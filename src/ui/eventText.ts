/**
 * Readable copy for engine event text shown in toasts, the interrupt dialog and the journal.
 *
 * The engine's private event text is terse and uses identifiers (country codes, offer ids such as
 * `of31`, coalition ids such as `co3`, raw diplomatic levels such as `right_of_way`). The UI rebuilds
 * offer events from structured data (the event's `data.offer` and the viewer's own `view.offers`)
 * and, for anything else, replaces identifiers it can resolve. Only viewer-visible data is used.
 */
import type { Offer, OfferTerm } from '../engine/index';
import type { Frame } from './sim/protocol';
import { countryName, RESOURCE_LABEL } from './data/static';
import { gameTime, num } from './format';

export interface EventLike {
  kind: string;
  text: string;
  data?: Record<string, unknown> | null;
}

type View = Frame['view'];

function coalitionName(view: View | null | undefined, id: string): string {
  const c = view?.coalitions.find((x) => x.id === id);
  return c ? c.name : 'a coalition';
}

function name(id: string): string {
  return countryName(id);
}

export function termPhrase(t: OfferTerm, view?: View | null): string {
  if (t.kind === 'status') return t.level === 'right_of_way' ? 'right of way' : t.level === 'shared_intel' ? 'shared intelligence' : 'peace';
  if (t.kind === 'peace') return 'a peace treaty';
  if (t.kind === 'coalition_invite') return `membership of ${coalitionName(view, t.coalition)}`;
  return `${num(t.amount / 1000)} ${RESOURCE_LABEL[t.resource].toLowerCase()}`;
}

function list(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** "Mexico gives right of way and 500 money in exchange for right of way" (from the viewer's side). */
export function offerSummary(o: Pick<Offer, 'from' | 'to' | 'give' | 'receive'>, viewer: string, view?: View | null): string {
  const mine = o.from === viewer;
  const who = mine ? 'you' : name(o.from);
  const give = list(o.give.map((t) => termPhrase(t, view)));
  const ask = list(o.receive.map((t) => termPhrase(t, view)));
  if (!give && !ask) return `${who} ${mine ? 'propose' : 'proposes'} no terms`;
  if (!give) return `${who} ${mine ? 'ask' : 'asks'} for ${ask}, offering nothing in return`;
  return `${who} ${mine ? 'give' : 'gives'} ${give}${ask ? ` in exchange for ${ask}` : ', asking nothing in return'}`;
}

/** "Mexico's offer" / "Your offer to Mexico". */
export function offerRef(o: Pick<Offer, 'from' | 'to'>, viewer: string): string {
  return o.from === viewer ? `Your offer to ${name(o.to)}` : `${name(o.from)}'s offer`;
}

const cap1 = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function offerText(e: EventLike, o: Offer, viewer: string, view: View | null | undefined): string | null {
  const sum = offerSummary(o, viewer, view);
  switch (e.kind) {
    case 'offer_received':
      return o.to === viewer ? `${name(o.from)} sent an offer: ${sum}.` : `Offer sent to ${name(o.to)}: ${sum}.`;
    case 'offer_declined': {
      const m = /declined: (.*)\.$/.exec(e.text);
      return `${offerRef(o, viewer)} (${sum}) was declined${m ? `: ${humanizeIds(m[1], view)}` : ''}.`;
    }
    case 'offer_accepted': {
      const at = typeof e.data?.effectiveAt === 'number' ? (e.data.effectiveAt as number) : o.effectiveAt;
      return `${offerRef(o, viewer)} was accepted: ${sum}.${at !== null && at !== undefined ? ` Takes effect ${gameTime(at)}.` : ''}`;
    }
    case 'offer_expired':
      return `${offerRef(o, viewer)} expired without an answer.`;
    case 'offer_withdrawn':
      return `${offerRef(o, viewer)} was withdrawn.`;
    default:
      return null;
  }
}

/** Fallback: resolve identifiers left in engine text (country codes, offer/coalition ids, raw levels). */
export function humanizeIds(text: string, view?: View | null): string {
  let t = text;
  t = t.replace(/coalition membership \((co\d+)\)/g, (_, id: string) => `membership of ${coalitionName(view, id)}`);
  t = t.replace(/\bright[ _]of[ _]way\b/g, 'right of way');
  t = t.replace(/\bshared[ _]intel\b(?!l)/g, 'shared intelligence');
  t = t.replace(/ gives \[—\] for \[([^\]]*)\]/g, ' asks for $1, offering nothing in return');
  t = t.replace(/ for \[—\]/g, ', asking nothing in return');
  t = t.replace(/\[([^\]]*)\]/g, '$1');
  t = t.replace(/\bOffer of\d+\b/g, 'An offer').replace(/\boffer of\d+\b/g, 'an offer');
  t = t.replace(/\bat tick (\d+)\b/g, (_, n: string) => gameTime(Number(n)));
  t = t.replace(/\b[A-Z]{3}\b/g, (code) => {
    const n = countryName(code);
    return n && n !== code ? n : code;
  });
  return t;
}

/** Readable text for one event as seen by the viewer. */
export function readableEventText(e: EventLike, frame: Frame | null | undefined): string {
  const view = frame?.view;
  const viewer = view?.viewer ?? '';
  const offerId = typeof e.data?.offer === 'string' ? (e.data.offer as string) : null;
  if (offerId && view) {
    const o = view.offers.find((x) => x.id === offerId);
    if (o) {
      const t = offerText(e, o, viewer, view);
      if (t) return cap1(t);
    }
  }
  return cap1(humanizeIds(e.text, view));
}
