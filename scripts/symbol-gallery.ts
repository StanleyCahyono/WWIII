/**
 * Symbol gallery generator — `npm run gallery`.
 *
 * Writes:
 *   docs/gallery/index.html     offline, self-contained (inline SVG + CSS, no network)
 *   docs/gallery/manifest.json  key → variant → SIDC → meaning → SHA-256 of the SVG
 *
 * The manifest is the review artifact for renderer or crosswalk upgrades: any icon change
 * shows up as a hash diff. Output is deterministic (no timestamps).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SYMBOL_CROSSWALK,
  SYMBOL_CROSSWALK_VERSION,
  SYMBOL_EDITION,
  UNIT_TYPES,
  clearAssetValidationErrors,
  getAssetValidationErrors,
  resolveSymbol,
  type Affiliation,
  type BuildSidcOptions,
} from '../src/data/catalog';
import { RENDERER, renderSymbol, type RenderSymbolOptions } from '../src/data/catalog/symbol-render';
import type { SymbolCrosswalkEntry } from '../src/engine/data-types';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'docs/gallery');

const AFF_LABEL: Record<Affiliation, string> = {
  friend: 'Friendly',
  hostile: 'Hostile',
  neutral: 'Neutral',
  unknown: 'Unknown-affiliation',
  pending: 'Pending',
  assumed_friend: 'Assumed-friend',
  suspect: 'Suspect',
};
const FRAME_NOTE: Record<string, string> = {
  friend: 'rectangle/rounded frame, blue',
  hostile: 'diamond/pointed frame, red',
  neutral: 'square frame, green',
  unknown: 'quatrefoil/cloverleaf frame, yellow',
};
const MAIN_AFFILIATIONS: Affiliation[] = ['friend', 'hostile', 'neutral', 'unknown'];

interface Sample {
  id: string;
  key: string;
  variant: string;
  sidc: string;
  meaning: string;
  svg: string;
  hash: string;
}

const samples: Sample[] = [];

function sample(
  entry: SymbolCrosswalkEntry,
  variant: string,
  build: BuildSidcOptions,
  render: RenderSymbolOptions,
  meaning: string,
): Sample {
  const r = resolveSymbol(entry.key, build);
  const out = renderSymbol(r.sidc, { size: 36, ...render });
  if (!out.valid) throw new Error(`gallery: ${entry.key} ${variant} failed to render: ${out.error}`);
  const s: Sample = {
    id: `${entry.key}#${variant}`,
    key: entry.key,
    variant,
    sidc: r.sidc,
    meaning,
    svg: out.svg,
    hash: createHash('sha256').update(out.svg).digest('hex'),
  };
  samples.push(s);
  return s;
}

const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function figure(s: Sample): string {
  return `<figure title="${esc(s.meaning)} — SIDC ${s.sidc}"><div class="sym">${s.svg}</div><figcaption>${esc(s.meaning)}<code>${s.sidc}</code></figcaption></figure>`;
}

clearAssetValidationErrors();

// ── 1. Every supported entity × four affiliations ──
const groups = new Map<string, SymbolCrosswalkEntry[]>();
for (const e of SYMBOL_CROSSWALK) {
  const g = e.key.split('.').slice(0, 2).join('.');
  groups.set(g, [...(groups.get(g) ?? []), e]);
}
const unitNames = new Map<string, string[]>();
for (const u of UNIT_TYPES) unitNames.set(u.symbol, [...(unitNames.get(u.symbol) ?? []), u.name]);

const mainRows: string[] = [];
for (const [g, entries] of groups) {
  mainRows.push(`<tr class="group"><th colspan="5">${esc(g)}</th></tr>`);
  for (const e of entries) {
    const cells = MAIN_AFFILIATIONS.map(
      (a) => `<td>${figure(sample(e, a, { affiliation: a, status: 'present' }, {}, `${AFF_LABEL[a]} ${lc(e.meaning)}`))}</td>`,
    );
    const names = unitNames.get(e.key);
    mainRows.push(
      `<tr><th scope="row"><b>${esc(e.meaning)}</b><br><code>${esc(e.key)}</code>${names ? `<br><small>${esc(names.join(', '))}</small>` : ''}</th>${cells.join('')}</tr>`,
    );
  }
}

// ── 2. States: planned, selected, damaged, stale, monochrome, HQ/designation ──
const representatives = [
  'land.infantry.motorized',
  'land.armor.mbt',
  'land.support.sp_artillery',
  'land.air_defense.sam',
  'land.recon.radar',
  'land.missile.ballistic_launcher',
  'land.officer.armored',
  'land.deployable.ugv',
  'air.helicopter.attack',
  'air.fighter.air_superiority',
  'air.heavy.awacs',
  'air.recon.broad_area',
  'sea.naval.destroyer',
  'sea.naval.carrier',
  'subsurface.submarine.attack',
  'installation.air_base',
  'installation.naval_base',
  'contact.land',
  'contact.air',
  'contact.sea',
  'contact.subsurface',
  'event.missile.cruise',
  'event.missile.hgv',
];
const byKey = new Map(SYMBOL_CROSSWALK.map((e) => [e.key, e]));
const stateRows: string[] = [];
for (const key of representatives) {
  const e = byKey.get(key)!;
  const m = lc(e.meaning);
  const isContact = e.domain === 'contact';
  const isEvent = e.key.startsWith('event.');
  const cells: string[] = [];
  // planned: not meaningful for an observed contact or an in-flight event
  cells.push(isContact || isEvent ? '<td class="na">n/a — a contact/event is observed, never planned</td>'
    : `<td>${figure(sample(e, 'planned', { affiliation: 'friend', status: 'planned' }, {}, `Friendly ${m}, planned/anticipated (dashed frame)`))}</td>`);
  cells.push(`<td>${figure(sample(e, 'selected', { affiliation: 'hostile', status: 'present' }, { selected: true }, `Hostile ${m}, currently selected (game ring overlay)`))}</td>`);
  cells.push(isContact || isEvent ? '<td class="na">n/a — condition unknown for unidentified contacts/events</td>'
    : `<td>${figure(sample(e, 'damaged', { affiliation: 'friend', status: 'damaged' }, {}, `Friendly ${m}, damaged (operational-condition bar)`))}</td>`);
  cells.push(isEvent ? '<td class="na">n/a — events are reported once, not aged</td>'
    : `<td>${figure(sample(e, 'stale', { affiliation: 'hostile', status: 'present' }, { staleMinutes: 6 * 60, muted: true }, `Hostile ${m}, last observed 6 h ago (age badge, muted)`))}</td>`);
  cells.push(`<td>${figure(sample(e, 'mono-unknown', { affiliation: 'unknown', status: 'present' }, { monochrome: true }, `Unknown-affiliation ${m}, monochrome`))}</td>`);
  stateRows.push(`<tr><th scope="row"><b>${esc(e.meaning)}</b><br><code>${esc(e.key)}</code></th>${cells.join('')}</tr>`);
}

// ── 3. Monochrome frames for all four affiliations (frame shape alone must carry identity) ──
const monoCells: string[] = [];
for (const key of ['land.infantry.motorized', 'air.fighter.strike', 'sea.naval.frigate', 'subsurface.submarine.attack']) {
  const e = byKey.get(key)!;
  const figs = MAIN_AFFILIATIONS.map((a) =>
    figure(sample(e, `mono-${a}`, { affiliation: a, status: 'present' }, { monochrome: true }, `${AFF_LABEL[a]} ${lc(e.meaning)}, monochrome (${FRAME_NOTE[a].split(',')[0]})`)),
  );
  monoCells.push(`<tr><th scope="row">${esc(e.meaning)}</th>${figs.map((f) => `<td>${f}</td>`).join('')}</tr>`);
}

// ── 4. Legend pair, HQ + designation, extra identities, fail-safe ──
const legend = [
  figure(sample(byKey.get('land.infantry.motorized')!, 'legend', { affiliation: 'friend', status: 'present' }, {}, 'Infantry (friendly motorized infantry)')),
  figure(sample(byKey.get('land.armor.mbt')!, 'legend', { affiliation: 'friend', status: 'present' }, {}, 'Armor (friendly main battle tanks)')),
];
const extras = [
  figure(sample(byKey.get('land.infantry.mechanized')!, 'echelon-designation', { affiliation: 'friend', status: 'present', echelon: 'battalion' }, { designation: '2-14', higherFormation: '3 BDE' },
    'Friendly mechanized infantry battalion "2-14" of 3 BDE (verified echelon; designation and higher formation outside the frame)')),
  figure(sample(byKey.get('land.officer.infantry')!, 'hq', { affiliation: 'friend', status: 'present' }, { designation: 'CDR' }, 'Friendly infantry headquarters (officer) with HQ staff')),
  figure(sample(byKey.get('land.infantry.motorized')!, 'assumed_friend', { affiliation: 'assumed_friend', status: 'present' }, {}, 'Assumed-friend motorized infantry')),
  figure(sample(byKey.get('land.infantry.motorized')!, 'suspect', { affiliation: 'suspect', status: 'present' }, {}, 'Suspect motorized infantry')),
  figure(sample(byKey.get('land.infantry.motorized')!, 'pending', { affiliation: 'pending', status: 'present' }, {}, 'Pending-identity motorized infantry')),
];
const fsResolved = resolveSymbol('sea.naval.battleship', { affiliation: 'hostile', status: 'present' });
const fsSvg = renderSymbol(fsResolved.sidc, { size: 36 }).svg;
const failsafe = {
  id: 'failsafe#unknown-key',
  key: 'sea.naval.battleship (not in crosswalk)',
  variant: 'failsafe',
  sidc: fsResolved.sidc,
  meaning: 'Unknown key → hostile generic SURFACE contact + asset-validation error (never infantry)',
  svg: fsSvg,
  hash: createHash('sha256').update(fsSvg).digest('hex'),
};
samples.push(failsafe);
const failsafeErrors = getAssetValidationErrors().map((x) => `${x.key}: ${x.reason} → ${x.fallbackKey}`);

// ── HTML ──
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Symbol Gallery</title>
<style>
:root { --bg:#f6f6f3; --fg:#1b1d21; --muted:#5d6370; --line:#d6d6d0; --card:#fff; }
* { box-sizing:border-box; }
body { margin:0; padding:16px 24px 48px; background:var(--bg); color:var(--fg); font:14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
h1 { font-size:22px; margin:0 0 4px; } h2 { font-size:17px; margin:32px 0 8px; border-bottom:1px solid var(--line); padding-bottom:4px; }
p, li { max-width:72em; color:var(--fg); } .meta { color:var(--muted); }
table { border-collapse:collapse; background:var(--card); width:100%; }
th, td { border:1px solid var(--line); padding:6px; vertical-align:top; text-align:left; }
thead th { background:#ecece6; position:sticky; top:0; z-index:1; }
tr.group th { background:#e3e6ea; font-family:ui-monospace, monospace; }
th[scope=row] { width:22%; font-weight:normal; }
figure { margin:0; display:flex; flex-direction:column; align-items:center; gap:4px; }
.sym { min-height:60px; display:flex; align-items:center; justify-content:center; }
figcaption { font-size:11.5px; text-align:center; color:var(--fg); max-width:22em; }
figcaption code, th code { display:block; color:var(--muted); font-size:10.5px; }
td.na { color:var(--muted); font-size:11.5px; font-style:italic; text-align:center; vertical-align:middle; }
.row { display:flex; flex-wrap:wrap; gap:24px; background:var(--card); border:1px solid var(--line); padding:12px; }
.gray .sym { filter:grayscale(1); }
.overflow { overflow-x:auto; }
</style>
</head>
<body>
<h1>World Command: World 120 — symbol gallery</h1>
<p class="meta">Edition: ${esc(SYMBOL_EDITION)} · Crosswalk ${esc(SYMBOL_CROSSWALK_VERSION)} · Renderer ${RENDERER.name} ${RENDERER.version} (${RENDERER.license}, bundled; APP6 flag) · ${samples.length} samples · generated offline by <code>npm run gallery</code>. Every image is an inline SVG; this page makes no network requests.</p>

<h2>Legend</h2>
<div class="row">${legend.join('')}</div>

<h2>Game-only overlays (deliberate, outside the standard frame)</h2>
<ul>
<li><b>Selection ring</b> — yellow ring with a dark outline drawn around the symbol. Never changes the identity frame, fill or icon.</li>
<li><b>Age badge</b> — dashed white pill at top-right with the observation age (&lt;1h, Nh, Nd) for stale/historical reports.</li>
<li><b>Muted styling</b> — stale reports are drawn at reduced opacity. Geometry is unchanged, so it stays distinguishable from both selection (ring) and disabled UI.</li>
<li>Standard amplifiers drawn by the renderer (not game overlays): planned = dashed frame (status digit 1); damaged = operational-condition bar (status 3); HQ staff (HQ digit 2, officers only); echelon above the frame (land units, verified echelon only — never inferred from stack count); unique designation and higher formation beside the frame.</li>
<li>Unidentified contacts use a symbol-set frame with no entity icon, no modifiers, no echelon and no HQ, so no hidden branch is encoded.</li>
</ul>

<h2>Every supported entity under four affiliations (present)</h2>
<p>Expected frames: friendly ${FRAME_NOTE.friend}; hostile ${FRAME_NOTE.hostile}; neutral ${FRAME_NOTE.neutral}; unknown ${FRAME_NOTE.unknown}. Air, surface, subsurface, equipment and installation symbols use the edition's domain-specific variants of those frames.</p>
<div class="overflow"><table>
<thead><tr><th>Entity</th><th>Friend</th><th>Hostile</th><th>Neutral</th><th>Unknown</th></tr></thead>
<tbody>
${mainRows.join('\n')}
</tbody></table></div>

<h2>Independent states (where semantically allowed)</h2>
<div class="overflow"><table>
<thead><tr><th>Entity</th><th>Planned</th><th>Selected</th><th>Damaged</th><th>Stale (6 h)</th><th>Monochrome</th></tr></thead>
<tbody>
${stateRows.join('\n')}
</tbody></table></div>

<h2>Monochrome legibility (frame shape alone carries identity)</h2>
<div class="overflow"><table>
<thead><tr><th>Entity</th><th>Friend</th><th>Hostile</th><th>Neutral</th><th>Unknown</th></tr></thead>
<tbody>
${monoCells.join('\n')}
</tbody></table></div>

<h2>Grayscale check (colour removed by filter)</h2>
<div class="row gray">${MAIN_AFFILIATIONS.map((a) => figure(samples.find((s) => s.id === `land.armor.mbt#${a}`)!)).join('')}</div>

<h2>Designation, HQ and extended identities</h2>
<div class="row">${extras.join('')}</div>

<h2>Fail-safe</h2>
<div class="row">${figure(failsafe)}</div>
<p class="meta">Recorded asset-validation error: ${esc(failsafeErrors.join('; '))}</p>
</body>
</html>
`;

mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'index.html'), html);
const manifest = {
  edition: SYMBOL_EDITION,
  crosswalkVersion: SYMBOL_CROSSWALK_VERSION,
  renderer: RENDERER,
  standardFlag: 'APP6',
  size: 36,
  samples: samples
    .map(({ id, key, variant, sidc, meaning, hash }) => ({ id, key, variant, sidc, meaning, svgSha256: hash }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
};
writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`gallery: ${samples.length} samples, ${SYMBOL_CROSSWALK.length} crosswalk entries → docs/gallery/index.html, manifest.json`);
