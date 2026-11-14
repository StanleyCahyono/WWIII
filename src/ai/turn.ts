/**
 * One controller invocation ("turn"): the filtered view, the planner context, persisted memory,
 * cached static analysis, a LOCAL copy of the spendable budget (so a batch of commands never
 * over-commits under the shared validator) and the bounded output list.
 */
import type { CityKey, CountryId, NodeId, Resource } from '../engine/data-types';
import { RESOURCES } from '../engine/data-types';
import type { Command } from '../engine/commands/types';
import type { CountryView, DiplomacyRow } from '../engine/view/country-view';
import type { PlannerContext } from '../engine/ai-host/types';
import type { ResourceSummary } from '../engine/systems/economy';
import { geoOf, type Geo } from './geo';
import { catIndex, type CatIndex } from './value';
import { DIFFICULTY, type AiMemory, type DifficultyProfile, type Layer } from './types';
import { logDecision } from './log';

type ResM = Record<Resource, number>;

export class Turn {
  readonly me: CountryId;
  readonly geo: Geo;
  readonly ix: CatIndex;
  readonly diff: DifficultyProfile;
  readonly out: Command[] = [];
  /** Local spendable budget (milli), decremented by every accepted command's cost. */
  readonly budget: ResM;
  /** Reserve (milli) kept back for upkeep; only market escrow may dip into it. */
  readonly reserve: ResM;
  readonly res: Record<Resource, ResourceSummary>;
  readonly rel: Map<CountryId, DiplomacyRow>;
  pathLeft: number;
  previewsRejected = 0;
  /** Cities that already got a job this turn (per slot). */
  readonly busyCity = new Set<string>();
  readonly movedStacks = new Set<string>();
  marketOpen: number;
  researchFree: number;
  readonly pendingWith = new Map<CountryId, number>();
  readonly personality: { aggression: number; caution: number; trade: number; loyalty: number; expansion: number; research: number };

  constructor(readonly view: CountryView, readonly ctx: PlannerContext, readonly mem: AiMemory) {
    this.me = view.viewer;
    this.geo = geoOf(ctx.map);
    this.ix = catIndex(ctx.catalog);
    this.diff = DIFFICULTY[ctx.difficulty] ?? DIFFICULTY.normal;
    this.pathLeft = this.diff.pathBudget;
    this.budget = { ...view.self.stock };
    this.res = {} as Record<Resource, ResourceSummary>;
    for (const r of view.self.resources) this.res[r.resource] = r;
    this.reserve = {} as ResM;
    const p = view.self.personality ?? {};
    const j = mem.jitter;
    const clamp = (x: number) => Math.max(0, Math.min(1, x));
    this.personality = {
      aggression: clamp((p.aggression ?? 0.5) + j * 0.1),
      caution: clamp((p.caution ?? 0.5) - j * 0.05),
      trade: clamp((p.trade ?? 0.5) + j * 0.05),
      loyalty: clamp(p.loyalty ?? 0.5),
      expansion: clamp((p.expansion ?? 0.5) + j * 0.1),
      research: clamp(p.research ?? 0.5),
    };
    const days = 1.5 + this.personality.caution * 2;
    for (const r of RESOURCES) {
      const cons = this.res[r]?.consumptionPerDay ?? 0;
      this.reserve[r] = Math.round(cons * days);
    }
    this.rel = new Map(view.relations.map((r) => [r.country, r]));
    this.marketOpen = view.market.myOrders.filter((o) => o.status === 'open').length;
    this.researchFree = Math.max(0, view.self.researchSlots - view.self.research.length);
    for (const r of view.relations) if (r.pendingOffers.length) this.pendingWith.set(r.country, r.pendingOffers.length);
  }

  get full(): boolean {
    return this.out.length >= this.ctx.budget;
  }
  get now(): number {
    return this.view.tick;
  }

  /** Can we pay `cost` (milli) while keeping the upkeep reserve? */
  affordable(cost: Partial<ResM>, useReserve = false): boolean {
    for (const r of RESOURCES) {
      const c = cost[r] ?? 0;
      if (c <= 0) continue;
      const floor = useReserve ? 0 : this.reserve[r];
      if (this.budget[r] - c < floor) return false;
    }
    return true;
  }

  /**
   * Preview a command with the shared validator; on success check its cost against the local
   * budget, deduct it, record it and log the decision. Returns the preview (or null).
   */
  add(cmd: Command, layer: Layer, kind: string, reason: string, opts: { useReserve?: boolean; path?: boolean } = {}): { ok: true; preview: any } | null {
    if (this.full) return null;
    if (opts.path) {
      if (this.pathLeft <= 0) return null;
      this.pathLeft--;
    }
    const c = { ...cmd, reason: cmd.reason ?? reason } as Command;
    const v = this.ctx.preview(c);
    if (!v.ok) {
      this.previewsRejected++;
      return null;
    }
    const cost = costOf(c, v.preview);
    if (cost && !this.affordable(cost, opts.useReserve)) return null;
    if (cost) for (const r of RESOURCES) this.budget[r] -= cost[r] ?? 0;
    this.out.push(c);
    this.mem.counters[c.type] = (this.mem.counters[c.type] ?? 0) + 1;
    logDecision(this.me, { tick: this.now, layer, kind, detail: describe(c), reason, command: c.type });
    return { ok: true, preview: v.preview };
  }

  note(layer: Layer, kind: string, detail: string, reason: string): void {
    logDecision(this.me, { tick: this.now, layer, kind, detail, reason });
  }

  relation(c: CountryId): DiplomacyRow | undefined {
    return this.rel.get(c);
  }
  atWarWith(): CountryId[] {
    return this.view.relations.filter((r) => r.war && r.alive).map((r) => r.country);
  }
  cityByKey(k: CityKey) {
    return this.view.cities.find((c) => c.key === k);
  }
  isOwn(n: NodeId): boolean {
    return this.view.owners[n] === this.me;
  }
}

function costOf(c: Command, p: any): Partial<ResM> | null {
  switch (c.type) {
    case 'build':
    case 'mobilize':
      return p?.total ?? null;
    case 'startResearch':
    case 'produceMissile':
    case 'annex':
    case 'assignAgent':
    case 'buyIntelReport':
      return p?.cost ?? null;
    case 'marketOrder':
      return p?.escrow ?? null;
    case 'proposeOffer': {
      const v: Partial<ResM> = {};
      for (const t of c.give) if (t.kind === 'resource') v[t.resource] = (v[t.resource] ?? 0) + t.amount;
      return v;
    }
    default:
      return null;
  }
}

function describe(c: Command): string {
  switch (c.type) {
    case 'move':
      return `move ${c.stack} → node ${c.dest}`;
    case 'attack':
      return `attack ${c.stack} → ${c.targetNode ?? c.targetContact}`;
    case 'build':
      return `build ${c.building} @ ${c.targets.join(',')}`;
    case 'mobilize':
      return `mobilize ${c.unit} @ ${c.cities.join(',')}`;
    case 'startResearch':
      return `research ${c.tech}`;
    case 'marketOrder':
      return `${c.side} ${c.qty} ${c.resource} @ ${c.price}`;
    case 'proposeOffer':
      return `offer → ${c.to}: give ${JSON.stringify(c.give)} receive ${JSON.stringify(c.receive)}`;
    case 'respondOffer':
      return `${c.accept ? 'accept' : 'decline'} ${c.offer}`;
    case 'declareWar':
      return `declare war on ${c.target}`;
    default:
      return c.type;
  }
}
