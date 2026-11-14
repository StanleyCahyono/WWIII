/** Interop wrapper for polygon-clipping (CJS default export vs. named types). */
import * as pcNs from 'polygon-clipping';
import type { MultiPolygon, Polygon } from 'polygon-clipping';

type Geom = Polygon | MultiPolygon;
interface PC {
  intersection(g: Geom, ...gs: Geom[]): MultiPolygon;
  union(g: Geom, ...gs: Geom[]): MultiPolygon;
  difference(g: Geom, ...gs: Geom[]): MultiPolygon;
}
const pc: PC = ((pcNs as unknown as { default?: PC }).default ?? (pcNs as unknown as PC));

export function intersect(a: Geom, b: Geom): MultiPolygon {
  try {
    return pc.intersection(a, b);
  } catch {
    return [];
  }
}

export function unionAll(gs: Geom[]): MultiPolygon {
  if (gs.length === 0) return [];
  if (gs.length === 1) return pc.union(gs[0]);
  try {
    return pc.union(gs[0], ...gs.slice(1));
  } catch {
    // fall back to pairwise
    let acc: MultiPolygon = pc.union(gs[0]);
    for (let i = 1; i < gs.length; i++) {
      try {
        acc = pc.union(acc, gs[i]);
      } catch {
        acc = [...acc, ...(gs[i].length && typeof gs[i][0][0][0] === 'number' ? [gs[i] as Polygon] : (gs[i] as MultiPolygon))];
      }
    }
    return acc;
  }
}

export function clipBox(g: Geom, x0: number, y0: number, x1: number, y1: number): MultiPolygon {
  return intersect(g, [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]);
}
