/**
 * Symbology crosswalk — World Command: World 120.
 *
 * Internal stable entity keys → NATO APP-6 Edition E / MIL-STD-2525E 20-digit numeric SIDCs.
 * This module is dependency-free (no milsymbol) so the engine/worker can import the catalog
 * cheaply. Rendering lives in `symbol-render.ts`.
 *
 * SIDC layout (1-based positions, all digits, always kept as a STRING — leading zeroes matter):
 *   1-2  version       "13" = APP-6 E / 2525E
 *   3    context       0 reality
 *   4    standard identity  0 pending, 1 unknown, 2 assumed friend, 3 friend, 4 neutral,
 *                           5 suspect, 6 hostile          ← substituted per viewer
 *   5-6  symbol set    01 air, 02 air missile, 10 land unit, 15 land equipment,
 *                      20 land installation, 30 sea surface, 35 sea subsurface
 *   7    status        0 present, 1 planned/anticipated, 3 damaged, 4 destroyed ← substituted
 *   8    HQ/TF/dummy   0 none, 2 headquarters                 ← substituted if opts.hq given
 *   9-10 amplifier     land units (set 10): echelon            ← substituted if opts.echelon given
 *   11-16 entity / type / subtype
 *   17-18 sector 1 modifier, 19-20 sector 2 modifier
 *
 * Templates below are stored as complete valid SIDCs (friend, present, no echelon; contacts
 * as unknown) so the stored string itself renders.
 *
 * Crosswalk version history: bump SYMBOL_CROSSWALK_VERSION whenever a mapping changes and
 * regenerate docs/gallery (npm run gallery) so the manifest diff is reviewed.
 */
import type { Domain, SymbolCrosswalkEntry, SymbolEntityKey } from '../../engine/data-types';

export const SYMBOL_CROSSWALK_VERSION = '2026-11-14.1';
export const SYMBOL_EDITION = 'NATO APP-6 Edition E / MIL-STD-2525E (numeric SIDC version 13)';
export const SIDC_VERSION = '13';
export const SUPPORTED_SYMBOL_SETS = ['01', '02', '10', '15', '20', '30', '35'] as const;

type EntryDomain = SymbolCrosswalkEntry['domain'];

function e(key: string, sidc: string, domain: EntryDomain, meaning: string): SymbolCrosswalkEntry {
  return { key, sidc, domain, meaning };
}

/**
 * Build a template: version 13, reality, SI, symbol set, status 0, hq, echelon 00, entity, modifiers.
 * Written out with explicit pieces so each mapping is reviewable against the plates.
 */
function t(si: string, set: string, entity: string, m1 = '00', m2 = '00', hq = '0'): string {
  return `13` + `0` + si + set + `0` + hq + `00` + entity + m1 + m2;
}
const F = '3'; // friend (default for templates)
const U = '1'; // unknown (default for contacts)

export const SYMBOL_CROSSWALK: SymbolCrosswalkEntry[] = [
  // ── Infantry (land unit, set 10) ──
  e('land.infantry.motorized', t(F, '10', '121104'), 'land', 'Motorized infantry'),
  e('land.infantry.mechanized', t(F, '10', '121102'), 'land', 'Mechanized infantry (infantry in armored vehicles)'),
  e('land.infantry.marine', t(F, '10', '121101'), 'land', 'Amphibious (naval) infantry'),
  e('land.infantry.airmobile', t(F, '10', '121100', '01'), 'land', 'Infantry, airmobile / air assault'),
  e('land.infantry.special_forces', t(F, '10', '121700'), 'land', 'Special forces'),
  e('land.infantry.militia', t(F, '10', '121100', '00', '19'), 'land', 'Light infantry (national guard / militia)'),
  e('land.infantry.mercenary', t(F, '10', '121100', '00', '58'), 'land', 'Irregular infantry (contract force)'),
  // ── Armor ──
  e('land.armor.recon', t(F, '10', '120501'), 'land', 'Armored reconnaissance'),
  e('land.armor.afv', t(F, '10', '120500', '00', '19'), 'land', 'Light armor (armored fighting vehicle)'),
  e('land.armor.amphibious', t(F, '10', '120502'), 'land', 'Amphibious armor'),
  e('land.armor.mbt', t(F, '10', '120500'), 'land', 'Armor (main battle tanks)'),
  e('land.armor.tank_destroyer', t(F, '10', '120401'), 'land', 'Armored anti-armor (tank destroyer)'),
  // ── Support ──
  e('land.support.towed_artillery', t(F, '10', '130300', '00', '47'), 'land', 'Field artillery, towed'),
  e('land.support.sp_artillery', t(F, '10', '130301'), 'land', 'Field artillery, self-propelled (armored)'),
  e('land.support.rocket_artillery', t(F, '10', '130300', '41'), 'land', 'Field artillery, multiple rocket launcher'),
  e('land.air_defense.gun', t(F, '10', '130101'), 'land', 'Air defence, gun system'),
  e('land.air_defense.sam', t(F, '10', '130102'), 'land', 'Air defence, missile'),
  e('land.air_defense.theatre', t(F, '10', '130103', '00', '22'), 'land', 'Air and missile defence, long range'),
  e('land.recon.radar', t(F, '10', '121600', '50'), 'land', 'Surveillance, radar'),
  e('land.missile.cruise_launcher', t(F, '10', '130700', '00', '26'), 'land', 'Missile unit, medium range (cruise launcher)'),
  e('land.missile.ballistic_launcher', t(F, '10', '130700', '00', '44'), 'land', 'Missile unit, strategic (ballistic launcher)'),
  e('land.deployable.ugv', t(F, '10', '121900'), 'land', 'Unmanned systems (unmanned ground vehicle)'),
  // ── Officers (headquarters elements; HQ indicator only on these known HQ objects) ──
  e('land.officer.infantry', t(F, '10', '121100', '00', '00', '2'), 'land', 'Infantry headquarters (officer)'),
  e('land.officer.airborne', t(F, '10', '121100', '01', '00', '2'), 'land', 'Air assault infantry headquarters (officer)'),
  e('land.officer.armored', t(F, '10', '120500', '00', '00', '2'), 'land', 'Armor headquarters (officer)'),
  e('air.officer.helicopter', t(F, '10', '120600', '00', '00', '2'), 'air', 'Rotary-wing aviation headquarters (officer)'),
  e('air.officer.fighter', t(F, '10', '120800', '00', '00', '2'), 'air', 'Fixed-wing aviation headquarters (officer)'),
  e('sea.officer.naval', t(F, '30', '121002'), 'sea', 'Navy task force (flotilla commander)'),
  e('subsurface.officer.submarine', t(F, '35', '110100', '03'), 'subsurface', 'Submarine, command and control (undersea commander)'),
  // ── Helicopters (air, set 01) ──
  e('air.helicopter.gunship', t(F, '01', '110200', '36'), 'air', 'Military rotary wing, multimission (gunship)'),
  e('air.helicopter.attack', t(F, '01', '110200', '01'), 'air', 'Military rotary wing, attack'),
  e('air.helicopter.asw', t(F, '01', '110200', '22'), 'air', 'Military rotary wing, antisubmarine warfare'),
  // ── Fighters ──
  e('air.fighter.air_superiority', t(F, '01', '110104'), 'air', 'Fixed wing, fighter'),
  e('air.fighter.naval_air_superiority', t(F, '01', '110104', '15'), 'air', 'Fixed wing, fighter, escort (carrier fighter)'),
  e('air.fighter.stealth_air_superiority', t(F, '01', '110104', '05'), 'air', 'Fixed wing, fighter, interceptor (stealth fighter)'),
  e('air.fighter.strike', t(F, '01', '110105'), 'air', 'Fixed wing, fighter/bomber (strike fighter)'),
  e('air.fighter.naval_strike', t(F, '01', '110105', '32'), 'air', 'Fixed wing, fighter/bomber, antisurface warfare (carrier striker)'),
  e('air.fighter.stealth_strike', t(F, '01', '110102'), 'air', 'Fixed wing, attack/strike (stealth striker)'),
  e('air.fighter.uav', t(F, '01', '110300', '01'), 'air', 'Unmanned aerial vehicle, attack'),
  e('air.deployable.swarm_uav', t(F, '01', '110300', '01', '03'), 'air', 'Unmanned aerial vehicle, attack, light (drone swarm)'),
  // ── Heavies ──
  e('air.heavy.maritime_patrol', t(F, '01', '110110', '22'), 'air', 'Fixed wing, patrol, antisubmarine warfare'),
  e('air.heavy.awacs', t(F, '01', '110116'), 'air', 'Fixed wing, airborne early warning'),
  e('air.heavy.naval_aew', t(F, '01', '110116', '00', '03'), 'air', 'Fixed wing, airborne early warning, light (carrier AEW)'),
  e('air.heavy.bomber', t(F, '01', '110103', '00', '01'), 'air', 'Fixed wing, bomber, heavy'),
  e('air.heavy.stealth_bomber', t(F, '01', '110103', '00', '10'), 'air', 'Fixed wing, bomber, long range (stealth bomber)'),
  e('air.heavy.transport', t(F, '01', '110107', '00', '01'), 'air', 'Fixed wing, cargo, heavy (strategic airlifter)'),
  e('air.heavy.tanker', t(F, '01', '110109'), 'air', 'Fixed wing, tanker'),
  e('air.recon.broad_area', t(F, '01', '110111', '00', '10'), 'air', 'Fixed wing, reconnaissance, long range'),
  // ── Surface (set 30) ──
  e('sea.naval.corvette', t(F, '30', '120205'), 'sea', 'Corvette'),
  e('sea.naval.frigate', t(F, '30', '120204'), 'sea', 'Frigate'),
  e('sea.naval.destroyer', t(F, '30', '120203'), 'sea', 'Destroyer'),
  e('sea.naval.cruiser', t(F, '30', '120202'), 'sea', 'Cruiser, guided missile'),
  e('sea.naval.carrier', t(F, '30', '120100'), 'sea', 'Carrier'),
  // ── Subsurface (set 35) ──
  e('subsurface.submarine.attack', t(F, '35', '110100', '08'), 'subsurface', 'Submarine, attack'),
  e('subsurface.submarine.ballistic', t(F, '35', '110100', '09'), 'subsurface', 'Submarine, ballistic missile'),
  // ── Installations (set 20; radar from land equipment set 15) ──
  e('installation.city', t(F, '20', '120000'), 'installation', 'Infrastructure installation (city)'),
  e('installation.capital', t(F, '20', '120600'), 'installation', 'Government site (capital)'),
  e('installation.army_base', t(F, '20', '120802'), 'installation', 'Military base'),
  e('installation.air_base', t(F, '20', '120803'), 'installation', 'Military airport (air base)'),
  e('installation.naval_base', t(F, '20', '121310'), 'installation', 'Naval yard (naval base)'),
  e('installation.missile_complex', t(F, '20', '111400'), 'installation', 'Missile launch site (missile complex)'),
  e('installation.arms_industry', t(F, '20', '110800'), 'installation', 'Equipment manufacture (arms industry)'),
  e('installation.radar', t(F, '15', '220300', '03'), 'installation', 'Radar, early warning (radar station)'),
  // ── Generic contacts (no entity, no modifiers: never encode a hidden branch) ──
  e('contact.land', t(U, '10', '000000'), 'contact', 'Land contact, type unknown'),
  e('contact.air', t(U, '01', '000000'), 'contact', 'Air contact, type unknown'),
  e('contact.sea', t(U, '30', '000000'), 'contact', 'Surface contact, type unknown'),
  e('contact.subsurface', t(U, '35', '000000'), 'contact', 'Subsurface contact, type unknown'),
  // ── Missile event icons (air missile set 02) ──
  e('event.missile.unknown', t(U, '02', '110000'), 'strategic', 'Missile in flight, family unknown'),
  e('event.missile.cruise', t(F, '02', '110000', '07'), 'strategic', 'Cruise missile in flight'),
  e('event.missile.ballistic', t(F, '02', '110000', '06'), 'strategic', 'Ballistic missile in flight'),
  e('event.missile.hgv', t(F, '02', '110000', '09', '15'), 'strategic', 'Hypersonic missile, long range (boost-glide system)'),
  e('event.missile.hcm', t(F, '02', '110000', '09', '13'), 'strategic', 'Hypersonic missile, medium range (hypersonic cruise)'),
];

export const SYMBOL_BY_KEY: ReadonlyMap<SymbolEntityKey, SymbolCrosswalkEntry> = new Map(SYMBOL_CROSSWALK.map((x) => [x.key, x]));

/** Missile family → event icon key. */
export const MISSILE_EVENT_SYMBOL: Record<'cruise' | 'ballistic' | 'hgv' | 'hcm', SymbolEntityKey> = {
  cruise: 'event.missile.cruise',
  ballistic: 'event.missile.ballistic',
  hgv: 'event.missile.hgv',
  hcm: 'event.missile.hcm',
};

// ───────────────────────────── build / validate ─────────────────────────────

export type Affiliation = 'friend' | 'hostile' | 'neutral' | 'unknown' | 'pending' | 'assumed_friend' | 'suspect';
export type SymbolStatus = 'present' | 'planned' | 'damaged' | 'destroyed';
export type Echelon =
  | 'team'
  | 'squad'
  | 'section'
  | 'platoon'
  | 'company'
  | 'battalion'
  | 'regiment'
  | 'brigade'
  | 'division'
  | 'corps'
  | 'army'
  | 'army_group'
  | 'region';

export const AFFILIATION_DIGIT: Record<Affiliation, string> = {
  pending: '0',
  unknown: '1',
  assumed_friend: '2',
  friend: '3',
  neutral: '4',
  suspect: '5',
  hostile: '6',
};
export const STATUS_DIGIT: Record<SymbolStatus, string> = { present: '0', planned: '1', damaged: '3', destroyed: '4' };
export const ECHELON_DIGITS: Record<Echelon, string> = {
  team: '11',
  squad: '12',
  section: '13',
  platoon: '14',
  company: '15',
  battalion: '16',
  regiment: '17',
  brigade: '18',
  division: '21',
  corps: '22',
  army: '23',
  army_group: '24',
  region: '25',
};

export interface BuildSidcOptions {
  affiliation: Affiliation;
  status: SymbolStatus;
  /** Verified echelon only. NEVER derive from a stack count. Applied to land-unit symbols only. */
  echelon?: Echelon | string;
  /** true → HQ indicator, false → none, undefined → keep template (officers are HQ). */
  hq?: boolean;
  /** Domain hint used only for the fail-safe generic contact when the key is unknown. */
  domain?: Domain;
}

export interface AssetValidationError {
  key: string;
  reason: string;
  fallbackKey: string;
}

const assetErrors: AssetValidationError[] = [];
/** Asset-validation errors recorded by the fail-safe path (shown in diagnostics; never silent). */
export function getAssetValidationErrors(): readonly AssetValidationError[] {
  return assetErrors;
}
export function clearAssetValidationErrors(): void {
  assetErrors.length = 0;
}

export function validateSidc(sidc: unknown): { ok: boolean; reason?: string } {
  if (typeof sidc !== 'string') return { ok: false, reason: 'SIDC must be a string' };
  if (sidc.length !== 20) return { ok: false, reason: `SIDC must be 20 characters (got ${sidc.length})` };
  if (!/^\d{20}$/.test(sidc)) return { ok: false, reason: 'SIDC must contain digits only' };
  if (sidc.slice(0, 2) !== SIDC_VERSION) return { ok: false, reason: `unsupported SIDC version ${sidc.slice(0, 2)} (expected ${SIDC_VERSION}, APP-6 E / 2525E)` };
  if (!'012'.includes(sidc[2])) return { ok: false, reason: `unsupported context ${sidc[2]}` };
  if (!'0123456'.includes(sidc[3])) return { ok: false, reason: `invalid standard identity ${sidc[3]}` };
  const set = sidc.slice(4, 6);
  if (!(SUPPORTED_SYMBOL_SETS as readonly string[]).includes(set)) return { ok: false, reason: `unsupported symbol set ${set}` };
  if (!'012345'.includes(sidc[6])) return { ok: false, reason: `invalid status ${sidc[6]}` };
  if (!'01234567'.includes(sidc[7])) return { ok: false, reason: `invalid HQ/task force/dummy ${sidc[7]}` };
  if (set === '10') {
    const ech = sidc.slice(8, 10);
    if (ech !== '00' && !Object.values(ECHELON_DIGITS).includes(ech)) return { ok: false, reason: `invalid land-unit echelon ${ech}` };
  }
  return { ok: true };
}

const DOMAIN_CONTACT: Record<Domain, SymbolEntityKey> = {
  land: 'contact.land',
  air: 'contact.air',
  sea: 'contact.sea',
  subsurface: 'contact.subsurface',
  strategic: 'event.missile.unknown',
};

/** Key of the generic contact for a domain (used when the entity type is not identified). */
export function contactKeyForDomain(domain: Domain): SymbolEntityKey {
  return DOMAIN_CONTACT[domain];
}

function domainFromKey(key: string, hint?: Domain): Domain {
  if (hint) return hint;
  const head = key.split('.')[0];
  if (head === 'air' || head === 'sea' || head === 'subsurface' || head === 'land') return head;
  if (head === 'event') return 'strategic';
  return 'land';
}

function applyOptions(entry: SymbolCrosswalkEntry, opts: BuildSidcOptions): string {
  const c = entry.sidc.split('');
  c[3] = AFFILIATION_DIGIT[opts.affiliation] ?? AFFILIATION_DIGIT.unknown;
  c[6] = STATUS_DIGIT[opts.status] ?? STATUS_DIGIT.present;
  const isContact = entry.domain === 'contact';
  // Contacts never take HQ/echelon: those would reveal information the viewer does not have.
  if (!isContact && opts.hq !== undefined) c[7] = opts.hq ? '2' : '0';
  if (!isContact && opts.echelon && entry.sidc.slice(4, 6) === '10') {
    const d = (ECHELON_DIGITS as Record<string, string>)[opts.echelon] ?? (/^\d\d$/.test(opts.echelon) ? opts.echelon : undefined);
    if (d && Object.values(ECHELON_DIGITS).includes(d)) {
      c[8] = d[0];
      c[9] = d[1];
    }
  }
  return c.join('');
}

export interface ResolvedSymbol {
  sidc: string;
  /** Key actually rendered (differs from the request on the fail-safe path). */
  key: SymbolEntityKey;
  meaning: string;
  fallback: boolean;
  error?: string;
}

/**
 * Resolve a key to a SIDC for a viewer. Unknown key or invalid template → generic contact of the
 * known domain + recorded asset-validation error. Never substitutes infantry.
 */
export function resolveSymbol(key: SymbolEntityKey, opts: BuildSidcOptions): ResolvedSymbol {
  const entry = SYMBOL_BY_KEY.get(key);
  if (entry) {
    const sidc = applyOptions(entry, opts);
    const v = validateSidc(sidc);
    if (v.ok) return { sidc, key, meaning: entry.meaning, fallback: false };
    return fallback(key, opts, `invalid SIDC for key "${key}": ${v.reason}`);
  }
  return fallback(key, opts, `unknown symbol entity key "${key}"`);
}

function fallback(key: string, opts: BuildSidcOptions, reason: string): ResolvedSymbol {
  const ckey = DOMAIN_CONTACT[domainFromKey(key, opts.domain)];
  const centry = SYMBOL_BY_KEY.get(ckey)!;
  assetErrors.push({ key, reason, fallbackKey: ckey });
  return { sidc: applyOptions(centry, opts), key: ckey, meaning: centry.meaning, fallback: true, error: reason };
}

/** Build a SIDC for `key` as seen by a viewer (see resolveSymbol for the fail-safe). */
export function buildSidc(key: SymbolEntityKey, opts: BuildSidcOptions): string {
  return resolveSymbol(key, opts).sidc;
}
