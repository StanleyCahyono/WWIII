/**
 * Province subdivision: per playable owner, each eligible landmass part is cut into provinces by
 * a Voronoi diagram (seeds = cities + deterministic Halton/farthest-point/Lloyd seeds) computed in
 * a per-part azimuthal equal-area projection, clipped to the part polygon. Parts are NEVER merged
 * across water; stray clip fragments are reassigned to the land-adjacent province they share the
 * longest border with. Intra-part adjacency is measured by sampling Voronoi edges on both sides
 * (a pair is adjacent only if both sides are land at the same point — never across water).
 */
import { Delaunay } from 'd3-delaunay';
import { geoAzimuthalEqualArea } from 'd3-geo';
import type { MultiPolygon, Polygon } from 'polygon-clipping';
import type { CitySeed } from '../../src/data/cities';
import type { Pt, Poly, MultiPoly, Ring } from './geo';
import {
  bboxOfRings, polyContains, polyArea, poleOfInaccessibility, halton, haversineKm, closestBoundaryPoint,
  multiContains, bboxOfMulti, type BBox, inBBox,
} from './geo';
import { intersect, unionAll } from './clip';

export interface Territory { code: string; name: string; status: 'dependent' }

export interface OwnerPart {
  owner: string;
  poly: Poly;
  areaKm2: number;
  centroid: Pt;
  territory: Territory | null;
  featureIndex: number;
}

export interface CityPlaced extends CitySeed {
  placed: Pt;
  nudgedKm: number;
  part: number;
}

export interface ProvinceDraft {
  owner: string;
  part: number;
  /** lon/lat polygons, longitudes unwrapped around the part centre (may exceed ±180). */
  polys: MultiPoly;
  areaKm2: number;
  center: Pt;
  city: CityPlaced | null;
  territory: Territory | null;
  islets: number;
}

export interface OwnerResult {
  provinces: ProvinceDraft[];
  /** local province index pairs with shared-border length (km). */
  adj: Map<string, number>;
  cities: CityPlaced[];
  decorativeParts: number;
  warnings: string[];
}

interface Proj { fwd(p: Pt): Pt; inv(p: Pt): Pt }

export function makeProj(center: Pt): Proj {
  const pr = geoAzimuthalEqualArea().rotate([-center[0], -center[1]]).scale(6371.0088).translate([0, 0]).precision(0);
  const c0 = center[0];
  return {
    fwd: (p) => pr(p) as Pt,
    inv: (p) => {
      const ll = pr.invert!(p) as Pt;
      const lon = ll[0] + 360 * Math.round((c0 - ll[0]) / 360);
      return [lon, ll[1]];
    },
  };
}

const MIN_ELIGIBLE_KM2 = 1500;
const MIN_ELIGIBLE_POLAR_KM2 = 5000;
const ISLET_ATTACH_KM = 80;
const MIN_REMOTE_ISLAND_KM2 = 40;
const MIN_KM2_PER_EXTRA_PROVINCE = 350;
const RURAL_SHARE = 0.3;

function containsLL(poly: Poly, p: Pt): boolean {
  return polyContains(poly, p[0], p[1]) || polyContains(poly, p[0] + 360, p[1]) || polyContains(poly, p[0] - 360, p[1]);
}

/** Place each city in a part (nudging coastal points that fall a few km offshore). */
function placeCities(owner: string, parts: OwnerPart[], cities: readonly CitySeed[], warnings: string[]): CityPlaced[] {
  const out: CityPlaced[] = [];
  for (const c of cities) {
    let part = parts.findIndex((p) => containsLL(p.poly, c.lonlat));
    if (part >= 0) {
      let placed: Pt = [c.lonlat[0], c.lonlat[1]];
      if (!polyContains(parts[part].poly, placed[0], placed[1])) {
        placed = polyContains(parts[part].poly, placed[0] + 360, placed[1]) ? [placed[0] + 360, placed[1]] : [placed[0] - 360, placed[1]];
      }
      out.push({ ...c, placed, nudgedKm: 0, part });
      continue;
    }
    // nearest part boundary
    let best = Infinity, bestPart = -1, bestPt: Pt = c.lonlat;
    parts.forEach((p, pi) => {
      for (const shift of [0, 360, -360]) {
        const x = c.lonlat[0] + shift;
        const q = closestBoundaryPoint([p.poly[0]], x, c.lonlat[1]);
        const d = haversineKm([x, c.lonlat[1]], q);
        if (d < best) { best = d; bestPart = pi; bestPt = q; }
      }
    });
    if (bestPart < 0 || best > 60) throw new Error(`City ${c.key} is ${best.toFixed(1)} km from any ${owner} polygon`);
    const poly = parts[bestPart].poly;
    const proj = makeProj(bestPt);
    const P = poly.map((r) => r.map((v) => proj.fwd(v)));
    const q = proj.fwd(bestPt);
    const cpt = proj.fwd([c.lonlat[0] + (bestPt[0] - c.lonlat[0] > 180 ? 360 : bestPt[0] - c.lonlat[0] < -180 ? -360 : 0), c.lonlat[1]]);
    let dx = q[0] - cpt[0], dy = q[1] - cpt[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    let placedProj: Pt | null = null;
    for (const step of [0.5, 1, 2, 3, 5, 8]) {
      const t: Pt = [q[0] + dx * step, q[1] + dy * step];
      if (polyContains(P, t[0], t[1])) { placedProj = t; break; }
    }
    if (!placedProj) {
      const pole = poleOfInaccessibility(P, 2);
      for (const f of [0.02, 0.05, 0.1, 0.2, 0.5]) {
        const t: Pt = [q[0] + (pole[0] - q[0]) * f, q[1] + (pole[1] - q[1]) * f];
        if (polyContains(P, t[0], t[1])) { placedProj = t; break; }
      }
    }
    if (!placedProj) throw new Error(`Could not nudge city ${c.key} inside ${owner}`);
    const placed = proj.inv(placedProj);
    const nudgedKm = haversineKm(c.lonlat, [((placed[0] + 540) % 360) - 180, placed[1]]);
    if (nudgedKm > 25) warnings.push(`city ${c.key} nudged ${nudgedKm.toFixed(1)} km onto land`);
    out.push({ ...c, placed, nudgedKm, part: bestPart });
  }
  return out;
}

/** Largest-remainder allocation of n provinces among parts. */
function allocate(total: number, parts: { area: number; base: number; cap: number }[]): number[] {
  const alloc = parts.map((p) => p.base);
  let remaining = total - alloc.reduce((s, v) => s + v, 0);
  if (remaining <= 0) return alloc;
  const sumA = parts.reduce((s, p) => s + p.area, 0);
  for (let guard = 0; remaining > 0 && guard < 100000; guard++) {
    // give one to the part with the highest deficit (ideal - alloc), respecting caps
    let bi = -1, bd = -Infinity;
    parts.forEach((p, i) => {
      if (alloc[i] >= p.cap) return;
      const ideal = (total * p.area) / sumA;
      const d = (ideal - alloc[i]) / Math.max(1, alloc[i]);
      if (d > bd || (d === bd && p.area > parts[bi].area)) { bd = d; bi = i; }
    });
    if (bi < 0) break;
    alloc[bi]++;
    remaining--;
  }
  return alloc;
}

interface SubResult { polys: MultiPoly[]; areas: number[]; centers: Pt[]; cityIdx: (number | null)[]; adj: Map<string, number> }

function subdividePart(part: OwnerPart, n: number, cities: CityPlaced[]): SubResult {
  const proj = makeProj(part.centroid);
  const P: Poly = part.poly.map((r) => r.map((v) => proj.fwd(v)));
  const bb = bboxOfRings([P[0]]);
  const seeds: Pt[] = cities.map((c) => proj.fwd(c.placed));
  const fixed = seeds.length;
  const need = Math.max(0, n - fixed);

  if (need > 0) {
    const K = Math.max(600, Math.min(14000, need * 90));
    const cand: Pt[] = [];
    for (let i = 1; cand.length < K && i < K * 40; i++) {
      const x = bb[0] + (bb[2] - bb[0]) * halton(i, 2);
      const y = bb[1] + (bb[3] - bb[1]) * halton(i, 3);
      if (polyContains(P, x, y)) cand.push([x, y]);
    }
    if (cand.length) {
      // farthest point sampling
      const md = new Float64Array(cand.length).fill(Infinity);
      const upd = (s: Pt) => {
        for (let k = 0; k < cand.length; k++) {
          const d = (cand[k][0] - s[0]) ** 2 + (cand[k][1] - s[1]) ** 2;
          if (d < md[k]) md[k] = d;
        }
      };
      seeds.forEach(upd);
      if (!seeds.length) { seeds.push(cand[0]); upd(cand[0]); }
      while (seeds.length < n) {
        let bk = -1, bd = -1;
        for (let k = 0; k < cand.length; k++) if (md[k] > bd) { bd = md[k]; bk = k; }
        if (bk < 0 || bd < 1) break;
        seeds.push(cand[bk]);
        upd(cand[bk]);
      }
      // Lloyd relaxation of the free seeds over the candidate sample
      for (let it = 0; it < 5; it++) {
        const sx = new Float64Array(seeds.length), sy = new Float64Array(seeds.length), sc = new Float64Array(seeds.length);
        const assign = new Int32Array(cand.length);
        for (let k = 0; k < cand.length; k++) {
          let bi = 0, bd2 = Infinity;
          for (let s = 0; s < seeds.length; s++) {
            const d = (cand[k][0] - seeds[s][0]) ** 2 + (cand[k][1] - seeds[s][1]) ** 2;
            if (d < bd2) { bd2 = d; bi = s; }
          }
          assign[k] = bi;
          sx[bi] += cand[k][0]; sy[bi] += cand[k][1]; sc[bi]++;
        }
        for (let s = fixed; s < seeds.length; s++) {
          if (!sc[s]) continue;
          let mx = sx[s] / sc[s], my = sy[s] / sc[s];
          if (!polyContains(P, mx, my)) {
            let bk = -1, bd2 = Infinity;
            for (let k = 0; k < cand.length; k++) if (assign[k] === s) {
              const d = (cand[k][0] - mx) ** 2 + (cand[k][1] - my) ** 2;
              if (d < bd2) { bd2 = d; bk = k; }
            }
            if (bk >= 0) { mx = cand[bk][0]; my = cand[bk][1]; }
          }
          seeds[s] = [mx, my];
        }
      }
    }
  }

  const m = Math.max(bb[2] - bb[0], bb[3] - bb[1]) * 0.05 + 10;
  const del = Delaunay.from(seeds);
  const vor = del.voronoi([bb[0] - m, bb[1] - m, bb[2] + m, bb[3] + m]);

  interface Piece { cell: number; poly: Polygon; bbox: BBox; area: number; owner: number }
  const pieces: Piece[] = [];
  const cellPieces: number[][] = seeds.map(() => []);
  for (let i = 0; i < seeds.length; i++) {
    const cell = vor.cellPolygon(i) as unknown as Pt[] | null;
    if (!cell) continue;
    const res = intersect([cell as Ring], P as Polygon);
    for (const pg of res) {
      const area = polyArea(pg as Poly);
      if (area <= 1e-6) continue;
      cellPieces[i].push(pieces.length);
      pieces.push({ cell: i, poly: pg, bbox: bboxOfRings(pg as Ring[]), area, owner: -1 });
    }
  }
  // main pieces
  for (let i = 0; i < seeds.length; i++) {
    const ids = cellPieces[i];
    if (!ids.length) continue;
    let main = ids.find((id) => polyContains(pieces[id].poly as Poly, seeds[i][0], seeds[i][1]));
    if (main === undefined) main = ids.reduce((a, b) => (pieces[a].area >= pieces[b].area ? a : b));
    pieces[main].owner = i;
  }
  const findPiece = (cell: number, p: Pt): number => {
    for (const id of cellPieces[cell]) {
      const pc = pieces[id];
      if (inBBox(pc.bbox, p[0], p[1]) && polyContains(pc.poly as Poly, p[0], p[1])) return id;
    }
    return -1;
  };

  // piece adjacency via Voronoi edge sampling
  const pAdj = new Map<number, Map<number, number>>();
  const addAdj = (a: number, b: number, w: number) => {
    if (!pAdj.has(a)) pAdj.set(a, new Map());
    if (!pAdj.has(b)) pAdj.set(b, new Map());
    pAdj.get(a)!.set(b, (pAdj.get(a)!.get(b) ?? 0) + w);
    pAdj.get(b)!.set(a, (pAdj.get(b)!.get(a) ?? 0) + w);
  };
  const EPS = 0.03; // km
  for (let i = 0; i < seeds.length; i++) {
    const cell = vor.cellPolygon(i) as unknown as Pt[] | null;
    if (!cell || !cellPieces[i].length) continue;
    for (const j of vor.neighbors(i)) {
      if (j <= i || !cellPieces[j].length) continue;
      for (let k = 0; k < cell.length - 1; k++) {
        const a = cell[k], b = cell[k + 1];
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        const di = Math.hypot(mx - seeds[i][0], my - seeds[i][1]);
        const dj = Math.hypot(mx - seeds[j][0], my - seeds[j][1]);
        if (Math.abs(di - dj) > 1e-6 * (di + 1)) continue;
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 1e-9) continue;
        let nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
        if (nx * (seeds[i][0] - mx) + ny * (seeds[i][1] - my) < 0) { nx = -nx; ny = -ny; }
        const ms = Math.max(2, Math.min(400, Math.ceil(L / 1.5)));
        for (let s = 0; s < ms; s++) {
          const t = (s + 0.5) / ms;
          const px = a[0] + (b[0] - a[0]) * t, py = a[1] + (b[1] - a[1]) * t;
          const pi = findPiece(i, [px + nx * EPS, py + ny * EPS]);
          if (pi < 0) continue;
          const pj = findPiece(j, [px - nx * EPS, py - ny * EPS]);
          if (pj < 0) continue;
          addAdj(pi, pj, L / ms);
        }
      }
    }
  }
  // resolve strays
  for (let changed = true; changed; ) {
    changed = false;
    for (let id = 0; id < pieces.length; id++) {
      if (pieces[id].owner >= 0) continue;
      const nb = pAdj.get(id);
      if (!nb) continue;
      let bo = -1, bw = 0;
      for (const [o, w] of nb) if (pieces[o].owner >= 0 && w > bw) { bw = w; bo = pieces[o].owner; }
      if (bo >= 0) { pieces[id].owner = bo; changed = true; }
    }
  }
  for (const pc of pieces) {
    if (pc.owner >= 0) continue;
    // isolated fragment (adjacency below sampling resolution): nearest seed with a main piece
    const cx = (pc.bbox[0] + pc.bbox[2]) / 2, cy = (pc.bbox[1] + pc.bbox[3]) / 2;
    let bo = -1, bd = Infinity;
    for (let s = 0; s < seeds.length; s++) {
      if (!cellPieces[s].some((id) => pieces[id].owner === s)) continue;
      const d = (seeds[s][0] - cx) ** 2 + (seeds[s][1] - cy) ** 2;
      if (d < bd) { bd = d; bo = s; }
    }
    pc.owner = bo;
  }
  // province list = seeds that own something
  const provOf = new Int32Array(seeds.length).fill(-1);
  const order: number[] = [];
  for (let s = 0; s < seeds.length; s++) if (pieces.some((p) => p.owner === s)) { provOf[s] = order.length; order.push(s); }
  const adj = new Map<string, number>();
  for (const [a, nb] of pAdj) for (const [b, w] of nb) {
    const oa = provOf[pieces[a].owner], ob = provOf[pieces[b].owner];
    if (oa < 0 || ob < 0 || oa >= ob) continue;
    const key = `${oa}|${ob}`;
    adj.set(key, (adj.get(key) ?? 0) + w);
  }
  const res: SubResult = { polys: [], areas: [], centers: [], cityIdx: [], adj };
  for (const s of order) {
    const own = pieces.filter((p) => p.owner === s);
    let mp: MultiPolygon = own.length === 1 ? [own[0].poly] : unionAll(own.map((p) => p.poly));
    if (!mp.length) mp = own.map((p) => p.poly);
    const area = mp.reduce((sum, pg) => sum + polyArea(pg as Poly), 0);
    const ll: MultiPoly = mp.map((pg) => pg.map((r) => r.map((v) => proj.inv(v as Pt))));
    let center: Pt;
    if (s < fixed) center = cities[s].placed;
    else {
      const biggest = mp.reduce((a, b) => (polyArea(a as Poly) >= polyArea(b as Poly) ? a : b));
      center = proj.inv(poleOfInaccessibility(biggest as Poly));
    }
    res.polys.push(ll);
    res.areas.push(area);
    res.centers.push(center);
    res.cityIdx.push(s < fixed ? s : null);
  }
  return res;
}

export function provinceCenterForPoly(poly: Poly, centroid: Pt): Pt {
  const proj = makeProj(centroid);
  const P = poly.map((r) => r.map((v) => proj.fwd(v)));
  return proj.inv(poleOfInaccessibility(P));
}

/** Build all provinces of one playable owner. */
export function buildOwner(owner: string, parts: OwnerPart[], cities: readonly CitySeed[], target: number): OwnerResult {
  const warnings: string[] = [];
  const placed = placeCities(owner, parts, cities, warnings);
  const cityByPart = parts.map((_, i) => placed.filter((c) => c.part === i));
  const eligible = parts.map((p, i) => cityByPart[i].length > 0 || p.areaKm2 >= (Math.abs(p.centroid[1]) >= 60 ? MIN_ELIGIBLE_POLAR_KM2 : MIN_ELIGIBLE_KM2));
  if (!eligible.some(Boolean) && parts.length) eligible[0] = true;
  const elIdx = parts.map((_, i) => i).filter((i) => eligible[i]);
  // cities and island bases come first; a rural share of the target is always added on top so
  // large landmasses (Borneo, Sumatra, Siberia…) get rural provinces between their cities.
  const baseSum = elIdx.reduce((s, i) => s + Math.max(1, cityByPart[i].length), 0);
  const alloc = allocate(
    Math.max(target, baseSum + Math.ceil(RURAL_SHARE * target)),
    elIdx.map((i) => ({
      area: parts[i].areaKm2,
      base: Math.max(1, cityByPart[i].length),
      cap: Math.max(1, cityByPart[i].length, Math.floor(parts[i].areaKm2 / MIN_KM2_PER_EXTRA_PROVINCE)),
    })),
  );

  const provinces: ProvinceDraft[] = [];
  const adj = new Map<string, number>();
  elIdx.forEach((pi, k) => {
    const part = parts[pi];
    const n = alloc[k];
    const cs = cityByPart[pi];
    if (n <= 1 && cs.length <= 1) {
      provinces.push({
        owner, part: pi, polys: [part.poly], areaKm2: part.areaKm2,
        center: cs[0]?.placed ?? provinceCenterForPoly(part.poly, part.centroid),
        city: cs[0] ?? null, territory: part.territory, islets: 0,
      });
      return;
    }
    const base = provinces.length;
    const sub = subdividePart(part, n, cs);
    sub.polys.forEach((pl, j) => {
      const ci = sub.cityIdx[j];
      provinces.push({ owner, part: pi, polys: pl, areaKm2: sub.areas[j], center: sub.centers[j], city: ci === null ? null : cs[ci], territory: part.territory, islets: 0 });
    });
    for (const [key, w] of sub.adj) {
      const [a, b] = key.split('|').map(Number);
      adj.set(`${base + a}|${base + b}`, w);
    }
    const lost = cs.filter((_, ci) => !sub.cityIdx.includes(ci));
    if (lost.length) throw new Error(`${owner}: cities lost their province: ${lost.map((c) => c.key).join(', ')}`);
  });

  // islets: attach to nearest province (shape only) or make a remote-island province
  let decorative = 0;
  const islets = parts.map((_, i) => i).filter((i) => !eligible[i]).sort((a, b) => parts[b].areaKm2 - parts[a].areaKm2);
  const pbbox = provinces.map((p) => bboxOfMulti(p.polys));
  for (const ii of islets) {
    const part = parts[ii];
    const ib = bboxOfRings([part.poly[0]]);
    let best = Infinity, bestP = -1;
    provinces.forEach((pv, pi) => {
      const b = pbbox[pi];
      for (const shift of [0, 360, -360]) {
        const pad = 2;
        if (ib[0] + shift > b[2] + pad || ib[2] + shift < b[0] - pad || ib[1] > b[3] + pad || ib[3] < b[1] - pad) continue;
        // vertex-to-vertex distance (sampled)
        const iv = part.poly[0];
        const stepI = Math.max(1, Math.floor(iv.length / 40));
        for (const pg of pv.polys) {
          const rv = pg[0];
          const stepR = Math.max(1, Math.floor(rv.length / 400));
          for (let a = 0; a < iv.length; a += stepI) for (let c = 0; c < rv.length; c += stepR) {
            const d = haversineKm([iv[a][0] + shift, iv[a][1]], rv[c]);
            if (d < best) { best = d; bestP = pi; }
          }
        }
      }
    });
    if (bestP >= 0 && best <= ISLET_ATTACH_KM) {
      const pv = provinces[bestP];
      // shift islet to the province's longitude frame
      const sh = Math.round((pv.center[0] - part.centroid[0]) / 360) * 360;
      pv.polys.push(sh ? part.poly.map((r) => r.map(([x, y]) => [x + sh, y] as Pt)) : part.poly);
      pv.areaKm2 += part.areaKm2;
      pv.islets++;
      pbbox[bestP] = bboxOfMulti(pv.polys);
    } else if (part.areaKm2 >= MIN_REMOTE_ISLAND_KM2) {
      provinces.push({ owner, part: ii, polys: [part.poly], areaKm2: part.areaKm2, center: provinceCenterForPoly(part.poly, part.centroid), city: null, territory: part.territory, islets: 0 });
      pbbox.push(bboxOfMulti([part.poly]));
    } else decorative++;
  }
  return { provinces, adj, cities: placed, decorativeParts: decorative, warnings };
}

export function provinceContains(p: ProvinceDraft, lon: number, lat: number): boolean {
  return multiContains(p.polys, lon, lat) || multiContains(p.polys, lon + 360, lat) || multiContains(p.polys, lon - 360, lat);
}
