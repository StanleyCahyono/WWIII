/** Campaign session flows shared by the title/new/load screens and the in-game menus. */
import { getHost } from './sim/host';
import { ui, centerOn, toast } from './state/ui';
import { prefs, setPrefs } from './persist/prefs';
import { getCampaign, newId, type CampaignMeta } from './persist/db';
import { MAP, countryName } from './data/static';
import { SPEED_BASE } from './sim/protocol';

export function centerOnCapital(country: string | null | undefined, zoom = 18) {
  if (!country) return;
  const mc = MAP.countryById.get(country);
  const cap = mc ? MAP.cityByKey.get(mc.capital) : undefined;
  if (cap) centerOn(cap.lonlat[0], cap.lonlat[1], zoom);
  else if (mc) centerOn(mc.labelAt[0], mc.labelAt[1], zoom);
}

function resetGameUi() {
  ui.patch({ panel: null, panelArg: null, panelStack: [], selection: null, lostSelection: null, mode: { kind: 'idle' }, toasts: [], chooser: null, contextMenu: null, previewMarker: null, pinned: [] });
}

export async function startNewCampaign(country: string, seed: number, difficulty: 'easy' | 'normal' | 'hard'): Promise<string> {
  const host = getHost();
  const id = newId('wc');
  const name = `${countryName(country)} · seed ${seed}`;
  resetGameUi();
  await host.newGame(country, seed, difficulty, id, name);
  setPrefs({ lastCampaign: id });
  await host.setClock({ paused: true, speed: prefs.get().speed, interrupts: prefs.get().interrupts });
  centerOnCapital(country, 18);
  ui.patch({ screen: 'game', briefingOpen: true, tutorialOpen: false });
  return id;
}

export type OpenOutcome = { ok: true } | { ok: false; locked: true } | { ok: false; error: string };

export async function openCampaign(id: string, opts: { readOnly?: boolean; takeOver?: boolean } = {}): Promise<OpenOutcome> {
  const host = getHost();
  try {
    if (!opts.readOnly) {
      const got = opts.takeOver ? await host.takeOver(id) : await host.acquireLock(id);
      if (!got) return { ok: false, locked: true };
    }
    const meta = await getCampaign(id);
    let catchUp = 0;
    const p = prefs.get();
    if (meta && p.catchUp.enabled && !meta.completed && !opts.readOnly) {
      const elapsedSec = Math.max(0, (Date.now() - meta.savedAt) / 1000);
      catchUp = Math.min(Math.floor(elapsedSec * SPEED_BASE), p.catchUp.maxHours * 60);
    }
    resetGameUi();
    const r = await host.open(id, { readOnly: opts.readOnly, catchUpMinutes: catchUp });
    setPrefs({ lastCampaign: id });
    await host.setClock({ paused: true, speed: p.speed, interrupts: p.interrupts });
    centerOnCapital(meta?.nation ?? host.store.get().frame?.meta.humanCountry, 18);
    ui.patch({ screen: 'game', briefingOpen: false });
    if (r.caughtUp > 0) toast({ text: `Catch-up: simulated ${Math.round(r.caughtUp / 60)} game hours of closed-app time (maximum ${p.catchUp.maxHours} h). Paused.`, node: null, kind: 'catchup', level: 'info' });
    if (r.reviewMode) ui.patch({ panel: 'end' });
    if (opts.readOnly) toast({ text: 'Opened read-only: another tab is writing this campaign. Nothing you do here will be saved.', node: null, kind: 'readonly', level: 'warn' });
    return { ok: true };
  } catch (e) {
    host.releaseLock();
    return { ok: false, error: (e as Error).message };
  }
}

export async function leaveToTitle() {
  const host = getHost();
  try {
    await host.setClock({ paused: true });
    await host.save('return to title');
  } catch {
    /* ignore */
  }
  await host.close();
  resetGameUi();
  ui.patch({ screen: 'title' });
}

export function campaignLabel(m: CampaignMeta): string {
  return `${m.nationName || m.nation} · Day ${m.day} · ${m.difficulty}`;
}
