/**
 * World 120 scenario assembly. The real map/catalog/profiles are authored by other agents in
 * src/data/**; this loader imports them lazily and degrades gracefully:
 *  - a missing CountryProfile is synthesized deterministically from map data (defaults.ts);
 *  - seats = the 120-country manifest intersected with countries present in the map.
 * `buildWorld120Scenario` is pure (pass modules in); `loadWorld120` uses Vite's import.meta.glob
 * (works in Vite/Vitest/Workers; in plain Node pass the modules to buildWorld120Scenario).
 */
import type { CountryId, CountryProfile, MapData } from '../data-types';
import type { Catalog, Scenario } from './types';
import { synthesizeProfile } from './defaults';
import { START_DATE } from '../rules';

export const WORLD120_ID = 'world120';

/** Exactly one selectable campaign mode. */
export function listCampaignModes(): { id: string; name: string }[] {
  return [{ id: WORLD120_ID, name: 'World 120' }];
}

export interface World120Inputs {
  map: MapData;
  catalog: Catalog & { version?: string };
  profiles?: Record<CountryId, CountryProfile> | CountryProfile[];
  manifest?: readonly { id: CountryId; name: string }[];
}

export function buildWorld120Scenario(inp: World120Inputs): Scenario {
  const profIn: Record<CountryId, CountryProfile> = {};
  if (Array.isArray(inp.profiles)) for (const p of inp.profiles) profIn[p.id] = p;
  else if (inp.profiles) Object.assign(profIn, inp.profiles);
  const mapIds = new Set(inp.map.countries.map((c) => c.id));
  const seats = (inp.manifest ? inp.manifest.map((m) => m.id) : [...mapIds]).filter((c) => mapIds.has(c));
  const notes: string[] = [];
  const profiles: Record<CountryId, CountryProfile> = {};
  const synthesized: CountryId[] = [];
  for (const c of seats) {
    if (profIn[c]) profiles[c] = profIn[c];
    else {
      profiles[c] = synthesizeProfile(inp.map, inp.catalog, c, inp.manifest?.find((m) => m.id === c)?.name);
      synthesized.push(c);
    }
  }
  if (synthesized.length) notes.push(`${synthesized.length} country profile(s) synthesized from map data: ${synthesized.join(', ')}`);
  if (inp.manifest && seats.length !== inp.manifest.length) notes.push(`Map provides ${seats.length} of ${inp.manifest.length} manifest seats.`);
  return {
    id: WORLD120_ID,
    version: `${inp.map.version}+${inp.catalog.version ?? 'catalog'}+${Object.keys(profIn).length}p`,
    name: 'World 120',
    map: inp.map,
    catalog: { resources: [...inp.catalog.resources], units: [...inp.catalog.units], buildings: [...inp.catalog.buildings], techs: [...inp.catalog.techs], missiles: [...inp.catalog.missiles] },
    profiles,
    seats,
    startDate: START_DATE,
    notes,
  };
}

type Loader = () => Promise<Record<string, unknown>>;
function glob(): Record<string, Loader> {
  try {
    // import.meta.glob is a Vite compile-time macro (Vite, Vitest, workers). In plain Node it is
    // undefined and throws — callers then pass modules to buildWorld120Scenario themselves.
    return import.meta.glob(['../../data/map-index.ts', '../../data/generated/map.json', '../../data/catalog/index.ts', '../../data/profiles/index.ts', '../../data/countries.ts']) as Record<string, Loader>;
  } catch {
    return {};
  }
}

function pickMap(mod: Record<string, unknown> | undefined): MapData | null {
  if (!mod) return null;
  for (const k of ['MAP', 'MAP_DATA', 'mapData', 'map', 'default']) {
    const v = mod[k] as MapData | undefined;
    if (v && Array.isArray((v as MapData).nodes) && Array.isArray((v as MapData).edges)) return v;
  }
  return null;
}

/** Lazily import src/data and build the scenario. Throws if map or catalog are unavailable. */
export async function loadWorld120(): Promise<Scenario> {
  const mods = glob();
  const load = async (suffix: string) => {
    const k = Object.keys(mods).find((x) => x.endsWith(suffix));
    return k ? await mods[k]() : undefined;
  };
  const mi = await load('map-index.ts');
  let map: MapData | null = null;
  const fn = mi && (mi['loadMapData'] ?? mi['loadMap'] ?? mi['getMap']);
  if (typeof fn === 'function') map = pickMap({ map: await (fn as () => Promise<MapData> | MapData)() });
  if (!map) map = pickMap(mi);
  if (!map) map = pickMap(await load('generated/map.json'));
  if (!map) throw new Error('World 120 map data is not available yet (src/data/generated/map.json).');
  const cat = await load('catalog/index.ts');
  const catalog = (cat?.['CATALOG'] ?? cat?.['default']) as (Catalog & { version?: string }) | undefined;
  if (!catalog) throw new Error('World 120 catalog is not available (src/data/catalog/index.ts).');
  const pm = await load('profiles/index.ts');
  let profiles: Record<CountryId, CountryProfile> | CountryProfile[] | undefined;
  if (pm) profiles = (pm['PROFILES'] ?? pm['profiles'] ?? pm['COUNTRY_PROFILES'] ?? pm['default']) as typeof profiles;
  const cm = await load('countries.ts');
  const manifest = (cm?.['MANIFEST'] as World120Inputs['manifest']) ?? undefined;
  return buildWorld120Scenario({ map, catalog, profiles, manifest });
}
