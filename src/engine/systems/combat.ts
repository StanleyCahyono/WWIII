/**
 * Combat — documented solo algorithm (resolved on every whole game hour; identical at any speed).
 *
 * 1. NODE COMBAT: stacks of countries at war sharing a node fight one round per hour.
 *    - A stack fires if its fire policy is `engage`, or it has an attack order, or (`return_fire`)
 *      a hostile stack at the node is firing. `hold` stacks only fire when ordered.
 *    - Table choice: the stack that was stationary at the node first (earliest stationarySince)
 *      is the DEFENDER and fires with its DEFENSE table; later arrivals fire with ATTACK tables.
 *    - Unit strength vs class c = table[c] × hp/maxHp × readiness factor × terrain modifier ×
 *      officer bonus × refit × stack efficiency × (defender: entrenchment, bunker defenseMult)
 *      × seeded variance (1 ± VARIANCE, stream "combat:<engagement>:<round>:<stack>").
 *    - A firing stack splits its fire over hostile stacks by unit count, and within a target over
 *      target classes by unit count. Damage = Σ strength × ROUND_DAMAGE_FACTOR (HP units).
 *    - All damage is computed first, then applied (simultaneous).
 *    - ALLOCATION (per target class pool): front echelon (1) first, then 2, then 3. Within an
 *      echelon the pool is split evenly (integer hundredths, remainder to lowest unit id); a
 *      destroyed unit's overflow passes on within the echelon, then to the next echelon. Damage
 *      vs a class with no surviving units is lost.
 * 2. RANGED: stationary stacks with ranged units (rangeKm > 0) not in node combat fire at the
 *    attack-order target or the nearest observed hostile stack within range (or bombard a
 *    hostile city's condition when ordered at an empty node).
 * 3. AIR: aircraft on station attack observed hostile stacks inside their patrol radius
 *    (air targets first if able); targets return fire with their DEFENSE table; air-defence
 *    stacks with `engage` also fire at hostile aircraft on station within their range.
 * Rounds are keyed by tick — the same round can never apply twice. A stack takes part in at most
 * one of node/ranged/air per round.
 */
import { TARGET_CLASSES, type CountryId, type NodeId, type TargetClass } from '../data-types';
import type { Engagement, GameState, Stack, Unit } from '../state';
import {
  COMBAT_READINESS_LOSS,
  ENTRENCH_AFTER_MIN,
  ENTRENCH_DEFENSE_MULT,
  OVERSTACK_LIMIT,
  OVERSTACK_MIN_EFFICIENCY,
  OVERSTACK_PENALTY_PER_UNIT,
  READINESS_STRENGTH_FLOOR,
  REFIT_STRENGTH_MULT,
  ROUND_DAMAGE_FACTOR,
  TERRAIN_DEFENSE,
  VARIANCE,
} from '../rules';
import { S } from '../scenario/registry';
import { streamRng } from '../rng';
import { nextId } from '../ids';
import { cmpId, stackLL, ustats, utype, hostileStacks as hostileStacksW, sortedStacks, enemyMap } from './world';
import { distKm } from './mapindex';
import { awardXp, emit, toAll } from './events';
import { sumEffect, bumpEconomy } from './economy';
import { derived } from '../derived';

export function stackEfficiency(n: number): number {
  if (n <= OVERSTACK_LIMIT) return 1;
  return Math.max(OVERSTACK_MIN_EFFICIENCY, 1 - OVERSTACK_PENALTY_PER_UNIT * (n - OVERSTACK_LIMIT));
}
export function combatUnits(s: Stack): Unit[] {
  return s.units.filter((u) => u.hp > 0);
}

function officerMult(state: GameState, s: Stack, u: Unit, key: 'attackMult' | 'defenseMult'): number {
  const fam = utype(state, u.type).family;
  const best = new Map<string, number>();
  for (const o of s.units) {
    const t = utype(state, o.type);
    const b = t.officerBonus;
    if (!b || !b.appliesTo.includes(fam) || o.hp <= 0) continue;
    const v = b[key] ?? 1;
    best.set(t.id, Math.max(best.get(t.id) ?? 1, v));
  }
  let m = 1;
  for (const v of best.values()) m *= v;
  return m;
}

export interface FireContext {
  table: 'attack' | 'defense';
  node: NodeId | null;
  entrenched: boolean;
  defenseMult: number;
}

/** Strength of one unit against target class c (HP units per round before ROUND_DAMAGE_FACTOR). */
export function unitStrength(state: GameState, s: Stack, u: Unit, c: TargetClass, fc: FireContext, eff: number): number {
  const t = utype(state, u.type);
  const st = ustats(state, u);
  const base = (fc.table === 'attack' ? st.attack[c] : st.defense[c]) ?? 0;
  if (base <= 0) return 0;
  let m = (u.hp / u.maxHp) * (READINESS_STRENGTH_FLOOR + ((1 - READINESS_STRENGTH_FLOOR) * u.readiness) / 100) * eff;
  if (fc.node !== null) {
    const terr = S(state).map.terrain[fc.node];
    if (fc.table === 'defense') m *= t.terrain[terr]?.defense ?? TERRAIN_DEFENSE[terr];
    else m *= t.terrain[terr]?.attack ?? 1;
  }
  m *= officerMult(state, s, u, fc.table === 'attack' ? 'attackMult' : 'defenseMult');
  if (s.refit) m *= REFIT_STRENGTH_MULT;
  if (fc.table === 'defense') {
    if (fc.entrenched) m *= ENTRENCH_DEFENSE_MULT;
    m *= fc.defenseMult;
  }
  return base * m;
}

/** Damage pools (hundredths of HP) by target class from firing stack A onto target stack D. */
export function damageAgainst(state: GameState, A: Stack, D: Stack, fc: FireContext, share: number, variance: number, rangeKm?: number): Partial<Record<TargetClass, number>> {
  const att = combatUnits(A).filter((u) => rangeKm === undefined || ustats(state, u).rangeKm >= rangeKm);
  const tgt = combatUnits(D);
  if (!att.length || !tgt.length) return {};
  const eff = stackEfficiency(combatUnits(A).length);
  const counts = new Map<TargetClass, number>();
  for (const u of tgt) {
    const c = utype(state, u.type).targetClass;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const out: Partial<Record<TargetClass, number>> = {};
  for (const c of TARGET_CLASSES) {
    const n = counts.get(c);
    if (!n) continue;
    let sum = 0;
    for (const u of att) sum += unitStrength(state, A, u, c, fc, eff);
    const dmg = Math.round(sum * share * (n / tgt.length) * ROUND_DAMAGE_FACTOR * variance * 100);
    if (dmg > 0) out[c] = dmg;
  }
  return out;
}

/** Explicit echelon allocation (tested). Mutates unit hp. Returns damage actually applied. */
export function allocateDamage(state: GameState, units: Unit[], pools: Partial<Record<TargetClass, number>>): number {
  let applied = 0;
  for (const c of TARGET_CLASSES) {
    let pool = pools[c] ?? 0;
    if (pool <= 0) continue;
    const cand = units.filter((u) => u.hp > 0 && utype(state, u.type).targetClass === c).sort(cmpId);
    for (const ech of [1, 2, 3]) {
      if (pool <= 0) break;
      const group = cand.filter((u) => utype(state, u.type).echelon === ech);
      let guard = 0;
      while (pool > 0 && guard++ < 1000) {
        const alive = group.filter((u) => u.hp > 0);
        if (!alive.length) break;
        const per = Math.floor(pool / alive.length);
        const rem = pool - per * alive.length;
        let overflow = 0;
        alive.forEach((u, i) => {
          const d = per + (i < rem ? 1 : 0);
          const take = Math.min(d, u.hp);
          u.hp -= take;
          applied += take;
          overflow += d - take;
        });
        pool = overflow;
      }
    }
  }
  return applied;
}

function variance(state: GameState, eng: string, round: number, stack: string): number {
  const r = streamRng(state.seed, 'combat', `${eng}:${round}:${stack}`);
  return 1 + VARIANCE * (2 * r.next() - 1);
}

function openEngagementAt(state: GameState, node: NodeId, kind: Engagement['kind']): Engagement | null {
  for (const id of Object.keys(state.engagements)) {
    const e = state.engagements[id];
    if (e.open && e.node === node && e.kind === kind) return e;
  }
  return null;
}

function engagementFor(state: GameState, node: NodeId, kind: Engagement['kind']): Engagement {
  let e = openEngagementAt(state, node, kind);
  if (!e) {
    e = { id: nextId(state, 'engagement'), node, kind, startedAt: state.clock.tick, lastRoundAt: -1, rounds: 0, participants: {}, losses: {}, damage: {}, tables: {}, open: true, closedAt: null, outcome: null };
    state.engagements[e.id] = e;
  }
  return e;
}
function addParticipant(e: Engagement, s: Stack) {
  const l = (e.participants[s.owner] ??= []);
  if (!l.includes(s.id)) l.push(s.id);
  e.losses[s.owner] ??= 0;
  e.damage[s.owner] ??= 0;
}

export interface CombatHooks {
  onStackDestroyed: (state: GameState, s: Stack, by: CountryId | null) => void;
  canSee: (state: GameState, viewer: CountryId, stackId: string) => boolean;
}

type Pending = Map<string, { pools: Partial<Record<TargetClass, number>>; from: CountryId; eng: Engagement }[]>;

function addPending(p: Pending, target: string, pools: Partial<Record<TargetClass, number>>, from: CountryId, eng: Engagement) {
  const l = p.get(target) ?? [];
  l.push({ pools, from, eng });
  p.set(target, l);
}

function defenderCtx(state: GameState, s: Stack, node: NodeId, isDefender: boolean): FireContext {
  const m = S(state).map;
  const land = m.isLand[node] === 1;
  const entrenched = isDefender && land && state.clock.tick - s.stationarySince >= ENTRENCH_AFTER_MIN;
  let dm = 1;
  if (isDefender && land) {
    const p = state.provinces[node];
    if (p && p.owner === s.owner) {
      dm += sumEffect(state, p.buildings, 'defenseMult');
      const ck = m.cityByNode.get(node);
      if (ck && state.cities[ck]) dm += sumEffect(state, state.cities[ck].buildings, 'defenseMult');
    }
  }
  return { table: isDefender ? 'defense' : 'attack', node, entrenched, defenseMult: dm };
}

export { enemyMap };

/** Resolve one combat round (call on whole hours). */
export function combatRound(state: GameState, hooks: CombatHooks): void {
  const tick = state.clock.tick;
  const enemies = enemyMap(state);
  if (!enemies.size) {
    closeEngagements(state);
    return;
  }
  const hostileStacks = (a: Stack, b: Stack) => a.owner !== b.owner && !!enemies.get(a.owner)?.has(b.owner);
  const atWar = (a: CountryId, b: CountryId) => !!enemies.get(a)?.has(b);
  const fired = new Set<string>();
  const pending: Pending = new Map();
  const m = S(state).map;
  const all = sortedStacks(state);

  // ── 1. node combat
  const byNode = new Map<NodeId, Stack[]>();
  for (const s of all) {
    if (s.pos.kind !== 'node' || s.aboard || s.moveClass === 'air') continue;
    const l = byNode.get(s.pos.node) ?? [];
    l.push(s);
    byNode.set(s.pos.node, l);
  }
  const nodes = [...byNode.keys()].sort((a, b) => a - b);
  for (const node of nodes) {
    const here = byNode.get(node) as Stack[];
    if (here.length < 2) continue;
    const owners = [...new Set(here.map((s) => s.owner))];
    let hostile = false;
    for (let i = 0; i < owners.length && !hostile; i++) for (let j = i + 1; j < owners.length; j++) if (atWar(owners[i], owners[j])) { hostile = true; break; }
    if (!hostile) continue;
    const eng = engagementFor(state, node, 'node');
    if (eng.lastRoundAt >= tick) continue; // never apply the same round twice
    eng.lastRoundAt = tick;
    eng.rounds++;
    const round = eng.rounds;
    const ordered = (s: Stack) => !!s.order && s.order.kind === 'move' && !!s.order.attack;
    const engagers = new Set(here.filter((s) => s.firePolicy === 'engage' || ordered(s) || s.order?.kind === 'attack').map((s) => s.id));
    for (const A of here) {
      const targets = here.filter((D) => hostileStacks(A, D));
      if (!targets.length) continue;
      addParticipant(eng, A);
      const fires = engagers.has(A.id) || (A.firePolicy === 'return_fire' && targets.some((D) => engagers.has(D.id)));
      if (!fires) continue;
      fired.add(A.id);
      const earliestHostile = Math.min(...targets.map((t) => t.stationarySince));
      const isDef = A.stationarySince <= earliestHostile && m.isLand[node] === 1;
      const fc = defenderCtx(state, A, node, isDef);
      eng.tables[A.owner] = fc.table;
      const total = targets.reduce((a, t) => a + combatUnits(t).length, 0) || 1;
      const v = variance(state, eng.id, round, A.id);
      for (const D of targets) {
        const pools = damageAgainst(state, A, D, fc, combatUnits(D).length / total, v);
        addPending(pending, D.id, pools, A.owner, eng);
      }
    }
  }

  // ── 2. ranged fire
  for (const A of all) {
    if (!enemies.has(A.owner)) continue;
    if (fired.has(A.id) || A.pos.kind !== 'node' || A.aboard || A.moveClass === 'air') continue;
    if (A.order && A.order.kind === 'move' && A.order.route.length) continue;
    const maxR = Math.max(0, ...combatUnits(A).map((u) => ustats(state, u).rangeKm));
    if (maxR <= 0) continue;
    const ordered = A.order?.kind === 'attack' ? A.order : null;
    if (A.firePolicy !== 'engage' && !ordered) continue;
    const ll = stackLL(state, A);
    let target: Stack | null = null;
    let dist = Infinity;
    if (ordered?.targetStack) {
      const t = state.stacks[ordered.targetStack];
      if (t && hostileStacks(A, t) && t.moveClass !== 'air' && !t.aboard) {
        const d = distKm(ll[0], ll[1], ...stackLL(state, t));
        if (d <= maxR && d > 0) { target = t; dist = d; }
      }
    }
    if (!target) {
      for (const D of all) {
        if (D.owner === A.owner || D.moveClass === 'air' || D.aboard || !hostileStacks(A, D)) continue;
        if (D.pos.kind === 'node' && A.pos.kind === 'node' && D.pos.node === A.pos.node) continue;
        if (!hooks.canSee(state, A.owner, D.id)) continue;
        const d = distKm(ll[0], ll[1], ...stackLL(state, D));
        if (d <= maxR && d < dist) { target = D; dist = d; }
      }
    }
    if (target) {
      const anchor = target.pos.kind === 'node' ? target.pos.node : A.pos.node;
      const eng = engagementFor(state, anchor, 'ranged');
      if (eng.lastRoundAt === tick && eng.participants[A.owner]?.includes(A.id)) continue;
      eng.lastRoundAt = tick;
      eng.rounds++;
      addParticipant(eng, A);
      addParticipant(eng, target);
      eng.tables[A.owner] = 'attack';
      fired.add(A.id);
      const pools = damageAgainst(state, A, target, { table: 'attack', node: null, entrenched: false, defenseMult: 1 }, 1, variance(state, eng.id, eng.rounds, A.id), dist);
      addPending(pending, target.id, pools, A.owner, eng);
    } else if (ordered?.targetNode !== null && ordered?.targetNode !== undefined) {
      // bombard a hostile city at an empty node
      const node = ordered.targetNode;
      const owner = state.provinces[node]?.owner;
      const ck = m.cityByNode.get(node);
      if (owner && atWar(A.owner, owner) && ck && state.cities[ck]) {
        const d = distKm(ll[0], ll[1], m.lon[node], m.lat[node]);
        if (d <= maxR) {
          let sum = 0;
          for (const u of combatUnits(A)) if (ustats(state, u).rangeKm >= d) sum += (ustats(state, u).attack.building ?? 0) * (u.hp / u.maxHp);
          const city = state.cities[ck];
          const loss = Math.min(city.condition, Math.round(sum * ROUND_DAMAGE_FACTOR * 2) / 1);
          if (loss > 0) {
            city.condition = Math.max(0, city.condition - loss);
            bumpEconomy(state);
            fired.add(A.id);
            emit(state, { kind: 'bombardment', category: 'combat', node, private: { ...toAll([A.owner], `${A.name} bombarded ${city.name} (condition −${loss}).`), ...toAll([owner], `${city.name} was bombarded (condition −${loss}).`) }, public: { headline: `${city.name} comes under bombardment`, countries: [owner] } });
          }
        }
      }
    }
  }

  // ── 3. air
  for (const P of all) {
    if (!enemies.has(P.owner)) continue;
    if (P.moveClass !== 'air' || !P.air || P.air.state !== 'on_station' || fired.has(P.id) || !P.air.patrol) continue;
    if (P.firePolicy === 'hold') continue;
    const ll = stackLL(state, P);
    const canAir = combatUnits(P).some((u) => (ustats(state, u).attack.airplane ?? 0) > 0);
    let target: Stack | null = null;
    let best = Infinity;
    for (const D of all) {
      if (D.id === P.id || !hostileStacks(P, D) || D.aboard) continue;
      const isAir = D.moveClass === 'air';
      if (isAir && (!D.air || D.air.state === 'landed' || D.air.state === 'refueling')) continue;
      if (isAir && !canAir) continue;
      if (!isAir && P.firePolicy !== 'engage') continue;
      if (!hooks.canSee(state, P.owner, D.id)) continue;
      const d = distKm(ll[0], ll[1], ...stackLL(state, D));
      if (d > P.air.patrol.radiusKm) continue;
      const score = (isAir ? 0 : 1e6) + d;
      if (score < best) { best = score; target = D; }
    }
    if (!target) continue;
    const anchor = target.pos.kind === 'node' ? target.pos.node : (P.air.patrol.node ?? 0);
    const eng = engagementFor(state, anchor, 'air');
    eng.lastRoundAt = tick;
    eng.rounds++;
    addParticipant(eng, P);
    addParticipant(eng, target);
    fired.add(P.id);
    eng.tables[P.owner] = 'attack';
    addPending(pending, target.id, damageAgainst(state, P, target, { table: 'attack', node: null, entrenched: false, defenseMult: 1 }, 1, variance(state, eng.id, eng.rounds, P.id)), P.owner, eng);
    // return fire with defense table
    addPending(pending, P.id, damageAgainst(state, target, P, { table: 'defense', node: null, entrenched: false, defenseMult: 1 }, 1, variance(state, eng.id, eng.rounds, target.id)), target.owner, eng);
  }
  // area air defence (distinct from return fire)
  for (const A of all) {
    if (!enemies.has(A.owner)) continue;
    if (A.moveClass === 'air' || A.aboard || A.firePolicy !== 'engage') continue;
    const ad = combatUnits(A).filter((u) => utype(state, u.type).family === 'air_defense');
    if (!ad.length) continue;
    const maxR = Math.max(...ad.map((u) => ustats(state, u).rangeKm));
    if (maxR <= 0) continue;
    const ll = stackLL(state, A);
    for (const P of all) {
      if (P.moveClass !== 'air' || !P.air || P.air.state !== 'on_station' || !hostileStacks(A, P)) continue;
      const d = distKm(ll[0], ll[1], ...stackLL(state, P));
      if (d > maxR || !hooks.canSee(state, A.owner, P.id)) continue;
      const anchor = A.pos.kind === 'node' ? A.pos.node : 0;
      const eng = engagementFor(state, anchor, 'air');
      eng.lastRoundAt = tick;
      addParticipant(eng, A);
      addParticipant(eng, P);
      const fake: Stack = { ...A, units: ad };
      addPending(pending, P.id, damageAgainst(state, fake, P, { table: 'defense', node: null, entrenched: false, defenseMult: 1 }, 1, variance(state, eng.id, eng.rounds + 1000, A.id), d), A.owner, eng);
      break;
    }
  }

  // ── apply (sorted by target id)
  const targets = [...pending.keys()].sort((a, b) => cmpId({ id: a }, { id: b }));
  for (const tid of targets) {
    const D = state.stacks[tid];
    if (!D) continue;
    for (const p of pending.get(tid) as { pools: Partial<Record<TargetClass, number>>; from: CountryId; eng: Engagement }[]) {
      const before = D.units.filter((u) => u.hp > 0).length;
      const applied = allocateDamage(state, D.units, p.pools);
      p.eng.damage[D.owner] = (p.eng.damage[D.owner] ?? 0) + applied;
      const after = D.units.filter((u) => u.hp > 0).length;
      p.eng.losses[D.owner] = (p.eng.losses[D.owner] ?? 0) + (before - after);
      if (before > after) {
        const ev = emit(state, { kind: 'units_lost', category: 'combat', node: D.pos.kind === 'node' ? D.pos.node : null, routine: false, private: { ...toAll([D.owner], `${D.name} lost ${before - after} unit(s).`, { stack: D.id, count: before - after }), ...toAll([p.from], `Enemy forces destroyed: ${before - after} unit(s).`, { count: before - after }) } });
        awardXp(state, p.from, ev.id, 'unitDefeated');
      }
    }
    D.lastCombatAt = tick;
    for (const u of D.units) if (u.hp > 0) u.readiness = Math.max(0, u.readiness - COMBAT_READINESS_LOSS);
    D.units = D.units.filter((u) => u.hp > 0);
    if (!D.units.length) {
      const by = pending.get(tid)?.[0]?.from ?? null;
      hooks.onStackDestroyed(state, D, by);
    }
  }
  for (const id of fired) {
    const s = state.stacks[id];
    if (s) s.lastCombatAt = tick;
  }

  closeEngagements(state);
}

function stillHostile(state: GameState, e: Engagement): boolean {
  if (e.kind !== 'node') return e.lastRoundAt === state.clock.tick;
  const here = Object.values(state.stacks).filter((s) => s.pos.kind === 'node' && s.pos.node === e.node && !s.aboard && s.moveClass !== 'air');
  for (let i = 0; i < here.length; i++) for (let j = i + 1; j < here.length; j++) if (hostileStacksW(state, here[i], here[j])) return true;
  return false;
}

export function closeEngagements(state: GameState): void {
  const m = S(state).map;
  if (!Object.values(state.engagements).some((e) => e.open)) return;
  for (const id of Object.keys(state.engagements).sort((a, b) => cmpId({ id: a }, { id: b }))) {
    const e = state.engagements[id];
    if (!e.open || stillHostile(state, e)) continue;
    e.open = false;
    e.closedAt = state.clock.tick;
    const sides = Object.keys(e.participants).sort();
    const survivors = sides.filter((c) => e.participants[c].some((sid) => !!state.stacks[sid]));
    e.outcome = survivors.length === 1 ? `${survivors[0]} prevailed` : survivors.length === 0 ? 'mutual destruction' : 'forces disengaged';
    const where = m.data.nodes[e.node]?.name ?? `sector ${e.node}`;
    const cause = e.kind === 'node' ? (Object.values(e.tables).includes('defense') ? 'assault on a defended center' : 'meeting engagement') : e.kind === 'air' ? 'air engagement' : 'ranged bombardment';
    const priv: GameEvent['private'] = {};
    for (const c of sides) {
      const others = sides.filter((x) => x !== c);
      priv[c] = {
        text: `Battle report — ${where}: ${cause} against ${others.join(', ') || 'unknown forces'}; ${e.outcome}. Own losses: ${e.losses[c] ?? 0} unit(s); enemy losses: ${others.reduce((a, o) => a + (e.losses[o] ?? 0), 0)}.`,
        data: { engagement: e.id, rounds: e.rounds, cause, outcome: e.outcome, ownLosses: e.losses[c] ?? 0, table: e.tables[c] ?? null },
      };
    }
    emit(state, { kind: 'battle_report', category: 'combat', node: e.node, private: priv, public: e.kind === 'node' ? { headline: `Fighting reported near ${where} (${sides.join(' vs ')})`, countries: sides } : null });
  }
  // prune old closed engagements (keep 200 most recent)
  const closed = Object.values(state.engagements).filter((e) => !e.open).sort(cmpId);
  for (let i = 0; i < closed.length - 200; i++) delete state.engagements[closed[i].id];
}
import type { GameEvent } from '../state';
