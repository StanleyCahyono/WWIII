/**
 * Tiny IndexedDB wrapper for campaign saves. Usable from the main thread and the sim worker.
 *  - `campaigns`: lightweight metadata rows (listed on the title screen without loading saves)
 *  - `saves`: full serialized save JSON per campaign (single current save per campaign)
 *  - `checkpoints`: recovery copies (failed writes, revision conflicts, pre-import backups)
 * Preferences are NOT stored here (see prefs.ts → localStorage).
 */
export const DB_NAME = 'world-command';
export const DB_VERSION = 1;

export interface CampaignMeta {
  id: string;
  name: string;
  archived: boolean;
  createdAt: number;
  savedAt: number;
  nation: string;
  nationName: string;
  day: number;
  tick: number;
  time: string;
  difficulty: string;
  score: number;
  target: number;
  seed: number;
  revision: number;
  completed: boolean;
  formatVersion: number;
  scenarioVersion: string;
  bytes: number;
}

export interface SaveRow {
  id: string;
  json: string;
  revision: number;
  savedAt: number;
}

export interface CheckpointRow {
  id: string;
  campaignId: string;
  json: string;
  at: number;
  reason: string;
}

let dbp: Promise<IDBDatabase> | null = null;

export function storageAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

export function openDb(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise<IDBDatabase>((resolve, reject) => {
    if (!storageAvailable()) return reject(new Error('IndexedDB is not available in this browser context.'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('campaigns')) db.createObjectStore('campaigns', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('saves')) db.createObjectStore('saves', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('checkpoints')) {
        const s = db.createObjectStore('checkpoints', { keyPath: 'id' });
        s.createIndex('campaignId', 'campaignId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open IndexedDB.'));
    req.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab.'));
  });
  dbp.catch(() => {
    dbp = null;
  });
  return dbp;
}

function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => T | Promise<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(stores, mode);
        let out: T;
        Promise.resolve(fn(t)).then((v) => (out = v), reject);
        t.oncomplete = () => resolve(out);
        t.onerror = () => reject(t.error ?? new Error('IndexedDB transaction failed.'));
        t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted (storage full?).'));
      }),
  );
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function listCampaigns(): Promise<CampaignMeta[]> {
  return tx(['campaigns'], 'readonly', async (t) => {
    const all = await req(t.objectStore('campaigns').getAll() as IDBRequest<CampaignMeta[]>);
    return all.sort((a, b) => b.savedAt - a.savedAt);
  });
}

export async function getCampaign(id: string): Promise<CampaignMeta | undefined> {
  return tx(['campaigns'], 'readonly', (t) => req(t.objectStore('campaigns').get(id) as IDBRequest<CampaignMeta | undefined>));
}

export async function getSave(id: string): Promise<SaveRow | undefined> {
  return tx(['saves'], 'readonly', (t) => req(t.objectStore('saves').get(id) as IDBRequest<SaveRow | undefined>));
}

/** Atomically write save + metadata in one transaction. */
export async function putSave(meta: CampaignMeta, json: string): Promise<void> {
  await tx(['campaigns', 'saves'], 'readwrite', (t) => {
    t.objectStore('saves').put({ id: meta.id, json, revision: meta.revision, savedAt: meta.savedAt } satisfies SaveRow);
    t.objectStore('campaigns').put(meta);
  });
}

export async function updateMeta(id: string, patch: Partial<CampaignMeta>): Promise<void> {
  await tx(['campaigns'], 'readwrite', async (t) => {
    const s = t.objectStore('campaigns');
    const cur = (await req(s.get(id) as IDBRequest<CampaignMeta | undefined>)) as CampaignMeta | undefined;
    if (cur) s.put({ ...cur, ...patch });
  });
}

export async function deleteCampaign(id: string): Promise<void> {
  await tx(['campaigns', 'saves'], 'readwrite', (t) => {
    t.objectStore('campaigns').delete(id);
    t.objectStore('saves').delete(id);
  });
}

export async function putCheckpoint(row: CheckpointRow): Promise<void> {
  await tx(['checkpoints'], 'readwrite', (t) => {
    t.objectStore('checkpoints').put(row);
  });
}

export async function listCheckpoints(campaignId?: string): Promise<Omit<CheckpointRow, 'json'>[]> {
  return tx(['checkpoints'], 'readonly', async (t) => {
    const all = (await req(t.objectStore('checkpoints').getAll() as IDBRequest<CheckpointRow[]>)) as CheckpointRow[];
    return all.filter((c) => !campaignId || c.campaignId === campaignId).map(({ json: _j, ...rest }) => rest).sort((a, b) => b.at - a.at);
  });
}

export async function getCheckpoint(id: string): Promise<CheckpointRow | undefined> {
  return tx(['checkpoints'], 'readonly', (t) => req(t.objectStore('checkpoints').get(id) as IDBRequest<CheckpointRow | undefined>));
}

export async function deleteCheckpoint(id: string): Promise<void> {
  await tx(['checkpoints'], 'readwrite', (t) => {
    t.objectStore('checkpoints').delete(id);
  });
}

export function newId(prefix = 'c'): string {
  const r = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.floor(Math.random() * 1e8).toString(36);
  return `${prefix}-${Date.now().toString(36)}-${r}`;
}

/** Ask the browser to keep our storage (best effort). Returns persisted state. */
export async function requestPersistence(): Promise<{ persisted: boolean | null; estimate: { usage?: number; quota?: number } | null }> {
  try {
    const sm = (navigator as Navigator & { storage?: StorageManager }).storage;
    if (!sm) return { persisted: null, estimate: null };
    let persisted = (await sm.persisted?.()) ?? null;
    if (!persisted && sm.persist) persisted = await sm.persist();
    const estimate = sm.estimate ? await sm.estimate() : null;
    return { persisted, estimate };
  } catch {
    return { persisted: null, estimate: null };
  }
}
