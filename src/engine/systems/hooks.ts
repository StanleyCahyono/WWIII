/** Cross-system wiring (kept in one place to avoid import cycles between systems). */
import type { CountryId, NodeId } from '../data-types';
import type { GameState, Stack } from '../state';
import { declareWarInternal, type DiploHooks } from './diplomacy';
import type { MoveHooks } from './movement';
import type { AirmobileHooks } from './airmobile';
import { orderFromPlan, planRoute } from './movement';
import type { CombatHooks } from './combat';
import type { GovHooks } from './government';
import { transferNode } from './government';
import type { ProductionHooks } from './production';
import { cancelJobInternal } from './production';
import { canSee } from './visibility';
import { emit, toAll } from './events';
import { joinCoalitionInternal, removeMember } from './coalitions';
import { cancelOrderInternal, openOrdersOf } from './market';
import { coalitionOf, cmpId, utype, stacksOfOwner, stacksReadonly } from './world';

export function destroyStack(state: GameState, s: Stack, by: CountryId | null): void {
  if (!state.stacks[s.id]) return;
  delete state.stacks[s.id];
  // aircraft aboard a destroyed carrier are lost with it (the read-only sorted list is a snapshot:
  // deleting entries of state.stacks inside the loop does not change it)
  for (const a of stacksReadonly(state)) {
    if (a.aboard === s.id) {
      delete state.stacks[a.id];
      emit(state, { kind: 'aircraft_lost', category: 'combat', private: toAll([a.owner], `Aircraft lost: ${a.name} went down with its carrier ${s.name}.`, { stack: a.id }) });
    }
  }
  emit(state, { kind: 'stack_destroyed', category: 'combat', node: s.pos.kind === 'node' ? s.pos.node : null, private: { ...toAll([s.owner], `${s.name} was destroyed.`, { stack: s.id }), ...toAll([by], `An enemy formation was destroyed.`) } });
}

export const moveHooks: MoveHooks = { declareWar: declareWarInternal };

export const airmobileHooks: AirmobileHooks = { declareWar: declareWarInternal, destroy: destroyStack };

export const combatHooks: CombatHooks = {
  onStackDestroyed: destroyStack,
  canSee,
};

export const govHooks: GovHooks = {
  onOwnerChanged: () => {
    /* eliminations are checked once per step */
  },
};

export const productionHooks: ProductionHooks = {
  onUnitSpawned: (state, s, rally) => {
    if (rally === null || s.moveClass === 'air') return;
    const plan = planRoute(state, s, rally, []);
    if (plan.ok && plan.segments.length) s.order = orderFromPlan(state, s, plan, rally, [], []);
  },
  onMissileReady: () => {},
};

export const diploHooks: DiploHooks = { joinCoalition: joinCoalitionInternal, cede: (state, node, _from, to) => transferNode(state, node, to, 'treaty', govHooks) };

/** A country with no territory and no capture-capable force is eliminated (once). */
const ownersCache = new WeakMap<GameState, { ownv: number; provs: object; owns: Set<CountryId> }>();
export function checkEliminations(state: GameState): void {
  // set of territory owners, rebuilt only when ownership changed (ownv) — every transfer bumps it
  const ownv = state.ids.ownv ?? 0;
  let oc = ownersCache.get(state);
  if (!oc || oc.ownv !== ownv || oc.provs !== state.provinces) {
    const s = new Set<CountryId>();
    for (const p of state.provinces) if (p && p.owner) s.add(p.owner);
    oc = { ownv, provs: state.provinces, owns: s };
    ownersCache.set(state, oc);
  }
  const owns = oc.owns;
  for (const c of state.countryOrder) {
    const cs = state.countries[c];
    if (!cs.alive || owns.has(c)) continue;
    const recovery = stacksOfOwner(state, c).some((s) => state.stacks[s.id] === s && s.moveClass === 'ground' && s.units.some((u) => utype(state, u.type).capture));
    if (recovery) continue;
    cs.alive = false;
    cs.eliminatedAt = state.clock.tick;
    for (const j of [...cs.jobs]) cancelJobInternal(state, c, j.id, 'country eliminated');
    for (const o of openOrdersOf(state, c)) cancelOrderInternal(state, o.id);
    cs.research = [];
    state.queue = state.queue.filter((e) => !(e.kind === 'research_done' && e.country === c));
    for (const s of Object.values(state.stacks)) if (s.owner === c) delete state.stacks[s.id];
    const co = coalitionOf(state, c);
    if (co) removeMember(state, co, c, 'eliminated');
    const human = state.meta.humanCountry === c;
    if (human) state.meta.humanRun = 'concluded';
    emit(state, {
      kind: 'country_eliminated',
      category: 'system',
      public: { headline: `${cs.name} has been eliminated`, countries: [c] },
      private: toAll([c], human ? 'Your country has lost all territory and has no recovery force. Your run is concluded — you may keep observing.' : 'Eliminated.'),
      interrupt: human ? [c] : [],
    });
  }
}

export function nodeName(state: GameState, n: NodeId): string {
  return String(n);
}
