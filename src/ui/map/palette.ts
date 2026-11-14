/** Map palettes and fill-layer legends (color + pattern + name, never color alone). */
import type { FillLayer } from '../persist/prefs';

export type PatternId = 'none' | 'hatch' | 'hatch2' | 'cross' | 'dots' | 'dense' | 'grid' | 'wave' | 'stipple';

export interface Theme {
  name: 'dark' | 'light';
  ocean: string;
  oceanDeep: string;
  land: string;
  outside: string;
  border: string;
  provBorder: string;
  seaBorder: string;
  coast: string;
  text: string;
  textDim: string;
  halo: string;
  graticule: string;
  dim: string;
  route: string;
  routeDraft: string;
  routeBad: string;
  select: string;
  self: string;
  pattern: string;
}

export const THEMES: Record<'dark' | 'light', Theme> = {
  dark: {
    name: 'dark',
    ocean: '#0d1520',
    oceanDeep: '#0a111a',
    land: '#283039',
    outside: '#252a30',
    border: '#7d8896',
    provBorder: 'rgba(160,172,186,0.22)',
    seaBorder: 'rgba(120,150,180,0.12)',
    coast: '#5f6f82',
    text: '#d9e0e8',
    textDim: '#8d99a6',
    halo: 'rgba(8,12,18,0.85)',
    graticule: 'rgba(140,160,180,0.08)',
    dim: 'rgba(8,12,18,0.28)',
    route: '#e8edf2',
    routeDraft: '#f0c24b',
    routeBad: '#ff6b5e',
    select: '#ffd21a',
    self: '#4d86c9',
    pattern: 'rgba(0,0,0,0.45)',
  },
  light: {
    name: 'light',
    ocean: '#c4d3df',
    oceanDeep: '#b9c9d6',
    land: '#e6e2d6',
    outside: '#d8d6d0',
    border: '#5b616a',
    provBorder: 'rgba(40,50,62,0.30)',
    seaBorder: 'rgba(60,90,120,0.14)',
    coast: '#6b7b8c',
    text: '#1b2129',
    textDim: '#4e5864',
    halo: 'rgba(250,250,247,0.9)',
    graticule: 'rgba(40,60,80,0.08)',
    dim: 'rgba(250,250,247,0.25)',
    route: '#1b2129',
    routeDraft: '#9a6a00',
    routeBad: '#b3261e',
    select: '#c98f00',
    self: '#86acd9',
    pattern: 'rgba(255,255,255,0.55)',
  },
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Muted per-country political color. */
export function politicalColor(id: string, theme: Theme): string {
  const h = hash(id);
  const hue = (h % 360);
  const sat = 18 + ((h >>> 9) % 16);
  const light = theme.name === 'dark' ? 26 + ((h >>> 15) % 10) : 70 + ((h >>> 15) % 12);
  return `hsl(${hue} ${sat}% ${light}%)`;
}

export const TERRAIN_STYLE: Record<string, { dark: string; light: string; pattern: PatternId }> = {
  open: { dark: '#4a5539', light: '#cfd5b0', pattern: 'none' },
  mountains: { dark: '#5a4e42', light: '#c4b39c', pattern: 'hatch' },
  forest: { dark: '#2f4a2f', light: '#a9c29a', pattern: 'dots' },
  urban: { dark: '#5c5c64', light: '#bdbcc4', pattern: 'grid' },
  suburban: { dark: '#55534a', light: '#d4cfbf', pattern: 'stipple' },
  jungle: { dark: '#24452f', light: '#8fb79a', pattern: 'dense' },
  tundra: { dark: '#55616a', light: '#d9e0e3', pattern: 'wave' },
  desert: { dark: '#6e5f3b', light: '#e3cf9c', pattern: 'stipple' },
  high_seas: { dark: '#0d1520', light: '#c4d3df', pattern: 'none' },
  coastal_waters: { dark: '#132131', light: '#d2dee8', pattern: 'none' },
};

export const RESOURCE_STYLE: Record<string, { dark: string; light: string; pattern: PatternId; glyph: string }> = {
  supplies: { dark: '#5b6b3a', light: '#c8d39a', pattern: 'dots', glyph: 'S' },
  components: { dark: '#5b5f6b', light: '#c3c7d3', pattern: 'grid', glyph: 'C' },
  electronics: { dark: '#36597a', light: '#a9c6e3', pattern: 'cross', glyph: 'E' },
  fuel: { dark: '#6b4a2e', light: '#dfb98f', pattern: 'hatch', glyph: 'F' },
  rare: { dark: '#5e3f6b', light: '#cdb0dc', pattern: 'dense', glyph: 'R' },
  manpower: { dark: '#6b5a2e', light: '#e2d29a', pattern: 'stipple', glyph: 'M' },
  money: { dark: '#2e6b55', light: '#9fd8c2', pattern: 'wave', glyph: '$' },
};

export const RELATION_STYLE: Record<string, { dark: string; light: string; pattern: PatternId; label: string }> = {
  self: { dark: '#2f5f99', light: '#8fb3e0', pattern: 'none', label: 'Your country' },
  coalition: { dark: '#24736c', light: '#8fd0c8', pattern: 'dots', label: 'Coalition partner' },
  access: { dark: '#3f6b3c', light: '#acd3a5', pattern: 'stipple', label: 'Right of way / shared intel' },
  peace: { dark: '#3c434c', light: '#cfd2d6', pattern: 'none', label: 'At peace' },
  war: { dark: '#7a2f2a', light: '#e3a39c', pattern: 'hatch', label: 'At war' },
  rebel: { dark: '#6b5524', light: '#dcc68d', pattern: 'cross', label: 'Rebel control' },
  none: { dark: '#252a30', light: '#d8d6d0', pattern: 'hatch2', label: 'Outside campaign / unowned' },
};

export function moraleColor(m: number, theme: Theme): string {
  const t = Math.max(0, Math.min(1, m / 100));
  const hue = 4 + t * 116;
  return theme.name === 'dark' ? `hsl(${hue} 45% ${26 + t * 6}%)` : `hsl(${hue} 55% ${62 + t * 8}%)`;
}
export function moralePattern(m: number): PatternId {
  return m < 33 ? 'cross' : m < 60 ? 'hatch' : 'none';
}

export interface LegendItem {
  label: string;
  color: string;
  pattern: PatternId;
}

export function legendFor(layer: FillLayer, theme: Theme): { title: string; items: LegendItem[]; note?: string } {
  const t = theme.name;
  switch (layer) {
    case 'political':
      return {
        title: 'Political control',
        items: [
          { label: 'Your country', color: theme.self, pattern: 'none' },
          { label: 'Other countries (one tone each)', color: politicalColor('XYZ', theme), pattern: 'none' },
          { label: 'Rebel control', color: RELATION_STYLE.rebel[t], pattern: 'cross' },
          { label: 'Outside campaign', color: theme.outside, pattern: 'hatch2' },
        ],
        note: 'Fill = political owner. Unit symbols show affiliation to you.',
      };
    case 'terrain':
      return { title: 'Terrain', items: Object.entries(TERRAIN_STYLE).filter(([k]) => k !== 'high_seas' && k !== 'coastal_waters').map(([k, v]) => ({ label: TERRAIN_NAMES[k], color: v[t], pattern: v.pattern })) };
    case 'morale':
      return {
        title: 'Morale (your territory)',
        items: [
          { label: 'High ≥ 60', color: moraleColor(85, theme), pattern: 'none' },
          { label: 'Medium 33–59', color: moraleColor(46, theme), pattern: 'hatch' },
          { label: 'Low < 33 (uprising risk)', color: moraleColor(15, theme), pattern: 'cross' },
          { label: 'Not yours (unknown)', color: theme.land, pattern: 'none' },
        ],
      };
    case 'resources':
      return { title: 'Rural resource deposits', items: [...Object.entries(RESOURCE_STYLE).map(([k, v]) => ({ label: `${v.glyph} ${RESOURCE_NAMES[k]}`, color: v[t], pattern: v.pattern })), { label: 'No deposit', color: theme.land, pattern: 'none' }] };
    case 'relations':
      return { title: 'Relations / coalition', items: Object.values(RELATION_STYLE).map((v) => ({ label: v.label, color: v[t], pattern: v.pattern })) };
    case 'visibility':
      return {
        title: 'Visibility (your picture)',
        items: [
          { label: 'Own / shared territory (observed)', color: theme.self, pattern: 'none' },
          { label: 'Contact reported recently', color: RELATION_STYLE.access[t], pattern: 'stipple' },
          { label: 'Not observed (fog)', color: theme.outside, pattern: 'stipple' },
        ],
        note: 'Shading only — unknown units stay unknown everywhere.',
      };
  }
}

const TERRAIN_NAMES: Record<string, string> = { open: 'Open ground', mountains: 'Mountains', forest: 'Forest', urban: 'Urban', suburban: 'Suburban', jungle: 'Jungle', tundra: 'Tundra', desert: 'Desert' };
const RESOURCE_NAMES: Record<string, string> = { supplies: 'Supplies', components: 'Components', electronics: 'Electronics', fuel: 'Fuel', rare: 'Rare materials', manpower: 'Manpower', money: 'Money' };

/** Pattern tile (CSS px size 8) drawn on a small canvas. */
export function makePatternTile(id: PatternId, color: string, dpr: number): HTMLCanvasElement | null {
  if (id === 'none') return null;
  const s = 8;
  const c = document.createElement('canvas');
  c.width = c.height = Math.round(s * dpr);
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 1;
  g.beginPath();
  switch (id) {
    case 'hatch':
      g.moveTo(0, s);
      g.lineTo(s, 0);
      g.moveTo(-2, 2);
      g.lineTo(2, -2);
      g.moveTo(s - 2, s + 2);
      g.lineTo(s + 2, s - 2);
      g.stroke();
      break;
    case 'hatch2':
      g.moveTo(0, 0);
      g.lineTo(s, s);
      g.moveTo(-2, s - 2);
      g.lineTo(2, s + 2);
      g.moveTo(s - 2, -2);
      g.lineTo(s + 2, 2);
      g.stroke();
      break;
    case 'cross':
      g.moveTo(0, s);
      g.lineTo(s, 0);
      g.moveTo(0, 0);
      g.lineTo(s, s);
      g.stroke();
      break;
    case 'dots':
      g.arc(4, 4, 1.1, 0, Math.PI * 2);
      g.fill();
      break;
    case 'dense':
      g.arc(2, 2, 1, 0, Math.PI * 2);
      g.arc(6, 6, 1, 0, Math.PI * 2);
      g.fill();
      break;
    case 'grid':
      g.moveTo(0, 0.5);
      g.lineTo(s, 0.5);
      g.moveTo(0.5, 0);
      g.lineTo(0.5, s);
      g.stroke();
      break;
    case 'wave':
      g.moveTo(0, 5);
      g.quadraticCurveTo(2, 3, 4, 5);
      g.quadraticCurveTo(6, 7, 8, 5);
      g.stroke();
      break;
    case 'stipple':
      g.fillRect(1, 1, 1, 1);
      g.fillRect(5, 4, 1, 1);
      g.fillRect(3, 7, 1, 1);
      break;
  }
  return c;
}
