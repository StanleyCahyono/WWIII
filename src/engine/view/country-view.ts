/**
 * getCountryView — the ONLY projection the UI and AI consume.
 *  - Own country: full state (stacks, cities, provinces, ledger, research, jobs, missiles, orders).
 *  - Foreign stacks: ONLY as observations (contacts) with fields permitted by their level. An
 *    unknown/radar `contact` carries no owner/type/count keys at all.
 *  - Foreign cities: public fields only (name, owner, tier, capital, port, node, status).
 *  - Political ownership of provinces is public (the basemap).
 *  - Intel reports: own + those of shared-intel/coalition sources, frozen snapshots.
 * Shared public slices are cached per (state, tick) and frozen.
 */
import type { CityKey, CountryId, NodeId, Resource } from '../data-types';
import { RESOURCES } from '../data-types';
import type {
  ActiveResearch,
  Agent,
  CampaignResult,
  CityState,
  Coalition,
  ContactLevel,
  DiploStatus,
  GameEvent,
  GameState,
  IntelReport,
  Job,
  MarketFill,
  MarketOrder,
  Message,
  MissileInventory,
  Offer,
  ProvinceState,
  Stack,
  TerritoryStatus,
  OpeningPowerResult,
} from '../state';
import type { ResM } from '../fixed';
import { S } from '../scenario/registry';
import { formatGameTime, dayOf } from '../time';
import { resourceSummary, type ResourceSummary } from '../systems/economy';
import { researchSlots } from '../systems/research';
import { atWar, coalitionOf, grantLevel, statusFrom, visionSources, sameCoalition, stacksReadonly, territoryOf } from '../systems/world';
import { trustOf } from '../systems/diplomacy';
import { bookView, type BookLevel } from '../systems/market';
import { countryScores, thresholdFor } from '../systems/score';
import { routeEtaTick } from '../systems/movement';
import { alliedContacts, observedNodes, stackSensorRadii } from '../systems/visibility';
import { forceSummary, liftBreakdown, type ForceSummary, type LiftBreakdown } from '../systems/readiness';
import { RULES } from '../rules';
import { derived, invalidateDerived } from '../derived';

export interface PublicCity {
  key: CityKey;
  name: string;
  node: NodeId;
  owner: CountryId | null;
  homeland: CountryId;
  tier: number;
  capital: boolean;
  port: boolean;
  status: TerritoryStatus | 'rebel';
}

export interface ContactView {
  id: string;
  level: ContactLevel;
  domain: string;
  lonlat: [number, number];
  node: NodeId | null;
  observedAt: number;
  ageMin: number;
  owner?: CountryId;
  count?: number;
  units?: { type: string; hpPct: number }[];
}

export interface StackView extends Omit<Stack, 'units'> {
  units: Stack['units'];
  eta: number | null;
  lonlat: [number, number];
  /** Effective visual sight radius (km) incl. terrain at its node and unit levels (0 while aboard). */
  sightKm: number;
  /** Effective radar radius (km) incl. the radar_range_mult modifier (0 while aboard or without radar). */
  radarKm: number;
}

export interface DiplomacyRow {
  country: CountryId;
  name: string;
  controller: 'human' | 'ai';
  alive: boolean;
  /** What I grant them / they grant me (direction explicit). */
  myStatusToThem: DiploStatus;
  theirStatusToMe: DiploStatus;
  war: boolean;
  trust: number;
  coalition: string | null;
  sameCoalition: boolean;
  pendingOffers: string[];
}

export interface CountryView {
  viewer: CountryId;
  tick: number;
  day: number;
  time: string;
  finished: boolean;
  result: CampaignResult | null;
  humanRun: GameState['meta']['humanRun'];
  isHuman: boolean;
  self: {
    id: CountryId;
    name: string;
    doctrine: string;
    alive: boolean;
    capitalCity: CityKey | null;
    stock: ResM;
    escrow: ResM;
    resources: ResourceSummary[];
    shortages: Resource[];
    techs: string[];
    research: ActiveResearch[];
    researchSlots: number;
    unitLevels: Record<string, number>;
    missiles: Record<string, MissileInventory>;
    jobs: Job[];
    lift: number;
    liftBreakdown: LiftBreakdown;
    maintenanceSlots: number;
    personality: Record<string, number>;
    modifiers: Record<string, number>;
    force: ForceSummary;
  };
  stacks: StackView[];
  cities: CityState[];
  provinces: ProvinceState[];
  owners: (CountryId | null)[];
  rebelNodes: NodeId[];
  publicCities: PublicCity[];
  contacts: ContactView[];
  /** Node ids currently covered by the viewer's (and its vision sources') sensors or territory, sorted. */
  observedNodes: NodeId[];
  reports: (IntelReport & { expired: boolean; shared: boolean })[];
  agents: Agent[];
  relations: DiplomacyRow[];
  offers: Offer[];
  coalitions: (Pick<Coalition, 'id' | 'name' | 'description' | 'emblem' | 'leader' | 'createdAt' | 'dissolvedAt'> & { members: CountryId[]; departures: Coalition['departures']; applications?: Coalition['applications']; score: number })[];
  myCoalition: string | null;
  messages: Record<string, Message[]>;
  market: { books: Record<string, { bids: BookLevel[]; asks: BookLevel[]; last: number | null }>; myOrders: MarketOrder[]; myFills: MarketFill[] };
  launches: { id: string; missile: string; target: NodeId; launchedAt: number; arriveAt: number; knowledge: string; mine: boolean }[];
  scores: { denominator: number; byCountry: Record<CountryId, number>; soloThreshold: number; coalitionThresholds: Record<number, number>; lastSettledDay: number };
  journal: { id: string; at: number; kind: string; category: string; node: NodeId | null; text: string; data?: Record<string, unknown>; interrupt: boolean; routine: boolean }[];
  openingPower: OpeningPowerResult | null;
  rules: typeof RULES;
}

function publicSlice(state: GameState) {
  const base = derived(state, '~public', () => computePublic(state));
  const books = derived(state, 'books', () => {
    const b: CountryView['market']['books'] = {};
    for (const r of RESOURCES) if (r !== 'money') b[r] = bookView(state, r);
    return b;
  });
  const offers = derived(state, 'offerIndex', () => {
    const byCountry = new Map<CountryId, Offer[]>();
    for (const o of Object.values(state.offers)) {
      for (const c of [o.from, o.to]) {
        const l = byCountry.get(c) ?? [];
        l.push(o);
        byCountry.set(c, l);
      }
    }
    return byCountry;
  });
  return { ...base, books, offers };
}
function computePublic(state: GameState) {
  const owners = state.provinces.map((p) => (p ? p.owner : null));
  const rebel = state.provinces.filter((p) => p && p.control === 'rebel').map((p) => (p as ProvinceState).node);
  const cities: PublicCity[] = Object.keys(state.cities)
    .sort()
    .map((k) => {
      const ci = state.cities[k];
      const p = state.provinces[ci.node] as ProvinceState;
      return Object.freeze({ key: k, name: ci.name, node: ci.node, owner: p.owner, homeland: p.homeland as CountryId, tier: ci.tier, capital: ci.capital, port: ci.port, status: p.control === 'rebel' ? 'rebel' : p.status }) as PublicCity;
    });
  return { tick: state.clock.tick, owners: Object.freeze(owners) as (CountryId | null)[], rebel, cities: Object.freeze(cities) as PublicCity[], scores: countryScores(state) };
}

/** Invalidate memoized derived data (public slices, rates, force summaries). */
export function invalidateViewCache(state: GameState): void {
  invalidateDerived(state);
}

export function projectContact(c: { id: string; level: ContactLevel; domain: string; lonlat: [number, number]; node: NodeId | null; observedAt: number; owner: CountryId | null; count: number | null; units: { type: string; hpPct: number; i?: number }[] | null }, now: number, refreshedAt?: number, live?: GameState['stacks'][string] | null): ContactView {
  const obs = c.level !== 'stale' && refreshedAt !== undefined ? Math.max(refreshedAt, c.observedAt) : c.observedAt;
  const v: ContactView = { id: c.id, level: c.level, domain: c.domain, lonlat: [c.lonlat[0], c.lonlat[1]], node: c.node, observedAt: obs, ageMin: now - obs };
  if (c.level === 'contact') return v;
  if (c.owner !== null) v.owner = c.owner;
  if (c.count !== null) v.count = c.count;
  if (c.level === 'identified' || (c.level === 'stale' && c.units)) if (c.units) {
    // current identified contacts show live HP of the observed members; stale ones the frozen snapshot
    v.units = c.units.map((u) => {
      const lu = c.level === 'identified' && live && u.i !== undefined ? live.units[u.i] : undefined;
      return lu && lu.type === u.type ? { type: u.type, hpPct: Math.round((lu.hp / lu.maxHp) * 100) } : { type: u.type, hpPct: u.hpPct };
    });
  }
  return v;
}

export function journalFor(state: GameState, c: CountryId, limit = 40, scan = 4000): CountryView['journal'] {
  const out: CountryView['journal'] = [];
  for (let i = state.events.length - 1; i >= 0 && out.length < limit && state.events.length - i <= scan; i--) {
    const e: GameEvent = state.events[i];
    const p = e.private[c];
    if (!p) continue;
    out.push({ id: e.id, at: e.at, kind: e.kind, category: e.category, node: e.node, text: p.text, data: p.data, interrupt: e.interrupt.includes(c), routine: e.routine });
  }
  return out;
}

export function getCountryView(state: GameState, viewer: CountryId, opts: { journalLimit?: number; journalScan?: number } = {}): CountryView {
  const cs = state.countries[viewer];
  if (!cs) throw new Error(`Unknown country ${viewer}`);
  const pub = publicSlice(state);
  const t = state.clock.tick;
  const stacks: StackView[] = [];
  for (const s of stacksByOwner(state).get(viewer) ?? []) {
    if (state.stacks[s.id] !== s) continue;
    const radii = stackSensorRadii(state, s);
    stacks.push({ ...cloneStack(s), eta: routeEtaTick(state, s), lonlat: lonlatOf(state, s), sightKm: radii.sightKm, radarKm: radii.radarKm });
  }
  stacks.sort((a, b) => (a.id < b.id ? -1 : 1));
  const cities: CityState[] = [];
  const provinces: ProvinceState[] = [];
  const mine = territoryOf(state, viewer);
  for (const n of mine.nodes) provinces.push(JSON.parse(JSON.stringify(state.provinces[n])));
  for (const k of mine.cities) cities.push(JSON.parse(JSON.stringify(state.cities[k])));
  const contacts: ContactView[] = [];
  const table = state.contacts[viewer] ?? {};
  const refreshed = state.clock.lastVisibility;
  for (const k of Object.keys(table).sort()) {
    const c = table[k];
    contacts.push(projectContact(c, t, refreshed, c.level === 'identified' ? state.stacks[c.stack] ?? null : null));
  }
  for (const c of alliedContacts(state, viewer)) if (!table[c.id]) contacts.push(projectContact(c, t));
  const srcs = new Set(visionSources(state, viewer));
  const reports: CountryView['reports'] = [];
  for (const r of Object.values(state.reports)) {
    if (r.country !== viewer && !srcs.has(r.country)) continue;
    reports.push({ ...JSON.parse(JSON.stringify(r)), expired: t >= r.expiresAt, shared: r.country !== viewer });
  }
  reports.sort((a, b) => b.observedAt - a.observedAt || (a.id < b.id ? -1 : 1));
  const myOffers = pub.offers.get(viewer) ?? [];
  const relations: DiplomacyRow[] = state.countryOrder
    .filter((c) => c !== viewer)
    .map((c) => ({
      country: c,
      name: state.countries[c].name,
      controller: state.countries[c].controller,
      alive: state.countries[c].alive,
      myStatusToThem: statusFrom(state, viewer, c),
      theirStatusToMe: statusFrom(state, c, viewer),
      war: atWar(state, viewer, c),
      trust: trustOf(state, viewer, c),
      coalition: coalitionOf(state, c)?.id ?? null,
      sameCoalition: c !== viewer && sameCoalition(state, viewer, c),
      pendingOffers: myOffers.filter((o) => o.status === 'pending' && (o.from === c || o.to === c)).map((o) => o.id),
    }));
  const offers = myOffers.map((o) => JSON.parse(JSON.stringify(o)) as Offer);
  const myCo = coalitionOf(state, viewer);
  const coalitions = Object.values(state.coalitions).map((co) => ({
    id: co.id,
    name: co.name,
    description: co.description,
    emblem: co.emblem,
    leader: co.leader,
    createdAt: co.createdAt,
    dissolvedAt: co.dissolvedAt,
    members: co.members.map((m) => m.country),
    departures: co.departures.map((d) => ({ ...d })),
    applications: co.leader === viewer ? co.applications.map((a) => ({ ...a })) : undefined,
    score: co.members.reduce((a, m) => a + (pub.scores[m.country] ?? 0), 0),
  }));
  const messages: Record<string, Message[]> = {};
  for (const th of threadIndex(state).get(viewer) ?? []) messages[th] = state.messages[th].map((m) => ({ ...m }));
  if (myCo && state.messages[`co:${myCo.id}`]) messages[`co:${myCo.id}`] = state.messages[`co:${myCo.id}`].map((m) => ({ ...m }));
  const launches: CountryView['launches'] = [];
  for (const l of Object.values(state.launches)) {
    const k = l.knowledge[viewer];
    if (!k) continue;
    launches.push({ id: l.id, missile: l.missile, target: l.target, launchedAt: l.launchedAt, arriveAt: l.country === viewer ? l.arriveAt : l.arriveAt, knowledge: k, mine: l.country === viewer });
  }
  const res = resourceSummary(state, viewer);
  return {
    viewer,
    tick: t,
    day: dayOf(t),
    time: formatGameTime(t, state.meta.startDate),
    finished: !!state.score.result,
    result: state.score.result ? JSON.parse(JSON.stringify(state.score.result)) : null,
    humanRun: state.meta.humanRun,
    isHuman: cs.controller === 'human',
    self: {
      id: viewer,
      name: cs.name,
      doctrine: cs.doctrine,
      alive: cs.alive,
      capitalCity: cs.capitalCity,
      stock: { ...cs.stock },
      escrow: { ...cs.escrow },
      resources: res,
      shortages: [...cs.shortages],
      techs: Object.keys(cs.techs).sort(),
      research: cs.research.map((r) => ({ ...r, cost: { ...r.cost } })),
      researchSlots: researchSlots(state, viewer),
      unitLevels: { ...cs.unitLevels },
      missiles: JSON.parse(JSON.stringify(cs.missiles)),
      jobs: JSON.parse(JSON.stringify(cs.jobs)),
      lift: liftBreakdown(state, viewer).total,
      liftBreakdown: liftBreakdown(state, viewer),
      maintenanceSlots: cs.maintenanceSlots,
      personality: { ...cs.personality },
      modifiers: { ...cs.modifiers },
      force: forceSummary(state, viewer),
    },
    stacks,
    cities,
    provinces,
    owners: pub.owners,
    rebelNodes: pub.rebel,
    publicCities: pub.cities,
    contacts,
    observedNodes: [...observedNodes(state, viewer)],
    reports,
    agents: Object.values(state.agents).filter((a) => a.country === viewer).map((a) => ({ ...a })),
    relations,
    offers,
    coalitions,
    myCoalition: myCo?.id ?? null,
    messages,
    market: {
      books: pub.books,
      myOrders: Object.values(state.market.orders).filter((o) => o.country === viewer).map((o) => ({ ...o })),
      myFills: state.market.fills.filter((f) => f.buyer === viewer || f.seller === viewer).map((f) => ({ ...f })),
    },
    launches,
    scores: { denominator: state.score.denominator, byCountry: { ...pub.scores }, soloThreshold: thresholdFor(state.score.denominator, 1), coalitionThresholds: { 2: thresholdFor(state.score.denominator, 2), 3: thresholdFor(state.score.denominator, 3), 4: thresholdFor(state.score.denominator, 4), 5: thresholdFor(state.score.denominator, 5) }, lastSettledDay: state.score.lastSettledDay },
    journal: journalFor(state, viewer, opts.journalLimit ?? 40, opts.journalScan ?? 4000),
    openingPower: state.openingPower,
    rules: RULES,
  };
}

const byOwnerCache = new WeakMap<GameState, { list: readonly Stack[]; m: Map<CountryId, Stack[]> }>();
function stacksByOwner(state: GameState): Map<CountryId, Stack[]> {
  const list = stacksReadonly(state);
  const c = byOwnerCache.get(state);
  if (c && c.list === list) return c.m;
  const m = new Map<CountryId, Stack[]>();
  for (const s of list) (m.get(s.owner) ?? m.set(s.owner, []).get(s.owner)!).push(s);
  byOwnerCache.set(state, { list, m });
  return m;
}
const threadCache = new WeakMap<GameState, { n: number; obj: object; m: Map<CountryId, string[]> }>();
function threadIndex(state: GameState): Map<CountryId, string[]> {
  const keys = Object.keys(state.messages);
  const c = threadCache.get(state);
  if (c && c.n === keys.length && c.obj === state.messages) return c.m;
  const m = new Map<CountryId, string[]>();
  for (const th of keys.sort()) {
    if (!th.startsWith('dm:')) continue;
    for (const p of th.slice(3).split('|')) (m.get(p) ?? m.set(p, []).get(p)!).push(th);
  }
  threadCache.set(state, { n: keys.length, obj: state.messages, m });
  return m;
}
/** Structural copy of a stack (cheaper than JSON round-trip; stacks are plain data). */
function cloneStack(s: Stack): Stack {
  return {
    ...s,
    units: s.units.map((u) => ({ ...u })),
    pos: s.pos.kind === 'air' ? { ...s.pos, from: [s.pos.from[0], s.pos.from[1]], to: [s.pos.to[0], s.pos.to[1]] } : { ...s.pos },
    order: s.order ? (s.order.kind === 'move' ? { ...s.order, route: s.order.route.map((r) => ({ ...r })), waypoints: [...s.order.waypoints], warConfirmed: [...s.order.warConfirmed], attack: s.order.attack ? { ...s.order.attack } : undefined } : { ...s.order, warConfirmed: [...s.order.warConfirmed] }) : null,
    air: s.air ? JSON.parse(JSON.stringify(s.air)) : null,
  };
}

function lonlatOf(state: GameState, s: Stack): [number, number] {
  const m = S(state).map;
  if (s.pos.kind === 'node') return [m.lon[s.pos.node], m.lat[s.pos.node]];
  if (s.pos.kind === 'edge') {
    const f = s.pos.length > 0 ? s.pos.progress / s.pos.length : 0;
    return [m.lon[s.pos.from] + (m.lon[s.pos.to] - m.lon[s.pos.from]) * f, m.lat[s.pos.from] + (m.lat[s.pos.to] - m.lat[s.pos.from]) * f];
  }
  const p = s.pos;
  const tt = p.arrive > p.depart ? Math.min(1, Math.max(0, (state.clock.tick - p.depart) / (p.arrive - p.depart))) : 1;
  return [p.from[0] + (p.to[0] - p.from[0]) * tt, p.from[1] + (p.to[1] - p.from[1]) * tt];
}

export { grantLevel };

/**
 * Batch projection for many countries (e.g. all AI planners of one review round). Shared public
 * slices (ownership, public cities, scores, books, offer index, stack/territory indexes, economy
 * rates) are computed once and reused; each result is identical to `getCountryView(state, id)`.
 */
export function getCountryViews(state: GameState, ids: readonly CountryId[], opts: { journalLimit?: number; journalScan?: number } = {}): Map<CountryId, CountryView> {
  const out = new Map<CountryId, CountryView>();
  for (const id of ids) out.set(id, getCountryView(state, id, opts));
  return out;
}
