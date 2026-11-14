/// <reference lib="webworker" />
/**
 * Simulation worker: owns the authoritative GameState, runs the clock, validates/applies
 * commands, answers viewer-scoped queries, and persists saves to IndexedDB.
 * The UI only ever receives the human country's filtered CountryView.
 */
import * as A from '../ui/sim/engine-adapter';
import type { GameState, Scenario } from '../ui/sim/engine-adapter';
import type { Envelope, Frame, InterruptPrefs, Push, Request, Response, SaveInfo, ClockState } from '../ui/sim/protocol';
import { SPEED_BASE } from '../ui/sim/protocol';
import { getCampaign, getSave, putCheckpoint, putSave, newId, type CampaignMeta } from '../ui/persist/db';

declare const self: DedicatedWorkerGlobalScope;

let scenario: Scenario | null = null;
let state: GameState | null = null;
let viewer: string | null = null;
let campaignId: string | null = null;
let campaignName = '';
let createdAt = 0;
let readOnly = false;
let knownRevision = 0;
let dirty = false;
let lastSaveWall = 0;
let seq = 0;
let debugEnabled = false;

const clock: ClockState = { paused: true, speed: 1, effective: 0, behind: false };
let interrupts: InterruptPrefs = { war: true, capital: true, end: true, other: false };
let acc = 0;
let lastLoop = 0;
let loopTimer: ReturnType<typeof setTimeout> | null = null;
let lastFrameAt = 0;
let effWindow: { t: number; ticks: number }[] = [];
let eventsSeen = 0;

const AUTOSAVE_MS = 60_000;
const FRAME_MS = 120;
const CHUNK_BUDGET_MS = 28;

function post(m: Push | Response) {
  self.postMessage(m);
}

function log(level: 'info' | 'warn' | 'error', message: string) {
  post({ type: 'log', level, message });
}

function buildFrame(): Frame | null {
  if (!state || !viewer) return null;
  const v = A.view(state, viewer);
  return {
    view: v,
    drawings: state.ui.planning.filter((d) => d.author === viewer).map((d) => ({ ...d, points: d.points.map((p) => [p[0], p[1]] as [number, number]) })),
    uiPrefs: { ...state.ui.prefs },
    meta: {
      campaignId,
      campaignName,
      seed: state.seed,
      difficulty: state.meta.difficulty,
      humanCountry: state.meta.humanCountry,
      startDate: state.meta.startDate,
      saveRevision: state.meta.saveRevision,
      scenarioVersion: state.scenarioVersion,
      formatVersion: state.schemaVersion,
      reviewMode: !!state.score.result,
      readOnly,
    },
    clock: { ...clock },
    seq: ++seq,
  };
}

function pushFrame() {
  const f = buildFrame();
  if (f) post({ type: 'frame', frame: f });
  lastFrameAt = performance.now();
}

function metaFor(s: GameState, bytes: number): CampaignMeta {
  const v = viewer ? s.countries[viewer] : null;
  const sc = viewer ? A.query(s, viewer, 'scoreBreakdown') as { mine: number; thresholds: { solo: number } } : null;
  return {
    id: campaignId!,
    name: campaignName,
    archived: false,
    createdAt,
    savedAt: Date.now(),
    nation: viewer ?? '',
    nationName: v?.name ?? '',
    day: A.dayOf(s.clock.tick),
    tick: s.clock.tick,
    time: A.formatGameTime(s.clock.tick, s.meta.startDate),
    difficulty: s.meta.difficulty,
    score: sc?.mine ?? 0,
    target: sc?.thresholds.solo ?? 0,
    seed: s.seed,
    revision: s.meta.saveRevision,
    completed: !!s.score.result,
    formatVersion: s.schemaVersion,
    scenarioVersion: s.scenarioVersion,
    bytes,
  };
}

async function save(reason: string, force = false): Promise<SaveInfo> {
  const t0 = performance.now();
  if (!state || !campaignId) return { ok: false, at: Date.now(), revision: 0, bytes: 0, ms: 0, reason, error: 'No campaign open.' };
  if (readOnly) return { ok: false, at: Date.now(), revision: state.meta.saveRevision, bytes: 0, ms: 0, reason, error: 'This tab is read-only (the campaign is open for writing in another tab).' };
  let json = '';
  try {
    const stored = await getCampaign(campaignId);
    if (stored && stored.revision > knownRevision && !force) {
      // Another writer saved newer progress — never overwrite silently.
      json = A.serialize(state);
      const recoveryId = newId('conflict');
      await putCheckpoint({ id: recoveryId, campaignId, json, at: Date.now(), reason: `Revision conflict: stored r${stored.revision} > this tab r${knownRevision}` });
      const info: SaveInfo = { ok: false, at: Date.now(), revision: state.meta.saveRevision, bytes: json.length, ms: performance.now() - t0, reason, error: 'A newer save exists (another tab or window). Your progress was kept as a recovery copy.', conflict: { storedRevision: stored.revision, myRevision: knownRevision, recoveryId } };
      clock.paused = true;
      return info;
    }
    const existingMeta = stored;
    A.markSaved(state);
    json = A.serialize(state);
    const meta = metaFor(state, json.length);
    if (existingMeta) {
      meta.archived = existingMeta.archived;
      meta.createdAt = existingMeta.createdAt;
      meta.name = existingMeta.name;
    }
    await putSave(meta, json);
    knownRevision = state.meta.saveRevision;
    dirty = false;
    lastSaveWall = Date.now();
    return { ok: true, at: Date.now(), revision: knownRevision, bytes: json.length, ms: performance.now() - t0, reason };
  } catch (e) {
    const msg = (e as Error).message || String(e);
    try {
      if (json) await putCheckpoint({ id: newId('recovery'), campaignId, json, at: Date.now(), reason: `Failed write: ${msg}` });
    } catch {
      /* storage unavailable */
    }
    return { ok: false, at: Date.now(), revision: state.meta.saveRevision, bytes: json.length, ms: performance.now() - t0, reason, error: `Save failed: ${msg}` };
  }
}

async function saveAndNotify(reason: string, force = false) {
  const info = await save(reason, force);
  post({ type: 'saved', info });
  if (info.conflict) pushFrame();
  return info;
}

function checkInterrupts(from: number): boolean {
  if (!state || !viewer) return false;
  const hits: { id: string; kind: string; text: string; node: number | null }[] = [];
  for (let i = from; i < state.events.length; i++) {
    const e = state.events[i];
    if (!e.interrupt.includes(viewer)) continue;
    const k = e.kind;
    const cat = k === 'war_declared' ? 'war' : k.includes('capital') || (k === 'city_captured' && /capital/i.test(e.private[viewer]?.text ?? '')) ? 'capital' : k === 'campaign_end' || k === 'country_eliminated' ? 'end' : k.includes('city_captured') ? 'capital' : 'other';
    if (!interrupts[cat as keyof InterruptPrefs]) continue;
    hits.push({ id: e.id, kind: k, text: e.private[viewer]?.text ?? e.public?.headline ?? k, node: e.node });
  }
  if (hits.length) {
    post({ type: 'interrupt', events: hits });
    return true;
  }
  return false;
}

function runFor(minutes: number) {
  if (!state) return;
  const host = hostCache;
  const start = state.events.length;
  A.advance(state, minutes, host ?? undefined);
  dirty = true;
  const hit = checkInterrupts(start);
  eventsSeen = state.events.length;
  if (hit || state.score.result) {
    clock.paused = true;
  }
}

let hostCache: Awaited<ReturnType<typeof A.loadAiHost>>['host'] | null = null;

function loop() {
  loopTimer = null;
  if (!state || clock.paused) return;
  const now = performance.now();
  const dt = Math.min(500, now - lastLoop);
  lastLoop = now;
  acc += (clock.speed * SPEED_BASE * dt) / 1000;
  const cap = Math.max(15, clock.speed * SPEED_BASE * 0.5);
  clock.behind = acc > cap;
  if (acc > cap) acc = cap; // drop time we cannot simulate (never spiral)
  const t0 = performance.now();
  let ran = 0;
  while (acc >= 1 && performance.now() - t0 < CHUNK_BUDGET_MS && !clock.paused) {
    // advance to (at most) the next 15-minute step boundary so each chunk is bounded
    const tick = state.clock.tick;
    const toBoundary = 15 - (tick % 15);
    const m = Math.max(1, Math.min(Math.floor(acc), toBoundary));
    runFor(m);
    acc -= m;
    ran += m;
  }
  effWindow.push({ t: now, ticks: ran });
  effWindow = effWindow.filter((w) => now - w.t < 1000);
  const span = Math.max(250, now - (effWindow[0]?.t ?? now));
  clock.effective = Math.round((effWindow.reduce((a, w) => a + w.ticks, 0) * 1000) / span);
  if (now - lastFrameAt > FRAME_MS || clock.paused) pushFrame();
  if (clock.paused) {
    clock.effective = 0;
    pushFrame();
    void saveAndNotify('pause');
    return;
  }
  if (dirty && Date.now() - lastSaveWall > AUTOSAVE_MS) void saveAndNotify('autosave');
  loopTimer = setTimeout(loop, 4);
}

function startLoop() {
  if (loopTimer || clock.paused) return;
  lastLoop = performance.now();
  loopTimer = setTimeout(loop, 0);
}

async function ensureScenario() {
  if (!scenario) scenario = await A.loadScenario();
  if (!hostCache) {
    const h = await A.loadAiHost();
    hostCache = h.host;
    log('info', `AI controllers: ${h.source}`);
  }
  return scenario;
}

function resetSession() {
  clock.paused = true;
  clock.effective = 0;
  acc = 0;
  dirty = false;
  if (loopTimer) clearTimeout(loopTimer);
  loopTimer = null;
}

async function handle(req: Request): Promise<unknown> {
  switch (req.op) {
    case 'init': {
      const sc = await ensureScenario();
      return { id: sc.id, name: sc.name, seats: sc.seats.length, version: sc.version, formatVersion: A.SAVE_FORMAT_VERSION };
    }
    case 'previews': {
      const sc = await ensureScenario();
      return A.countryPreviews(sc);
    }
    case 'newGame': {
      const sc = await ensureScenario();
      resetSession();
      state = A.createCampaign(sc, req.country, req.seed >>> 0, req.difficulty);
      viewer = req.country;
      campaignId = req.campaignId;
      campaignName = req.name;
      createdAt = Date.now();
      readOnly = false;
      knownRevision = 0;
      eventsSeen = state.events.length;
      const info = await save('new campaign', true);
      post({ type: 'saved', info });
      pushFrame();
      return { ok: true, save: info };
    }
    case 'open': {
      await ensureScenario();
      const row = await getSave(req.campaignId);
      const meta = await getCampaign(req.campaignId);
      if (!row || !meta) throw new Error('Save not found.');
      const s = A.deserialize(row.json); // throws SaveError; current state untouched
      resetSession();
      state = s;
      viewer = s.meta.humanCountry;
      campaignId = req.campaignId;
      campaignName = meta.name;
      createdAt = meta.createdAt;
      readOnly = !!req.readOnly;
      knownRevision = Math.max(row.revision, s.meta.saveRevision);
      eventsSeen = s.events.length;
      let caughtUp = 0;
      if (req.catchUpMinutes && req.catchUpMinutes > 0 && !s.score.result && !readOnly) {
        runFor(Math.floor(req.catchUpMinutes));
        caughtUp = Math.floor(req.catchUpMinutes);
      }
      pushFrame();
      return { ok: true, caughtUp, reviewMode: !!s.score.result };
    }
    case 'validateJson': {
      await ensureScenario();
      const s = A.deserialize(req.json);
      return { ok: true, nation: s.meta.humanCountry, nationName: s.meta.humanCountry ? s.countries[s.meta.humanCountry]?.name : null, tick: s.clock.tick, day: A.dayOf(s.clock.tick), seed: s.seed, difficulty: s.meta.difficulty };
    }
    case 'importJson': {
      await ensureScenario();
      const s = A.deserialize(req.json); // validate in a temporary copy first
      // Store as a new campaign without touching the currently open one.
      const prevState = state, prevViewer = viewer, prevId = campaignId, prevName = campaignName, prevCreated = createdAt, prevKnown = knownRevision;
      try {
        state = s;
        viewer = s.meta.humanCountry;
        campaignId = req.campaignId;
        campaignName = req.name;
        createdAt = Date.now();
        knownRevision = s.meta.saveRevision;
        readOnly = false;
        const info = await save('import', true);
        if (!info.ok) throw new Error(info.error ?? 'Import save failed.');
        return { ok: true, campaignId: req.campaignId };
      } finally {
        state = prevState;
        viewer = prevViewer;
        campaignId = prevId;
        campaignName = prevName;
        createdAt = prevCreated;
        knownRevision = prevKnown;
      }
    }
    case 'close': {
      if (state && dirty && !readOnly) await saveAndNotify('close');
      resetSession();
      state = null;
      viewer = null;
      campaignId = null;
      return { ok: true };
    }
    case 'command': {
      if (!state || !viewer) throw new Error('No campaign open.');
      if (readOnly) return { ok: false, code: 'read_only', reason: 'This tab is read-only; another tab holds the campaign.' };
      const cmd = { ...req.cmd, country: viewer };
      const res = A.submit(state, cmd);
      if (res.ok) dirty = true;
      pushFrame();
      return res;
    }
    case 'preview': {
      if (!state || !viewer) throw new Error('No campaign open.');
      return A.preview(state, { ...req.cmd, country: viewer });
    }
    case 'query': {
      if (!state || !viewer) throw new Error('No campaign open.');
      return A.query(state, viewer, req.name, req.args ?? []);
    }
    case 'clock': {
      if (req.interrupts) interrupts = req.interrupts;
      if (req.speed !== undefined) clock.speed = Math.max(1, Math.min(1024, req.speed));
      if (req.paused !== undefined) {
        const wasRunning = !clock.paused;
        clock.paused = req.paused || !state || !!state?.score.result || readOnly;
        if (clock.paused) {
          clock.effective = 0;
          if (wasRunning && dirty) void saveAndNotify('pause');
        } else startLoop();
      }
      pushFrame();
      return { ...clock };
    }
    case 'step': {
      if (!state) throw new Error('No campaign open.');
      if (readOnly) throw new Error('Read-only tab.');
      clock.paused = true;
      const start = state.events.length;
      A.advance(state, Math.max(0, Math.floor(req.minutes)), hostCache ?? undefined);
      dirty = true;
      checkInterrupts(start);
      pushFrame();
      void saveAndNotify('step');
      return { tick: state.clock.tick };
    }
    case 'nextEvent': {
      if (!state || !viewer) throw new Error('No campaign open.');
      if (readOnly) throw new Error('Read-only tab.');
      clock.paused = true;
      const t0 = state.clock.tick;
      const start = state.events.length;
      A.advanceToNextEvent(state, viewer, req.maxMinutes ?? 1440, hostCache ?? undefined);
      dirty = true;
      checkInterrupts(start);
      pushFrame();
      void saveAndNotify('next event');
      return { tick: state.clock.tick, advanced: state.clock.tick - t0 };
    }
    case 'save':
      return saveAndNotify(req.reason, !!req.force);
    case 'export': {
      if (!state) throw new Error('No campaign open.');
      return A.serialize(state);
    }
    case 'ui': {
      if (!state || !viewer) throw new Error('No campaign open.');
      const a = req.action;
      let r: unknown = null;
      if (a.kind === 'addDrawing') r = A.ui.addDrawing(state, { ...a.drawing, author: viewer });
      else if (a.kind === 'renameDrawing') r = A.ui.renameDrawing(state, a.id, a.name);
      else if (a.kind === 'hideDrawing') r = A.ui.setDrawingHidden(state, a.id, a.hidden);
      else if (a.kind === 'deleteDrawing') r = A.ui.deleteDrawing(state, a.id);
      else if (a.kind === 'setPref') r = A.ui.setPref(state, a.key, a.value);
      dirty = true;
      pushFrame();
      return r;
    }
    case 'hash': {
      if (!state || !viewer) throw new Error('No campaign open.');
      return A.query(state, viewer, 'hashInfo');
    }
    case 'setReadOnly': {
      readOnly = req.readOnly;
      if (readOnly) clock.paused = true;
      else if (campaignId) {
        const stored = await getCampaign(campaignId);
        if (stored) knownRevision = Math.max(knownRevision, stored.revision);
      }
      pushFrame();
      return { readOnly };
    }
    case 'perf':
      return { ok: true };
    case 'debugMissileSetup': {
      if (!debugEnabled || !state || !viewer) throw new Error('Debug operations are disabled.');
      const r = A.debugMissileSetup(state, viewer, req.missile);
      pushFrame();
      return r;
    }
    case 'debugEngage': {
      if (!debugEnabled || !state || !viewer) throw new Error('Debug operations are disabled.');
      const r = A.debugEngage(state, viewer);
      pushFrame();
      return r;
    }
    case 'debugMarketOrder': {
      if (!debugEnabled || !state || !viewer) throw new Error('Debug operations are disabled.');
      const r = A.debugMarketOrder(state, viewer, req.side, req.resource, req.qty, req.price);
      pushFrame();
      return r;
    }
    case 'debugEnable':
      debugEnabled = true;
      return { ok: true };
    case 'debugContact': {
      if (!debugEnabled || !state || !viewer) throw new Error('Debug operations are disabled.');
      const mine = new Set(Object.values(state.stacks).filter((s) => s.owner === viewer).flatMap((s) => s.units.map((u) => u.type)));
      const cands = Object.values(state.stacks).filter((s) => s.owner !== viewer && s.pos.kind === 'node');
      const pick = cands.find((s) => s.units.every((u) => !mine.has(u.type))) ?? cands[0];
      if (!pick || pick.pos.kind !== 'node') throw new Error('No foreign stack.');
      const node = pick.pos.node;
      const m = (await A.loadScenario()).map;
      const ll = m.nodes[node].center as [number, number];
      const table = (state.contacts[viewer] ??= {});
      const domain = pick.moveClass === 'air' ? 'air' : pick.moveClass === 'naval' ? 'sea' : 'land';
      table['kdbg1'] = { id: 'kdbg1', stack: pick.id, level: 'contact', domain, lonlat: [ll[0], ll[1]], node, observedAt: state.clock.tick, firstSeenAt: state.clock.tick, owner: null, count: null, units: null, sources: ['radar'] };
      pushFrame();
      return { contactId: 'kdbg1', hiddenTypes: [...new Set(pick.units.map((u) => u.type))], hiddenOwner: pick.owner, node, lonlat: ll };
    }
  }
}

self.onmessage = async (ev: MessageEvent<Envelope>) => {
  const { id, ...req } = ev.data;
  try {
    const result = await handle(req as Request);
    post({ type: 'response', id, ok: true, result });
  } catch (e) {
    const err = e as Error & { code?: string; details?: unknown };
    post({ type: 'response', id, ok: false, error: err.message || String(e), code: err.code, details: err.details });
  }
};

self.addEventListener('error', (e) => post({ type: 'fatal', message: e.message }));
void eventsSeen;
