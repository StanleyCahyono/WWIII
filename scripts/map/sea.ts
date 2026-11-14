/**
 * Sea zones: a 0.05° land/water raster (water = not inside any source polygon; the only inland
 * water body in the source is the Caspian), a deterministic Poisson-like seed set (dense near
 * coasts, sparse offshore), nearest-seed assignment with a water-connectivity fix (a zone never
 * spans an isthmus), two Lloyd iterations, and topology-preserving vectorisation (each boundary
 * chain between two zones is simplified once, so neighbours share identical edges).
 * Zone polygons extend a few cells under the land so coastlines drawn on top hide the raster.
 */
import type { Pt, Poly, MultiPoly, Ring } from './geo';
import { douglasPeucker, simplifyClosed, signedArea, ringContains, orientPoly, R_EARTH } from './geo';

export const RES = 0.05;
export const W = Math.round(360 / RES);
export const H = Math.round(180 / RES);
const D2R = Math.PI / 180;
const CELL_KM = RES * 111.32;

export interface SeaOptions {
  coastSpacingKm: number;
  offshoreSlope: number;
  maxSpacingKm: number;
  polarSouthSpacingKm: number;
  minForcedComponentKm2: number;
  lloydIterations: number;
  dilateCells: number;
  tolInner: number;
  tolOuter: number;
}

export interface SeaResult {
  land: Uint8Array;
  label: Int32Array; // water cells → zone id, else -1
  comp: Int32Array; // water component id, -1 for land
  compArea: number[];
  zones: { center: Pt; areaKm2: number; comp: number; touchesLand: boolean }[];
  /** zone pairs "a|b" (a<b) → shared raster edge count */
  adjacency: Map<string, number>;
  polygons: MultiPoly[];
  stats: { waterComponents: number; seeds: number; forcedSeeds: number };
}

export const cellLon = (c: number) => -180 + (c + 0.5) * RES;
export const cellLat = (r: number) => 90 - (r + 0.5) * RES;
export const colOf = (lon: number) => ((Math.floor((lon + 180) / RES) % W) + W) % W;
export const rowOf = (lat: number) => Math.max(0, Math.min(H - 1, Math.floor((90 - lat) / RES)));

/** Even-odd scanline fill of a polygon (lon may exceed ±180; columns wrap). */
export function rasterizePoly(poly: Poly, out: Uint8Array, value = 1): void {
  const rows = new Map<number, number[]>();
  for (const ring of poly) {
    for (let i = 0, n = ring.length; i < n - 1; i++) {
      const x1 = (ring[i][0] + 180) / RES - 0.5, y1 = (90 - ring[i][1]) / RES - 0.5;
      const x2 = (ring[i + 1][0] + 180) / RES - 0.5, y2 = (90 - ring[i + 1][1]) / RES - 0.5;
      if (y1 === y2) continue;
      const ya = Math.min(y1, y2), yb = Math.max(y1, y2);
      for (let r = Math.max(0, Math.ceil(ya)); r < yb && r < H; r++) {
        if (r < ya) continue;
        const x = x1 + ((r - y1) * (x2 - x1)) / (y2 - y1);
        let a = rows.get(r);
        if (!a) rows.set(r, (a = []));
        a.push(x);
      }
    }
  }
  for (const [r, xs] of rows) {
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.ceil(xs[k]), c1 = Math.floor(xs[k + 1]);
      for (let c = c0; c <= c1; c++) out[r * W + (((c % W) + W) % W)] = value;
    }
  }
}

function fibonacciSphere(n: number): Pt[] {
  const out: Pt[] = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const z = 1 - (2 * (i + 0.5)) / n;
    const lat = Math.asin(z) / D2R;
    let lon = ((i * ga) / D2R) % 360;
    if (lon > 180) lon -= 360;
    out.push([lon, lat]);
  }
  return out;
}

const vec = (p: Pt): [number, number, number] => {
  const la = p[1] * D2R, lo = p[0] * D2R;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
};

export function buildSea(landPolys: Poly[], forcedSeeds: Pt[], opt: SeaOptions, barriers: readonly [number, number, number, number][] = []): SeaResult {
  const N = W * H;
  const land = new Uint8Array(N);
  for (const p of landPolys) rasterizePoly(p, land, 1);
  // the source clips Antarctica at ~85.2°S: treat the polar cap as land
  for (let r = rowOf(-85.0); r < H; r++) for (let c = 0; c < W; c++) land[r * W + c] = 1;
  // controlled narrows (e.g. Turkish Straits) are closed in the raster; canal edges reconnect them
  for (const [x0, y0, x1, y1] of barriers) {
    for (let r = rowOf(y1); r <= rowOf(y0); r++) for (let c = colOf(x0); c <= colOf(x1); c++) land[r * W + c] = 1;
  }

  // per-row geometry
  const cosLat = new Float64Array(H), sinLat = new Float64Array(H), cellArea = new Float64Array(H);
  for (let r = 0; r < H; r++) {
    const la = cellLat(r) * D2R;
    cosLat[r] = Math.cos(la); sinLat[r] = Math.sin(la);
    cellArea[r] = CELL_KM * CELL_KM * Math.cos(la);
  }
  const cosLon = new Float64Array(W), sinLon = new Float64Array(W);
  for (let c = 0; c < W; c++) { const lo = cellLon(c) * D2R; cosLon[c] = Math.cos(lo); sinLon[c] = Math.sin(lo); }

  // water components (4-connected, x wraps)
  const comp = new Int32Array(N).fill(-1);
  const compArea: number[] = [];
  const queue = new Int32Array(N);
  for (let start = 0; start < N; start++) {
    if (land[start] || comp[start] >= 0) continue;
    const id = compArea.length;
    let area = 0, qh = 0, qt = 0;
    queue[qt++] = start; comp[start] = id;
    while (qh < qt) {
      const v = queue[qh++];
      const r = (v / W) | 0, c = v - r * W;
      area += cellArea[r];
      const nb = [r > 0 ? v - W : -1, r < H - 1 ? v + W : -1, r * W + ((c + 1) % W), r * W + ((c + W - 1) % W)];
      for (const u of nb) if (u >= 0 && !land[u] && comp[u] < 0) { comp[u] = id; queue[qt++] = u; }
    }
    compArea.push(area);
  }

  // coarse distance-to-land (0.25°) for seed spacing
  const CF = 5, CW = W / CF, CH = H / CF;
  const cd = new Float64Array(CW * CH);
  for (let R = 0; R < CH; R++) for (let C = 0; C < CW; C++) {
    let lc = 0;
    for (let a = 0; a < CF; a++) for (let b = 0; b < CF; b++) lc += land[(R * CF + a) * W + C * CF + b];
    cd[R * CW + C] = lc > 0 ? 0 : 1e9;
  }
  const cdy = 0.25 * 111.32;
  for (let pass = 0; pass < 2; pass++) {
    for (let R = 0; R < CH; R++) {
      const dx = cdy * Math.max(0.05, Math.cos((90 - (R + 0.5) * 0.25) * D2R));
      const dg = Math.hypot(dx, cdy);
      for (let C = 0; C < CW; C++) {
        const i = R * CW + C;
        const l = R * CW + ((C + CW - 1) % CW);
        let d = Math.min(cd[i], cd[l] + dx);
        if (R > 0) d = Math.min(d, cd[i - CW] + cdy, cd[(R - 1) * CW + ((C + CW - 1) % CW)] + dg, cd[(R - 1) * CW + ((C + 1) % CW)] + dg);
        cd[i] = d;
      }
    }
    for (let R = CH - 1; R >= 0; R--) {
      const dx = cdy * Math.max(0.05, Math.cos((90 - (R + 0.5) * 0.25) * D2R));
      const dg = Math.hypot(dx, cdy);
      for (let C = CW - 1; C >= 0; C--) {
        const i = R * CW + C;
        const rr = R * CW + ((C + 1) % CW);
        let d = Math.min(cd[i], cd[rr] + dx);
        if (R < CH - 1) d = Math.min(d, cd[i + CW] + cdy, cd[(R + 1) * CW + ((C + 1) % CW)] + dg, cd[(R + 1) * CW + ((C + CW - 1) % CW)] + dg);
        cd[i] = d;
      }
    }
  }
  const distAt = (lon: number, lat: number) => cd[Math.min(CH - 1, Math.floor((90 - lat) / 0.25)) * CW + (Math.floor((lon + 180) / 0.25) % CW)];

  // seeds
  const cand = fibonacciSphere(42000);
  const accepted: Pt[] = [];
  const accV: [number, number, number][] = [];
  const accR: number[] = [];
  const spacing = (p: Pt) => {
    const d = distAt(p[0], p[1]);
    const base = p[1] < -60 ? opt.polarSouthSpacingKm : opt.coastSpacingKm;
    return Math.min(opt.maxSpacingKm, base + opt.offshoreSlope * d);
  };
  const tryAccept = (p: Pt, force: boolean) => {
    const v = vec(p);
    const rp = spacing(p);
    if (!force) {
      for (let k = 0; k < accV.length; k++) {
        const dot = v[0] * accV[k][0] + v[1] * accV[k][1] + v[2] * accV[k][2];
        const dist = Math.acos(Math.max(-1, Math.min(1, dot))) * R_EARTH;
        if (dist < Math.min(rp, accR[k])) return false;
      }
    }
    accepted.push(p); accV.push(v); accR.push(rp);
    return true;
  };
  for (const p of forcedSeeds) tryAccept(p, true);
  // deterministic visiting order (hash-shuffled) to avoid latitude banding
  const order = cand.map((_, i) => i).sort((a, b) => ((a * 2654435761) >>> 0) - ((b * 2654435761) >>> 0));
  for (const i of order) {
    const p = cand[i];
    const r = rowOf(p[1]), c = colOf(p[0]);
    const v = r * W + c;
    if (land[v]) continue;
    if (compArea[comp[v]] < opt.minForcedComponentKm2) continue;
    if (distAt(p[0], p[1]) < 12 && compArea[comp[v]] > 50000) continue;
    tryAccept([cellLon(c), cellLat(r)], false);
  }
  // every sizeable water component gets at least one seed
  const compHasSeed = new Uint8Array(compArea.length);
  for (const p of accepted) { const v = rowOf(p[1]) * W + colOf(p[0]); if (comp[v] >= 0) compHasSeed[comp[v]] = 1; }
  let forced = 0;
  const csum = compArea.map(() => [0, 0, 0, 0]);
  for (let v = 0; v < N; v++) {
    const k = comp[v];
    if (k < 0 || compHasSeed[k] || compArea[k] < opt.minForcedComponentKm2) continue;
    const r = (v / W) | 0, c = v - r * W;
    const s = csum[k];
    s[0] += cosLat[r] * cosLon[c]; s[1] += cosLat[r] * sinLon[c]; s[2] += sinLat[r]; s[3]++;
  }
  const bestCell = new Int32Array(compArea.length).fill(-1);
  const bestDot = new Float64Array(compArea.length).fill(-2);
  for (let v = 0; v < N; v++) {
    const k = comp[v];
    if (k < 0 || compHasSeed[k] || compArea[k] < opt.minForcedComponentKm2) continue;
    const r = (v / W) | 0, c = v - r * W;
    const s = csum[k];
    const dot = s[0] * cosLat[r] * cosLon[c] + s[1] * cosLat[r] * sinLon[c] + s[2] * sinLat[r];
    if (dot > bestDot[k]) { bestDot[k] = dot; bestCell[k] = v; }
  }
  for (let k = 0; k < compArea.length; k++) {
    if (bestCell[k] < 0) continue;
    const v = bestCell[k], r = (v / W) | 0, c = v - r * W;
    tryAccept([cellLon(c), cellLat(r)], true);
    forced++;
  }

  const label = new Int32Array(N).fill(-1);
  const assign = (seeds: Pt[]) => {
    const sv = seeds.map(vec);
    // coarse candidate lists (1° cells)
    const G = 20, GW = W / G, GH = H / G;
    const cands: Int32Array[] = new Array(GW * GH);
    const marginRad = 1.6 * D2R;
    for (let R = 0; R < GH; R++) for (let C = 0; C < GW; C++) {
      const p: Pt = [-180 + (C + 0.5) * G * RES, 90 - (R + 0.5) * G * RES];
      const v = vec(p);
      const ang = sv.map((s) => Math.acos(Math.max(-1, Math.min(1, v[0] * s[0] + v[1] * s[1] + v[2] * s[2]))));
      const mn = Math.min(...ang);
      const lst: number[] = [];
      ang.forEach((a, i) => { if (a <= mn + 2 * marginRad) lst.push(i); });
      cands[R * GW + C] = Int32Array.from(lst);
    }
    label.fill(-1);
    for (let r = 0; r < H; r++) {
      const R = (r / G) | 0;
      const cl = cosLat[r], sl = sinLat[r];
      for (let c = 0; c < W; c++) {
        const v = r * W + c;
        if (land[v]) continue;
        const k = comp[v];
        if (compArea[k] < opt.minForcedComponentKm2) continue;
        const lst = cands[R * GW + ((c / G) | 0)];
        const x = cl * cosLon[c], y = cl * sinLon[c];
        let best = -1, bd = -2;
        for (let q = 0; q < lst.length; q++) {
          const s = sv[lst[q]];
          const d = x * s[0] + y * s[1] + sl * s[2];
          if (d > bd) { bd = d; best = lst[q]; }
        }
        label[v] = best;
      }
    }
    // connectivity fix: keep only the part of each zone connected (through same-label water) to its seed
    const reached = new Uint8Array(N);
    let qt = 0;
    seeds.forEach((p, s) => {
      const v0 = rowOf(p[1]) * W + colOf(p[0]);
      if (label[v0] !== s || reached[v0]) return;
      let qh = qt;
      queue[qt++] = v0; reached[v0] = 1;
      while (qh < qt) {
        const v = queue[qh++];
        const r = (v / W) | 0, c = v - r * W;
        const nb = [r > 0 ? v - W : -1, r < H - 1 ? v + W : -1, r * W + ((c + 1) % W), r * W + ((c + W - 1) % W)];
        for (const u of nb) if (u >= 0 && !reached[u] && label[u] === s) { reached[u] = 1; queue[qt++] = u; }
      }
    });
    for (let v = 0; v < N; v++) if (label[v] >= 0 && !reached[v]) label[v] = -1;
    // grow reached zones into orphan water (BFS from all reached cells; queue already holds them)
    let qh = 0;
    while (qh < qt) {
      const v = queue[qh++];
      const r = (v / W) | 0, c = v - r * W;
      const nb = [r > 0 ? v - W : -1, r < H - 1 ? v + W : -1, r * W + ((c + 1) % W), r * W + ((c + W - 1) % W)];
      for (const u of nb) if (u >= 0 && !land[u] && label[u] < 0 && compArea[comp[u]] >= opt.minForcedComponentKm2) { label[u] = label[v]; queue[qt++] = u; }
    }
  };

  let seeds = accepted.slice();
  const fixedCount = forcedSeeds.length;
  assign(seeds);
  for (let it = 0; it < opt.lloydIterations; it++) {
    const sums = seeds.map(() => [0, 0, 0]);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const z = label[r * W + c];
      if (z < 0) continue;
      const a = cellArea[r], s = sums[z];
      s[0] += a * cosLat[r] * cosLon[c]; s[1] += a * cosLat[r] * sinLon[c]; s[2] += a * sinLat[r];
    }
    const best = seeds.map(() => -2), bestV = seeds.map(() => -1);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const v = r * W + c, z = label[v];
      if (z < 0) continue;
      const s = sums[z];
      const d = s[0] * cosLat[r] * cosLon[c] + s[1] * cosLat[r] * sinLon[c] + s[2] * sinLat[r];
      if (d > best[z]) { best[z] = d; bestV[z] = v; }
    }
    seeds = seeds.map((p, z) => {
      if (z < fixedCount || bestV[z] < 0) return p;
      const v = bestV[z], r = (v / W) | 0, c = v - r * W;
      return [cellLon(c), cellLat(r)] as Pt;
    });
    assign(seeds);
  }

  // drop zones that ended empty and renumber
  const count = new Float64Array(seeds.length);
  for (let v = 0; v < N; v++) if (label[v] >= 0) count[label[v]] += cellArea[(v / W) | 0];
  const remap = new Int32Array(seeds.length).fill(-1);
  const zones: SeaResult['zones'] = [];
  seeds.forEach((p, z) => {
    if (count[z] <= 0) return;
    remap[z] = zones.length;
    const v = rowOf(p[1]) * W + colOf(p[0]);
    zones.push({ center: p, areaKm2: count[z], comp: comp[v], touchesLand: false });
  });
  for (let v = 0; v < N; v++) if (label[v] >= 0) label[v] = remap[label[v]];
  // zone centres must sit on a cell of the zone
  zones.forEach((zn, z) => {
    const v = rowOf(zn.center[1]) * W + colOf(zn.center[0]);
    if (label[v] === z) return;
    let bestV = -1, bd = Infinity;
    for (let r = Math.max(0, rowOf(zn.center[1]) - 60); r < Math.min(H, rowOf(zn.center[1]) + 60); r++) for (let dc = -120; dc <= 120; dc++) {
      const c = (colOf(zn.center[0]) + dc + W) % W, u = r * W + c;
      if (label[u] !== z) continue;
      const d = (r - rowOf(zn.center[1])) ** 2 + dc * dc;
      if (d < bd) { bd = d; bestV = u; }
    }
    if (bestV >= 0) zn.center = [cellLon(bestV % W), cellLat((bestV / W) | 0)];
  });

  // zones touching any land cell (playable or not) are coastal waters
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const v = r * W + c, z = label[v];
    if (z < 0 || zones[z].touchesLand) continue;
    if (land[r * W + ((c + 1) % W)] || land[r * W + ((c + W - 1) % W)] || (r > 0 && land[v - W]) || (r < H - 1 && land[v + W])) zones[z].touchesLand = true;
  }
  // adjacency
  const adjacency = new Map<string, number>();
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const v = r * W + c, a = label[v];
    if (a < 0) continue;
    const nbs = [r * W + ((c + 1) % W), r < H - 1 ? v + W : -1];
    for (const u of nbs) {
      if (u < 0) continue;
      const b = label[u];
      if (b < 0 || b === a) continue;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      adjacency.set(key, (adjacency.get(key) ?? 0) + 1);
    }
  }

  // shape labels: dilate zones under land
  const shape = Int32Array.from(label);
  {
    let qt2 = 0;
    const depth = new Uint8Array(N);
    for (let v = 0; v < N; v++) if (shape[v] >= 0) queue[qt2++] = v;
    let qh2 = 0;
    while (qh2 < qt2) {
      const v = queue[qh2++];
      if (depth[v] >= opt.dilateCells) continue;
      const r = (v / W) | 0, c = v - r * W;
      const nb = [r > 0 ? v - W : -1, r < H - 1 ? v + W : -1, r * W + ((c + 1) % W), r * W + ((c + W - 1) % W)];
      for (const u of nb) if (u >= 0 && shape[u] < 0) { shape[u] = shape[v]; depth[u] = depth[v] + 1; queue[qt2++] = u; }
    }
  }
  const polygons = vectorize(shape, zones.length, opt);
  return { land, label, comp, compArea, zones, adjacency, polygons, stats: { waterComponents: compArea.length, seeds: zones.length, forcedSeeds: forced } };
}

/** Topology-preserving vectorisation of a label raster. */
function vectorize(L: Int32Array, nZones: number, opt: SeaOptions): MultiPoly[] {
  const VW = W + 1;
  const lab = (r: number, c: number) => (r < 0 || r >= H || c < 0 || c >= W ? -2 : L[r * W + c]);
  // directed edges keyed by label*VN + from
  const VN = VW * (H + 1);
  const out = new Map<number, number[]>(); // key → list of 'to' vertices
  const push = (labelId: number, from: number, to: number) => {
    const k = labelId * VN + from;
    const a = out.get(k);
    if (a) a.push(to); else out.set(k, [to]);
  };
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const a = L[r * W + c];
    if (a < 0) continue;
    if (lab(r - 1, c) !== a) push(a, r * VW + c, r * VW + c + 1);
    if (lab(r, c + 1) !== a) push(a, r * VW + c + 1, (r + 1) * VW + c + 1);
    if (lab(r + 1, c) !== a) push(a, (r + 1) * VW + c + 1, (r + 1) * VW + c);
    if (lab(r, c - 1) !== a) push(a, (r + 1) * VW + c, r * VW + c);
  }
  const isJunction = (v: number) => {
    const j = (v / VW) | 0, i = v - j * VW;
    const a = lab(j - 1, i - 1), b = lab(j - 1, i), c = lab(j, i - 1), d = lab(j, i);
    const s = new Set([a, b, c, d]);
    if (s.size >= 3) return true;
    if (s.size === 2 && a === d && b === c) return true; // checkerboard
    return false;
  };
  const vx = (v: number): Pt => { const j = (v / VW) | 0, i = v - j * VW; return [-180 + i * RES, 90 - j * RES]; };
  const otherSide = (from: number, to: number, a: number): number => {
    // the cell to the left of the directed edge (interior is on the right)
    const j0 = (from / VW) | 0, i0 = from - j0 * VW, j1 = (to / VW) | 0, i1 = to - j1 * VW;
    if (j0 === j1) return i1 > i0 ? lab(j0 - 1, i0) : lab(j0, i1); // top edge (left→right) / bottom edge (right→left)
    return j1 > j0 ? lab(j0, i0) : lab(j1, i0 - 1); // right edge (down) / left edge (up)
  };
  void otherSide;
  const cache = new Map<string, Pt[]>();
  const simplifyChain = (verts: number[], closed: boolean, other: number): Pt[] => {
    const tol = other >= 0 ? opt.tolInner : other === -2 ? 1e-9 : opt.tolOuter;
    if (closed) {
      // canonical rotation/direction
      const open = verts.slice(0, -1);
      let mi = 0;
      for (let k = 1; k < open.length; k++) if (open[k] < open[mi]) mi = k;
      const rot = [...open.slice(mi), ...open.slice(0, mi)];
      const fwd = rot[1] <= rot[rot.length - 1];
      const canon = fwd ? rot : [rot[0], ...rot.slice(1).reverse()];
      const key = `c${canon[0]}|${canon[1]}|${canon.length}`;
      let s = cache.get(key);
      if (!s) {
        s = simplifyClosed([...canon, canon[0]].map(vx), tol);
        cache.set(key, s);
      }
      // map back: s is in canon order starting at canon[0]
      const res = fwd ? s : [s[0], ...s.slice(1, -1).reverse(), s[0]];
      return res;
    }
    const a = verts[0], b = verts[verts.length - 1];
    const fwd = a < b || (a === b && verts[1] <= verts[verts.length - 2]);
    const canon = fwd ? verts : verts.slice().reverse();
    const key = `o${canon[0]}|${canon[1]}|${canon[canon.length - 1]}|${canon.length}`;
    let s = cache.get(key);
    if (!s) {
      s = douglasPeucker(canon.map(vx), tol);
      cache.set(key, s);
    }
    return fwd ? s : s.slice().reverse();
  };

  const ringsByZone: Ring[][] = Array.from({ length: nZones }, () => []);
  const used = new Set<number>(); // key*8 + index in list
  const keys = [...out.keys()].sort((x, y) => x - y);
  const turnOrder = (dxIn: number, dyIn: number, cands: number[], v: number): number => {
    // prefer right turn, then straight, then left (screen coords, y down)
    let best = -1, bestScore = -Infinity;
    const j = (v / VW) | 0, i = v - j * VW;
    cands.forEach((t, idx) => {
      const tj = (t / VW) | 0, ti = t - tj * VW;
      const dx = ti - i, dy = tj - j;
      const cross = dxIn * dy - dyIn * dx; // >0 = right turn in screen coords
      const dot = dxIn * dx + dyIn * dy;
      const score = cross > 0 ? 3 : dot > 0 ? 2 : cross < 0 ? 1 : 0;
      if (score > bestScore) { bestScore = score; best = idx; }
    });
    return best;
  };
  for (const k of keys) {
    const zone = Math.floor(k / VN);
    const lst = out.get(k)!;
    for (let e = 0; e < lst.length; e++) {
      if (used.has(k * 8 + e)) continue;
      const startFrom = k - zone * VN;
      const verts: number[] = [startFrom];
      let from = startFrom, to = lst[e];
      used.add(k * 8 + e);
      for (let guard = 0; guard < 5e6; guard++) {
        verts.push(to);
        if (to === startFrom) break;
        const nk = zone * VN + to;
        const nl = out.get(nk);
        if (!nl) break;
        const fj = (from / VW) | 0, fi = from - fj * VW, tj = (to / VW) | 0, ti = to - tj * VW;
        const freeIdx: number[] = [];
        nl.forEach((_, idx) => { if (!used.has(nk * 8 + idx)) freeIdx.push(idx); });
        if (!freeIdx.length) break;
        const pick = freeIdx.length === 1 ? freeIdx[0] : freeIdx[turnOrder(ti - fi, tj - fj, freeIdx.map((x) => nl[x]), to)];
        used.add(nk * 8 + pick);
        from = to; to = nl[pick];
      }
      if (verts.length < 4 || verts[verts.length - 1] !== startFrom) continue;
      // split at junctions and simplify chains
      const n = verts.length - 1;
      const junc: number[] = [];
      for (let q = 0; q < n; q++) if (isJunction(verts[q])) junc.push(q);
      const chainOther = (q: number) => {
        // label on the other side of edge verts[q] → verts[q+1]
        const f = verts[q], t = verts[q + 1];
        const j0 = (f / VW) | 0, i0 = f - j0 * VW, j1 = (t / VW) | 0, i1 = t - j1 * VW;
        if (j0 === j1) return i1 > i0 ? lab(j0 - 1, i0) : lab(j0, i1);
        return j1 > j0 ? lab(j0, i0) : lab(j1, i0 - 1);
      };
      let ring: Pt[] = [];
      if (!junc.length) {
        ring = simplifyChain(verts, true, chainOther(0));
      } else {
        const rot = [...verts.slice(junc[0], n), ...verts.slice(0, junc[0] + 1)];
        const jset = new Set(junc.map((q) => verts[q]));
        let startIdx = 0;
        for (let q = 1; q < rot.length; q++) {
          if (jset.has(rot[q]) || q === rot.length - 1) {
            const chain = rot.slice(startIdx, q + 1);
            // other side of the first edge of the chain
            const f = chain[0], t = chain[1];
            const j0 = (f / VW) | 0, i0 = f - j0 * VW, j1 = (t / VW) | 0, i1 = t - j1 * VW;
            const oth = j0 === j1 ? (i1 > i0 ? lab(j0 - 1, i0) : lab(j0, i1)) : j1 > j0 ? lab(j0, i0) : lab(j1, i0 - 1);
            const s = simplifyChain(chain, false, oth);
            ring.push(...(ring.length ? s.slice(1) : s));
            startIdx = q;
          }
        }
      }
      if (ring.length >= 4) ringsByZone[zone].push(ring);
    }
  }
  // assemble polygons: exterior rings keep the interior on their right = clockwise = negative signed area in lon/lat
  return ringsByZone.map((rings) => {
    const ext = rings.filter((r) => signedArea(r) < 0);
    const holes = rings.filter((r) => signedArea(r) > 0);
    const polys: Poly[] = ext.map((r) => [r]);
    for (const h of holes) {
      const p = h[0];
      const host = polys.find((pg) => ringContains(pg[0], p[0] + 1e-7, p[1] + 1e-7)) ?? polys.find((pg) => ringContains(pg[0], h[1][0], h[1][1]));
      if (host) host.push(h);
    }
    return polys.map((p) => orientPoly(p));
  });
}

/** Zone of the nearest labeled water cell within `radius` cells (or -1). */
export function zoneNear(sea: SeaResult, lon: number, lat: number, radius: number): number {
  const r0 = rowOf(lat), c0 = colOf(lon);
  let best = -1, bd = Infinity;
  for (let dr = -radius; dr <= radius; dr++) {
    const r = r0 + dr;
    if (r < 0 || r >= H) continue;
    for (let dc = -radius; dc <= radius; dc++) {
      const v = r * W + ((c0 + dc + W) % W);
      const z = sea.label[v];
      if (z < 0) continue;
      const d = dr * dr + dc * dc * Math.cos(lat * D2R) ** 2;
      if (d < bd) { bd = d; best = z; }
    }
  }
  return best;
}

/** All zones of labeled water cells within `radius` cells. */
export function zonesNear(sea: SeaResult, lon: number, lat: number, radius: number, out: Set<number>): void {
  const r0 = rowOf(lat), c0 = colOf(lon);
  for (let dr = -radius; dr <= radius; dr++) {
    const r = r0 + dr;
    if (r < 0 || r >= H) continue;
    for (let dc = -radius; dc <= radius; dc++) {
      const z = sea.label[r * W + ((c0 + dc + W) % W)];
      if (z >= 0) out.add(z);
    }
  }
}
