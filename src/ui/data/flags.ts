/**
 * Simplified national flags (public symbols) for the 120 campaign seats: real colours and band
 * layouts, a few cheap emblem shapes, drawn on a 30×20 box by `Flag` (components/common.tsx).
 * Deliberately low detail — a recognisable chip, not a reproduction. Unknown codes fall back to a
 * coded chip.
 */

export type Emblem =
  | { s: 'disc' | 'ring' | 'star'; c: string; x: number; y: number; r: number }
  | { s: 'crescent'; c: string; k: string; x: number; y: number; r: number }
  | { s: 'rect'; c: string; x: number; y: number; w: number; h: number }
  | { s: 'poly'; c: string; p: string }
  | { s: 'diamond'; c: string; x: number; y: number; r: number }
  | { s: 'uj'; x: number; y: number; w: number; h: number }
  | { s: 'grid'; c: string; x: number; y: number; w: number; h: number; n: number; m: number };

export type FlagSpec =
  /** Horizontal bands (top → bottom), optional relative weights. */
  | { k: 'h'; c: string[]; w?: number[]; e?: Emblem[] }
  /** Vertical bands (hoist → fly). */
  | { k: 'v'; c: string[]; w?: number[]; e?: Emblem[] }
  /** Nordic cross, optional inner cross colour. */
  | { k: 'cross'; bg: string; fg: string; inner?: string; e?: Emblem[] }
  /** Centred cross (plus). */
  | { k: 'plus'; bg: string; fg: string; e?: Emblem[] }
  /** Horizontal bands with a hoist triangle (and optional inner triangle). */
  | { k: 'tri'; c: string[]; w?: number[]; t: string; t2?: string; tw?: number; e?: Emblem[] }
  /** Four quarters (TL, TR, BL, BR), optional centred cross colour. */
  | { k: 'quad'; c: [string, string, string, string]; fg?: string; e?: Emblem[] }
  /** Diagonal band from bottom-left to top-right. */
  | { k: 'diag'; a: string; b: string; band: string; edge?: string; rev?: boolean; e?: Emblem[] };

const W = '#ffffff';
const K = '#111111';

export const FLAGS: Record<string, FlagSpec> = {
  // ── Americas ──
  ARG: { k: 'h', c: ['#74acdf', W, '#74acdf'], e: [{ s: 'disc', c: '#f6b40e', x: 15, y: 10, r: 2 }] },
  BOL: { k: 'h', c: ['#d52b1e', '#f9e300', '#007934'] },
  BRA: { k: 'h', c: ['#009c3b'], e: [{ s: 'diamond', c: '#ffdf00', x: 15, y: 10, r: 12 }, { s: 'disc', c: '#002776', x: 15, y: 10, r: 4.2 }] },
  CAN: { k: 'v', c: ['#d80621', W, '#d80621'], w: [1, 2, 1], e: [{ s: 'star', c: '#d80621', x: 15, y: 10.4, r: 4.2 }] },
  CHL: { k: 'h', c: [W, '#d52b1e'], e: [{ s: 'rect', c: '#0039a6', x: 0, y: 0, w: 10, h: 10 }, { s: 'star', c: W, x: 5, y: 5.2, r: 2.6 }] },
  COL: { k: 'h', c: ['#fcd116', '#003893', '#ce1126'], w: [2, 1, 1] },
  CRI: { k: 'h', c: ['#002b7f', W, '#ce1126', W, '#002b7f'], w: [1, 1, 2, 1, 1] },
  CUB: { k: 'tri', c: ['#002a8f', W, '#002a8f', W, '#002a8f'], t: '#cf142b', e: [{ s: 'star', c: W, x: 4.6, y: 10.2, r: 2.6 }] },
  DOM: { k: 'quad', c: ['#002d62', '#ce1126', '#ce1126', '#002d62'], fg: W },
  ECU: { k: 'h', c: ['#ffdd00', '#034ea2', '#ed1c24'], w: [2, 1, 1], e: [{ s: 'disc', c: '#8a6d3b', x: 15, y: 9, r: 2.2 }] },
  SLV: { k: 'h', c: ['#0047ab', W, '#0047ab'], e: [{ s: 'disc', c: '#c8a400', x: 15, y: 10, r: 1.6 }] },
  GTM: { k: 'v', c: ['#4997d0', W, '#4997d0'], e: [{ s: 'disc', c: '#6c9a3d', x: 15, y: 10, r: 1.8 }] },
  GUY: { k: 'tri', c: ['#009e49'], t: '#fcd116', t2: '#ce1126', tw: 30 },
  HND: { k: 'h', c: ['#0073cf', W, '#0073cf'], e: [{ s: 'star', c: '#0073cf', x: 15, y: 10.2, r: 1.6 }] },
  MEX: { k: 'v', c: ['#006847', W, '#ce1126'], e: [{ s: 'disc', c: '#8c5a2b', x: 15, y: 10, r: 2.4 }] },
  NIC: { k: 'h', c: ['#0067c6', W, '#0067c6'], e: [{ s: 'poly', c: '#0067c6', p: '13.4,11.6 16.6,11.6 15,8.6' }] },
  PAN: { k: 'quad', c: [W, '#da121a', '#072357', W], e: [{ s: 'star', c: '#072357', x: 7.5, y: 5.2, r: 2.4 }, { s: 'star', c: '#da121a', x: 22.5, y: 15.2, r: 2.4 }] },
  PRY: { k: 'h', c: ['#d52b1e', W, '#0038a8'], e: [{ s: 'ring', c: '#0038a8', x: 15, y: 10, r: 1.8 }] },
  PER: { k: 'v', c: ['#d91023', W, '#d91023'] },
  USA: {
    k: 'h',
    c: ['#b22234', W, '#b22234', W, '#b22234', W, '#b22234', W, '#b22234', W, '#b22234', W, '#b22234'],
    e: [{ s: 'rect', c: '#3c3b6e', x: 0, y: 0, w: 12, h: 10.8 }, { s: 'grid', c: W, x: 1.2, y: 1.2, w: 9.6, h: 8.4, n: 5, m: 4 }],
  },
  URY: { k: 'h', c: [W, '#0038a8', W, '#0038a8', W, '#0038a8', W, '#0038a8', W], e: [{ s: 'rect', c: W, x: 0, y: 0, w: 10, h: 11.1 }, { s: 'disc', c: '#fcd116', x: 5, y: 5.5, r: 2.6 }] },
  VEN: { k: 'h', c: ['#ffcc00', '#00247d', '#cf142b'], e: [{ s: 'ring', c: W, x: 15, y: 10.6, r: 3 }] },
  // ── Europe ──
  ALB: { k: 'h', c: ['#e41e20'], e: [{ s: 'poly', c: K, p: '15,4 18.5,7 17.5,11 19,14 15,16 11,14 12.5,11 11.5,7' }] },
  AUT: { k: 'h', c: ['#ed2939', W, '#ed2939'] },
  BLR: { k: 'h', c: ['#c8313e', '#4aa657'], w: [2, 1], e: [{ s: 'rect', c: W, x: 0, y: 0, w: 3.2, h: 20 }, { s: 'rect', c: '#c8313e', x: 1.1, y: 0, w: 1, h: 20 }] },
  BEL: { k: 'v', c: [K, '#fdda24', '#ef3340'] },
  BIH: { k: 'h', c: ['#002395'], e: [{ s: 'poly', c: '#fecb00', p: '9,0 21,0 21,20' }, { s: 'grid', c: W, x: 6.5, y: 1, w: 1, h: 18, n: 1, m: 7 }] },
  BGR: { k: 'h', c: [W, '#00966e', '#d62612'] },
  HRV: { k: 'h', c: ['#ff0000', W, '#171796'], e: [{ s: 'rect', c: '#ff0000', x: 12.5, y: 5.5, w: 5, h: 7 }, { s: 'grid', c: W, x: 12.9, y: 5.9, w: 4.2, h: 6.2, n: 3, m: 4 }] },
  CZE: { k: 'tri', c: [W, '#d7141a'], t: '#11457e', tw: 15 },
  DNK: { k: 'cross', bg: '#c8102e', fg: W },
  EST: { k: 'h', c: ['#0072ce', K, W] },
  FIN: { k: 'cross', bg: W, fg: '#002f6c' },
  FRA: { k: 'v', c: ['#0055a4', W, '#ef4135'] },
  DEU: { k: 'h', c: [K, '#dd0000', '#ffce00'] },
  GRC: {
    k: 'h',
    c: ['#0d5eaf', W, '#0d5eaf', W, '#0d5eaf', W, '#0d5eaf', W, '#0d5eaf'],
    e: [{ s: 'rect', c: '#0d5eaf', x: 0, y: 0, w: 11.1, h: 11.1 }, { s: 'rect', c: W, x: 4.45, y: 0, w: 2.2, h: 11.1 }, { s: 'rect', c: W, x: 0, y: 4.45, w: 11.1, h: 2.2 }],
  },
  HUN: { k: 'h', c: ['#ce2939', W, '#477050'] },
  IRL: { k: 'v', c: ['#169b62', W, '#ff883e'] },
  ITA: { k: 'v', c: ['#009246', W, '#ce2b37'] },
  LVA: { k: 'h', c: ['#9e3039', W, '#9e3039'], w: [2, 1, 2] },
  LTU: { k: 'h', c: ['#fdb913', '#006a44', '#c1272d'] },
  MDA: { k: 'v', c: ['#0046ae', '#ffd200', '#cc092f'], e: [{ s: 'disc', c: '#8c5a2b', x: 15, y: 10, r: 2.2 }] },
  NLD: { k: 'h', c: ['#ae1c28', W, '#21468b'] },
  NOR: { k: 'cross', bg: '#ba0c2f', fg: W, inner: '#00205b' },
  POL: { k: 'h', c: [W, '#dc143c'] },
  PRT: { k: 'v', c: ['#006600', '#ff0000'], w: [2, 3], e: [{ s: 'ring', c: '#ffcc00', x: 12, y: 10, r: 3.4 }, { s: 'disc', c: W, x: 12, y: 10, r: 2 }] },
  ROU: { k: 'v', c: ['#002b7f', '#fcd116', '#ce1126'] },
  RUS: { k: 'h', c: [W, '#0039a6', '#d52b1e'] },
  SRB: { k: 'h', c: ['#c6363c', '#0c4076', W], e: [{ s: 'rect', c: '#c6363c', x: 7, y: 5, w: 4.5, h: 7 }, { s: 'disc', c: W, x: 9.25, y: 8.5, r: 1.4 }] },
  SVK: { k: 'h', c: [W, '#0b4ea2', '#ee1c25'], e: [{ s: 'rect', c: W, x: 6.6, y: 4.4, w: 6.8, h: 9.4 }, { s: 'rect', c: '#ee1c25', x: 7.2, y: 5, w: 5.6, h: 8.2 }, { s: 'rect', c: W, x: 9.5, y: 6, w: 1, h: 5.4 }] },
  SVN: { k: 'h', c: [W, '#005da4', '#ed1c24'], e: [{ s: 'rect', c: '#005da4', x: 6.6, y: 3.6, w: 4.6, h: 6.4 }, { s: 'poly', c: W, p: '7.4,8.6 8.9,6.2 10.4,8.6' }] },
  ESP: { k: 'h', c: ['#aa151b', '#f1bf00', '#aa151b'], w: [1, 2, 1], e: [{ s: 'rect', c: '#aa151b', x: 7, y: 7.2, w: 3, h: 5 }] },
  SWE: { k: 'cross', bg: '#006aa7', fg: '#fecc00' },
  CHE: { k: 'plus', bg: '#da291c', fg: W },
  UKR: { k: 'h', c: ['#0057b7', '#ffd700'] },
  GBR: { k: 'h', c: ['#012169'], e: [{ s: 'uj', x: 0, y: 0, w: 30, h: 20 }] },
  // ── Africa ──
  DZA: { k: 'v', c: ['#006233', W], e: [{ s: 'crescent', c: '#d21034', k: W, x: 15, y: 10, r: 5 }, { s: 'star', c: '#d21034', x: 17.6, y: 10, r: 2 }] },
  AGO: { k: 'h', c: ['#cc092f', K], e: [{ s: 'ring', c: '#ffcb00', x: 15, y: 10, r: 3.2 }, { s: 'star', c: '#ffcb00', x: 15.5, y: 9, r: 1.4 }] },
  CMR: { k: 'v', c: ['#007a5e', '#ce1126', '#fcd116'], e: [{ s: 'star', c: '#fcd116', x: 15, y: 10.3, r: 2.8 }] },
  CIV: { k: 'v', c: ['#f77f00', W, '#009e60'] },
  COD: { k: 'diag', a: '#007fff', b: '#007fff', band: '#ce1021', edge: '#f7d618', e: [{ s: 'star', c: '#f7d618', x: 5.5, y: 5, r: 3.2 }] },
  EGY: { k: 'h', c: ['#ce1126', W, K], e: [{ s: 'disc', c: '#c09300', x: 15, y: 10, r: 2 }] },
  ETH: { k: 'h', c: ['#078930', '#fcdd09', '#da121a'], e: [{ s: 'disc', c: '#0f47af', x: 15, y: 10, r: 4.2 }, { s: 'star', c: '#fcdd09', x: 15, y: 10.3, r: 3 }] },
  GHA: { k: 'h', c: ['#ce1126', '#fcd116', '#006b3f'], e: [{ s: 'star', c: K, x: 15, y: 10.3, r: 3.2 }] },
  KEN: { k: 'h', c: [K, W, '#bb0000', W, '#006600'], w: [6, 1, 6, 1, 6], e: [{ s: 'diamond', c: '#bb0000', x: 15, y: 10, r: 3.6 }, { s: 'rect', c: K, x: 14.4, y: 6.2, w: 1.2, h: 7.6 }] },
  LBY: { k: 'h', c: ['#e70013', K, '#239e46'], w: [1, 2, 1], e: [{ s: 'crescent', c: W, k: K, x: 14.4, y: 10, r: 3.4 }, { s: 'star', c: W, x: 17, y: 10, r: 1.4 }] },
  MAR: { k: 'h', c: ['#c1272d'], e: [{ s: 'star', c: '#006233', x: 15, y: 10.4, r: 4.4 }, { s: 'star', c: '#c1272d', x: 15, y: 10.4, r: 2.8 }] },
  MOZ: { k: 'tri', c: ['#007168', W, K, W, '#fce100'], w: [6, 1, 6, 1, 6], t: '#d21034', e: [{ s: 'star', c: '#fce100', x: 4.4, y: 10.3, r: 2.6 }] },
  NGA: { k: 'v', c: ['#008751', W, '#008751'] },
  SEN: { k: 'v', c: ['#00853f', '#fdef42', '#e31b23'], e: [{ s: 'star', c: '#00853f', x: 15, y: 10.3, r: 2.8 }] },
  ZAF: { k: 'tri', c: ['#de3831', W, '#007a4d', W, '#002395'], w: [6, 1, 4, 1, 6], t: '#ffb612', t2: K, tw: 11 },
  SDN: { k: 'tri', c: ['#d21034', W, K], t: '#007229' },
  TZA: { k: 'diag', a: '#1eb53a', b: '#00a3dd', band: K, edge: '#fcd116' },
  TUN: { k: 'h', c: ['#e70013'], e: [{ s: 'disc', c: W, x: 15, y: 10, r: 5 }, { s: 'crescent', c: '#e70013', k: W, x: 14.6, y: 10, r: 3.6 }, { s: 'star', c: '#e70013', x: 16.4, y: 10.2, r: 1.6 }] },
  // ── West and Central Asia ──
  ARM: { k: 'h', c: ['#d90012', '#0033a0', '#f2a800'] },
  AZE: { k: 'h', c: ['#00b5e2', '#ef3340', '#509e2f'], e: [{ s: 'crescent', c: W, k: '#ef3340', x: 14.4, y: 10, r: 2.6 }, { s: 'star', c: W, x: 17, y: 10, r: 1.1 }] },
  BHR: { k: 'v', c: [W, '#ce1126'], w: [1, 2.6], e: [{ s: 'poly', c: W, p: '8.3,0 11,2 8.3,4 11,6 8.3,8 11,10 8.3,12 11,14 8.3,16 11,18 8.3,20' }] },
  GEO: { k: 'quad', c: [W, W, W, W], fg: '#ff0000' },
  IRN: { k: 'h', c: ['#239f40', W, '#da0000'], e: [{ s: 'disc', c: '#da0000', x: 15, y: 10, r: 1.8 }] },
  IRQ: { k: 'h', c: ['#ce1126', W, K], e: [{ s: 'rect', c: '#007a3d', x: 10.5, y: 9, w: 9, h: 2 }] },
  ISR: { k: 'h', c: [W, '#0038b8', W, '#0038b8', W], w: [2, 1.6, 9, 1.6, 2], e: [{ s: 'ring', c: '#0038b8', x: 15, y: 10, r: 2.8 }] },
  JOR: { k: 'tri', c: [K, W, '#007a3d'], t: '#ce1126', e: [{ s: 'star', c: W, x: 4.6, y: 10.3, r: 1.6 }] },
  KAZ: { k: 'h', c: ['#00afca'], e: [{ s: 'disc', c: '#fec50c', x: 15, y: 9, r: 3.8 }, { s: 'rect', c: '#fec50c', x: 2, y: 2, w: 1.2, h: 16 }] },
  KWT: { k: 'tri', c: ['#007a3d', W, '#ce1126'], t: K },
  KGZ: { k: 'h', c: ['#e8112d'], e: [{ s: 'disc', c: '#ffef00', x: 15, y: 10, r: 4.8 }, { s: 'disc', c: '#e8112d', x: 15, y: 10, r: 2.4 }] },
  LBN: { k: 'h', c: ['#ed1c24', W, '#ed1c24'], w: [1, 2, 1], e: [{ s: 'poly', c: '#00a651', p: '15,5.6 19,13.6 11,13.6' }] },
  OMN: { k: 'h', c: [W, '#db161b', '#008000'], e: [{ s: 'rect', c: '#db161b', x: 0, y: 0, w: 8, h: 20 }] },
  QAT: { k: 'v', c: [W, '#8a1538'], w: [1, 2.4], e: [{ s: 'poly', c: '#8a1538', p: '8.8,0 11.2,1.1 8.8,2.2 11.2,3.3 8.8,4.4 11.2,5.5 8.8,6.6 11.2,7.7 8.8,8.8 11.2,10 8.8,11.1 11.2,12.2 8.8,13.3 11.2,14.4 8.8,15.5 11.2,16.6 8.8,17.7 11.2,18.8 8.8,20' }] },
  SAU: { k: 'h', c: ['#006c35'], e: [{ s: 'rect', c: W, x: 8, y: 6.5, w: 14, h: 2 }, { s: 'rect', c: W, x: 9, y: 13, w: 12, h: 1.2 }] },
  SYR: { k: 'h', c: ['#ce1126', W, K], e: [{ s: 'star', c: '#007a3d', x: 11.5, y: 10.3, r: 1.7 }, { s: 'star', c: '#007a3d', x: 18.5, y: 10.3, r: 1.7 }] },
  TJK: { k: 'h', c: ['#cc0000', W, '#006600'], w: [1, 1.4, 1], e: [{ s: 'disc', c: '#f8c300', x: 15, y: 10, r: 1.6 }] },
  TUR: { k: 'h', c: ['#e30a17'], e: [{ s: 'crescent', c: W, k: '#e30a17', x: 12, y: 10, r: 5 }, { s: 'star', c: W, x: 17.2, y: 10, r: 2 }] },
  TKM: { k: 'h', c: ['#00843d'], e: [{ s: 'rect', c: '#d22630', x: 4, y: 0, w: 5, h: 20 }, { s: 'crescent', c: W, k: '#00843d', x: 13, y: 5, r: 2.6 }] },
  ARE: { k: 'h', c: ['#00732f', W, K], e: [{ s: 'rect', c: '#ff0000', x: 0, y: 0, w: 8, h: 20 }] },
  UZB: { k: 'h', c: ['#0099b5', '#ce1126', W, '#ce1126', '#1eb53a'], w: [6, 0.6, 6, 0.6, 6], e: [{ s: 'crescent', c: W, k: '#0099b5', x: 5, y: 3.3, r: 2.3 }] },
  YEM: { k: 'h', c: ['#ce1126', W, K] },
  // ── South, East and Southeast Asia ──
  AFG: { k: 'v', c: [K, '#d32011', '#007a36'], e: [{ s: 'ring', c: W, x: 15, y: 10, r: 2.8 }] },
  BGD: { k: 'h', c: ['#006a4e'], e: [{ s: 'disc', c: '#f42a41', x: 13.5, y: 10, r: 6 }] },
  KHM: { k: 'h', c: ['#032ea1', '#e00025', '#032ea1'], w: [1, 2, 1], e: [{ s: 'poly', c: W, p: '10,13 11,9 13,9 13.5,6.5 15,5 16.5,6.5 17,9 19,9 20,13' }] },
  CHN: { k: 'h', c: ['#de2910'], e: [{ s: 'star', c: '#ffde00', x: 5, y: 5.2, r: 3.2 }, { s: 'star', c: '#ffde00', x: 10, y: 2.2, r: 1 }, { s: 'star', c: '#ffde00', x: 12, y: 4.2, r: 1 }, { s: 'star', c: '#ffde00', x: 12, y: 7, r: 1 }, { s: 'star', c: '#ffde00', x: 10, y: 9, r: 1 }] },
  IND: { k: 'h', c: ['#ff9933', W, '#138808'], e: [{ s: 'ring', c: '#000080', x: 15, y: 10, r: 2.6 }] },
  IDN: { k: 'h', c: ['#ce1126', W] },
  JPN: { k: 'h', c: [W], e: [{ s: 'disc', c: '#bc002d', x: 15, y: 10, r: 6 }] },
  LAO: { k: 'h', c: ['#ce1126', '#002868', '#ce1126'], w: [1, 2, 1], e: [{ s: 'disc', c: W, x: 15, y: 10, r: 4 }] },
  MYS: {
    k: 'h',
    c: ['#cc0001', W, '#cc0001', W, '#cc0001', W, '#cc0001', W, '#cc0001', W, '#cc0001', W, '#cc0001', W],
    e: [{ s: 'rect', c: '#010066', x: 0, y: 0, w: 15, h: 11.4 }, { s: 'crescent', c: '#ffcc00', k: '#010066', x: 6.2, y: 5.7, r: 4 }, { s: 'star', c: '#ffcc00', x: 10.6, y: 5.8, r: 2.4 }],
  },
  MNG: { k: 'v', c: ['#c4272f', '#015197', '#c4272f'], e: [{ s: 'rect', c: '#f9cf02', x: 4, y: 4, w: 2, h: 12 }, { s: 'disc', c: '#f9cf02', x: 5, y: 3, r: 1.4 }] },
  MMR: { k: 'h', c: ['#fecb00', '#34b233', '#ea2839'], e: [{ s: 'star', c: W, x: 15, y: 10.8, r: 6.4 }] },
  NPL: { k: 'h', c: ['#e9eef2'], e: [{ s: 'poly', c: '#003893', p: '6,0 21,9.6 11,9.6 21,20 6,20' }, { s: 'poly', c: '#dc143c', p: '7,1.8 18,8.8 9.2,8.8 18.6,19 7,19' }, { s: 'disc', c: W, x: 10, y: 14.4, r: 1.8 }] },
  PRK: { k: 'h', c: ['#024fa2', W, '#ed1c27', W, '#024fa2'], w: [3, 0.6, 8, 0.6, 3], e: [{ s: 'disc', c: W, x: 10, y: 10, r: 3.2 }, { s: 'star', c: '#ed1c27', x: 10, y: 10.3, r: 2.8 }] },
  PAK: { k: 'v', c: [W, '#01411c'], w: [1, 3], e: [{ s: 'crescent', c: W, k: '#01411c', x: 18, y: 10.6, r: 4.6 }, { s: 'star', c: W, x: 20.6, y: 8.2, r: 1.6 }] },
  PHL: { k: 'tri', c: ['#0038a8', '#ce1126'], t: W, e: [{ s: 'disc', c: '#fcd116', x: 4.6, y: 10, r: 1.8 }] },
  SGP: { k: 'h', c: ['#ef3340', W], e: [{ s: 'crescent', c: W, k: '#ef3340', x: 6, y: 5, r: 3.4 }] },
  KOR: { k: 'h', c: [W], e: [{ s: 'disc', c: '#cd2e3a', x: 15, y: 10, r: 4.6 }, { s: 'poly', c: '#0047a0', p: '10.4,10 19.6,10 19.3,11.8 18,13.6 15,14.6 12,13.6 10.7,11.8' }, { s: 'rect', c: K, x: 4, y: 3.5, w: 4, h: 1 }, { s: 'rect', c: K, x: 22, y: 3.5, w: 4, h: 1 }, { s: 'rect', c: K, x: 4, y: 15.5, w: 4, h: 1 }, { s: 'rect', c: K, x: 22, y: 15.5, w: 4, h: 1 }] },
  LKA: { k: 'v', c: ['#005f56', '#ff7300', '#8d153a'], w: [1, 1, 4], e: [{ s: 'disc', c: '#ffbe29', x: 20, y: 10, r: 3 }] },
  TWN: { k: 'h', c: ['#fe0000'], e: [{ s: 'rect', c: '#000095', x: 0, y: 0, w: 15, h: 10 }, { s: 'disc', c: W, x: 7.5, y: 5, r: 2.6 }] },
  THA: { k: 'h', c: ['#a51931', '#f4f5f8', '#2d2a4a', '#f4f5f8', '#a51931'], w: [1, 1, 2, 1, 1] },
  VNM: { k: 'h', c: ['#da251d'], e: [{ s: 'star', c: '#ffff00', x: 15, y: 10.6, r: 5.4 }] },
  // ── Oceania ──
  AUS: { k: 'h', c: ['#012169'], e: [{ s: 'uj', x: 0, y: 0, w: 15, h: 10 }, { s: 'star', c: W, x: 7.5, y: 15, r: 2.6 }, { s: 'star', c: W, x: 22.5, y: 4, r: 1.3 }, { s: 'star', c: W, x: 25.5, y: 9, r: 1.3 }, { s: 'star', c: W, x: 22.5, y: 16, r: 1.3 }, { s: 'star', c: W, x: 19.5, y: 9.4, r: 1.3 }] },
  NZL: { k: 'h', c: ['#012169'], e: [{ s: 'uj', x: 0, y: 0, w: 15, h: 10 }, { s: 'star', c: '#c8102e', x: 22.5, y: 4.4, r: 1.5 }, { s: 'star', c: '#c8102e', x: 25.5, y: 9, r: 1.5 }, { s: 'star', c: '#c8102e', x: 20, y: 10, r: 1.3 }, { s: 'star', c: '#c8102e', x: 22.5, y: 16, r: 1.6 }] },
  PNG: { k: 'diag', a: '#ce1126', b: K, band: 'none', rev: true, e: [{ s: 'star', c: W, x: 7, y: 13, r: 1.4 }, { s: 'star', c: W, x: 9, y: 16.6, r: 1.4 }, { s: 'star', c: W, x: 5, y: 16.6, r: 1.4 }, { s: 'disc', c: '#fcd116', x: 21, y: 6.5, r: 2.6 }] },
};
