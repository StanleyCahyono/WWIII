/** APP-6 symbol image cache (milsymbol SVG → HTMLImageElement), keyed by SIDC + size + mono. */
import { renderSymbol } from '../../data/catalog/symbol-render';

export interface SymImage {
  img: HTMLImageElement;
  w: number;
  h: number;
  cx: number;
  cy: number;
  ready: boolean;
  svg: string;
}

const cache = new Map<string, SymImage>();
let onReady: (() => void) | null = null;
let pendingNotify = false;

export function setSymbolReadyCallback(fn: () => void) {
  onReady = fn;
}

export function symbolImage(sidc: string, size: number, mono: boolean | string = false): SymImage {
  const k = `${sidc}|${size}|${mono}`;
  let s = cache.get(k);
  if (s) return s;
  const r = renderSymbol(sidc, { size, monochrome: mono || undefined });
  const img = new Image();
  s = { img, w: r.width, h: r.height, cx: r.center.x, cy: r.center.y, ready: false, svg: r.svg };
  const entry = s;
  img.onload = () => {
    entry.ready = true;
    if (!pendingNotify) {
      pendingNotify = true;
      requestAnimationFrame(() => {
        pendingNotify = false;
        onReady?.();
      });
    }
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(r.svg)}`;
  cache.set(k, s);
  return s;
}

/** Inline SVG markup for HTML lists (roster, inspector, legend). */
export function symbolSvg(sidc: string, size = 22, mono: boolean | string = false): string {
  return symbolImage(sidc, size, mono).svg;
}

export function symbolCacheSize(): number {
  return cache.size;
}
