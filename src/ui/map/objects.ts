/**
 * THE filtered map-object dataset. Built only from the human's CountryView. Map drawing, hit
 * testing, search, roster rows and accessible names all consume these objects, so an unknown
 * contact can never expose hidden branch/type/strength/destination anywhere in the UI.
 */
import { buildSidc, contactKeyForDomain, type Affiliation } from '../../data/catalog/sidc';
import { unitById, countryName, placeName, cityByNode, NODES } from '../data/static';
import { ageLabel, gameTime } from '../format';
import type { Frame } from '../sim/protocol';
import type { Domain } from '../../engine/data-types';

export type ObjKind = 'stack' | 'contact' | 'report';

export interface MapObject {
  /** UI id: S:<stackId> | C:<contactId> | R:<reportId>:<ref> */
  id: string;
  kind: ObjKind;
  /** Underlying id (stack id / contact id / report id). */
  ref: string;
  lonlat: [number, number];
  node: number | null;
  affiliation: Affiliation;
  domain: Domain;
  sidc: string;
  symbolKey: string;
  /** Short label safe for display (no hidden information). */
  label: string;
  /** Longer accessible description (same knowledge as label). */
  aria: string;
  designation: string | null;
  owner: string | null;
  /** Observation age in minutes (contacts/reports); null = current own formation. */
  ageMin: number | null;
  stale: boolean;
  /** Known count of units (never shown as echelon). */
  count: number | null;
  status: 'present' | 'planned' | 'damaged';
  /** Searchable text (exactly the same knowledge as label/aria). */
  search: string;
  moving: boolean;
  parent: string | null;
  group: string;
  hasOrder: boolean;
  expired?: boolean;
}

const DOMAIN_WORD: Record<string, string> = { land: 'ground', air: 'air', sea: 'surface', subsurface: 'subsurface', strategic: 'strategic' };

export function affiliationFor(frame: Frame, owner: string | null | undefined): Affiliation {
  const me = frame.view.viewer;
  if (!owner) return 'unknown';
  if (owner === me) return 'friend';
  const r = frame.view.relations.find((x) => x.country === owner);
  if (!r) return 'unknown';
  if (r.war) return 'hostile';
  if (r.sameCoalition) return 'friend';
  return 'neutral';
}

function dominantType(units: { type: string }[]): string | null {
  const counts = new Map<string, number>();
  for (const u of units) counts.set(u.type, (counts.get(u.type) ?? 0) + 1);
  let best: string | null = null;
  let bc = -1;
  for (const [t, c] of counts) {
    const ut = unitById.get(t);
    const score = c * 10 + (ut ? 4 - ut.echelon : 0);
    if (score > bc || (score === bc && best !== null && t < best)) {
      best = t;
      bc = score;
    }
  }
  return best;
}

function domainOfType(t: string | null, fallback: Domain): Domain {
  const ut = t ? unitById.get(t) : undefined;
  return ut ? (ut.domain === 'strategic' ? 'land' : ut.domain) : fallback;
}

function composition(units: { type: string }[]): string {
  const counts = new Map<string, number>();
  for (const u of units) counts.set(u.type, (counts.get(u.type) ?? 0) + 1);
  return [...counts.entries()].map(([t, c]) => `${c}× ${unitById.get(t)?.name ?? t}`).join(', ');
}

export function buildObjects(frame: Frame): MapObject[] {
  const v = frame.view;
  const out: MapObject[] = [];
  const now = v.tick;
  for (const s of v.stacks) {
    const dt = dominantType(s.units);
    const ut = dt ? unitById.get(dt) : undefined;
    const domain: Domain = s.moveClass === 'air' ? 'air' : s.moveClass === 'naval' ? domainOfType(dt, 'sea') : 'land';
    const hpFrac = s.units.reduce((a, u) => a + u.hp, 0) / Math.max(1, s.units.reduce((a, u) => a + u.maxHp, 0));
    const status = hpFrac < 0.5 ? 'damaged' : 'present';
    const key = ut?.symbol ?? contactKeyForDomain(domain);
    const sidc = buildSidc(key, { affiliation: 'friend', status, domain });
    const node = s.pos.kind === 'node' ? s.pos.node : null;
    const where = node !== null ? placeName(node) : s.pos.kind === 'edge' ? `en route ${placeName(s.pos.from)} → ${placeName(s.pos.to)}` : 'airborne';
    const comp = composition(s.units);
    const dest = s.order && s.order.kind === 'move' ? placeName(s.order.dest) : null;
    const label = s.name;
    const aria = `Friendly ${DOMAIN_WORD[domain]} formation ${s.name}, ${s.units.length} unit${s.units.length === 1 ? '' : 's'} (${comp}), ${where}${dest ? `, moving to ${dest}` : ''}${status === 'damaged' ? ', damaged' : ''}.`;
    out.push({
      id: `S:${s.id}`,
      kind: 'stack',
      ref: s.id,
      lonlat: s.lonlat,
      node,
      affiliation: 'friend',
      domain,
      sidc,
      symbolKey: key,
      label,
      aria,
      designation: s.name,
      owner: v.viewer,
      ageMin: null,
      stale: false,
      count: s.units.length,
      status,
      search: `${s.name} ${comp} ${where} friendly ${DOMAIN_WORD[domain]}`.toLowerCase(),
      moving: s.pos.kind !== 'node' || !!s.order,
      parent: s.aboard,
      group: domain,
      hasOrder: !!s.order,
    });
  }
  for (const c of v.contacts) {
    const age = c.ageMin;
    const stale = c.level === 'stale';
    const affil = affiliationFor(frame, c.owner);
    const dom = (['land', 'air', 'sea', 'subsurface'].includes(c.domain) ? c.domain : 'land') as Domain;
    let key = contactKeyForDomain(dom);
    let comp = '';
    if (c.units && c.units.length && (c.level === 'identified' || stale)) {
      const dt = dominantType(c.units);
      const ut = dt ? unitById.get(dt) : undefined;
      if (ut) key = ut.symbol;
      comp = composition(c.units);
    }
    const sidc = buildSidc(key, { affiliation: affil, status: 'present', domain: dom });
    const ownerTxt = c.owner ? countryName(c.owner) : null;
    let label: string;
    let aria: string;
    const where = c.node !== null ? placeName(c.node) : 'open area';
    if (c.level === 'contact') {
      label = `Unknown ${DOMAIN_WORD[dom]} contact`;
      aria = `Unknown ${DOMAIN_WORD[dom]} contact near ${where}, last observed ${ageLabel(age)} (${gameTime(c.observedAt)}). Owner, type and strength unknown.`;
    } else if (c.level === 'unidentified') {
      label = `${ownerTxt ? `${ownerTxt} ` : ''}unidentified ${DOMAIN_WORD[dom]} contact`;
      aria = `Unidentified ${DOMAIN_WORD[dom]} contact${ownerTxt ? ` of ${ownerTxt}` : ''}${c.count ? `, ${c.count} detected` : ''} near ${where}, observed ${ageLabel(age)}. Type unknown.`;
    } else if (c.level === 'identified') {
      label = `${ownerTxt ?? 'Foreign'} ${comp || DOMAIN_WORD[dom] + ' formation'}`;
      aria = `Identified ${ownerTxt ?? 'foreign'} formation near ${where}: ${comp || 'composition not observed'}, observed ${ageLabel(age)}.`;
    } else {
      label = `Stale ${DOMAIN_WORD[dom]} contact (${ageLabel(age)})`;
      aria = `Stale ${DOMAIN_WORD[dom]} contact${ownerTxt ? ` of ${ownerTxt}` : ''} last seen near ${where} ${ageLabel(age)}${comp ? `: ${comp}` : ''}. Current position unknown.`;
    }
    out.push({
      id: `C:${c.id}`,
      kind: 'contact',
      ref: c.id,
      lonlat: c.lonlat,
      node: c.node,
      affiliation: affil,
      domain: dom,
      sidc,
      symbolKey: key,
      label,
      aria,
      designation: null,
      owner: c.owner ?? null,
      ageMin: age,
      stale: stale || age >= 120,
      count: c.count ?? null,
      status: 'present',
      search: `${label} ${where} contact`.toLowerCase(),
      moving: false,
      parent: null,
      group: 'contact',
      hasOrder: false,
    });
  }
  for (const r of v.reports) {
    if (r.expired) continue;
    r.stacks.forEach((s) => {
      const affil = affiliationFor(frame, s.owner);
      const units = s.units.flatMap((u) => Array.from({ length: Math.min(u.count, 20) }, () => ({ type: u.type })));
      const dt = dominantType(units);
      const ut = dt ? unitById.get(dt) : undefined;
      const dom = domainOfType(dt, 'land');
      const key = ut?.symbol ?? contactKeyForDomain(dom);
      const sidc = buildSidc(key, { affiliation: affil, status: 'present', domain: dom });
      const comp = s.units.map((u) => `${u.count}× ${unitById.get(u.type)?.name ?? u.type}`).join(', ');
      const age = now - r.observedAt;
      const where = s.node !== null ? placeName(s.node) : 'open area';
      const label = `Report: ${countryName(s.owner)} at ${where}`;
      const aria = `Intelligence report (${r.source}${r.shared ? ', shared' : ''}) as of ${gameTime(r.observedAt)}: ${countryName(s.owner)} formation at ${where} — ${comp}. Frozen snapshot; expires ${gameTime(r.expiresAt)}.`;
      out.push({
        id: `R:${r.id}:${s.ref}`,
        kind: 'report',
        ref: r.id,
        lonlat: s.lonlat,
        node: s.node,
        affiliation: affil,
        domain: dom,
        sidc,
        symbolKey: key,
        label,
        aria,
        designation: null,
        owner: s.owner,
        ageMin: age,
        stale: true,
        count: s.units.reduce((a, u) => a + u.count, 0),
        status: 'present',
        search: `report ${countryName(s.owner)} ${where} ${comp}`.toLowerCase(),
        moving: false,
        parent: null,
        group: 'report',
        hasOrder: false,
      });
    });
  }
  return out;
}

export interface PlaceResult {
  id: string;
  kind: 'city' | 'province' | 'country';
  label: string;
  sub: string;
  node: number;
  lonlat: [number, number];
}

/** Public geography search (cities + provinces + countries). */
export function searchPlaces(q: string, frame: Frame | null, limit = 12): PlaceResult[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const out: PlaceResult[] = [];
  const owners = frame?.view.owners;
  for (const c of cityByNode.values()) {
    if (c.name.toLowerCase().includes(s)) out.push({ id: `city:${c.key}`, kind: 'city', label: c.name, sub: `City · ${countryName(owners ? owners[c.node] : c.country)}${c.capital ? ' · capital' : ''}`, node: c.node, lonlat: c.lonlat });
    if (out.length > limit * 2) break;
  }
  for (const n of NODES) {
    if (n.kind !== 'land' || n.outside) continue;
    if (n.name.toLowerCase().includes(s)) out.push({ id: `prov:${n.id}`, kind: 'province', label: n.name, sub: `Province · ${countryName(owners ? owners[n.id] : n.country)}`, node: n.id, lonlat: n.center });
    if (out.length > limit * 3) break;
  }
  // Prefix matches first, cities before provinces, then the player's own places (two "La Paz":
  // a Bolivian player gets Bolivia's capital on Enter), then exact names, then capitals.
  const me = frame?.view.viewer;
  const mine = (r: PlaceResult) => Number(!(me && owners && owners[r.node] === me));
  const exact = (r: PlaceResult) => Number(r.label.toLowerCase() !== s);
  const capital = (r: PlaceResult) => Number(!r.sub.includes('capital'));
  out.sort((a, b) => Number(!a.label.toLowerCase().startsWith(s)) - Number(!b.label.toLowerCase().startsWith(s)) || (a.kind === 'city' ? -1 : 1) - (b.kind === 'city' ? -1 : 1) || mine(a) - mine(b) || exact(a) - exact(b) || capital(a) - capital(b));
  return out.slice(0, limit);
}
