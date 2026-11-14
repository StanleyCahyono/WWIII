/**
 * getCountryView — the ONLY projection the UI and AI consume.
 *  - Own country: full state (stacks, cities, provinces, ledger, research, jobs, missiles, orders).
 *  - Foreign stacks: ONLY as observations (contacts) with fields permitted by their level. An
 *    unknown/radar `contact` carries no owner/type/count keys at all.
 *  - Foreign cities: public fields only (name, owner, tier, capital, port, node, status).
 *  - Political ownership of provinces is public (the basemap).
 *  - Intel reports: own + those of shared-intel/coalition sources, frozen snapshots.
 * Shared public slices (ownership, public cities, scores, books, war list) are memoized by saved
 * version counters and frozen; per-viewer data is copied. `{ lite: true }` builds the planner view
 * (see `ViewOptions.lite`).
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
  TrustEntry,
  TrustState,
  OpeningPowerResult,
} from '../state';
import type { ResM } from '../fixed';
import { S } from '../scenario/registry';
import { formatGameTime, dayOf } from '../time';
import { resourceSummary, type ResourceSummary } from '../systems/economy';
import { researchSlots } from '../systems/research';
import { coalitionIndex, coalitionOf, enemyMap, grantLevel, grantMap, grantTouch, visionSources, stacksOfOwner, territoryOf } from '../systems/world';
import { trustRow } from '../systems/diplomacy';
import { bookView, ordersOf, type BookLevel } from '../systems/market';
import { countryScores, thresholdFor } from '../systems/score';
import { routeEtaTick } from '../systems/movement';
import { forEachAlliedStack, observedNodes, sortedContactIds, stackSensorRadii } from '../systems/visibility';
import { forceSummary, liftBreakdown, type ForceSummary, type LiftBreakdown } from '../systems/readiness';
import { RULES } from '../rules';
import { derived, invalidateDerived, memoByVersion } from '../derived';

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
  /**
   * The viewer's OWN trust history toward this country (engine-recorded changes, oldest first);
   * absent if untouched. The free-text reason is omitted: it can carry the other side's private
   * wording (e.g. a declaration-of-war reason only the declarer was told).
   */
  trustHistory?: Pick<TrustEntry, 'at' | 'kind' | 'delta'>[];
}

export interface CountryView {
  viewer: CountryId;
  /**
   * Set on a planner ("lite") view: `self.force`, `self.lift`, `self.liftBreakdown`,
   * `observedNodes`, stack `sightKm`/`radarKm` and `market.myFills` are NOT computed (zero/empty
   * placeholders). Everything else is identical to the full view.
   */
  lite?: true;
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
  coalitions: (Pick<Coalition, 'id' | 'name' | 'description' | 'emblem' | 'leader' | 'createdAt' | 'dissolvedAt'> & {
    members: CountryId[];
    /** Join tick of every current member (public: joins are announced). */
    joinedAt: Record<CountryId, number>;
    departures: Coalition['departures'];
    applications?: Coalition['applications'];
    score: number;
  })[];
  myCoalition: string | null;
  /** Every current war as a sorted pair [a, b] (a < b), sorted — public (declarations and peace are headlines). */
  wars: [CountryId, CountryId][];
  messages: Record<string, Message[]>;
  market: { books: Record<string, { bids: BookLevel[]; asks: BookLevel[]; last: number | null }>; myOrders: MarketOrder[]; myFills: MarketFill[] };
  launches: { id: string; missile: string; target: NodeId; launchedAt: number; arriveAt: number; knowledge: string; mine: boolean }[];
  scores: { denominator: number; byCountry: Record<CountryId, number>; soloThreshold: number; coalitionThresholds: Record<number, number>; lastSettledDay: number };
  journal: { id: string; at: number; kind: string; category: string; node: NodeId | null; text: string; data?: Record<string, unknown>; interrupt: boolean; routine: boolean }[];
  openingPower: OpeningPowerResult | null;
  rules: typeof RULES;
}

function publicSlice(state: GameState) {
  // public basemap slice: ownership/control changes bump `ownv` (transferNode); the only other
  // public field that changes — territory status (annexation) — is re-checked on every hit
  // (re-validated once per step: commands cannot change ownership or territory status)
  const base = derived(state, '~publicSlice', () => memoByVersion(state, 'publicSlice', `${state.ids.ownv ?? 0}`, [state.provinces, state.cities], () => computePublic(state), (b) => {
    for (const pc of b.cities) {
      const p = state.provinces[pc.node] as ProvinceState;
      if (pc.status !== (p.control === 'rebel' ? 'rebel' : p.status) || pc.owner !== p.owner) return false;
    }
    return true;
  }));
  const books: CountryView['market']['books'] = {};
  for (const r of RESOURCES) if (r !== 'money') books[r] = bookView(state, r);
  // offers are created only with a new id (counter) and deleted only by the day-change prune;
  // status changes are in place, so the index of references stays valid across steps and commands
  // (readers drop pruned entries: `liveOffers`)
  const offers = memoByVersion(state, 'offerIndex', `${state.ids.offer ?? 0}`, [state.offers], () => {
    const byCountry = new Map<CountryId, Offer[]>();
    for (const o of Object.values(state.offers)) {
      (byCountry.get(o.from) ?? byCountry.set(o.from, []).get(o.from)!).push(o);
      if (o.to !== o.from) (byCountry.get(o.to) ?? byCountry.set(o.to, []).get(o.to)!).push(o);
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
  return { owners: Object.freeze(owners) as (CountryId | null)[], rebel: Object.freeze(rebel) as NodeId[], cities: Object.freeze(cities) as PublicCity[], scores: Object.freeze(countryScores(state)) as Record<CountryId, number> };
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

/**
 * Per-recipient index of the (append-only, id-ascending) event log: events are added from a
 * cursor, the front is trimmed lazily after pruning; rebuilt when the events array is replaced
 * (load/clone). Used so a view reads its journal tail without scanning every recent event.
 */
interface JournalIndex {
  events: GameEvent[];
  lastId: number;
  by: Map<CountryId, GameEvent[]>;
}
const journalIndexCache = new WeakMap<GameState, JournalIndex>();
const evNum = (e: GameEvent) => Number(e.id.slice(1));
function journalIndex(state: GameState): JournalIndex {
  const evs = state.events;
  let ix = journalIndexCache.get(state);
  if (!ix || ix.events !== evs) {
    ix = { events: evs, lastId: -1, by: new Map() };
    journalIndexCache.set(state, ix);
  }
  const n = evs.length;
  if (n && evNum(evs[n - 1]) > ix.lastId) {
    let from = n;
    while (from > 0 && evNum(evs[from - 1]) > ix.lastId) from--;
    for (let i = from; i < n; i++) {
      const e = evs[i];
      for (const c in e.private) if (e.private[c]) (ix.by.get(c) ?? ix.by.set(c, []).get(c)!).push(e);
    }
    ix.lastId = evNum(evs[n - 1]);
    // drop entries that left the log (pruned from the front)
    const first = n ? evNum(evs[0]) : 0;
    for (const l of ix.by.values()) if (l.length > 64 && evNum(l[0]) < first) {
      let k = 0;
      while (k < l.length && evNum(l[k]) < first) k++;
      l.splice(0, k);
    }
  }
  return ix;
}

/** Private journal of `c`: newest first, at most `limit` entries among the last `scan` events. */
export function journalFor(state: GameState, c: CountryId, limit = 40, scan = 4000): CountryView['journal'] {
  const out: CountryView['journal'] = [];
  const evs = state.events;
  if (!evs.length || limit <= 0 || scan <= 0) return out;
  const list = journalIndex(state).by.get(c);
  if (!list) return out;
  const minId = evNum(evs[Math.max(0, evs.length - scan)]);
  for (let i = list.length - 1; i >= 0 && out.length < limit; i--) {
    const e = list[i];
    if (evNum(e) < minId) break;
    const p = e.private[c];
    out.push({ id: e.id, at: e.at, kind: e.kind, category: e.category, node: e.node, text: p.text, data: p.data, interrupt: e.interrupt.includes(c), routine: e.routine });
  }
  return out;
}

export interface ViewOptions {
  journalLimit?: number;
  journalScan?: number;
  /**
   * Planner view: skip the fields no planner in src/ai reads (force summary, lift, observed
   * nodes, stack sensor radii, own fills). Used by the AI scheduler for controllers that declare
   * `liteView`; the UI keeps full views.
   */
  lite?: boolean;
}

const NO_OFFERS: Offer[] = [];
/** The index list without offers pruned since it was built (same order as a fresh index). */
function liveOffers(state: GameState, l: Offer[] | undefined): Offer[] {
  if (!l) return NO_OFFERS;
  for (const o of l) if (state.offers[o.id] !== o) return l.filter((x) => state.offers[x.id] === x);
  return l;
}
const NO_RADII = { sightKm: 0, radarKm: 0 };
const EMPTY_LIFT: LiftBreakdown = Object.freeze({ base: 0, buildings: 0, units: 0, total: 0 });
const EMPTY_FORCE: ForceSummary = Object.freeze({ fielded: 0, ready: 0, committed: 0, inRefit: 0, units: 0, stacks: 0, maintenanceUsed: 0, maintenanceCapacity: 0, byDomain: Object.freeze({}) as ForceSummary['byDomain'] });

export function getCountryView(state: GameState, viewer: CountryId, opts: ViewOptions = {}): CountryView {
  const cs = state.countries[viewer];
  if (!cs) throw new Error(`Unknown country ${viewer}`);
  const lite = opts.lite === true;
  const pub = publicSlice(state);
  const t = state.clock.tick;
  const stacks: StackView[] = [];
  for (const s of stacksOfOwner(state, viewer)) {
    if (state.stacks[s.id] !== s) continue;
    const radii = lite ? NO_RADII : stackSensorRadii(state, s);
    stacks.push({ ...cloneStack(s), eta: routeEtaTick(state, s), lonlat: lonlatOf(state, s), sightKm: radii.sightKm, radarKm: radii.radarKm });
  }
  stacks.sort((a, b) => (a.id < b.id ? -1 : 1));
  const cities: CityState[] = [];
  const provinces: ProvinceState[] = [];
  const mine = territoryOf(state, viewer);
  for (const n of mine.nodes) provinces.push(cloneProvince(state.provinces[n] as ProvinceState));
  for (const k of mine.cities) cities.push(cloneCity(state.cities[k]));
  const contacts: ContactView[] = [];
  const table = state.contacts[viewer] ?? {};
  const refreshed = state.clock.lastVisibility;
  for (const k of sortedContactIds(table)) {
    const c = table[k];
    contacts.push(projectContact(c, t, refreshed, c.level === 'identified' ? state.stacks[c.stack] ?? null : null));
  }
  // allied (vision-source) stacks: identified and live; projected directly (same fields as projectContact)
  forEachAlliedStack(state, viewer, (s, cid, lonlat, domain) => {
    if (table[cid]) return;
    contacts.push({ id: cid, level: 'identified', domain, lonlat, node: s.pos.kind === 'node' ? s.pos.node : null, observedAt: t, ageMin: 0, owner: s.owner, count: s.units.length, units: alliedUnits(s) });
  });
  const srcs = new Set(visionSources(state, viewer));
  const reports: CountryView['reports'] = [];
  for (const r of Object.values(state.reports)) {
    if (r.country !== viewer && !srcs.has(r.country)) continue;
    reports.push({ ...plainClone(r), expired: t >= r.expiresAt, shared: r.country !== viewer });
  }
  reports.sort((a, b) => b.observedAt - a.observedAt || (a.id < b.id ? -1 : 1));
  const myOffers = liveOffers(state, pub.offers.get(viewer));
  const myCo = coalitionOf(state, viewer);
  const relations = relationRows(state, viewer, myOffers, myCo);
  const offers = myOffers.map((o) => plainClone(o));
  const coalitions: CountryView['coalitions'] = [];
  for (const id in state.coalitions) coalitions.push(coalitionEntry(state.coalitions[id], viewer, pub.scores));
  const messages: Record<string, Message[]> = {};
  for (const th of threadIndex(state).get(viewer) ?? []) messages[th] = state.messages[th].map(messageCopy);
  if (myCo && state.messages[`co:${myCo.id}`]) messages[`co:${myCo.id}`] = state.messages[`co:${myCo.id}`].map(messageCopy);
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
    time: gameTimeText(t, state.meta.startDate),
    finished: !!state.score.result,
    result: state.score.result ? jsonCopy(state.score.result) : null,
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
      techs: sortedTechs(cs),
      research: cs.research.map((r) => ({ ...r, cost: { ...r.cost } })),
      researchSlots: researchSlots(state, viewer),
      unitLevels: { ...cs.unitLevels },
      missiles: jsonCopy(cs.missiles),
      jobs: plainClone(cs.jobs),
      lift: lite ? 0 : liftBreakdown(state, viewer).total,
      liftBreakdown: lite ? { ...EMPTY_LIFT } : liftBreakdown(state, viewer),
      maintenanceSlots: cs.maintenanceSlots,
      personality: { ...cs.personality },
      modifiers: { ...cs.modifiers },
      force: lite ? { ...EMPTY_FORCE, byDomain: {} } : forceSummary(state, viewer),
    },
    stacks,
    cities,
    provinces,
    owners: pub.owners,
    rebelNodes: pub.rebel,
    publicCities: pub.cities,
    contacts,
    observedNodes: lite ? [] : [...observedNodes(state, viewer)],
    reports,
    agents: Object.values(state.agents).filter((a) => a.country === viewer).map((a) => ({ ...a })),
    relations,
    offers,
    coalitions,
    myCoalition: myCo?.id ?? null,
    wars: publicWars(state),
    messages,
    market: {
      books: pub.books,
      myOrders: ordersOf(state, viewer).map((o) => ({ ...o })),
      myFills: lite ? [] : state.market.fills.filter((f) => f.buyer === viewer || f.seller === viewer).map((f) => ({ ...f })),
    },
    launches,
    scores: { denominator: state.score.denominator, byCountry: pub.scores, soloThreshold: thresholdFor(state.score.denominator, 1), coalitionThresholds: { 2: thresholdFor(state.score.denominator, 2), 3: thresholdFor(state.score.denominator, 3), 4: thresholdFor(state.score.denominator, 4), 5: thresholdFor(state.score.denominator, 5) }, lastSettledDay: state.score.lastSettledDay },
    journal: journalFor(state, viewer, opts.journalLimit ?? 40, opts.journalScan ?? 4000),
    openingPower: state.openingPower,
    rules: RULES,
    ...(lite ? { lite: true as const } : {}),
  };
}

let timeMemo = { t: -1, start: '', text: '' };
/** `formatGameTime` memoized for the last (tick, start date) — every view of a step shares it. */
function gameTimeText(t: number, start: string | undefined): string {
  const st = start ?? '';
  if (timeMemo.t !== t || timeMemo.start !== st) timeMemo = { t, start: st, text: formatGameTime(t, start) };
  return timeMemo.text;
}

type CoalitionEntry = CountryView['coalitions'][number];
interface CoalitionMemo {
  members: object;
  nMembers: number;
  departures: object;
  nDepartures: number;
  leader: CountryId;
  dissolvedAt: number | null;
  name: string;
  description: string;
  emblem: string;
  createdAt: number;
  scores: object;
  entry: CoalitionEntry;
}
const coalitionMemos = new WeakMap<Coalition, CoalitionMemo>();
/**
 * Public part of one coalition (frozen, shared by every view) — rebuilt when any field it copies
 * changes (members, departures: compared by array identity and length — they are only appended to
 * or replaced; leader, dissolution, texts, the frozen score table). Only the leader additionally
 * sees the applications (a fresh copy per view).
 */
function coalitionEntry(co: Coalition, viewer: CountryId, scores: Record<CountryId, number>): CoalitionEntry {
  let e = coalitionMemos.get(co);
  if (!e || e.members !== co.members || e.nMembers !== co.members.length || e.departures !== co.departures || e.nDepartures !== co.departures.length || e.leader !== co.leader || e.dissolvedAt !== co.dissolvedAt || e.name !== co.name || e.description !== co.description || e.emblem !== co.emblem || e.createdAt !== co.createdAt || e.scores !== scores) {
    const entry: CoalitionEntry = {
      id: co.id,
      name: co.name,
      description: co.description,
      emblem: co.emblem,
      leader: co.leader,
      createdAt: co.createdAt,
      dissolvedAt: co.dissolvedAt,
      members: Object.freeze(co.members.map((m) => m.country)) as CountryId[],
      joinedAt: Object.freeze(Object.fromEntries(co.members.map((m) => [m.country, m.joinedAt]))),
      departures: Object.freeze(co.departures.map((d) => Object.freeze({ ...d }))) as Coalition['departures'],
      applications: undefined,
      score: co.members.reduce((a, m) => a + (scores[m.country] ?? 0), 0),
    };
    e = { members: co.members, nMembers: co.members.length, departures: co.departures, nDepartures: co.departures.length, leader: co.leader, dissolvedAt: co.dissolvedAt, name: co.name, description: co.description, emblem: co.emblem, createdAt: co.createdAt, scores, entry: Object.freeze(entry) };
    coalitionMemos.set(co, e);
  }
  if (co.leader !== viewer) return e.entry;
  return { ...e.entry, applications: co.applications.map((a) => ({ ...a })) };
}

/**
 * Deep copy with exactly `JSON.parse(JSON.stringify(v))` semantics for plain data: object members
 * that are undefined/functions are dropped, such array items become null, non-finite numbers
 * become null and -0 becomes 0.
 */
function jsonCopy<T>(v: T): T {
  return jsonVal(v) as T;
}
function jsonVal(v: unknown): unknown {
  if (v === null) return null;
  const t = typeof v;
  if (t === 'number') return Number.isFinite(v as number) ? ((v as number) === 0 ? 0 : v) : null;
  if (t !== 'object') return t === 'string' || t === 'boolean' ? v : undefined;
  if (Array.isArray(v)) {
    const out = new Array(v.length);
    for (let i = 0; i < v.length; i++) {
      const x = jsonVal(v[i]);
      out[i] = x === undefined ? null : x;
    }
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const k in v as Record<string, unknown>) {
    if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
    const x = jsonVal((v as Record<string, unknown>)[k]);
    if (x !== undefined) out[k] = x;
  }
  return out;
}

const alliedUnitsMemo = new WeakMap<Stack, { arr: Stack['units']; v: { type: string; hpPct: number }[] }>();
/**
 * Live member list of an allied stack as projected into views (type + rounded HP). Frozen and
 * shared by every view while the roster array and each member's type and rounded HP are unchanged
 * (re-checked on every call, so in-place HP changes are seen).
 */
function alliedUnits(s: Stack): { type: string; hpPct: number }[] {
  const us = s.units;
  const e = alliedUnitsMemo.get(s);
  if (e && e.arr === us && e.v.length === us.length) {
    let ok = true;
    for (let i = 0; i < us.length; i++) {
      const u = us[i];
      const x = e.v[i];
      if (x.type !== u.type || x.hpPct !== Math.round((u.hp / u.maxHp) * 100)) {
        ok = false;
        break;
      }
    }
    if (ok) return e.v;
  }
  const v = Object.freeze(us.map((u) => Object.freeze({ type: u.type, hpPct: Math.round((u.hp / u.maxHp) * 100) }))) as { type: string; hpPct: number }[];
  alliedUnitsMemo.set(s, { arr: us, v });
  return v;
}

const messageCopies = new WeakMap<Message, Message>();
/**
 * Messages are immutable once posted (`postMessage` only appends/trims threads), so every view
 * shares one frozen copy per message instead of copying whole threads (up to 200 each) per view.
 */
function messageCopy(m: Message): Message {
  let c = messageCopies.get(m);
  if (!c) {
    c = Object.freeze({ ...m });
    messageCopies.set(m, c);
  }
  return c;
}

const warsCache = new WeakMap<GameState, { v: number; rel: object; list: [CountryId, CountryId][] }>();
/** Public war list (frozen, shared), keyed by the relations counter `relv`. */
function publicWars(state: GameState): [CountryId, CountryId][] {
  const v = state.ids.relv ?? 0;
  const c = warsCache.get(state);
  if (c && c.v === v && c.rel === state.relations) return c.list;
  const list: [CountryId, CountryId][] = [];
  for (const k of Object.keys(state.relations).sort()) {
    if (!state.relations[k].war) continue;
    const [a, b] = k.split('|');
    list.push(Object.freeze([a, b]) as [CountryId, CountryId]);
  }
  Object.freeze(list);
  warsCache.set(state, { v, rel: state.relations, list });
  return list;
}

const techCache = new WeakMap<object, { n: number; list: string[] }>();
/** Sorted tech ids (techs are only ever added; memo keyed by the record and its key count). */
function sortedTechs(cs: GameState['countries'][string]): string[] {
  let n = 0;
  for (const _ in cs.techs) n++;
  let e = techCache.get(cs.techs);
  if (!e || e.n !== n) {
    e = { n, list: Object.keys(cs.techs).sort() };
    techCache.set(cs.techs, e);
  }
  return e.list.slice();
}

const countryListCache = new WeakMap<object, { order: readonly CountryId[]; list: GameState['countries'][string][] }>();
/** Country records aligned with `countryOrder` (records are stable objects; keyed by both containers). */
function countryList(state: GameState): GameState['countries'][string][] {
  const e = countryListCache.get(state.countries);
  if (e && e.order === state.countryOrder) return e.list;
  const list = state.countryOrder.map((c) => state.countries[c]);
  countryListCache.set(state.countries, { order: state.countryOrder, list });
  return list;
}

/**
 * Diplomacy rows of `viewer` toward every other seat, from the shared version-keyed indexes
 * (war sets by `relv`, grant maps by `grv`, coalition membership by `cov`); trust is read live.
 *
 * Rows are reused between calls (frozen, shared by consecutive views of the same viewer): the
 * per-viewer memo is valid while the war and coalition indexes, the viewer's coalition and the
 * seat order are the same objects and no grant from or to the viewer changed (`grantTouch`); each row is then re-checked against the live inputs that no
 * counter covers (trust value, trust entry identity + history length + newest history item —
 * direct `state.trust` edits included — pending offers, name/controller/alive) and rebuilt alone
 * if any differs. Results equal a fresh build field for field.
 */
interface RelMemo {
  em: object;
  /** grant lineage + touch version of the viewer (no grant to/from it changed while equal) */
  gl: object;
  gt: number;
  ci: object;
  co: Coalition | null;
  order: readonly CountryId[];
  rows: DiplomacyRow[];
  /** per seat index: trust entry, its history length and newest history item at build time */
  entries: (TrustState | undefined)[];
  hlen: number[];
  hlast: unknown[];
}
const relMemos = new WeakMap<GameState, Map<CountryId, RelMemo>>();
const NO_IDS: string[] = Object.freeze([]) as unknown as string[];
function samePending(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function relationRows(state: GameState, viewer: CountryId, myOffers: Offer[], myCo: Coalition | null): DiplomacyRow[] {
  const em = enemyMap(state);
  const enemies = em.get(viewer);
  const grants = grantMap(state);
  const mineOut = grants.get(viewer);
  const pending = new Map<CountryId, string[]>();
  for (const o of myOffers) {
    if (o.status !== 'pending') continue;
    const other = o.from === viewer ? o.to : o.from;
    (pending.get(other) ?? pending.set(other, []).get(other)!).push(o.id);
  }
  const coMembers = myCo ? new Set(myCo.members.map((m) => m.country)) : null;
  const entries: (TrustState | undefined)[] = [];
  const trust = trustRow(state, viewer, entries);
  const order = state.countryOrder;
  const others = countryList(state);
  const coIdx = coalitionIndex(state);
  let memos = relMemos.get(state);
  if (!memos) {
    memos = new Map();
    relMemos.set(state, memos);
  }
  const memo = memos.get(viewer);
  const gtv = grantTouch(state, viewer);
  const reuse = !!memo && memo.em === em && memo.gl === gtv.lineage && memo.gt === gtv.touch && memo.ci === coIdx && memo.co === myCo && memo.order === order;
  let rows: DiplomacyRow[] | null = reuse ? memo!.rows : null;
  const hlen: number[] = reuse ? memo!.hlen : [];
  const hlast: unknown[] = reuse ? memo!.hlast : [];
  let changed = !reuse;
  let k = 0;
  for (let i = 0; i < order.length; i++) {
    const c = order[i];
    if (c === viewer) continue;
    const other = others[i];
    const en = entries[i];
    const pend = pending.get(c) ?? NO_IDS;
    if (reuse) {
      const r = memo!.rows[k];
      if (r.trust === trust[i] && memo!.entries[i] === en && (!en || (en.history.length === hlen[i] && en.history[en.history.length - 1] === hlast[i])) && r.name === other.name && r.controller === other.controller && r.alive === other.alive && samePending(r.pendingOffers, pend)) {
        k++;
        continue;
      }
      if (!changed) {
        rows = memo!.rows.slice();
        changed = true;
      }
    }
    const war = !!enemies && enemies.has(c);
    let theirs: DiploStatus = 'peace';
    if (war) theirs = 'war';
    else {
      const g = grants.get(c);
      if (g !== undefined) theirs = g.get(viewer) ?? 'peace';
    }
    const row: DiplomacyRow = {
      country: c,
      name: other.name,
      controller: other.controller,
      alive: other.alive,
      myStatusToThem: war ? 'war' : mineOut?.get(c) ?? 'peace',
      theirStatusToMe: theirs,
      war,
      trust: trust[i],
      coalition: coIdx.get(c) ?? null,
      sameCoalition: !!coMembers && coMembers.has(c),
      pendingOffers: pend === NO_IDS ? NO_IDS : (Object.freeze(pend) as string[]),
    };
    if (en) row.trustHistory = Object.freeze(en.history.map((h) => Object.freeze({ at: h.at, kind: h.kind, delta: h.delta }))) as DiplomacyRow['trustHistory'];
    hlen[i] = en ? en.history.length : 0;
    hlast[i] = en ? en.history[en.history.length - 1] : undefined;
    if (!rows) rows = [];
    rows[k++] = Object.freeze(row);
  }
  if (!rows) rows = []; // (a world with no other seat)
  if (changed) {
    Object.freeze(rows);
    memos.set(viewer, { em, gl: gtv.lineage, gt: gtv.touch, ci: coIdx, co: myCo, order, rows: rows!, entries, hlen, hlast });
  } else memo!.entries = entries;
  return rows!;
}

function cloneBuildings(l: CityState['buildings']): CityState['buildings'] {
  const out = new Array(l.length);
  for (let i = 0; i < l.length; i++) out[i] = { ...l[i] };
  return out;
}
/** Province copy (all members are primitives except `buildings`). */
function cloneProvince(p: ProvinceState): ProvinceState {
  return { ...p, buildings: cloneBuildings(p.buildings) };
}
/** City copy (nested: functions, morale factors, buildings, base output). */
function cloneCity(c: CityState): CityState {
  return { ...c, functions: [...c.functions], moraleFactors: c.moraleFactors.map((f) => ({ ...f })), buildings: cloneBuildings(c.buildings), baseOutput: { ...c.baseOutput } };
}

/** Deep copy of plain JSON data with JSON round-trip semantics (undefined members dropped). */
function plainClone<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    const out = new Array(v.length);
    for (let i = 0; i < v.length; i++) {
      const x = v[i];
      out[i] = x === undefined ? null : plainClone(x);
    }
    return out as T;
  }
  const out: Record<string, unknown> = {};
  for (const k in v as Record<string, unknown>) {
    const x = (v as Record<string, unknown>)[k];
    if (x !== undefined) out[k] = plainClone(x);
  }
  return out as T;
}

const threadCache = new WeakMap<GameState, { v: number; obj: object; m: Map<CountryId, string[]> }>();
/**
 * dm threads per participant. A thread is only ever created by `postMessage`, which also draws a
 * message id, so the index is keyed by the message counter (+ the messages object identity).
 */
function threadIndex(state: GameState): Map<CountryId, string[]> {
  const v = state.ids.message ?? 0;
  const c = threadCache.get(state);
  if (c && c.v === v && c.obj === state.messages) return c.m;
  const m = new Map<CountryId, string[]>();
  for (const th of Object.keys(state.messages).sort()) {
    if (!th.startsWith('dm:')) continue;
    for (const p of th.slice(3).split('|')) (m.get(p) ?? m.set(p, []).get(p)!).push(th);
  }
  threadCache.set(state, { v, obj: state.messages, m });
  return m;
}
/** Structural copy of a stack (cheaper than JSON round-trip; stacks are plain data). */
function cloneStack(s: Stack): Stack {
  return {
    ...s,
    units: s.units.map((u) => ({ ...u })),
    pos: s.pos.kind === 'air' ? { ...s.pos, from: [s.pos.from[0], s.pos.from[1]], to: [s.pos.to[0], s.pos.to[1]] } : { ...s.pos },
    order: s.order ? (s.order.kind === 'move' ? { ...s.order, route: s.order.route.map((r) => ({ ...r })), waypoints: [...s.order.waypoints], warConfirmed: [...s.order.warConfirmed], attack: s.order.attack ? { ...s.order.attack } : undefined, ...(s.order.airmobile ? { airmobile: { ...s.order.airmobile } } : {}) } : { ...s.order, warConfirmed: [...s.order.warConfirmed] }) : null,
    air: s.air ? jsonCopy(s.air) : null,
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
export function getCountryViews(state: GameState, ids: readonly CountryId[], opts: ViewOptions = {}): Map<CountryId, CountryView> {
  const out = new Map<CountryId, CountryView>();
  for (const id of ids) out.set(id, getCountryView(state, id, opts));
  return out;
}
