/**
 * Canvas 2D operations-map renderer.
 *  - Province/sea/outline geometry → Path2D in world units (cached once).
 *  - Basemap (fills, patterns, borders, coastlines) rendered into an offscreen cache canvas
 *    for a camera snapshot with a margin; pans/zooms blit the cache, re-rendered when idle or
 *    when coverage runs out. Fill groups are cached per (layer, data version).
 *  - Overlay (routes, planning, labels, symbols, selection) drawn every frame from the single
 *    filtered MapObject dataset.
 *  - Horizontal world wrap: every layer draws the copies that intersect the viewport.
 */
import type { MapGeometry, PlanningDrawing } from '../../engine/index';
import { NODES, MAP, cityByNode, CITIES } from '../data/static';
import type { MapObject } from './objects';
import { symbolImage } from './symbols';
import { formatAge } from '../../data/catalog/symbol-render';
import { clampCamera, dLon, kmPerPx, pointInPolygon, screenToWorld, worldToScreen, wrapLon, zoomState, type Camera, type ZoomState } from './projection';
import { THEMES, makePatternTile, moraleColor, moralePattern, politicalColor, RELATION_STYLE, RESOURCE_STYLE, TERRAIN_STYLE, type PatternId, type Theme } from './palette';
import type { FillLayer, MapPrefs } from '../persist/prefs';

export interface RouteLine {
  id: string;
  points: [number, number][];
  kind: 'order' | 'preview' | 'blocked' | 'draft';
  label?: string;
  warPoints?: [number, number][];
}

export interface MapInput {
  owners: (string | null)[];
  me: string | null;
  relation: (owner: string) => 'self' | 'coalition' | 'access' | 'peace' | 'war';
  morale: Map<number, number>;
  rebel: Set<number>;
  objects: MapObject[];
  cityOwners: Map<string, string | null>;
  capitals: Set<number>;
  routes: RouteLine[];
  drawings: PlanningDrawing[];
  draft: { kind: string; points: [number, number][] } | null;
  selected: Set<string>;
  selectedNode: number | null;
  pinned: Set<string>;
  sensors: { lonlat: [number, number]; km: number }[];
  observedNodes: Set<number>;
  previewMarker: { lonlat: [number, number]; label: string } | null;
  alertIds: Set<string>;
}

export interface Hit {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'object' | 'cluster' | 'city' | 'small' | 'drawing';
  ids: string[];
  node?: number;
  label: string;
}

interface FillGroup {
  key: string;
  color: string;
  pattern: PatternId;
  path: Path2D;
}

const MARGIN = 0.5; // fraction of viewport per side

export class MapRenderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  w = 800;
  h = 600;
  dpr = 1;
  cam: Camera = { cx: 110, cy: 2, z: 20 };
  geom: MapGeometry | null = null;
  input: MapInput | null = null;
  prefs: MapPrefs;
  theme: Theme = THEMES.dark;
  mono = false;
  hits: Hit[] = [];
  lasso: { x0: number; y0: number; x1: number; y1: number } | null = null;
  hover: { x: number; y: number } | null = null;
  onFrame: ((ms: number) => void) | null = null;

  private shapePaths: (Path2D | null)[] = [];
  private shapeBBox: [number, number, number, number][] = [];
  private landBorder: Path2D | null = null;
  private seaBorder: Path2D | null = null;
  private outlinePath: Path2D | null = null;
  private outsidePath: Path2D | null = null;
  private grid = new Map<string, number[]>();
  private fillGroups: FillGroup[] = [];
  private fillKey = '';
  private patternCache = new Map<string, CanvasPattern | null>();
  private cache: HTMLCanvasElement;
  private cacheCam: Camera | null = null;
  private cacheW = 0;
  private cacheH = 0;
  private cacheKey = '';
  private dirty = true;
  private raf = 0;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private interacting = false;
  private dataVersion = 0;
  baseRenderMs = 0;

  constructor(canvas: HTMLCanvasElement, prefs: MapPrefs) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.cache = document.createElement('canvas');
    this.prefs = prefs;
  }

  // ───────────────────────── setup ─────────────────────────
  setGeometry(g: MapGeometry) {
    this.geom = g;
    this.shapePaths = [];
    this.shapeBBox = [];
    const land = new Path2D();
    const sea = new Path2D();
    const outside = new Path2D();
    for (const sh of g.shapes) {
      const p = new Path2D();
      for (const poly of sh.polygons) for (const ring of poly) {
        for (let i = 0; i < ring.length; i++) {
          const x = ring[i][0], y = -ring[i][1];
          if (i === 0) p.moveTo(x, y);
          else p.lineTo(x, y);
        }
        p.closePath();
      }
      this.shapePaths[sh.node] = p;
      this.shapeBBox[sh.node] = sh.bbox;
      const n = NODES[sh.node];
      if (!n) continue;
      if (n.kind === 'sea') sea.addPath(p);
      else if (n.outside) outside.addPath(p);
      else land.addPath(p);
      // grid index (10° cells)
      const [x0, y0, x1, y1] = sh.bbox;
      for (let gx = Math.floor(x0 / 10); gx <= Math.floor(x1 / 10); gx++)
        for (let gy = Math.floor(y0 / 10); gy <= Math.floor(y1 / 10); gy++) {
          const k = `${gx},${gy}`;
          const l = this.grid.get(k) ?? [];
          l.push(sh.node);
          this.grid.set(k, l);
        }
    }
    this.landBorder = land;
    this.seaBorder = sea;
    this.outsidePath = outside;
    const out = new Path2D();
    for (const o of g.outlines) for (const poly of o.polygons) for (const ring of poly) {
      for (let i = 0; i < ring.length; i++) {
        if (i === 0) out.moveTo(ring[i][0], -ring[i][1]);
        else out.lineTo(ring[i][0], -ring[i][1]);
      }
      out.closePath();
    }
    this.outlinePath = out;
    this.fillKey = '';
    this.invalidateBase();
  }

  resize(w: number, h: number, dpr: number) {
    this.w = Math.max(1, Math.round(w));
    this.h = Math.max(1, Math.round(h));
    this.dpr = Math.min(2, dpr || 1);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.cam = clampCamera(this.cam, this.w, this.h);
    this.patternCache.clear();
    this.invalidateBase();
  }

  setTheme(name: 'dark' | 'light') {
    if (this.theme.name === name) return;
    this.theme = THEMES[name];
    this.patternCache.clear();
    this.fillKey = '';
    this.invalidateBase();
  }

  setPrefs(p: MapPrefs) {
    const fillChanged = p.fill !== this.prefs.fill || p.borders !== this.prefs.borders;
    this.prefs = p;
    if (fillChanged) {
      this.fillKey = '';
      this.invalidateBase();
    }
    this.requestDraw();
  }

  setInput(input: MapInput, baseChanged: boolean) {
    this.input = input;
    if (baseChanged) {
      this.dataVersion++;
      this.fillKey = '';
      this.invalidateBase();
    }
    this.requestDraw();
  }

  setCamera(c: Camera, interacting = false) {
    this.cam = clampCamera(c, this.w, this.h);
    this.interacting = interacting;
    this.requestDraw();
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.interacting = false;
      if (this.cacheCam && Math.abs(this.cacheCam.z - this.cam.z) / this.cam.z > 0.001) this.invalidateBase();
      this.requestDraw();
    }, 160);
  }

  invalidateBase() {
    this.cacheCam = null;
    this.requestDraw();
  }

  requestDraw() {
    this.dirty = true;
    if (!this.raf) this.raf = requestAnimationFrame(() => this.draw());
  }

  destroy() {
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.settleTimer) clearTimeout(this.settleTimer);
  }

  get zoomState(): ZoomState {
    return zoomState(this.cam.z);
  }

  // ───────────────────────── hit testing ─────────────────────────
  nodeAt(lon: number, lat: number): number | null {
    const gx = Math.floor(lon / 10), gy = Math.floor(lat / 10);
    const cands = this.grid.get(`${gx},${gy}`) ?? [];
    let seaHit: number | null = null;
    for (const n of cands) {
      const b = this.shapeBBox[n];
      if (!b || lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
      const sh = this.geom!.shapes[NODES[n].shape] ?? this.geom!.shapes.find((s) => s.node === n);
      if (!sh) continue;
      for (const poly of sh.polygons) {
        if (pointInPolygon(lon, lat, poly)) {
          if (NODES[n].kind === 'land') return n;
          seaHit = n;
        }
      }
    }
    return seaHit;
  }

  /** Topmost interactive item at a screen point. */
  hitAt(x: number, y: number, slop = 4): Hit | null {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (x >= h.x - slop && x <= h.x + h.w + slop && y >= h.y - slop && y <= h.y + h.h + slop) return h;
    }
    return null;
  }

  hitsInRect(x0: number, y0: number, x1: number, y1: number): Hit[] {
    const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
    return this.hits.filter((h) => h.x + h.w / 2 >= ax && h.x + h.w / 2 <= bx && h.y + h.h / 2 >= ay && h.y + h.h / 2 <= by);
  }

  // ───────────────────────── basemap cache ─────────────────────────
  private pattern(id: PatternId): CanvasPattern | null {
    if (id === 'none') return null;
    const k = `${id}|${this.theme.name}|${this.dpr}`;
    if (this.patternCache.has(k)) return this.patternCache.get(k)!;
    const tile = makePatternTile(id, this.theme.pattern, this.dpr);
    const p = tile ? this.ctx.createPattern(tile, 'repeat') : null;
    this.patternCache.set(k, p);
    return p;
  }

  private buildFillGroups() {
    const input = this.input;
    const layer: FillLayer = this.prefs.fill;
    const key = `${layer}|${this.theme.name}|${this.dataVersion}|${!!input}`;
    if (key === this.fillKey && this.fillGroups.length) return;
    this.fillKey = key;
    const groups = new Map<string, FillGroup>();
    const th = this.theme;
    const t = th.name;
    const add = (n: number, color: string, pattern: PatternId) => {
      const p = this.shapePaths[n];
      if (!p) return;
      const k = `${color}|${pattern}`;
      let g = groups.get(k);
      if (!g) groups.set(k, (g = { key: k, color, pattern, path: new Path2D() }));
      g.path.addPath(p);
    };
    for (const n of NODES) {
      if (n.kind !== 'land') continue;
      if (n.outside) {
        add(n.id, th.outside, 'hatch2');
        continue;
      }
      const owner = input?.owners[n.id] ?? n.country;
      const rebel = input?.rebel.has(n.id);
      switch (layer) {
        case 'political':
          if (rebel) add(n.id, RELATION_STYLE.rebel[t], 'cross');
          else if (!owner) add(n.id, th.outside, 'hatch2');
          else if (owner === input?.me) add(n.id, th.self, 'none');
          else add(n.id, politicalColor(owner, th), 'none');
          break;
        case 'terrain': {
          const st = TERRAIN_STYLE[n.terrain] ?? TERRAIN_STYLE.open;
          add(n.id, st[t], st.pattern);
          break;
        }
        case 'morale': {
          const m = input?.morale.get(n.id);
          if (m === undefined) add(n.id, th.land, 'none');
          else add(n.id, moraleColor(m, th), moralePattern(m));
          break;
        }
        case 'resources': {
          const st = n.deposit ? RESOURCE_STYLE[n.deposit] : null;
          if (st) add(n.id, st[t], st.pattern);
          else add(n.id, th.land, 'none');
          break;
        }
        case 'relations': {
          if (rebel) add(n.id, RELATION_STYLE.rebel[t], 'cross');
          else if (!owner) add(n.id, RELATION_STYLE.none[t], 'hatch2');
          else {
            const r = input ? input.relation(owner) : 'peace';
            const st = RELATION_STYLE[r];
            add(n.id, st[t], st.pattern);
          }
          break;
        }
        case 'visibility': {
          const r = owner && input ? input.relation(owner) : 'peace';
          if (r === 'self' || r === 'coalition' || (input && input.observedNodes.has(n.id) && r === 'access')) add(n.id, th.self, 'none');
          else if (input?.observedNodes.has(n.id)) add(n.id, RELATION_STYLE.access[t], 'stipple');
          else add(n.id, th.outside, 'stipple');
          break;
        }
      }
    }
    this.fillGroups = [...groups.values()];
  }

  private copiesFor(xmin: number, xmax: number): number[] {
    const out: number[] = [];
    for (let k = Math.floor((xmin + 180) / 360) - 1; k <= Math.floor((xmax + 180) / 360) + 1; k++) {
      const a = -180 + k * 360, b = 180 + k * 360;
      if (b >= xmin && a <= xmax) out.push(k);
    }
    return out;
  }

  private renderBase() {
    const t0 = performance.now();
    this.buildFillGroups();
    const mw = Math.round(this.w * MARGIN), mh = Math.round(this.h * MARGIN);
    const cw = this.w + 2 * mw, ch = this.h + 2 * mh;
    const dpr = this.dpr;
    if (this.cache.width !== Math.round(cw * dpr) || this.cache.height !== Math.round(ch * dpr)) {
      this.cache.width = Math.round(cw * dpr);
      this.cache.height = Math.round(ch * dpr);
    }
    const g = this.cache.getContext('2d', { alpha: false })!;
    const cam = { ...this.cam };
    const th = this.theme;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = th.ocean;
    g.fillRect(0, 0, this.cache.width, this.cache.height);
    const z = cam.z;
    const zs = zoomState(z);
    const xmin = cam.cx - cw / 2 / z, xmax = cam.cx + cw / 2 / z;
    for (const k of this.copiesFor(xmin, xmax)) {
      g.setTransform(z * dpr, 0, 0, z * dpr, ((k * 360 - cam.cx) * z + cw / 2) * dpr, (-cam.cy * z + ch / 2) * dpr);
      const lw = (px: number) => px / z;
      // sea sector borders (local zoom)
      if (zs === 'local' && this.seaBorder) {
        g.strokeStyle = th.seaBorder;
        g.lineWidth = lw(0.8);
        g.stroke(this.seaBorder);
      }
      for (const fg of this.fillGroups) {
        g.fillStyle = fg.color;
        g.fill(fg.path);
        if (fg.pattern !== 'none' && (fg.pattern !== 'hatch2' || zs !== 'world')) {
          const pat = this.pattern(fg.pattern);
          if (pat) {
            pat.setTransform(new DOMMatrix().scale(1 / (z * dpr)));
            g.fillStyle = pat;
            g.fill(fg.path);
          }
        }
      }
      if (this.landBorder && zs !== 'world') {
        g.strokeStyle = th.provBorder;
        g.lineWidth = lw(zs === 'local' ? 0.9 : 0.5);
        g.stroke(this.landBorder);
      }
      if (this.prefs.borders && this.outlinePath) {
        g.strokeStyle = th.border;
        g.lineWidth = lw(zs === 'world' ? 0.6 : zs === 'regional' ? 1.1 : 1.6);
        g.stroke(this.outlinePath);
      } else if (this.outlinePath) {
        g.strokeStyle = th.coast;
        g.lineWidth = lw(0.5);
        g.stroke(this.outlinePath);
      }
    }
    this.cacheCam = cam;
    this.cacheW = cw;
    this.cacheH = ch;
    this.cacheKey = this.fillKey;
    this.baseRenderMs = performance.now() - t0;
  }

  private cacheCovers(): boolean {
    const cc = this.cacheCam;
    if (!cc || this.cacheKey !== this.fillKey) return false;
    const s = this.cam.z / cc.z;
    const dx = (-this.cacheW / 2) * s + dLon(cc.cx, this.cam.cx) * this.cam.z + this.w / 2;
    const dy = (-this.cacheH / 2) * s + (cc.cy - this.cam.cy) * this.cam.z + this.h / 2;
    return dx <= 1 && dy <= 1 && dx + this.cacheW * s >= this.w - 1 && dy + this.cacheH * s >= this.h - 1;
  }

  // ───────────────────────── frame ─────────────────────────
  draw() {
    this.raf = 0;
    if (!this.dirty) return;
    this.dirty = false;
    const t0 = performance.now();
    const ctx = this.ctx;
    const th = this.theme;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!this.geom) {
      ctx.fillStyle = th.ocean;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.fillStyle = th.textDim;
      ctx.font = '14px var(--font-sans, system-ui)';
      ctx.fillText('Loading map geometry…', 20, 30);
      return;
    }
    const needBase = !this.cacheCam || this.cacheKey !== this.fillKey || (!this.cacheCovers()) || (!this.interacting && Math.abs((this.cacheCam?.z ?? 0) - this.cam.z) / this.cam.z > 0.001);
    if (needBase) this.renderBase();
    const cc = this.cacheCam!;
    const s = this.cam.z / cc.z;
    const dx = (-this.cacheW / 2) * s + dLon(cc.cx, this.cam.cx) * this.cam.z + this.w / 2;
    const dy = (-this.cacheH / 2) * s + (cc.cy - this.cam.cy) * this.cam.z + this.h / 2;
    ctx.fillStyle = th.ocean;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.cache, dx, dy, this.cacheW * s, this.cacheH * s);
    this.hits = [];
    this.drawGraticule();
    const input = this.input;
    if (input) {
      const dense = input.objects.length > 60 || input.routes.some((r) => r.kind === 'preview' || r.kind === 'blocked');
      if (this.prefs.dim && dense) {
        ctx.fillStyle = th.dim;
        ctx.fillRect(0, 0, this.w, this.h);
      }
      if (this.prefs.sensors) this.drawSensors(input);
      if (input.selectedNode !== null) this.drawNodeHighlight(input.selectedNode);
      this.drawDrawings(input);
      if (this.prefs.routes) this.drawRoutes(input, false);
      this.drawRoutes(input, true);
      this.drawPlaces(input);
      if (this.prefs.symbols) this.drawObjects(input);
      else this.drawObjects({ ...input, objects: input.objects.filter((o) => input.selected.has(o.id)) });
      this.drawLocator(input);
      if (input.previewMarker) this.drawPreviewMarker(input.previewMarker);
    }
    if (this.lasso) {
      const l = this.lasso;
      ctx.save();
      ctx.strokeStyle = th.select;
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(Math.min(l.x0, l.x1), Math.min(l.y0, l.y1), Math.abs(l.x1 - l.x0), Math.abs(l.y1 - l.y0));
      ctx.fillStyle = 'rgba(255,210,26,0.08)';
      ctx.fillRect(Math.min(l.x0, l.x1), Math.min(l.y0, l.y1), Math.abs(l.x1 - l.x0), Math.abs(l.y1 - l.y0));
      ctx.restore();
    }
    this.onFrame?.(performance.now() - t0);
  }

  private sx(lon: number): number[] {
    // all screen x positions (wrap copies) of a longitude that fall near the viewport
    const base = dLon(lon, this.cam.cx) * this.cam.z + this.w / 2;
    const out: number[] = [];
    const span = 360 * this.cam.z;
    for (let k = -2; k <= 2; k++) {
      const x = base + k * span;
      if (x > -80 && x < this.w + 80) out.push(x);
    }
    return out;
  }
  private sy(lat: number): number {
    return (-lat - this.cam.cy) * this.cam.z + this.h / 2;
  }
  private toScreen(ll: [number, number]): [number, number] {
    return worldToScreen(this.cam, this.w, this.h, ll[0], ll[1]);
  }

  private drawGraticule() {
    const ctx = this.ctx;
    const z = this.cam.z;
    const step = z < 6 ? 30 : z < 20 ? 10 : z < 60 ? 5 : 1;
    ctx.save();
    ctx.strokeStyle = this.theme.graticule;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const [lonA] = screenToWorld(this.cam, this.w, this.h, 0, 0);
    const startLon = Math.floor((this.cam.cx - this.w / 2 / z) / step) * step;
    for (let lon = startLon; lon <= this.cam.cx + this.w / 2 / z + step; lon += step) {
      const x = (lon - this.cam.cx) * z + this.w / 2;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.h);
    }
    void lonA;
    for (let lat = -80; lat <= 80; lat += step) {
      const y = this.sy(lat);
      if (y < 0 || y > this.h) continue;
      ctx.moveTo(0, y);
      ctx.lineTo(this.w, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawNodeHighlight(node: number) {
    const p = this.shapePaths[node];
    if (!p) return;
    const ctx = this.ctx;
    const z = this.cam.z;
    ctx.save();
    for (const k of [-1, 0, 1]) {
      ctx.setTransform(z * this.dpr, 0, 0, z * this.dpr, ((k * 360 - this.cam.cx) * z + this.w / 2) * this.dpr, (-this.cam.cy * z + this.h / 2) * this.dpr);
      ctx.lineWidth = 3 / z;
      ctx.strokeStyle = '#000';
      ctx.stroke(p);
      ctx.lineWidth = 1.6 / z;
      ctx.strokeStyle = this.theme.select;
      ctx.setLineDash([4 / z, 3 / z]);
      ctx.stroke(p);
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  private drawSensors(input: MapInput) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(120,190,255,0.45)';
    ctx.fillStyle = 'rgba(120,190,255,0.05)';
    ctx.setLineDash([3, 3]);
    for (const s of input.sensors) {
      const r = s.km / kmPerPx(this.cam, s.lonlat[1]);
      if (r < 3) continue;
      const y = this.sy(s.lonlat[1]);
      for (const x of this.sx(s.lonlat[0])) {
        ctx.beginPath();
        ctx.ellipse(x, y, r, s.km / 111.32 * this.cam.z, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private polyline(points: [number, number][]) {
    // unwrap longitudes relative to the first point so lines never jump across the map
    const ctx = this.ctx;
    if (!points.length) return [] as [number, number][];
    const out: [number, number][] = [];
    let prevLon = points[0][0];
    let acc = points[0][0];
    for (let i = 0; i < points.length; i++) {
      if (i > 0) acc += dLon(points[i][0], prevLon);
      prevLon = points[i][0];
      out.push([acc, points[i][1]]);
    }
    void ctx;
    return out;
  }

  private strokeWorldLine(points: [number, number][], close = false) {
    const ctx = this.ctx;
    const pts = this.polyline(points);
    if (pts.length < 2) return;
    const base = (pts[0][0] - this.cam.cx);
    const firstX = dLon(pts[0][0], this.cam.cx) * this.cam.z + this.w / 2;
    const shift = firstX - (base * this.cam.z + this.w / 2);
    for (const k of [-1, 0, 1]) {
      const off = shift + k * 360 * this.cam.z;
      ctx.beginPath();
      pts.forEach(([lon, lat], i) => {
        const x = (lon - this.cam.cx) * this.cam.z + this.w / 2 + off;
        const y = this.sy(lat);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (close) ctx.closePath();
      ctx.stroke();
    }
  }

  private drawRoutes(input: MapInput, previews: boolean) {
    const ctx = this.ctx;
    const th = this.theme;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const r of input.routes) {
      const isPreview = r.kind === 'preview' || r.kind === 'blocked';
      if (isPreview !== previews) continue;
      const color = r.kind === 'blocked' ? th.routeBad : r.kind === 'preview' ? th.select : r.kind === 'draft' ? th.routeDraft : th.route;
      ctx.lineWidth = isPreview ? 4.5 : 3.5;
      ctx.strokeStyle = th.halo;
      ctx.setLineDash([]);
      this.strokeWorldLine(r.points);
      ctx.lineWidth = isPreview ? 2.4 : 1.6;
      ctx.strokeStyle = color;
      ctx.setLineDash(r.kind === 'blocked' ? [2, 5] : isPreview ? [9, 5] : r.kind === 'draft' ? [4, 4] : []);
      this.strokeWorldLine(r.points);
      // endpoint marker
      const end = r.points[r.points.length - 1];
      if (end) {
        const y = this.sy(end[1]);
        for (const x of this.sx(end[0])) {
          ctx.setLineDash([]);
          ctx.fillStyle = color;
          ctx.strokeStyle = th.halo;
          ctx.lineWidth = 2;
          ctx.beginPath();
          if (r.kind === 'order') {
            // committed destination: filled diamond
            ctx.moveTo(x, y - 6);
            ctx.lineTo(x + 6, y);
            ctx.lineTo(x, y + 6);
            ctx.lineTo(x - 6, y);
            ctx.closePath();
          } else ctx.arc(x, y, 5.5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fill();
          if (r.label && isPreview) this.text(r.label, x + 10, y - 10, { color: th.text, bold: true, size: 12, align: 'left' });
        }
      }
      for (const wp of r.warPoints ?? []) {
        const y = this.sy(wp[1]);
        for (const x of this.sx(wp[0])) {
          ctx.setLineDash([]);
          ctx.fillStyle = th.routeBad;
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x, y - 9);
          ctx.lineTo(x + 8, y + 6);
          ctx.lineTo(x - 8, y + 6);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          this.text('!', x, y + 4, { color: '#fff', bold: true, size: 11, halo: false });
        }
      }
    }
    ctx.restore();
  }

  private drawDrawings(input: MapInput) {
    const ctx = this.ctx;
    const th = this.theme;
    const list = input.drawings.filter((d) => !d.hidden);
    const all: { kind: string; points: [number, number][]; name?: string; draft?: boolean }[] = list.map((d) => ({ kind: d.kind, points: d.points, name: d.name }));
    if (input.draft) all.push({ kind: input.draft.kind, points: input.draft.points, draft: true });
    ctx.save();
    for (const d of all) {
      const col = '#c58cff';
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.setLineDash(d.kind === 'route' ? [7, 3, 2, 3] : d.kind === 'phase_line' ? [12, 4] : []);
      if (d.points.length >= 2 && (d.kind === 'route' || d.kind === 'phase_line' || d.kind === 'area')) {
        this.strokeWorldLine(d.points, d.kind === 'area' && !d.draft);
        if (d.kind === 'area' && d.points.length > 2) {
          ctx.fillStyle = 'rgba(197,140,255,0.08)';
          const pts = this.polyline(d.points);
          const y0 = this.sy(pts[0][1]);
          void y0;
          ctx.beginPath();
          const x0s = this.sx(pts[0][0]);
          const shift = (x0s[0] ?? 0) - ((pts[0][0] - this.cam.cx) * this.cam.z + this.w / 2);
          pts.forEach(([lon, lat], i) => {
            const x = (lon - this.cam.cx) * this.cam.z + this.w / 2 + shift;
            const y = this.sy(lat);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.setLineDash([]);
      for (const p of d.points) {
        const y = this.sy(p[1]);
        for (const x of this.sx(p[0])) {
          if (d.kind === 'objective') {
            ctx.beginPath();
            ctx.arc(x, y, 8, 0, Math.PI * 2);
            ctx.moveTo(x - 11, y);
            ctx.lineTo(x + 11, y);
            ctx.moveTo(x, y - 11);
            ctx.lineTo(x, y + 11);
            ctx.stroke();
          } else if (d.kind === 'bookmark') {
            ctx.fillStyle = col;
            ctx.beginPath();
            ctx.moveTo(x - 5, y - 12);
            ctx.lineTo(x + 5, y - 12);
            ctx.lineTo(x + 5, y);
            ctx.lineTo(x, y - 4);
            ctx.lineTo(x - 5, y);
            ctx.closePath();
            ctx.fill();
          } else if (d.draft || d.kind === 'label') {
            ctx.fillStyle = col;
            ctx.fillRect(x - 2.5, y - 2.5, 5, 5);
          }
        }
      }
      if (d.name && d.points.length) {
        const p = d.points[Math.floor((d.points.length - 1) / 2)];
        const y = this.sy(p[1]);
        for (const x of this.sx(p[0])) this.text(d.name, x + 8, y - 8, { color: col, size: 12, align: 'left', italic: true });
      }
    }
    ctx.restore();
    void th;
  }

  private labels: { x: number; y: number; w: number; h: number }[] = [];
  private fits(x: number, y: number, w: number, h: number): boolean {
    for (const r of this.labels) if (x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y) return false;
    return true;
  }

  private text(s: string, x: number, y: number, o: { color?: string; size?: number; bold?: boolean; italic?: boolean; align?: CanvasTextAlign; halo?: boolean; collide?: boolean; caps?: boolean } = {}): boolean {
    const ctx = this.ctx;
    const size = o.size ?? 12;
    ctx.font = `${o.italic ? 'italic ' : ''}${o.bold ? '600 ' : ''}${size}px Inter, "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif`;
    const str = o.caps ? s.toUpperCase() : s;
    const w = ctx.measureText(str).width;
    const align = o.align ?? 'center';
    const lx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    if (o.collide) {
      if (!this.fits(lx - 2, y - size, w + 4, size + 4)) return false;
      this.labels.push({ x: lx - 2, y: y - size, w: w + 4, h: size + 4 });
    }
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    if (o.halo !== false) {
      ctx.strokeStyle = this.theme.halo;
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.strokeText(str, x, y);
    }
    ctx.fillStyle = o.color ?? this.theme.text;
    ctx.fillText(str, x, y);
    return true;
  }

  private drawPlaces(input: MapInput) {
    const ctx = this.ctx;
    const th = this.theme;
    const zs = this.zoomState;
    this.labels = [];
    // reserve label space for selections/alerts first (priority: selection & alerts > pinned > neighbours)
    const nameOn = this.prefs.names;
    // country names (world + regional)
    const countryLabels: { x: number; y: number; text: string; pri: number; small: boolean; id: string }[] = [];
    if (nameOn && zs !== 'local') {
      for (const c of MAP.data.countries) {
        const y = this.sy(c.labelAt[1]);
        if (y < -20 || y > this.h + 20) continue;
        for (const x of this.sx(c.labelAt[0])) countryLabels.push({ x, y, text: c.name, pri: c.id === input.me ? 100 : c.provinces.length, small: !!c.small, id: c.id });
      }
    }
    // cities
    type CityLabel = { x: number; y: number; name: string; tier: number; capital: boolean; port: boolean; node: number; pri: number; owner: string | null };
    const cityItems: CityLabel[] = [];
    for (const c of CITIES) {
      const owner = input.cityOwners.get(c.key) ?? c.country;
      const show = zs === 'local' || (zs === 'regional' && (c.tier >= 3 || c.capital || c.port)) || (zs === 'world' && c.capital);
      if (!show) continue;
      const y = this.sy(c.lonlat[1]);
      if (y < -10 || y > this.h + 10) continue;
      for (const x of this.sx(c.lonlat[0])) {
        if (x < -10 || x > this.w + 10) continue;
        const pri = (input.selectedNode === c.node ? 1000 : 0) + (c.capital ? 50 : 0) + c.tier * 5 + (owner === input.me ? 20 : 0);
        cityItems.push({ x, y, name: c.name, tier: c.tier, capital: c.capital, port: c.port, node: c.node, pri, owner });
      }
    }
    cityItems.sort((a, b) => b.pri - a.pri);
    // province centres (local)
    if (zs === 'local') {
      ctx.fillStyle = th.textDim;
      for (const n of NODES) {
        if (n.kind !== 'land' || n.outside || cityByNode.has(n.id)) continue;
        const y = this.sy(n.center[1]);
        if (y < 0 || y > this.h) continue;
        for (const x of this.sx(n.center[0])) {
          if (x < 0 || x > this.w) continue;
          ctx.beginPath();
          ctx.arc(x, y, 2, 0, Math.PI * 2);
          ctx.fill();
          if (this.cam.z > 70 && nameOn) this.text(n.name, x, y + 13, { size: 10, color: th.textDim, collide: true });
          if (this.prefs.fill === 'resources' && n.deposit) this.text(RESOURCE_STYLE[n.deposit].glyph, x + 7, y - 4, { size: 10, bold: true, color: th.text, align: 'left' });
        }
      }
    } else if (zs === 'regional' && this.prefs.fill === 'resources') {
      for (const n of NODES) {
        if (!n.deposit) continue;
        const y = this.sy(n.center[1]);
        for (const x of this.sx(n.center[0])) if (x > 0 && x < this.w && y > 0 && y < this.h) this.text(RESOURCE_STYLE[n.deposit].glyph, x, y + 4, { size: 10, bold: true, color: th.text });
      }
    }
    // city markers
    for (const c of cityItems) {
      const r = c.capital ? 4.5 : 2.5 + c.tier * 0.5;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = th.halo;
      ctx.fillStyle = c.owner === input.me ? '#ffffff' : th.text;
      ctx.beginPath();
      if (c.capital) {
        // capital: star-like square with inner dot
        ctx.rect(c.x - r, c.y - r, r * 2, r * 2);
        ctx.stroke();
        ctx.fill();
        ctx.fillStyle = th.halo;
        ctx.fillRect(c.x - 1.5, c.y - 1.5, 3, 3);
      } else {
        ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fill();
      }
      if (c.port && zs !== 'world') {
        // port: small anchor tick below-right
        ctx.strokeStyle = th.text;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(c.x + r + 4, c.y + r + 2, 2.5, 0, Math.PI);
        ctx.moveTo(c.x + r + 4, c.y + r - 2);
        ctx.lineTo(c.x + r + 4, c.y + r + 4.5);
        ctx.stroke();
      }
      this.hits.push({ x: c.x - 7, y: c.y - 7, w: 14, h: 14, kind: 'city', ids: [], node: c.node, label: c.name });
    }
    // labels: selection first, then cities by priority, then countries
    for (const c of cityItems) {
      if (!nameOn && input.selectedNode !== c.node) continue;
      const size = c.capital ? 13 : c.tier >= 4 ? 12 : 11;
      this.text(c.name, c.x + 7, c.y - 5, { size, bold: c.capital || input.selectedNode === c.node, align: 'left', collide: true, color: input.selectedNode === c.node ? th.select : th.text });
    }
    countryLabels.sort((a, b) => b.pri - a.pri);
    for (const l of countryLabels) {
      if (l.small && zs === 'world') {
        // small states: offset point label with leader line + clickable marker
        const ox = l.x + 22, oy = l.y - 16;
        ctx.strokeStyle = th.textDim;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(l.x, l.y);
        ctx.lineTo(ox - 2, oy + 3);
        ctx.stroke();
        ctx.fillStyle = th.select;
        ctx.strokeStyle = '#000';
        ctx.beginPath();
        ctx.arc(l.x, l.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        this.text(l.text, ox, oy, { size: 11, align: 'left', collide: true, color: th.text });
        const cap = MAP.countryById.get(l.id)?.capital;
        const capNode = cap ? MAP.cityByKey.get(cap)?.node : undefined;
        this.hits.push({ x: l.x - 8, y: l.y - 8, w: 16, h: 16, kind: 'small', ids: [l.id], node: capNode, label: l.text });
        continue;
      }
      const size = zs === 'world' ? (l.pri > 60 ? 13 : 11) : 15;
      this.text(l.text, l.x, l.y, { size, bold: true, caps: true, collide: true, color: zs === 'world' ? th.text : th.textDim });
    }
  }

  private drawObjects(input: MapInput) {
    const ctx = this.ctx;
    const th = this.theme;
    const zs = this.zoomState;
    const size = zs === 'local' ? 28 : zs === 'regional' ? 22 : 18;
    // world zoom: only selected groups, pinned items and alerts
    let objs = input.objects;
    if (zs === 'world') objs = objs.filter((o) => input.selected.has(o.id) || input.pinned.has(o.id) || input.alertIds.has(o.id));
    // project + cluster
    type P = { o: MapObject; x: number; y: number };
    const pts: P[] = [];
    for (const o of objs) {
      const y = this.sy(o.lonlat[1]);
      if (y < -40 || y > this.h + 40) continue;
      for (const x of this.sx(o.lonlat[0])) pts.push({ o, x, y });
    }
    // priority: selected/alerts > pinned > own > contacts
    const pri = (p: P) => (input.selected.has(p.o.id) ? 1000 : 0) + (input.alertIds.has(p.o.id) ? 500 : 0) + (input.pinned.has(p.o.id) ? 200 : 0) + (p.o.kind === 'stack' ? 50 : p.o.kind === 'contact' ? 30 : 10);
    pts.sort((a, b) => pri(b) - pri(a));
    const radius = zs === 'local' ? 16 : 20;
    const clusters: { x: number; y: number; items: P[] }[] = [];
    for (const p of pts) {
      // cluster only compatible observations (same node or within radius) — friendly with friendly, contacts with contacts
      const c = clusters.find((cl) => Math.abs(cl.x - p.x) < radius && Math.abs(cl.y - p.y) < radius && compatible(cl.items[0].o, p.o));
      if (c) c.items.push(p);
      else clusters.push({ x: p.x, y: p.y, items: [p] });
    }
    // regional: limit overlapping clusters (non-overlapping symbols); count hidden ones
    const placed: { x: number; y: number }[] = [];
    const mono = this.mono ? '#e8e8e8' : false;
    for (const cl of clusters) {
      const lead = cl.items[0];
      if (zs !== 'local' && placed.some((q) => Math.abs(q.x - cl.x) < size * 0.9 && Math.abs(q.y - cl.y) < size * 0.9) && !input.selected.has(lead.o.id)) continue;
      placed.push({ x: cl.x, y: cl.y });
      const img = symbolImage(lead.o.sidc, size, mono);
      const iw = img.w, ih = img.h;
      const left = cl.x - img.cx, top = cl.y - img.cy;
      const muted = lead.o.kind === 'report' || (lead.o.kind === 'contact' && lead.o.stale);
      if (img.ready) {
        ctx.globalAlpha = muted ? 0.6 : 1;
        ctx.drawImage(img.img, left, top, iw, ih);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = th.textDim;
        ctx.fillRect(cl.x - size / 2, cl.y - size / 3, size, size * 0.66);
      }
      const isSel = cl.items.some((p) => input.selected.has(p.o.id));
      if (isSel) {
        const r = size * 0.95;
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#000';
        ctx.beginPath();
        ctx.arc(cl.x, cl.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 2;
        ctx.strokeStyle = th.select;
        ctx.stroke();
      }
      if (input.pinned.has(lead.o.id)) {
        ctx.fillStyle = th.select;
        ctx.beginPath();
        ctx.arc(cl.x - size * 0.75, cl.y - size * 0.6, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      // report marker (eye) — frozen dated snapshot, external to frame
      if (lead.o.kind === 'report') this.badge('REPORT ' + formatAge(lead.o.ageMin ?? 0), cl.x, top - 2, true);
      else if (lead.o.ageMin !== null && lead.o.ageMin >= 60) this.badge(formatAge(lead.o.ageMin), cl.x + size * 0.7, top + 4, true);
      if (cl.items.length > 1) this.badge(`×${cl.items.length}`, cl.x + size * 0.75, cl.y + size * 0.55, false);
      if (lead.o.hasOrder && zs !== 'world') {
        ctx.fillStyle = th.route;
        ctx.beginPath();
        ctx.moveTo(cl.x + size * 0.62, cl.y - 3);
        ctx.lineTo(cl.x + size * 0.62 + 6, cl.y);
        ctx.lineTo(cl.x + size * 0.62, cl.y + 3);
        ctx.fill();
      }
      if (zs === 'local' && (lead.o.designation || lead.o.kind !== 'stack')) {
        const lab = lead.o.designation ?? lead.o.label;
        this.text(lab.length > 26 ? lab.slice(0, 25) + '…' : lab, cl.x, top + ih + 8, { size: 11, collide: !isSel, color: isSel ? th.select : th.text });
      }
      this.hits.push({ x: cl.x - size * 0.6, y: cl.y - size * 0.5, w: size * 1.2, h: size, kind: cl.items.length > 1 ? 'cluster' : 'object', ids: cl.items.map((p) => p.o.id), label: cl.items.length > 1 ? `${cl.items.length} objects` : lead.o.label });
    }
  }

  private badge(s: string, x: number, y: number, dashed: boolean) {
    const ctx = this.ctx;
    ctx.font = '600 10px Inter, "Segoe UI", system-ui, sans-serif';
    const w = ctx.measureText(s).width + 8;
    const h = 13;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.setLineDash(dashed ? [2, 1] : []);
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h + 2, w, h, 6);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.fillText(s, x, y - 1);
  }

  private drawLocator(input: MapInput) {
    // off-screen selection locator: arrow at the viewport edge pointing to the selected object
    const sel = input.objects.filter((o) => input.selected.has(o.id));
    const ctx = this.ctx;
    for (const o of sel.slice(0, 3)) {
      const [x, y] = this.toScreen(o.lonlat);
      if (x >= 0 && x <= this.w && y >= 0 && y <= this.h) continue;
      const cx = this.w / 2, cy = this.h / 2;
      const ang = Math.atan2(y - cy, x - cx);
      const ex = Math.max(28, Math.min(this.w - 28, cx + Math.cos(ang) * this.w));
      const ey = Math.max(28, Math.min(this.h - 28, cy + Math.sin(ang) * this.h));
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(ang);
      ctx.fillStyle = this.theme.select;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(-6, -9);
      ctx.lineTo(-2, 0);
      ctx.lineTo(-6, 9);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      this.text(o.label.slice(0, 22), ex - Math.cos(ang) * 22, ey - Math.sin(ang) * 22 + 4, { size: 11, color: this.theme.select });
      this.hits.push({ x: ex - 12, y: ey - 12, w: 24, h: 24, kind: 'object', ids: [o.id], label: `Locate ${o.label}` });
    }
  }

  private drawPreviewMarker(m: { lonlat: [number, number]; label: string }) {
    const ctx = this.ctx;
    const [x, y] = this.toScreen(m.lonlat);
    ctx.save();
    ctx.strokeStyle = this.theme.select;
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(x, y, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    this.text(m.label, x, y - 20, { size: 12, bold: true, color: this.theme.select });
  }

  // ───────────────────────── camera helpers ─────────────────────────
  zoomAt(factor: number, sx: number, sy: number) {
    const [lon, lat] = screenToWorld(this.cam, this.w, this.h, sx, sy);
    const z = this.cam.z * factor;
    const next = clampCamera({ ...this.cam, z }, this.w, this.h);
    // keep (lon,lat) under the pointer
    const cx = lon - (sx - this.w / 2) / next.z;
    const cy = -lat - (sy - this.h / 2) / next.z;
    this.setCamera({ cx: wrapLon(cx), cy, z: next.z }, true);
  }

  panBy(dx: number, dy: number) {
    this.setCamera({ cx: this.cam.cx - dx / this.cam.z, cy: this.cam.cy - dy / this.cam.z, z: this.cam.z }, true);
  }

  center(lon: number, lat: number, z?: number) {
    this.setCamera({ cx: lon, cy: -lat, z: z ?? this.cam.z });
  }

  scaleBar(): { px: number; label: string } {
    const lat = -this.cam.cy;
    const kpp = kmPerPx(this.cam, lat);
    const target = kpp * 120;
    const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
    const km = nice.reduce((b, v) => (v <= target ? v : b), 1);
    return { px: km / kpp, label: `${km.toLocaleString()} km` };
  }
}

function compatible(a: MapObject, b: MapObject): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'stack') return true;
  return a.affiliation === b.affiliation && a.domain === b.domain;
}
