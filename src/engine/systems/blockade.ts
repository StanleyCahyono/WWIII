/**
 * BLOCKADE (AI engine request #12). A port city (map port flag) is BLOCKADED when
 *   (a) at least one sea zone adjacent to its control node (coast edge) holds a naval stack with a
 *       warship (a living sea/subsurface unit with any attack value > 0) of a country AT WAR with
 *       the city's owner, and
 *   (b) no adjacent sea zone holds a naval stack (any) of the owner or of a coalition partner.
 * Evaluated every whole game hour (step 6, before the economy accrual) from stack positions only, so
 * it is a pure function of the state at that boundary; the result is saved in `state.blockades`
 * (city → { since, by, zones }) because the start/lift events need the previous status.
 *
 * Effects while blockaded (documented in the UI economy report and the journal):
 *  - city output × BLOCKADE.outputFactor (port trade and coastal shipping lost) — applied in
 *    economy.cityOutput before the territory factor, announced with bumpEconomy(node);
 *  - no new naval units can be mobilized at the city (`checkMobilize` → code `blockaded`).
 * Journal: the owner is told "<city> is blockaded by hostile warships" (without naming who — the
 * blockaders' identity may be unobserved); each blockading country is told which enemy port its
 * warships blockade. Lifting is announced to both.
 */
import type { CityKey, CountryId, NodeId } from '../data-types';
import type { GameState } from '../state';
import { S } from '../scenario/registry';
import { BLOCKADE } from '../rules';
import type { MapIndex } from './mapindex';
import { atWar, sameCoalition, stacksReadonly, utype } from './world';
import { emit, toAll } from './events';
import { bumpEconomy } from './economy';

interface PortIndex {
  /** sea node → port city keys whose control node touches it (sorted). */
  seaToPorts: Map<NodeId, CityKey[]>;
  /** port city key → adjacent sea zones (sorted). */
  portSeas: Map<CityKey, NodeId[]>;
}
const portIndexCache = new WeakMap<MapIndex, PortIndex>();
export function portIndex(m: MapIndex): PortIndex {
  let pi = portIndexCache.get(m);
  if (pi) return pi;
  pi = { seaToPorts: new Map(), portSeas: new Map() };
  for (const c of [...m.data.cities].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
    if (!c.port) continue;
    const seas: NodeId[] = [];
    for (const ei of m.adj[c.node]) {
      const e = m.edges[ei];
      if (e.kind !== 'coast') continue;
      const o = e.a === c.node ? e.b : e.a;
      if (m.isLand[o]) continue;
      if (!seas.includes(o)) seas.push(o);
    }
    seas.sort((a, b) => a - b);
    if (!seas.length) continue;
    pi.portSeas.set(c.key, seas);
    for (const s of seas) {
      const l = pi.seaToPorts.get(s) ?? [];
      if (!l.includes(c.key)) l.push(c.key);
      pi.seaToPorts.set(s, l);
    }
  }
  for (const l of pi.seaToPorts.values()) l.sort();
  portIndexCache.set(m, pi);
  return pi;
}

interface ZonePresence {
  /** Owners with any naval stack in the zone. */
  any: Set<CountryId>;
  /** Owners with a warship in the zone. */
  armed: Set<CountryId>;
}

function presence(state: GameState): Map<NodeId, ZonePresence> {
  const m = S(state).map;
  const out = new Map<NodeId, ZonePresence>();
  for (const s of stacksReadonly(state)) {
    if (s.moveClass !== 'naval' || s.pos.kind !== 'node' || s.aboard || state.stacks[s.id] !== s) continue;
    const n = s.pos.node;
    if (m.isLand[n]) continue;
    let z = out.get(n);
    if (!z) out.set(n, (z = { any: new Set(), armed: new Set() }));
    z.any.add(s.owner);
    if (!z.armed.has(s.owner)) {
      for (const u of s.units) {
        if (u.hp <= 0) continue;
        const t = utype(state, u.type);
        if (t.domain !== 'sea' && t.domain !== 'subsurface') continue;
        const lv = t.levels.find((l) => l.level === u.level) ?? t.levels[0];
        if (lv && Object.values(lv.attack).some((v) => (v ?? 0) > 0)) {
          z.armed.add(s.owner);
          break;
        }
      }
    }
  }
  return out;
}

/** Blockade verdict for one port city from a presence map (pure). */
function verdict(state: GameState, key: CityKey, seas: NodeId[], pres: Map<NodeId, ZonePresence>): { by: CountryId[]; zones: NodeId[] } | null {
  const node = state.cities[key]?.node;
  const p = node === undefined ? null : state.provinces[node];
  if (!p || p.control !== 'country' || !p.owner) return null;
  const owner = p.owner;
  const by = new Set<CountryId>();
  const zones: NodeId[] = [];
  for (const z of seas) {
    const zp = pres.get(z);
    if (!zp) continue;
    for (const c of zp.any) if (c === owner || sameCoalition(state, c, owner)) return null; // friendly naval presence
    let hostile = false;
    for (const c of zp.armed) if (atWar(state, c, owner)) { by.add(c); hostile = true; }
    if (hostile) zones.push(z);
  }
  if (!by.size) return null;
  return { by: [...by].sort(), zones };
}

/** Hourly refresh (step 6, before economyHour). */
export function updateBlockades(state: GameState): void {
  const m = S(state).map;
  const pi = portIndex(m);
  const cur = (state.blockades ??= {});
  const pres = presence(state);
  const cand = new Set<CityKey>(Object.keys(cur));
  for (const z of pres.keys()) for (const k of pi.seaToPorts.get(z) ?? []) cand.add(k);
  if (!cand.size) return;
  const t = state.clock.tick;
  for (const key of [...cand].sort()) {
    const seas = pi.portSeas.get(key);
    const v = seas ? verdict(state, key, seas, pres) : null;
    const old = cur[key];
    const city = state.cities[key];
    if (!city) {
      delete cur[key];
      continue;
    }
    const owner = state.provinces[city.node]?.owner ?? null;
    if (v && !old) {
      cur[key] = { since: t, by: v.by, zones: v.zones };
      bumpEconomy(state, city.node);
      emit(state, {
        kind: 'blockade_started',
        category: 'economy',
        node: city.node,
        private: {
          ...toAll([owner], `${city.name} is blockaded by hostile warships: city output −${Math.round((1 - blockadeFactor()) * 100)} % (port trade lost) and no new ships can be launched there until a friendly ship reaches an adjacent sea zone or the blockaders leave.`, { city: key, node: city.node }),
          ...toAll(v.by, `Our warships blockade ${city.name} (${owner}): its output is cut and its shipyards cannot launch ships while no ${owner} or allied ship contests the adjacent waters.`, { city: key, node: city.node, owner }),
        },
      });
    } else if (!v && old) {
      delete cur[key];
      bumpEconomy(state, city.node);
      emit(state, { kind: 'blockade_lifted', category: 'economy', node: city.node, private: { ...toAll([owner], `The blockade of ${city.name} has been lifted.`, { city: key, node: city.node }), ...toAll(old.by.filter((c) => c !== owner), `Our blockade of ${city.name} has ended.`, { city: key, node: city.node }) } });
    } else if (v && old && (old.by.join() !== v.by.join() || old.zones.join() !== v.zones.join())) {
      old.by = v.by;
      old.zones = v.zones;
    }
  }
}

export function blockadeFactor(): number {
  return BLOCKADE.outputFactor;
}
export function isBlockaded(state: GameState, key: CityKey): boolean {
  return !!state.blockades?.[key];
}
