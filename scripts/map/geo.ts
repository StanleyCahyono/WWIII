/** Small geometry helpers for the map pipeline (planar + spherical). Deterministic, no deps. */

export type Pt = [number, number];
export type Ring = Pt[];
export type Poly = Ring[]; // ring 0 = exterior, rest = holes
export type MultiPoly = Poly[];

export const R_EARTH = 6371.0088;
const D2R = Math.PI / 180;

export function haversineKm(a: Pt, b: Pt): number {
  const dLat = (b[1] - a[1]) * D2R;
  const dLon = (b[0] - a[0]) * D2R;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * D2R) * Math.cos(b[1] * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function signedArea(r: Ring): number {
  let s = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const [x1, y1] = r[i];
    const [x2, y2] = r[(i + 1) % n];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

export function polyArea(p: Poly): number {
  let a = Math.abs(signedArea(p[0]));
  for (let i = 1; i < p.length; i++) a -= Math.abs(signedArea(p[i]));
  return a;
}

export function multiArea(m: MultiPoly): number {
  return m.reduce((s, p) => s + polyArea(p), 0);
}

export function ringContains(r: Ring, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function polyContains(p: Poly, x: number, y: number): boolean {
  if (!ringContains(p[0], x, y)) return false;
  for (let i = 1; i < p.length; i++) if (ringContains(p[i], x, y)) return false;
  return true;
}

export function multiContains(m: MultiPoly, x: number, y: number): boolean {
  for (const p of m) if (polyContains(p, x, y)) return true;
  return false;
}

export type BBox = [number, number, number, number];

export function bboxOfRings(rings: Ring[]): BBox {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const [x, y] of r) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

export function bboxOfMulti(m: MultiPoly): BBox {
  return bboxOfRings(m.flatMap((p) => p));
}

export function inBBox(b: BBox, x: number, y: number, pad = 0): boolean {
  return x >= b[0] - pad && x <= b[2] + pad && y >= b[1] - pad && y <= b[3] + pad;
}

export function bboxOverlap(a: BBox, b: BBox, pad = 0): boolean {
  return a[0] - pad <= b[2] && b[0] - pad <= a[2] && a[1] - pad <= b[3] && b[1] - pad <= a[3];
}

/** Squared distance from point to segment. */
export function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

export function distToPolyBoundary(p: Poly, x: number, y: number): number {
  let best = Infinity;
  for (const r of p) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const d = segDist2(x, y, r[j][0], r[j][1], r[i][0], r[i][1]);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** Closest point on a polygon's boundary (planar). */
export function closestBoundaryPoint(p: Poly, x: number, y: number): Pt {
  let best = Infinity;
  let out: Pt = [x, y];
  for (const r of p) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const ax = r[j][0], ay = r[j][1], bx = r[i][0], by = r[i][1];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx, qy = ay + t * dy;
    const d = (qx - x) ** 2 + (qy - y) ** 2;
    if (d < best) { best = d; out = [qx, qy]; }
  }
  return out;
}

/** Approximate pole of inaccessibility: grid search + refinement (planar). */
export function poleOfInaccessibility(p: Poly, iterations = 3): Pt {
  const [x0, y0, x1, y1] = bboxOfRings([p[0]]);
  let cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  let w = x1 - x0, h = y1 - y0;
  let best: Pt | null = null;
  let bestD = -Infinity;
  const N = 14;
  let sx0 = x0, sy0 = y0, sw = w, sh = h;
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const x = sx0 + (sw * (i + 0.5)) / (N + 1);
      const y = sy0 + (sh * (j + 0.5)) / (N + 1);
      if (!polyContains(p, x, y)) continue;
      const d = distToPolyBoundary(p, x, y);
      if (d > bestD) { bestD = d; best = [x, y]; }
    }
    if (!best) break;
    cx = best[0]; cy = best[1];
    sw /= 3; sh /= 3;
    sx0 = cx - sw / 2; sy0 = cy - sh / 2;
  }
  if (best) return best;
  // Fallback: first vertex nudged inward via centroid of ring
  const r = p[0];
  let ax = 0, ay = 0;
  for (const [x, y] of r) { ax += x; ay += y; }
  ax /= r.length; ay /= r.length;
  if (polyContains(p, ax, ay)) return [ax, ay];
  // midpoint of a short chord near the first vertex
  for (let k = 1; k < r.length; k++) {
    const mx = (r[0][0] + r[k][0]) / 2, my = (r[0][1] + r[k][1]) / 2;
    if (polyContains(p, mx, my)) return [mx, my];
  }
  return [r[0][0], r[0][1]];
}

/** Douglas–Peucker on an open polyline; keeps endpoints. Tolerance in coordinate units. */
export function douglasPeucker(pts: Pt[], tol: number, xScale = 1): Pt[] {
  const n = pts.length;
  if (n <= 2) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1; keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = -1, idx = -1;
    const ax = pts[a][0] * xScale, ay = pts[a][1], bx = pts[b][0] * xScale, by = pts[b][1];
    for (let i = a + 1; i < b; i++) {
      const d = segDist2(pts[i][0] * xScale, pts[i][1], ax, ay, bx, by);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > t2 && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

/** Simplify a closed ring (first == last) keeping at least 4 points if possible. */
export function simplifyClosed(r: Ring, tol: number, xScale = 1): Ring {
  const open = r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r.slice();
  if (open.length <= 4) return [...open, open[0]];
  // split at the farthest vertex from the first
  let far = 1, fd = -1;
  for (let i = 1; i < open.length; i++) {
    const d = ((open[i][0] - open[0][0]) * xScale) ** 2 + (open[i][1] - open[0][1]) ** 2;
    if (d > fd) { fd = d; far = i; }
  }
  const a = douglasPeucker(open.slice(0, far + 1), tol, xScale);
  const b = douglasPeucker([...open.slice(far), open[0]], tol, xScale);
  let res = [...a, ...b.slice(1)];
  if (res.length < 4) {
    // keep a triangle at least: pick 3 spread vertices
    const k = Math.max(1, Math.floor(open.length / 3));
    res = [open[0], open[k], open[Math.min(open.length - 1, 2 * k)], open[0]];
  }
  return res;
}

/** Densify segments so no segment exceeds maxLen (degrees). */
export function densifyRing(r: Ring, maxLen: number): Ring {
  const out: Ring = [];
  for (let i = 0; i < r.length - 1; i++) {
    const a = r[i], b = r[i + 1];
    out.push(a);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > maxLen) {
      const n = Math.ceil(len / maxLen);
      for (let k = 1; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
  }
  out.push(r[r.length - 1]);
  return out;
}

export function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export function closeRing(r: Ring): Ring {
  if (r.length === 0) return r;
  const f = r[0], l = r[r.length - 1];
  return f[0] === l[0] && f[1] === l[1] ? r : [...r, [f[0], f[1]]];
}

/** Remove consecutive duplicates (after rounding) and degenerate rings. */
export function cleanRing(r: Ring): Ring | null {
  const out: Ring = [];
  for (const p of r) {
    const l = out[out.length - 1];
    if (!l || l[0] !== p[0] || l[1] !== p[1]) out.push(p);
  }
  const c = closeRing(out);
  if (c.length < 4) return null;
  if (Math.abs(signedArea(c)) < 1e-9) return null;
  return c;
}

/** Orient rings for d3-geo / world-atlas convention: exterior clockwise (negative signed area in lon/lat). */
export function orientPoly(p: Poly): Poly {
  return p.map((r, i) => {
    const a = signedArea(r);
    const wantNeg = i === 0;
    return (a < 0) === wantNeg ? r : r.slice().reverse();
  });
}

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit string hash (FNV-1a). */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Halton low-discrepancy sequence value. */
export function halton(i: number, base: number): number {
  let f = 1, r = 0;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

export function normLon(lon: number): number {
  let l = lon;
  while (l > 180) l -= 360;
  while (l < -180) l += 360;
  return l;
}

/** Initial bearing a→b in degrees 0..360. */
export function bearing(a: Pt, b: Pt): number {
  const f1 = a[1] * D2R, f2 = b[1] * D2R, dl = (b[0] - a[0]) * D2R;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return ((Math.atan2(y, x) / D2R) + 360) % 360;
}

const DIRS = ['North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest'];
export function compass8(deg: number): string {
  return DIRS[Math.round(deg / 45) % 8];
}
