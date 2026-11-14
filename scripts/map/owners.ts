/** Assemble per-owner land parts from the source features via the reviewed territory manifest. */
import { geoCentroid } from 'd3-geo';
import { MANIFEST_IDS } from '../../src/data/countries';
import { TERRITORY_MANIFEST, MANIFEST_BY_NAME, PART_TAGS, type TerritoryEntry } from '../../src/data/territory-manifest';
import type { Pt, Poly } from './geo';
import { orientPoly } from './geo';
import { unionAll } from './clip';
import type { SourceData, SourceFeature } from './source';
import { partArea } from './source';
import type { OwnerPart } from './provinces';

export interface ClassifiedFeature {
  feature: SourceFeature;
  entry: TerritoryEntry;
  /** Playable owner (homeland or inheriting parent), null for outside/disputed/antarctica. */
  owner: string | null;
}

export function classifyFeatures(src: SourceData): ClassifiedFeature[] {
  const seen = new Set<string>();
  const out: ClassifiedFeature[] = [];
  for (const f of src.features) {
    const entry = MANIFEST_BY_NAME.get(f.name);
    if (!entry) throw new Error(`Territory manifest has no entry for source feature "${f.name}" (id ${f.num})`);
    if ((entry.num ?? null) !== (f.num ?? null)) throw new Error(`Manifest id mismatch for "${f.name}": manifest ${entry.num} vs source ${f.num}`);
    if (seen.has(f.name)) throw new Error(`Duplicate source feature name "${f.name}"`);
    seen.add(f.name);
    const owner = entry.role === 'playable' ? entry.code : entry.role === 'dependent' ? entry.owner! : null;
    out.push({ feature: f, entry, owner });
  }
  for (const e of TERRITORY_MANIFEST) if (!seen.has(e.name)) throw new Error(`Manifest entry "${e.name}" matches no source feature`);
  const playable = new Set(out.filter((c) => c.entry.role === 'playable').map((c) => c.entry.code));
  for (const id of MANIFEST_IDS) if (!playable.has(id)) throw new Error(`Playable country ${id} has no source feature`);
  if (playable.size !== 120) throw new Error(`Expected 120 playable features, got ${playable.size}`);
  return out;
}

function touchesAntimeridian(poly: Poly): boolean {
  return poly.some((r) => r.some(([x]) => Math.abs(x) > 179.99));
}

/** Merge parts split at the antimeridian into continuous polygons (longitudes may exceed 180). */
function stitchAntimeridian(parts: { poly: Poly }[]): Poly[] {
  const touching = parts.filter((p) => touchesAntimeridian(p.poly));
  const rest = parts.filter((p) => !touchesAntimeridian(p.poly)).map((p) => p.poly);
  if (touching.length < 2) return parts.map((p) => p.poly);
  const shifted = touching.map((p) => {
    const meanLon = p.poly[0].reduce((s, v) => s + v[0], 0) / p.poly[0].length;
    return meanLon < 0 ? p.poly.map((r) => r.map(([x, y]) => [x + 360, y] as Pt)) : p.poly;
  });
  const merged = unionAll(shifted as unknown as Parameters<typeof unionAll>[0]) as unknown as Poly[];
  return [...merged.map((p) => orientPoly(p)), ...rest];
}

export function ownerParts(classified: ClassifiedFeature[]): Map<string, OwnerPart[]> {
  const map = new Map<string, OwnerPart[]>();
  for (const id of MANIFEST_IDS) map.set(id, []);
  for (const c of classified) {
    if (!c.owner) continue;
    const list = map.get(c.owner)!;
    const polys = stitchAntimeridian(c.feature.parts);
    for (const poly of polys) {
      const areaKm2 = partArea(poly);
      const centroid = geoCentroid({ type: 'Polygon', coordinates: poly }) as Pt;
      let territory: OwnerPart['territory'] = null;
      if (c.entry.role === 'dependent') territory = { code: c.entry.code, name: c.entry.display, status: 'dependent' };
      else {
        const tag = PART_TAGS.find((t) => t.feature === c.feature.name && centroid[0] >= t.bbox[0] && centroid[0] <= t.bbox[2] && centroid[1] >= t.bbox[1] && centroid[1] <= t.bbox[3]);
        if (tag) territory = { code: tag.code, name: tag.display, status: 'dependent' };
      }
      // keep the continuous longitude frame for stitched parts so centroids are meaningful
      const cen: Pt = poly[0].some(([x]) => x > 180) && centroid[0] < 0 ? [centroid[0] + 360, centroid[1]] : centroid;
      list.push({ owner: c.owner, poly, areaKm2, centroid: cen, territory, featureIndex: c.feature.index });
    }
  }
  for (const list of map.values()) list.sort((a, b) => b.areaKm2 - a.areaKm2);
  return map;
}
