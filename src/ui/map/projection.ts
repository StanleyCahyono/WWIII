/** Plate carrée projection: world x = lon°, y = −lat°. Camera zoom z = CSS px per degree. */
export interface Camera {
  cx: number;
  cy: number;
  z: number;
}

export const Z_MAX = 900;
export const LAT_N = 84;
export const LAT_S = -62;

export function wrapLon(x: number): number {
  let v = ((x + 180) % 360 + 360) % 360 - 180;
  if (v === -180 && x > 0) v = 180;
  return v;
}

/** Shortest signed delta a−b in longitude. */
export function dLon(a: number, b: number): number {
  return wrapLon(a - b);
}

export function zMin(w: number, h: number): number {
  return Math.max(w / 360, h / (LAT_N - LAT_S)) * 0.999;
}

export function clampCamera(c: Camera, w: number, h: number): Camera {
  const z = Math.min(Z_MAX, Math.max(zMin(w, h), c.z));
  const halfH = h / 2 / z;
  let cy = c.cy;
  const top = -LAT_N + halfH;
  const bot = -LAT_S - halfH;
  if (top > bot) cy = (top + bot) / 2;
  else cy = Math.min(bot, Math.max(top, cy));
  return { cx: wrapLon(c.cx), cy, z };
}

export function worldToScreen(c: Camera, w: number, h: number, lon: number, lat: number): [number, number] {
  return [dLon(lon, c.cx) * c.z + w / 2, (-lat - c.cy) * c.z + h / 2];
}

export function screenToWorld(c: Camera, w: number, h: number, x: number, y: number): [number, number] {
  return [wrapLon(c.cx + (x - w / 2) / c.z), -(c.cy + (y - h / 2) / c.z)];
}

export type ZoomState = 'world' | 'regional' | 'local';
export function zoomState(z: number): ZoomState {
  return z < 9 ? 'world' : z < 32 ? 'regional' : 'local';
}

/** km per CSS pixel at latitude (plate carrée horizontal scale). */
export function kmPerPx(c: Camera, lat: number): number {
  return (111.32 * Math.cos((lat * Math.PI) / 180)) / c.z;
}

export function pointInRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(lon: number, lat: number, poly: number[][][]): boolean {
  if (!poly.length || !pointInRing(lon, lat, poly[0])) return false;
  for (let i = 1; i < poly.length; i++) if (pointInRing(lon, lat, poly[i])) return false;
  return true;
}
