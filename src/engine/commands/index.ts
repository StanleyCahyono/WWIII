/**
 * The ONE authoritative command path for humans and AI:
 *   validateCommand(state, cmd) → { ok:true, preview } | { ok:false, code, reason }
 *   submitCommand(state, cmd)   → validates, applies, records nonce + stats
 *   previewCommand(state, cmd)  → validation preview only (never mutates)
 */
import type { GameState } from '../state';
import type { Command, CommandResult, Validation } from './types';
import type { Handler } from './common';
import * as F from './forces';
import * as N from './national';
import { invalidateDerived } from '../derived';

const handlers: Record<Command['type'], Handler<any, any>> = {
  move: F.move,
  attack: F.attack,
  stop: F.stop,
  delay: F.delay,
  split: F.split,
  merge: F.merge,
  setFirePolicy: F.setFirePolicy,
  patrol: F.patrol,
  rebase: F.rebase,
  ferry: F.ferry,
  embark: F.embark,
  disembark: F.disembark,
  retreat: F.retreat,
  setRefit: F.setRefit,
  useDeployable: F.useDeployable,
  airmobile: F.airmobile,
  build: N.build,
  cancelJob: N.cancelJob,
  demolish: N.demolish,
  annex: N.annex,
  mobilize: N.mobilize,
  setRally: N.setRally,
  startResearch: N.startResearch,
  cancelResearch: N.cancelResearch,
  marketOrder: N.marketOrder,
  cancelMarketOrder: N.cancelMarketOrder,
  proposeOffer: N.proposeOffer,
  respondOffer: N.respondOffer,
  withdrawOffer: N.withdrawOffer,
  revokeGrant: N.revokeGrant,
  declareWar: N.declareWar,
  createCoalition: N.createCoalition,
  applyCoalition: N.applyCoalition,
  respondApplication: N.respondApplication,
  leaveCoalition: N.leaveCoalition,
  launchMissile: N.launchMissile,
  produceMissile: N.produceMissile,
  assignAgent: N.assignAgent,
  recallAgent: N.recallAgent,
  buyIntelReport: N.buyIntelReport,
  publishArticle: N.publishArticle,
  sendMessage: N.sendMessage,
};

export const COMMAND_TYPES = Object.keys(handlers) as Command['type'][];

/**
 * Commands whose `apply` never touches stacks (set, rosters, positions, orders, air state),
 * territory, relations, grants or coalition membership — they only queue jobs/research, move
 * resources, place market orders, create/resolve offers (effects are scheduled events), agents,
 * reports, articles and messages. They keep forces-scoped derived caches (`@` keys, e.g. force
 * summaries, lift, observed nodes, stacks by owner). Paths they call that do change relations
 * (diplomacy/coalition internals) invalidate on their own.
 */
const FORCE_NEUTRAL: ReadonlySet<Command['type']> = new Set<Command['type']>([
  'build',
  'cancelJob',
  'annex',
  'mobilize',
  'setRally',
  'startResearch',
  'cancelResearch',
  'produceMissile',
  'marketOrder',
  'cancelMarketOrder',
  'proposeOffer',
  'respondOffer',
  'withdrawOffer',
  'assignAgent',
  'recallAgent',
  'buyIntelReport',
  'publishArticle',
  'sendMessage',
]);

export function validateCommand(state: GameState, cmd: Command): Validation {
  if (!cmd || typeof cmd !== 'object' || typeof (cmd as Command).type !== 'string') return { ok: false, code: 'unknown_command', reason: 'Malformed command.' };
  const h = handlers[cmd.type];
  if (!h) return { ok: false, code: 'unknown_command', reason: `Unknown command "${(cmd as Command).type}".` };
  if (state.score.result) return { ok: false, code: 'game_over', reason: 'The campaign has ended — review mode only.' };
  const c = state.countries[cmd.country];
  if (!c) return { ok: false, code: 'not_owner', reason: 'Unknown issuing country.' };
  if (!c.alive) return { ok: false, code: 'eliminated', reason: `${c.name} has been eliminated.` };
  try {
    return h.validate(state, cmd);
  } catch (e) {
    return { ok: false, code: 'invalid_argument', reason: `Invalid command: ${(e as Error).message}` };
  }
}

export const previewCommand = validateCommand;

/** Apply an already-validated command (low-level; prefer submitCommand). */
export function applyCommand(state: GameState, cmd: Command, preview: unknown): unknown {
  return handlers[cmd.type].apply(state, cmd, preview);
}

export function submitCommand(state: GameState, cmd: Command): CommandResult {
  const cs = state.countries[cmd?.country];
  if (cs && cmd.nonce) {
    const seen = cs.nonces.find((n) => n.nonce === cmd.nonce);
    if (seen) return { ok: true, preview: null, result: seen.result, duplicate: true };
  }
  const v = validateCommand(state, cmd);
  if (!v.ok) {
    if (cs) cs.stats.rejected[cmd.type] = (cs.stats.rejected[cmd.type] ?? 0) + 1;
    return v;
  }
  const result = applyCommand(state, cmd, v.preview);
  invalidateDerived(state, cmd.type === 'demolish' ? 'all' : FORCE_NEUTRAL.has(cmd.type) ? 'national' : 'command');
  cs.stats.accepted[cmd.type] = (cs.stats.accepted[cmd.type] ?? 0) + 1;
  if (cmd.nonce) {
    cs.nonces.push({ nonce: cmd.nonce, at: state.clock.tick, result: JSON.stringify(result ?? null).slice(0, 200) });
    if (cs.nonces.length > 64) cs.nonces.shift();
  }
  return { ok: true, preview: v.preview, result, warnings: v.warnings };
}

export type { Command, CommandResult, Validation } from './types';
