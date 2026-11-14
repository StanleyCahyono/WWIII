/**
 * Symbol rendering — the only catalog module that imports milsymbol.
 *
 * Renderer: milsymbol 3.0.5 (MIT, bundled; see public/licenses/milsymbol-LICENSE.txt). Since 3.0
 * milsymbol draws numeric SIDCs (version 13) as close as possible to MIL-STD-2525E /
 * STANAG APP-6 E. We render with the APP-6 standard flag.
 *
 * Standard amplifiers drawn by milsymbol (outside the frame): unique designation, higher
 * formation, operational condition (status 3 "damaged" bar), planned (dashed frame), HQ staff.
 *
 * Deliberate GAME-ONLY overlays, composed around (never inside) the standardized symbol:
 *  - selection ring  (external circle; does not alter the identity frame)
 *  - age badge       (stale observation age, e.g. "6h", top-right outside the frame)
 *  - muted styling   (reduced opacity for stale reports; geometry unchanged)
 */
import ms from 'milsymbol';
import { SYMBOL_BY_KEY, validateSidc } from './sidc';

export interface RenderSymbolOptions {
  /** Symbol size in px (milsymbol `size`, ~ frame height). Default 32. */
  size?: number;
  /** Unique designation (APP-6 amplifier T), placed outside the frame. */
  designation?: string;
  /** Higher formation (APP-6 amplifier M), placed outside the frame. */
  higherFormation?: string;
  /** Game overlay: external selection ring. */
  selected?: boolean;
  /** Game overlay: observation age in game minutes → age badge. null/undefined = current. */
  staleMinutes?: number | null;
  /** Game overlay: muted styling for stale/historical reports (opacity only). */
  muted?: boolean;
  /** Monochrome rendering: true = near-black, or a CSS colour. */
  monochrome?: boolean | string;
  /** Standard flavour; default 'APP6'. */
  standard?: 'APP6' | '2525';
}

export interface RenderedSymbol {
  svg: string;
  width: number;
  height: number;
  /** Placement anchor within the returned SVG (milsymbol anchor: frame centre, or HQ staff foot). */
  anchor: { x: number; y: number };
  /** Centre of the symbol frame (octagon anchor) within the returned SVG; the selection ring uses it. */
  center: { x: number; y: number };
  /** False if the requested SIDC failed validation and a generic contact was drawn instead. */
  valid: boolean;
  error?: string;
}

export const RENDERER = { name: 'milsymbol', version: '3.0.5', license: 'MIT' } as const;

/** Format an observation age for the badge. */
export function formatAge(minutes: number): string {
  if (minutes < 60) return '<1h';
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** Generic-contact fallback for a SIDC that failed validation, keeping its domain when legible. */
function fallbackSidc(sidc: string): string {
  const set = typeof sidc === 'string' ? sidc.slice(4, 6) : '';
  const key = set === '01' || set === '02' ? 'contact.air' : set === '30' ? 'contact.sea' : set === '35' ? 'contact.subsurface' : 'contact.land';
  return SYMBOL_BY_KEY.get(key)!.sidc;
}

/** Is this SIDC both schema-valid and drawable by the bundled milsymbol? */
export function isRenderable(sidc: string, standard: 'APP6' | '2525' = 'APP6'): boolean {
  if (!validateSidc(sidc).ok) return false;
  const sym = new ms.Symbol(sidc, { size: 20, standard });
  return sym.isValid() === true;
}

export function renderSymbol(sidc: string, opts: RenderSymbolOptions = {}): RenderedSymbol {
  const size = opts.size ?? 32;
  const standard = opts.standard ?? 'APP6';
  let code = sidc;
  let valid = true;
  let error: string | undefined;
  const v = validateSidc(sidc);
  if (!v.ok) {
    valid = false;
    error = v.reason;
    code = fallbackSidc(sidc);
  } else if (!isRenderable(sidc, standard)) {
    valid = false;
    error = 'renderer reports the SIDC as not drawable';
    code = fallbackSidc(sidc);
  }

  const msOpts: Record<string, unknown> = { size, standard };
  if (opts.designation) msOpts.uniqueDesignation = opts.designation;
  if (opts.higherFormation) msOpts.higherFormation = opts.higherFormation;
  if (!valid) msOpts.uniqueDesignation = '?';
  if (opts.monochrome) msOpts.monoColor = typeof opts.monochrome === 'string' ? opts.monochrome : '#1a1a1a';
  const sym = new ms.Symbol(code, msOpts);
  const inner = sym.asSVG();
  const { width: w, height: h } = sym.getSize();
  const a = sym.getAnchor();
  const o = sym.getOctagonAnchor();

  const pad = Math.round(size * 0.5);
  const W = round(w + 2 * pad);
  const H = round(h + 2 * pad);
  const ax = round(pad + a.x);
  const ay = round(pad + a.y);
  const cx = round(pad + o.x);
  const cy = round(pad + o.y);

  const nested = inner.replace('<svg ', `<svg x="${pad}" y="${pad}" `);
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" data-sidc="${esc(code)}">`);
  if (opts.selected) {
    const r = round(size * 0.95);
    parts.push(
      `<g class="wc-overlay-selection"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#000" stroke-width="4"/>` +
        `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#ffd21a" stroke-width="2"/></g>`,
    );
  }
  parts.push(opts.muted ? `<g class="wc-overlay-muted" opacity="0.5">${nested}</g>` : nested);
  if (opts.staleMinutes !== undefined && opts.staleMinutes !== null) {
    const label = formatAge(opts.staleMinutes);
    const bw = round(8 + label.length * size * 0.24);
    const bh = round(size * 0.42);
    const bx = round(W - bw - 1);
    parts.push(
      `<g class="wc-overlay-age"><rect x="${bx}" y="1" width="${bw}" height="${bh}" rx="${round(bh / 2)}" fill="#fff" stroke="#000" stroke-width="1" stroke-dasharray="2 1"/>` +
        `<text x="${round(bx + bw / 2)}" y="${round(1 + bh * 0.74)}" font-family="system-ui, sans-serif" font-size="${round(bh * 0.75)}" text-anchor="middle" fill="#000">${esc(label)}</text></g>`,
    );
  }
  parts.push('</svg>');
  return { svg: parts.join(''), width: W, height: H, anchor: { x: ax, y: ay }, center: { x: cx, y: cy }, valid, error };
}

/** Convenience: SVG markup only. */
export function renderSymbolSvg(sidc: string, opts: RenderSymbolOptions = {}): string {
  return renderSymbol(sidc, opts).svg;
}
