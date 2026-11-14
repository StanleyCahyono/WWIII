/**
 * Sim host (main thread). Owns the simulation worker, exposes a promise API, the latest frame
 * (CountryView for the human seat), the clock, save status and multi-tab single-writer locking.
 */
import type { Command, CommandResult, Validation } from '../../engine/index';
import type { Frame, InterruptPrefs, Push, QueryName, Request, Response, SaveInfo, UiAction, WorkerMessage, CountryPreview, ScenarioSummary } from './protocol';
import { createStore } from '../state/store';

export interface HostState {
  ready: boolean;
  frame: Frame | null;
  lastSave: SaveInfo | null;
  lastGoodSave: SaveInfo | null;
  saving: boolean;
  error: string | null;
  interrupts: { id: string; kind: string; text: string; node: number | null; at: number }[];
  logs: { at: number; level: string; message: string }[];
  /** Another tab owns this campaign. */
  lockLost: boolean;
}

/** Distributive Omit so each command variant keeps its own fields. */
export type CommandInput = Command extends unknown ? (Command extends infer C ? (C extends Command ? Omit<C, 'country'> & { country?: string } : never) : never) : never;

type Pending = { resolve: (v: unknown) => void; reject: (e: Error & { code?: string; details?: unknown }) => void; op: string; t0: number };

export class SimHost {
  readonly store = createStore<HostState>({ ready: false, frame: null, lastSave: null, lastGoodSave: null, saving: false, error: null, interrupts: [], logs: [], lockLost: false });
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private lockRelease: (() => void) | null = null;
  private channel: BroadcastChannel | null = null;
  private tabId = Math.random().toString(36).slice(2);
  private openId: string | null = null;
  readonly timings: { op: string; ms: number }[] = [];

  constructor() {
    this.worker = new Worker(new URL('../../workers/sim.worker.ts', import.meta.url), { type: 'module', name: 'sim' });
    this.worker.onmessage = (ev: MessageEvent<WorkerMessage>) => this.onMessage(ev.data);
    this.worker.onerror = (ev) => this.store.patch({ error: `Simulation worker error: ${ev.message || 'unknown'}` });
    try {
      this.channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('world-command-tabs') : null;
      if (this.channel) this.channel.onmessage = (ev) => this.onChannel(ev.data);
    } catch {
      this.channel = null;
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => void this.save('page hidden').catch(() => {}));
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && this.store.get().frame && !this.store.get().frame!.clock.paused) void this.save('tab hidden').catch(() => {});
      });
    }
  }

  private onMessage(m: WorkerMessage) {
    if (m.type === 'response') return this.onResponse(m);
    this.onPush(m);
  }

  private onResponse(m: Response) {
    const p = this.pending.get(m.id);
    if (!p) return;
    this.pending.delete(m.id);
    this.timings.push({ op: p.op, ms: performance.now() - p.t0 });
    if (this.timings.length > 500) this.timings.shift();
    if (m.ok) p.resolve(m.result);
    else {
      const e = new Error(m.error) as Error & { code?: string; details?: unknown };
      e.code = m.code;
      e.details = m.details;
      p.reject(e);
    }
  }

  private onPush(m: Push) {
    const s = this.store.get();
    switch (m.type) {
      case 'frame':
        this.store.patch({ frame: m.frame });
        break;
      case 'saved':
        this.store.patch({ lastSave: m.info, saving: false, lastGoodSave: m.info.ok ? m.info : s.lastGoodSave, error: m.info.ok ? s.error : m.info.error ?? s.error });
        if (m.info.ok && this.channel && this.openId) this.channel.postMessage({ kind: 'saved', id: this.openId, revision: m.info.revision, tab: this.tabId });
        break;
      case 'interrupt':
        this.store.patch({ interrupts: [...s.interrupts, ...m.events.map((e) => ({ ...e, at: Date.now() }))].slice(-20) });
        break;
      case 'log':
        this.store.patch({ logs: [...s.logs, { at: Date.now(), level: m.level, message: m.message }].slice(-100) });
        break;
      case 'fatal':
        this.store.patch({ error: m.message, logs: [...s.logs, { at: Date.now(), level: 'error', message: m.message }].slice(-100) });
        break;
    }
  }

  private onChannel(msg: { kind: string; id: string; tab: string; revision?: number }) {
    if (!msg || msg.tab === this.tabId || msg.id !== this.openId) return;
    if (msg.kind === 'takeover') {
      // Another tab took over writing: become read-only immediately.
      this.releaseLock();
      void this.request({ op: 'setReadOnly', readOnly: true });
      this.store.patch({ lockLost: true });
    }
  }

  request<T = unknown>(req: Request): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, op: req.op, t0: performance.now() });
      this.worker.postMessage({ id, ...req });
    });
  }

  // ───────────── lifecycle ─────────────
  async init() {
    const r = await this.request<{ id: string; name: string; seats: number; version: string; formatVersion: number }>({ op: 'init' });
    this.store.patch({ ready: true });
    return r;
  }
  previews() {
    return this.request<{ summary: ScenarioSummary; previews: CountryPreview[] }>({ op: 'previews' });
  }

  /** Acquire the single-writer lock for a campaign. Returns false when another tab holds it. */
  async acquireLock(id: string): Promise<boolean> {
    this.releaseLock();
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    if (!locks) return true; // no Web Locks: rely on save-revision conflict detection
    return new Promise<boolean>((resolve) => {
      void locks.request(`world-command:${id}`, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(false);
          return undefined;
        }
        resolve(true);
        return new Promise<void>((release) => (this.lockRelease = release));
      });
    });
  }
  /** Ask the other tab to yield, then wait for the lock. */
  async takeOver(id: string): Promise<boolean> {
    this.channel?.postMessage({ kind: 'takeover', id, tab: this.tabId });
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    if (!locks) return true;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 4000);
      void locks.request(`world-command:${id}`, (lock) => {
        clearTimeout(timer);
        resolve(!!lock);
        return new Promise<void>((release) => (this.lockRelease = release));
      });
    });
  }
  releaseLock() {
    if (this.lockRelease) this.lockRelease();
    this.lockRelease = null;
  }

  async newGame(country: string, seed: number, difficulty: 'easy' | 'normal' | 'hard', campaignId: string, name: string) {
    await this.acquireLock(campaignId);
    this.openId = campaignId;
    this.store.patch({ lockLost: false, interrupts: [], lastSave: null });
    return this.request<{ ok: boolean; save: SaveInfo }>({ op: 'newGame', country, seed, difficulty, campaignId, name });
  }

  async open(campaignId: string, opts: { readOnly?: boolean; catchUpMinutes?: number } = {}) {
    this.openId = campaignId;
    this.store.patch({ lockLost: !!opts.readOnly, interrupts: [], lastSave: null });
    return this.request<{ ok: boolean; caughtUp: number; reviewMode: boolean }>({ op: 'open', campaignId, readOnly: opts.readOnly, catchUpMinutes: opts.catchUpMinutes });
  }

  async close() {
    const r = await this.request({ op: 'close' }).catch(() => null);
    this.releaseLock();
    this.openId = null;
    this.store.patch({ frame: null, interrupts: [] });
    return r;
  }

  // ───────────── game API ─────────────
  command<P = unknown>(cmd: CommandInput): Promise<CommandResult<P>> {
    return this.request<CommandResult<P>>({ op: 'command', cmd: { country: '', ...cmd } as Command });
  }
  preview<P = unknown>(cmd: CommandInput): Promise<Validation<P>> {
    return this.request<Validation<P>>({ op: 'preview', cmd: { country: '', ...cmd } as Command });
  }
  query<T = unknown>(name: QueryName, ...args: unknown[]): Promise<T> {
    return this.request<T>({ op: 'query', name, args });
  }
  setClock(c: { paused?: boolean; speed?: number; interrupts?: InterruptPrefs }) {
    return this.request({ op: 'clock', ...c });
  }
  step(minutes: number) {
    return this.request<{ tick: number }>({ op: 'step', minutes });
  }
  nextEvent(maxMinutes = 1440) {
    return this.request<{ tick: number; advanced: number }>({ op: 'nextEvent', maxMinutes });
  }
  save(reason = 'manual', force = false) {
    if (!this.store.get().frame) return Promise.resolve(null);
    this.store.patch({ saving: true });
    return this.request<SaveInfo>({ op: 'save', reason, force });
  }
  exportJson() {
    return this.request<string>({ op: 'export' });
  }
  validateJson(json: string) {
    return this.request<{ ok: boolean; nation: string; nationName: string; tick: number; day: number; seed: number; difficulty: string }>({ op: 'validateJson', json });
  }
  importJson(json: string, campaignId: string, name: string) {
    return this.request<{ ok: boolean; campaignId: string }>({ op: 'importJson', json, campaignId, name });
  }
  ui(action: UiAction) {
    return this.request({ op: 'ui', action });
  }
  hash() {
    return this.request<{ hash: string; rng: { seed: number; counter: number }; tick: number }>({ op: 'hash' });
  }
  setReadOnly(readOnly: boolean) {
    return this.request({ op: 'setReadOnly', readOnly });
  }
  dismissInterrupt(id: string) {
    this.store.patch({ interrupts: this.store.get().interrupts.filter((i) => i.id !== id) });
  }
}

let singleton: SimHost | null = null;
export function getHost(): SimHost {
  if (!singleton) singleton = new SimHost();
  return singleton;
}
