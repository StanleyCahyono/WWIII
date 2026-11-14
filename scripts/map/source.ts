/**
 * Natural Earth source loader: decodes world-atlas TopoJSON arcs, simplifies each arc ONCE
 * (topology-preserving: shared borders stay identical on both sides), and rebuilds features.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { geoArea, geoCentroid } from 'd3-geo';
import type { Pt, Poly, Ring } from './geo';
import { douglasPeucker, simplifyClosed, orientPoly, signedArea, R_EARTH } from './geo';

const require = createRequire(import.meta.url);

interface TopoGeom { type: 'Polygon' | 'MultiPolygon'; arcs: number[][] | number[][][]; id?: string; properties: { name: string } }
interface Topo { transform: { scale: [number, number]; translate: [number, number] }; arcs: [number, number][][]; objects: { countries: { geometries: TopoGeom[] } } }

export interface SourcePart {
  /** Polygon in lon/lat, d3 winding (exterior clockwise). */
  poly: Poly;
  areaKm2: number;
  centroid: Pt;
}

export interface SourceFeature {
  index: number;
  name: string;
  num: string | null;
  parts: SourcePart[];
}

export interface SharedArc {
  /** Simplified coordinates. */
  coords: Pt[];
  features: [number, number];
}

export interface SourceData {
  features: SourceFeature[];
  /** Vertex keys (lon/lat rounded 1e-5) of coastline arcs (used by exactly one feature). */
  coastKeys: Set<string>;
  sharedArcs: SharedArc[];
  rawPoints: number;
  simplifiedPoints: number;
  sourcePath: string;
}

export const vkey = (lon: number, lat: number): string => `${Math.round(lon * 1e5)},${Math.round(lat * 1e5)}`;

export function partArea(poly: Poly): number {
  return geoArea({ type: 'Polygon', coordinates: poly }) * R_EARTH * R_EARTH;
}

export function loadSource(tolDeg: number): SourceData {
  const sourcePath = require.resolve('world-atlas/countries-50m.json');
  const topo = JSON.parse(fs.readFileSync(sourcePath, 'utf8')) as Topo;
  const { scale, translate } = topo.transform;
  const raw: Pt[][] = topo.arcs.map((a) => {
    let x = 0, y = 0;
    return a.map(([dx, dy]) => {
      x += dx; y += dy;
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]] as Pt;
    });
  });
  const rawPoints = raw.reduce((s, a) => s + a.length, 0);

  // Arc usage by feature.
  const geoms = topo.objects.countries.geometries;
  const usage: number[][] = raw.map(() => []);
  geoms.forEach((g, gi) => {
    const polys = (g.type === 'Polygon' ? [g.arcs] : g.arcs) as number[][][];
    for (const p of polys) for (const r of p) for (const ai of r) usage[ai < 0 ? ~ai : ai].push(gi);
  });

  // Simplify each arc once.
  const simp: Pt[][] = raw.map((a) => {
    if (a.length <= 2) return a.slice();
    const midLat = a[Math.floor(a.length / 2)][1];
    const xs = Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
    const closed = a[0][0] === a[a.length - 1][0] && a[0][1] === a[a.length - 1][1];
    return closed ? simplifyClosed(a, tolDeg, xs) : douglasPeucker(a, tolDeg, xs);
  });
  const simplifiedPoints = simp.reduce((s, a) => s + a.length, 0);

  const coastKeys = new Set<string>();
  const sharedArcs: SharedArc[] = [];
  simp.forEach((a, i) => {
    const u = usage[i];
    if (u.length === 1) {
      for (const [x, y] of a) if (Math.abs(x) < 179.99) coastKeys.add(vkey(x, y));
    } else if (u.length >= 2 && u[0] !== u[1]) {
      sharedArcs.push({ coords: a, features: [u[0], u[1]] });
    }
  });

  let useRaw = false;
  const buildRing = (r: number[]): Ring => {
    const out: Ring = [];
    for (const ai of r) {
      let a = (useRaw ? raw : simp)[ai < 0 ? ~ai : ai];
      if (ai < 0) a = a.slice().reverse();
      for (let k = out.length ? 1 : 0; k < a.length; k++) out.push([a[k][0], a[k][1]]);
    }
    return out;
  };

  /** Make ring longitudes continuous (source rings may jump ±360 at the antimeridian). Polar rings are left as-is. */
  const unwrap = (r: Ring): Ring => {
    const out: Ring = [[r[0][0], r[0][1]]];
    let off = 0;
    for (let i = 1; i < r.length; i++) {
      let x = r[i][0] + off;
      const prev = out[i - 1][0];
      while (x - prev > 180) { x -= 360; off -= 360; }
      while (x - prev < -180) { x += 360; off += 360; }
      out.push([x, r[i][1]]);
    }
    if (Math.abs(out[out.length - 1][0] - out[0][0]) > 1e-6) return r; // encircles a pole
    return out;
  };

  const buildParts = (g: TopoGeom): SourcePart[] => {
    const polys = (g.type === 'Polygon' ? [g.arcs] : g.arcs) as number[][][];
    const parts: SourcePart[] = [];
    for (const p of polys) {
      let rings = p.map((r) => unwrap(buildRing(r))).filter((r) => r.length >= 4 && Math.abs(signedArea(r)) > 1e-8);
      if (!rings.length) continue;
      const meanLon = rings[0].reduce((s, v) => s + v[0], 0) / rings[0].length;
      const sh = meanLon > 180 ? -360 : meanLon < -180 ? 360 : 0;
      if (sh) rings = rings.map((r) => r.map(([x, y]) => [x + sh, y] as Pt));
      // exterior must be first; if the exterior degenerated, skip the polygon
      if (p.length && buildRing(p[0]).length < 4) continue;
      const poly = orientPoly(rings);
      const areaKm2 = partArea(poly);
      if (!(areaKm2 > 0.5) || areaKm2 > 2.6e8) continue; // degenerate or inverted
      parts.push({ poly, areaKm2, centroid: geoCentroid({ type: 'Polygon', coordinates: poly }) as Pt });
    }
    parts.sort((a, b) => b.areaKm2 - a.areaKm2);
    return parts;
  };
  const features: SourceFeature[] = geoms.map((g, gi) => {
    let parts = buildParts(g);
    if (!parts.length) {
      // micro-states (e.g. Vatican) can degenerate under simplification: keep their raw geometry
      useRaw = true;
      parts = buildParts(g);
      useRaw = false;
    }
    return { index: gi, name: g.properties.name, num: g.id ?? null, parts };
  });

  return { features, coastKeys, sharedArcs, rawPoints, simplifiedPoints, sourcePath };
}
