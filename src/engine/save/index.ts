/**
 * Persistence (pure part; IndexedDB lives in the UI).
 *  - serialize(state) → JSON envelope { format, schemaVersion, scenarioId, scenarioVersion, seed, state }
 *  - deserialize(json) → parses into a TEMPORARY copy, runs explicit stepwise migrations
 *    (v0 → v1 …), validates references/finite numbers/ownership/queued work, then returns the new
 *    state (the caller swaps atomically). Any failure throws SaveError and never touches the
 *    caller's current state.
 *  - stateHash(state): canonical (sorted-key) hash EXCLUDING the `ui` section and save revision.
 *  - saveRevision: bumped by markSaved(); hosts compare revisions to detect multi-tab conflicts.
 */
import type { GameState, PlanningDrawing } from '../state';
import { SCHEMA_VERSION } from '../state';
import { hash64Hex } from '../rng';
import { isValidVec } from '../fixed';
import { getScenarioById } from '../scenario/registry';
import { RESOURCES } from '../data-types';

export const SAVE_FORMAT = 'world-command-save';

export class SaveError extends Error {
  code: 'parse' | 'format' | 'version' | 'scenario' | 'invalid';
  details: string[];
  constructor(code: SaveError['code'], message: string, details: string[] = []) {
    super(message);
    this.name = 'SaveError';
    this.code = code;
    this.details = details;
  }
}

export interface SaveEnvelope {
  format: typeof SAVE_FORMAT;
  schemaVersion: number;
  scenarioId: string;
  scenarioVersion: string;
  seed: number;
  savedRevision: number;
  state: unknown;
}

export function serialize(state: GameState): string {
  const env: SaveEnvelope = { format: SAVE_FORMAT, schemaVersion: state.schemaVersion, scenarioId: state.scenarioId, scenarioVersion: state.scenarioVersion, seed: state.seed, savedRevision: state.meta.saveRevision, state };
  return JSON.stringify(env);
}

/** Bump the save revision (call when persisting). Returns the new revision. */
export function markSaved(state: GameState): number {
  state.meta.saveRevision += 1;
  return state.meta.saveRevision;
}
/** Multi-tab conflict check: a writer holding `myRevision` may only overwrite `storedRevision` if not newer. */
export function revisionConflict(myRevision: number, storedRevision: number): boolean {
  return storedRevision > myRevision;
}

// ───────────────────────────── migrations ─────────────────────────────

type Migration = (s: Record<string, any>) => Record<string, any>;
/** migrations[v] upgrades a schema-v state to v+1. Pure and repeatable. */
export const MIGRATIONS: Record<number, Migration> = {
  0: (s) => {
    // v0 (pre-release prototype): countries had `treasury` (whole units) instead of milli `stock`,
    // no `escrow`, no `ui` section, no `shortages`, and the clock was `minute`.
    const o = JSON.parse(JSON.stringify(s));
    if (o.clock && typeof o.clock.minute === 'number' && o.clock.tick === undefined) {
      o.clock = { tick: o.clock.minute, lastStep: Math.floor(o.clock.minute / 15) * 15 };
    }
    for (const c of Object.values<any>(o.countries ?? {})) {
      if (c.treasury && !c.stock) {
        c.stock = {};
        for (const r of RESOURCES) c.stock[r] = Math.round((c.treasury[r] ?? 0) * 1000);
        delete c.treasury;
      }
      c.escrow ??= Object.fromEntries(RESOURCES.map((r) => [r, 0]));
      c.shortages ??= [];
      if (c.ledger && !c.ledger.initial) c.ledger.initial = { ...c.stock };
    }
    o.ui ??= { planning: [], prefs: {}, nextDrawingId: 1 };
    o.schemaVersion = 1;
    return o;
  },
};

export function migrate(raw: Record<string, any>): Record<string, any> {
  let s = raw;
  let v = typeof s.schemaVersion === 'number' ? s.schemaVersion : 0;
  if (v > SCHEMA_VERSION) throw new SaveError('version', `Save schema ${v} is newer than this build (${SCHEMA_VERSION}).`);
  while (v < SCHEMA_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) throw new SaveError('version', `No migration from schema ${v}.`);
    s = m(s);
    v = s.schemaVersion;
  }
  return s;
}

// ───────────────────────────── validation ─────────────────────────────

function finiteDeep(x: unknown, path: string, errs: string[], depth = 0): void {
  if (errs.length > 20 || depth > 40) return;
  if (typeof x === 'number') {
    if (!Number.isFinite(x)) errs.push(`Non-finite number at ${path}`);
  } else if (Array.isArray(x)) x.forEach((v, i) => finiteDeep(v, `${path}[${i}]`, errs, depth + 1));
  else if (x && typeof x === 'object') for (const k of Object.keys(x)) finiteDeep((x as Record<string, unknown>)[k], `${path}.${k}`, errs, depth + 1);
}

export function validateState(s: GameState): string[] {
  const errs: string[] = [];
  const req = ['countries', 'provinces', 'cities', 'stacks', 'queue', 'clock', 'score', 'market', 'countryOrder'];
  for (const k of req) if ((s as any)[k] === undefined) errs.push(`Missing section ${k}`);
  if (errs.length) return errs;
  if (!Number.isInteger(s.clock.tick) || s.clock.tick < 0) errs.push('Invalid clock');
  finiteDeep(s, 'state', errs);
  const sc = getScenarioById(s.scenarioId);
  if (!sc) errs.push(`Scenario ${s.scenarioId} not available`);
  else {
    if (sc.version !== s.scenarioVersion) errs.push(`Scenario version mismatch (${s.scenarioVersion} vs ${sc.version})`);
    if (s.provinces.length !== sc.map.nodes.length) errs.push('Province table does not match map');
  }
  const nNodes = s.provinces.length;
  for (const c of s.countryOrder) {
    const cs = s.countries[c];
    if (!cs) { errs.push(`Missing country ${c}`); continue; }
    if (!isValidVec(cs.stock) || !isValidVec(cs.escrow)) errs.push(`Invalid resource vector for ${c}`);
    for (const r of RESOURCES) if (cs.stock[r] < 0 || cs.escrow[r] < 0) errs.push(`Negative resource ${r} for ${c}`);
    for (const j of cs.jobs) {
      if (j.city && !s.cities[j.city]) errs.push(`Job ${j.id} references unknown city`);
      if (!(j.node >= 0 && j.node < nNodes)) errs.push(`Job ${j.id} references unknown node`);
      if (j.startedAt !== null && !s.queue.some((q) => q.kind === 'job_done' && q.ref === j.id)) errs.push(`Active job ${j.id} has no completion event`);
    }
    for (const r of cs.research) if (!s.queue.some((q) => q.kind === 'research_done' && q.ref === r.tech && q.country === c)) errs.push(`Research ${r.tech} (${c}) has no completion event`);
  }
  for (const p of s.provinces) {
    if (!p) continue;
    if (p.owner !== null && !s.countries[p.owner]) errs.push(`Province ${p.node} owned by unknown ${p.owner}`);
  }
  for (const id of Object.keys(s.stacks)) {
    const st = s.stacks[id];
    if (st.id !== id) errs.push(`Stack key mismatch ${id}`);
    if (!s.countries[st.owner]) errs.push(`Stack ${id} owner unknown`);
    if (!Array.isArray(st.units) || !st.units.length) errs.push(`Stack ${id} has no units`);
    if (st.pos.kind === 'node' && !(st.pos.node >= 0 && st.pos.node < nNodes)) errs.push(`Stack ${id} at unknown node`);
    if (st.aboard && !s.stacks[st.aboard]) errs.push(`Stack ${id} aboard missing carrier`);
    for (const u of st.units) if (!(u.hp > 0 && u.hp <= u.maxHp)) errs.push(`Unit ${u.id} has invalid HP`);
  }
  // market escrow reconciles with open orders
  const esc: Record<string, Record<string, number>> = {};
  for (const o of Object.values(s.market.orders)) {
    if (o.status !== 'open') continue;
    const e = (esc[o.country] ??= {});
    const r = o.side === 'buy' ? 'money' : o.resource;
    e[r] = (e[r] ?? 0) + o.escrow;
  }
  for (const c of s.countryOrder) for (const r of RESOURCES) {
    const want = esc[c]?.[r] ?? 0;
    if (s.countries[c] && s.countries[c].escrow[r] !== want) errs.push(`Escrow mismatch for ${c}/${r}`);
  }
  for (let i = 1; i < s.queue.length; i++) {
    const a = s.queue[i - 1], b = s.queue[i];
    if (a.at > b.at || (a.at === b.at && (a.cls > b.cls || (a.cls === b.cls && a.seq > b.seq)))) { errs.push('Event queue out of order'); break; }
  }
  return errs;
}

export function deserialize(json: string): GameState {
  let env: any;
  try {
    env = JSON.parse(json);
  } catch (e) {
    throw new SaveError('parse', 'Save file is not valid JSON.');
  }
  if (!env || typeof env !== 'object' || env.format !== SAVE_FORMAT || !env.state || typeof env.state !== 'object') throw new SaveError('format', 'Not a World Command save file.');
  let s: any = JSON.parse(JSON.stringify(env.state)); // temporary copy
  s = migrate(s);
  const errs = validateState(s as GameState);
  if (errs.length) throw new SaveError('invalid', `Save failed validation: ${errs[0]}`, errs);
  return s as GameState;
}

export function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state));
}

function canon(x: unknown): string {
  if (x === null || typeof x !== 'object') return JSON.stringify(x);
  if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
  const o = x as Record<string, unknown>;
  return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canon(o[k])).join(',') + '}';
}

/** Canonical hash of simulation state (excludes `ui` and `meta.saveRevision`). */
export function stateHash(state: GameState): string {
  const { ui: _ui, meta, ...rest } = state;
  void _ui;
  return hash64Hex(canon({ ...rest, meta: { ...meta, saveRevision: 0 } }));
}

// ───────────────────────────── UI-private planning layer ─────────────────────────────
// Never read by the simulation; excluded from stateHash.

export function addDrawing(state: GameState, d: Omit<PlanningDrawing, 'id' | 'createdAt' | 'hidden'> & { hidden?: boolean }): PlanningDrawing {
  const id = `d${state.ui.nextDrawingId++}`;
  const x: PlanningDrawing = { ...d, id, createdAt: state.clock.tick, hidden: d.hidden ?? false };
  state.ui.planning.push(x);
  return x;
}
export function renameDrawing(state: GameState, id: string, name: string): boolean {
  const d = state.ui.planning.find((x) => x.id === id);
  if (!d) return false;
  d.name = name;
  return true;
}
export function setDrawingHidden(state: GameState, id: string, hidden: boolean): boolean {
  const d = state.ui.planning.find((x) => x.id === id);
  if (!d) return false;
  d.hidden = hidden;
  return true;
}
export function deleteDrawing(state: GameState, id: string): boolean {
  const n = state.ui.planning.length;
  state.ui.planning = state.ui.planning.filter((x) => x.id !== id);
  return state.ui.planning.length < n;
}
export function setPref(state: GameState, key: string, value: string | number | boolean): void {
  state.ui.prefs[key] = value;
}
