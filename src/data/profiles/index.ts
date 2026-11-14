/**
 * World 120 country profiles — entry point (owner: profiles agent).
 *
 * `PROFILES` lists one authored CountryProfile per manifest seat, in manifest order. The engine's
 * scenario loader (src/engine/scenario/world120.ts) reads `PROFILES` from this module.
 * `PROFILE_ISSUES` must be empty (asserted by tests/profiles); it records authoring problems
 * (unknown city keys after a map rebuild, misplaced naval units, …) without breaking the game.
 */
import type { CountryId, CountryProfile } from '../../engine/data-types';
import { MANIFEST } from '../countries';
import { buildProfile, type BuildResult } from './build';
import type { CountrySpec } from './types';
import { AMERICAS } from './americas';
import { EUROPE } from './europe';
import { AFRICA } from './africa';
import { WEST_CENTRAL_ASIA } from './west-central-asia';
import { ASIA } from './asia';
import { OCEANIA } from './oceania';

export { TEMPLATES } from './templates';
export { BLOCS } from './relations';
export type { CountrySpec, TemplateId } from './types';

export const PROFILE_SPECS: readonly CountrySpec[] = [...AMERICAS, ...EUROPE, ...AFRICA, ...WEST_CENTRAL_ASIA, ...ASIA, ...OCEANIA];

const specById = new Map<CountryId, CountrySpec>();
const dupes: string[] = [];
for (const s of PROFILE_SPECS) {
  if (specById.has(s.id)) dupes.push(`duplicate spec ${s.id}`);
  specById.set(s.id, s);
}

const results = new Map<CountryId, BuildResult>();
for (const m of MANIFEST) {
  const s = specById.get(m.id);
  if (s) results.set(m.id, buildProfile(s));
}

export const PROFILES: CountryProfile[] = MANIFEST.filter((m) => results.has(m.id)).map((m) => (results.get(m.id) as BuildResult).profile);
export const profileById: ReadonlyMap<CountryId, CountryProfile> = new Map(PROFILES.map((p) => [p.id, p]));
/** Conservative planning numbers per seat (documentation / tests). */
export const PROFILE_PLANS: ReadonlyMap<CountryId, BuildResult['plan']> = new Map([...results].map(([k, v]) => [k, v.plan]));

export const PROFILE_ISSUES: readonly string[] = [
  ...dupes,
  ...MANIFEST.filter((m) => !specById.has(m.id)).map((m) => `missing spec for ${m.id}`),
  ...PROFILE_SPECS.filter((s) => !MANIFEST.some((m) => m.id === s.id)).map((s) => `spec ${s.id} is not a manifest seat`),
  ...[...results.values()].flatMap((r) => r.issues),
];

export default PROFILES;
