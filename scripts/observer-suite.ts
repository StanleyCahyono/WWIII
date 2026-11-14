/**
 * Observer balance suite — `npm run report:observer -- --runs 120 --days 180` (owner: AI agent).
 *
 * Runs seeded, TEST-ONLY AI-observer campaigns (humanCountry = null, all 120 seats driven by the
 * utility planner in src/ai) on the real World 120 map, in parallel worker_threads, and writes
 *   docs/reports/observer-summary.md   human-readable summary + flags
 *   docs/reports/observer-summary.json the same data (per run and per country)
 *
 * Options: --runs N (default 8)  --days D (default 30)  --workers W (default 4)  --seed0 S (default 1)
 *          --long N --long-days D  (additionally run N campaigns at a longer horizon, e.g. 180)
 *          --difficulty easy|normal|hard (default normal)  --out <path prefix>
 * A campaign ends at its documented terminal condition (threshold victory or day-180 settlement)
 * or is reported as "timeout" when the horizon is shorter than the campaign.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';

interface Job { seed: number; days: number; difficulty: 'easy' | 'normal' | 'hard'; cohort: string }
interface CountryRec {
  c: string;
  rank: number;
  alive: boolean;
  eliminatedDay: number | null;
  score: number;
  frac: number;
  finalRank: number;
  coalition: { id: string; size: number; leader: string } | null;
  everCoalition: boolean;
  shortageDays: number;
  stallDays: number;
  /** Stalled: no accepted command on at least half of the simulated days (min 3). */
  stalled: boolean;
  readiness30: number;
  firstActionDay: number | null;
  invalid: number;
  accepted: number;
  opening: string[];
  wars: number;
  captures: number;
}
interface RunRec {
  seed: number;
  cohort: string;
  horizon: number;
  daysRun: number;
  finished: boolean;
  reason: string;
  winner: { kind: 'solo' | 'coalition'; id: string; members: string[]; fraction: number } | null;
  day: number | null;
  msPerDay: number;
  plannerMsPerDay: number;
  wars: number;
  captures: number;
  coalitions: number;
  countries: CountryRec[];
}

// ───────────────────────────── worker ─────────────────────────────

async function runOne(job: Job): Promise<RunRec> {
  const E = await import('../src/engine/index');
  const { loadMapData } = await import('../src/data/map-index');
  const { CATALOG } = await import('../src/data/catalog/index');
  const { MANIFEST } = await import('../src/data/countries');
  const { PROFILES } = await import('../src/data/profiles/index');
  const AI = await import('../src/ai/index');
  AI.setDecisionLogging(false);
  const sc = E.buildWorld120Scenario({ map: loadMapData(), catalog: CATALOG as never, manifest: MANIFEST, profiles: PROFILES });
  const s = E.createCampaign({ seed: job.seed, humanCountry: null, scenario: sc, difficulty: job.difficulty });
  const opening = new Map<string, string[]>();
  const base = AI.UtilityController;
  const ctl = {
    decide(view: Parameters<typeof base.decide>[0], ctx: Parameters<typeof base.decide>[1]) {
      const out = base.decide(view, ctx);
      const l = opening.get(view.viewer) ?? opening.set(view.viewer, []).get(view.viewer)!;
      if (l.length < 4) for (const c of out) {
        if (l.length >= 4) break;
        if (c.type === 'build') l.push(`B:${c.building}`);
        else if (c.type === 'mobilize') l.push(`M:${c.unit}`);
        else if (c.type === 'startResearch') l.push(`R:${c.tech}`);
      }
      return out;
    },
  };
  const order = s.countryOrder;
  const rank = new Map((s.openingPower?.rank ?? order).map((c, i) => [c, i + 1]));
  const shortageDays = new Map<string, number>();
  const stallDays = new Map<string, number>();
  const firstAction = new Map<string, number>();
  const readiness = new Map<string, number>();
  let prevAcc = new Map<string, number>();
  const tot = (c: string) => Object.values(s.countries[c].stats.accepted).reduce((a, b) => a + b, 0);
  const p0 = AI.aiPerf.ms;
  const t0 = performance.now();
  let d = 0;
  for (; d < job.days && !s.score.result; d++) {
    E.advance(s, 1440, { fallback: ctl });
    for (const c of order) {
      const cs = s.countries[c];
      if (!cs.alive) continue;
      if (cs.shortages.length) shortageDays.set(c, (shortageDays.get(c) ?? 0) + 1);
      const a = tot(c);
      if (a > 0 && !firstAction.has(c)) firstAction.set(c, d + 1);
      if (a === (prevAcc.get(c) ?? 0)) stallDays.set(c, (stallDays.get(c) ?? 0) + 1);
    }
    prevAcc = new Map(order.map((c) => [c, tot(c)]));
    if (d + 1 === Math.min(30, job.days)) for (const c of order) {
      const f = E.forceSummary(s, c);
      readiness.set(c, f.fielded > 0 ? Math.round((f.ready / f.fielded) * 1000) / 1000 : 0);
    }
  }
  const ms = performance.now() - t0;
  const scores = E.countryScores(s);
  const thr = E.thresholdFor(s.score.denominator, 1);
  const sorted = [...order].sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0) || (a < b ? -1 : 1));
  const evs = (k: string[]) => s.events.filter((e) => k.includes(e.kind));
  const warsBy = new Map<string, number>();
  for (const e of evs(['war_declared'])) { const by = e.public?.countries[0]; if (by) warsBy.set(by, (warsBy.get(by) ?? 0) + 1); }
  const capBy = new Map<string, number>();
  for (const e of evs(['city_captured', 'province_captured'])) { const h = /^(\S+) takes/.exec(e.public?.headline ?? ''); const who = h?.[1] ?? null; if (who) capBy.set(who, (capBy.get(who) ?? 0) + 1); }
  const coalOf = (c: string) => Object.values(s.coalitions).find((co) => !co.dissolvedAt && co.members.some((m) => m.country === c)) ?? null;
  const countries: CountryRec[] = order.map((c) => {
    const cs = s.countries[c];
    const co = coalOf(c);
    return {
      c,
      rank: rank.get(c) ?? 0,
      alive: cs.alive,
      eliminatedDay: cs.eliminatedAt !== null ? E.dayOf(cs.eliminatedAt) : null,
      score: scores[c] ?? 0,
      frac: Math.round(((scores[c] ?? 0) / Math.max(1, thr)) * 1000) / 1000,
      finalRank: sorted.indexOf(c) + 1,
      coalition: co ? { id: co.id, size: co.members.length, leader: co.leader } : null,
      everCoalition: Object.values(s.coalitions).some((x) => x.history.some((h) => h.country === c)),
      shortageDays: shortageDays.get(c) ?? 0,
      stallDays: stallDays.get(c) ?? 0,
      stalled: (stallDays.get(c) ?? 0) >= Math.max(3, d * 0.5),
      readiness30: readiness.get(c) ?? 0,
      firstActionDay: firstAction.get(c) ?? null,
      invalid: Object.values(cs.stats.rejected).reduce((a, b) => a + b, 0),
      accepted: tot(c),
      opening: opening.get(c) ?? [],
      wars: warsBy.get(c) ?? 0,
      captures: capBy.get(c) ?? 0,
    };
  });
  const res = s.score.result;
  return {
    seed: job.seed,
    cohort: job.cohort,
    horizon: job.days,
    daysRun: d,
    finished: !!res,
    reason: res ? res.reason : 'timeout',
    winner: res ? { kind: res.winner.kind, id: res.winner.id, members: res.winner.members, fraction: Math.round(res.winner.fraction * 1000) / 1000 } : null,
    day: res ? res.day : null,
    msPerDay: Math.round(ms / Math.max(1, d)),
    plannerMsPerDay: Math.round((AI.aiPerf.ms - p0) / Math.max(1, d)),
    wars: evs(['war_declared']).length,
    captures: evs(['city_captured', 'province_captured']).length,
    coalitions: Object.values(s.coalitions).filter((x) => !x.dissolvedAt).length,
    countries,
  };
}

if (!isMainThread) {
  (async () => {
    // worker threads do not inherit the tsx loader hooks: register them before importing TS modules
    try {
      const api = (await import('tsx/esm/api')) as { register?: () => unknown };
      api.register?.();
    } catch {
      /* running from compiled JS */
    }
    const jobs = workerData as Job[];
    for (const j of jobs) parentPort!.postMessage(await runOne(j));
  })().catch((e) => {
    parentPort!.postMessage({ error: String(e?.stack ?? e) });
  });
}

// ───────────────────────────── main ─────────────────────────────

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
};
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a');

function summarize(runs: RunRec[], cohort: string) {
  const rs = runs.filter((r) => r.cohort === cohort);
  if (!rs.length) return null;
  const n = rs.length;
  const ids = rs[0].countries.map((c) => c.c);
  const per = new Map<string, CountryRec[]>();
  for (const r of rs) for (const c of r.countries) (per.get(c.c) ?? per.set(c.c, []).get(c.c)!).push(c);
  const soloWins = new Map<string, number>();
  const coalWins = new Map<string, number>();
  for (const r of rs) {
    if (!r.winner) continue;
    if (r.winner.kind === 'solo') soloWins.set(r.winner.id, (soloWins.get(r.winner.id) ?? 0) + 1);
    else for (const m of r.winner.members) coalWins.set(m, (coalWins.get(m) ?? 0) + 1);
  }
  const countries = ids.map((c) => {
    const l = per.get(c)!;
    return {
      c,
      openingRank: l[0].rank,
      survival: l.filter((x) => x.alive).length / n,
      medianFinalRank: median(l.map((x) => x.finalRank)),
      meanFrac: Math.round((l.reduce((a, x) => a + x.frac, 0) / n) * 1000) / 1000,
      soloWins: soloWins.get(c) ?? 0,
      coalitionWins: coalWins.get(c) ?? 0,
      coalitionMemberRate: l.filter((x) => x.coalition).length / n,
      shortageDaysMean: Math.round((l.reduce((a, x) => a + x.shortageDays, 0) / n) * 10) / 10,
      readiness30Mean: Math.round((l.reduce((a, x) => a + x.readiness30, 0) / n) * 1000) / 1000,
      stallRuns: l.filter((x) => x.stalled).length,
      noOpeningOrderRuns: l.filter((x) => x.firstActionDay === null || x.firstActionDay > 2).length,
      invalid: l.reduce((a, x) => a + x.invalid, 0),
      wars: l.reduce((a, x) => a + x.wars, 0),
      captures: l.reduce((a, x) => a + x.captures, 0),
      eliminatedMedianDay: median(l.filter((x) => x.eliminatedDay !== null).map((x) => x.eliminatedDay as number)),
      eliminatedRuns: l.filter((x) => !x.alive).length,
    };
  });
  const decided = rs.filter((r) => r.finished).length;
  const timeout = rs.filter((r) => !r.finished).length;
  const rivals = countries.filter((x) => x.c !== 'USA').sort((a, b) => b.meanFrac - a.meanFrac);
  const strongest = rivals[0];
  const medianRival = rivals[Math.floor(rivals.length / 2)];
  // distribution across weaker starts (opening rank quintiles)
  const quint = [1, 2, 3, 4, 5].map((q) => {
    const lo = Math.floor(((q - 1) * ids.length) / 5) + 1, hi = Math.floor((q * ids.length) / 5);
    const l = countries.filter((x) => x.openingRank >= lo && x.openingRank <= hi);
    return { quintile: q, ranks: `${lo}-${hi}`, countries: l.length, survival: Math.round((l.reduce((a, x) => a + x.survival, 0) / Math.max(1, l.length)) * 1000) / 1000, meanFrac: Math.round((l.reduce((a, x) => a + x.meanFrac, 0) / Math.max(1, l.length)) * 1000) / 1000, soloWins: l.reduce((a, x) => a + x.soloWins, 0), coalitionWins: l.reduce((a, x) => a + x.coalitionWins, 0), medianFinalRank: median(l.map((x) => x.medianFinalRank)) };
  });
  // opening sequences of winners
  const seqs = new Map<string, number>();
  let winnerSeqs = 0;
  for (const r of rs) if (r.winner) for (const m of r.winner.members) {
    const rec = r.countries.find((x) => x.c === m);
    if (!rec) continue;
    winnerSeqs++;
    const k = rec.opening.slice(0, 3).join(' > ');
    seqs.set(k, (seqs.get(k) ?? 0) + 1);
  }
  const topSeq = [...seqs.entries()].sort((a, b) => b[1] - a[1])[0];
  // all-country opening uniformity (diversity of the first three investments)
  const allSeq = new Map<string, number>();
  for (const r of rs) for (const c of r.countries) { const k = c.opening.slice(0, 3).join(' > '); allSeq.set(k, (allSeq.get(k) ?? 0) + 1); }
  const usa = countries.find((x) => x.c === 'USA');
  const peers = countries.filter((x) => x.openingRank >= 1 && x.openingRank <= 10);
  const peersLeading = peers.filter((x) => x.medianFinalRank <= 10).length;
  const flags = {
    usaMedianEarlyElimination: usa ? usa.eliminatedRuns > n / 2 && usa.eliminatedMedianDay <= rs[0].horizon / 2 : false,
    singleAlwaysSuccessfulBuildOrder: !!topSeq && winnerSeqs >= 3 && topSeq[1] / winnerSeqs >= 0.8 ? topSeq[0] : null,
    noncompetitivePeerSet: peers.length ? peersLeading <= 2 || countries.some((x) => x.soloWins + x.coalitionWins >= Math.max(3, decided * 0.7)) : false,
    neverLegalOpeningOrder: countries.filter((x) => x.noOpeningOrderRuns === n).map((x) => x.c),
    repeatedlyStalling: countries.filter((x) => x.stallRuns >= Math.max(2, n / 2)).map((x) => x.c),
  };
  return {
    cohort,
    runs: n,
    horizonDays: rs[0].horizon,
    decided,
    timeout,
    timeoutFraction: Math.round((timeout / n) * 1000) / 1000,
    thresholdWins: rs.filter((r) => r.reason === 'threshold').length,
    finalDaySettlements: rs.filter((r) => r.reason === 'final_day').length,
    unilateralVictories: [...soloWins.entries()].map(([c, k]) => ({ c, wins: k, of: n })),
    coalitionVictories: rs.filter((r) => r.winner?.kind === 'coalition').map((r) => ({ seed: r.seed, members: r.winner!.members, day: r.day })),
    strongestRival: strongest ? { c: strongest.c, meanFrac: strongest.meanFrac, medianFinalRank: strongest.medianFinalRank } : null,
    medianRival: medianRival ? { c: medianRival.c, meanFrac: medianRival.meanFrac, medianFinalRank: medianRival.medianFinalRank } : null,
    usa,
    weakerStarts: quint,
    invalidCommands: countries.reduce((a, x) => a + x.invalid, 0),
    msPerDayMedian: median(rs.map((r) => r.msPerDay)),
    plannerMsPerDayMedian: median(rs.map((r) => r.plannerMsPerDay)),
    warsPerRun: Math.round((rs.reduce((a, r) => a + r.wars, 0) / n) * 10) / 10,
    capturesPerRun: Math.round((rs.reduce((a, r) => a + r.captures, 0) / n) * 10) / 10,
    coalitionsPerRun: Math.round((rs.reduce((a, r) => a + r.coalitions, 0) / n) * 10) / 10,
    openingDiversity: allSeq.size,
    topOpening: [...allSeq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => ({ seq: k, share: Math.round((v / (n * ids.length)) * 1000) / 1000 })),
    flags,
    countries,
  };
}

function markdown(sums: NonNullable<ReturnType<typeof summarize>>[], meta: Record<string, unknown>): string {
  const L: string[] = [];
  L.push('# Observer balance suite (AI-observer campaigns)', '');
  L.push(`_Generated by \`npm run report:observer\` (scripts/observer-suite.ts). Test-only observer campaigns: no human seat; all 120 seats driven by the utility planner (src/ai). ${JSON.stringify(meta)}_`, '');
  for (const s of sums) {
    L.push(`## Cohort "${s.cohort}": ${s.runs} seeded runs × ${s.horizonDays}-day horizon`, '');
    L.push(`- Decided: **${s.decided}/${s.runs}** (threshold ${s.thresholdWins}, day-180 settlement ${s.finalDaySettlements}); timeout (horizon reached first): **${s.timeout}/${s.runs}** (${pct(s.timeout, s.runs)}).`);
    L.push(`- Unilateral victories: ${s.unilateralVictories.length ? s.unilateralVictories.map((x) => `${x.c} ${x.wins}/${x.of}`).join(', ') : 'none'} (denominator ${s.runs} runs).`);
    L.push(`- Coalition victories: ${s.coalitionVictories.length ? s.coalitionVictories.map((x) => `[${x.members.join('+')}] seed ${x.seed} day ${x.day}`).join('; ') : 'none'} (denominator ${s.runs} runs).`);
    L.push(`- Strongest rival (non-USA, by mean score fraction of the solo threshold): **${s.strongestRival?.c}** (${s.strongestRival?.meanFrac}); median rival: ${s.medianRival?.c} (${s.medianRival?.meanFrac}).`);
    if (s.usa) L.push(`- USA: opening rank ${s.usa.openingRank}, survival ${pct(s.usa.survival * s.runs, s.runs)}, median final rank ${s.usa.medianFinalRank}, mean fraction ${s.usa.meanFrac}, solo wins ${s.usa.soloWins}, coalition wins ${s.usa.coalitionWins}, day-30 readiness ${s.usa.readiness30Mean}.`);
    L.push(`- Invalid bot commands: **${s.invalidCommands}**. Wars/run ${s.warsPerRun}, captures/run ${s.capturesPerRun}, live coalitions at end/run ${s.coalitionsPerRun}.`);
    L.push(`- Simulation cost: median ${s.msPerDayMedian} ms per game day (engine + views + AI), planner itself ${s.plannerMsPerDayMedian} ms/day.`);
    L.push(`- Opening diversity: ${s.openingDiversity} distinct first-three-investment sequences; most common: ${s.topOpening.map((x) => `"${x.seq}" ${(x.share * 100).toFixed(1)}%`).join('; ')}.`);
    L.push('', '**Flags**', '');
    L.push(`| Check | Result |`, `| --- | --- |`);
    L.push(`| U.S. median early elimination | ${s.flags.usaMedianEarlyElimination ? 'FLAG' : 'ok'} |`);
    L.push(`| Single always-successful build order | ${s.flags.singleAlwaysSuccessfulBuildOrder ? `FLAG: ${s.flags.singleAlwaysSuccessfulBuildOrder}` : 'ok'} |`);
    L.push(`| Noncompetitive peer set | ${s.flags.noncompetitivePeerSet ? 'FLAG' : 'ok'} |`);
    L.push(`| Country never issues a legal opening order | ${s.flags.neverLegalOpeningOrder.length ? `FLAG: ${s.flags.neverLegalOpeningOrder.join(', ')}` : 'ok (all 120 act by day 2)'} |`);
    L.push(`| Nations that repeatedly stall | ${s.flags.repeatedlyStalling.length ? s.flags.repeatedlyStalling.join(', ') : 'none'} |`);
    L.push('', '**Distribution across weaker starts (opening-rank quintiles)**', '');
    L.push('| Quintile | Ranks | Survival | Mean fraction of solo threshold | Median final rank | Solo wins | Coalition-member wins |', '| ---: | --- | ---: | ---: | ---: | ---: | ---: |');
    for (const q of s.weakerStarts) L.push(`| ${q.quintile} | ${q.ranks} | ${(q.survival * 100).toFixed(1)}% | ${q.meanFrac} | ${q.medianFinalRank} | ${q.soloWins} | ${q.coalitionWins} |`);
    L.push('', '**Per country** (opening rank order)', '');
    L.push('| Country | Open rank | Survival | Med. final rank | Mean frac | Solo W | Coal. W | In coalition | Shortage days | Day-30 readiness | Stall runs | Wars | Captures | Invalid |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const c of [...s.countries].sort((a, b) => a.openingRank - b.openingRank)) L.push(`| ${c.c} | ${c.openingRank} | ${(c.survival * 100).toFixed(0)}% | ${c.medianFinalRank} | ${c.meanFrac} | ${c.soloWins} | ${c.coalitionWins} | ${(c.coalitionMemberRate * 100).toFixed(0)}% | ${c.shortageDaysMean} | ${c.readiness30Mean} | ${c.stallRuns} | ${c.wars} | ${c.captures} | ${c.invalid} |`);
    L.push('');
  }
  return L.join('\n');
}

async function main() {
  const runs = Number(arg('runs', '8'));
  const days = Number(arg('days', '30'));
  const long = Number(arg('long', '0'));
  const longDays = Number(arg('long-days', '180'));
  const seed0 = Number(arg('seed0', '1'));
  const workers = Math.max(1, Math.min(Number(arg('workers', String(Math.min(4, cpus().length)))), runs + long));
  const difficulty = arg('difficulty', 'normal') as Job['difficulty'];
  const here = dirname(fileURLToPath(import.meta.url));
  const out = resolve(here, '..', arg('out', 'docs/reports/observer-summary'));
  const jobs: Job[] = [];
  // long runs first so they overlap with the short cohort
  for (let i = 0; i < long; i++) jobs.push({ seed: seed0 + i, days: longDays, difficulty, cohort: `${longDays}d` });
  for (let i = 0; i < runs; i++) jobs.push({ seed: seed0 + i, days, difficulty, cohort: `${days}d` });
  const buckets: Job[][] = Array.from({ length: workers }, () => []);
  jobs.forEach((j, i) => buckets[i % workers].push(j));
  const t0 = Date.now();
  const results: RunRec[] = [];
  let done = 0;
  await Promise.all(
    buckets.map(
      (b) =>
        new Promise<void>((res, rej) => {
          if (!b.length) return res();
          const w = new Worker(fileURLToPath(import.meta.url), { workerData: b });
          w.on('message', (m: RunRec | { error: string }) => {
            if ('error' in m) { rej(new Error(m.error)); return; }
            results.push(m);
            done++;
            // eslint-disable-next-line no-console
            console.log(`[observer] ${done}/${jobs.length} seed ${m.seed} ${m.cohort}: ${m.reason}${m.winner ? ` ${m.winner.kind} ${m.winner.id} day ${m.day}` : ''} (${m.daysRun} days, ${m.msPerDay} ms/day, wars ${m.wars}, captures ${m.captures}) ${((Date.now() - t0) / 60000).toFixed(1)} min`);
            if (b.every((j) => results.some((r) => r.seed === j.seed && r.cohort === j.cohort))) { void w.terminate(); res(); }
          });
          w.on('error', rej);
        }),
    ),
  );
  results.sort((a, b) => a.cohort.localeCompare(b.cohort) || a.seed - b.seed);
  const cohorts = [...new Set(results.map((r) => r.cohort))];
  const sums = cohorts.map((c) => summarize(results, c)).filter((x): x is NonNullable<typeof x> => !!x);
  const meta = { runs, days, long, longDays, seed0, workers, difficulty, wallMinutes: Math.round((Date.now() - t0) / 600) / 100, generated: 'deterministic seeds; wall time varies' };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(`${out}.json`, JSON.stringify({ meta, summaries: sums.map((s) => ({ ...s })), runs: results.map((r) => ({ ...r, countries: r.countries.map((c) => ({ c: c.c, rank: c.rank, alive: c.alive, frac: c.frac, finalRank: c.finalRank, coalition: c.coalition?.id ?? null, invalid: c.invalid, stallDays: c.stallDays, opening: c.opening })) })) }, null, 1));
  writeFileSync(`${out}.md`, markdown(sums, meta));
  // eslint-disable-next-line no-console
  console.log(`[observer] wrote ${out}.md/.json in ${meta.wallMinutes} min`);
}

if (isMainThread) main().catch((e) => { console.error(e); process.exit(1); });
