/**
 * Reviewed crossings. These are the ONLY land links across water ('strait'), the only canal
 * passages ('canal', controlled by the owner of the `via` province) and the only extra sea links
 * across narrows that the 0.05° raster cannot resolve. Each endpoint is resolved to the province
 * (of the expected country) or sea zone nearest to the given point; the build fails if an
 * endpoint cannot be resolved. If both ends of a strait fall in the same province (the source
 * draws the land as connected) the link is skipped and logged.
 *
 * Policy notes:
 *  - Indonesian islands are NEVER linked by land (not even Java–Madura/Suramadu): archipelago
 *    logistics must go by sea. The build asserts that no strait touches two IDN provinces.
 *  - Kerch Bridge reflects existing physical infrastructure; Crimea carries a DisputedArea record.
 *  - Strait of Messina has no fixed link; it is modelled as a short reviewed ferry crossing.
 */
import type { CountryId } from '../../src/engine/data-types';

export interface StraitSpec { label: string; a: [number, number]; b: [number, number]; countries: [CountryId, CountryId] }
export interface CanalSpec { label: string; seaA: [number, number]; seaB: [number, number]; via: [number, number]; viaCountry: CountryId; optional?: boolean }
export interface SeaLinkSpec { label: string; a: [number, number]; b: [number, number] }

export const STRAITS: readonly StraitSpec[] = [
  { label: 'Channel Tunnel', a: [1.15, 51.08], b: [1.85, 50.92], countries: ['GBR', 'FRA'] },
  { label: 'Øresund Bridge', a: [12.6, 55.62], b: [13.0, 55.57], countries: ['DNK', 'SWE'] },
  { label: 'Great Belt Fixed Link', a: [11.08, 55.34], b: [10.8, 55.31], countries: ['DNK', 'DNK'] },
  { label: 'Little Belt bridges', a: [9.82, 55.5], b: [9.7, 55.52], countries: ['DNK', 'DNK'] },
  { label: 'Storstrøm and Farø bridges', a: [11.95, 55.0], b: [11.95, 54.85], countries: ['DNK', 'DNK'] },
  { label: 'Fehmarn Sound Bridge', a: [11.18, 54.43], b: [11.12, 54.38], countries: ['DEU', 'DEU'] },
  { label: 'Rügen Bridge', a: [13.25, 54.35], b: [13.1, 54.3], countries: ['DEU', 'DEU'] },
  { label: 'Öland Bridge', a: [16.43, 56.67], b: [16.33, 56.66], countries: ['SWE', 'SWE'] },
  { label: 'Strait of Messina ferry link', a: [15.8, 38.3], b: [15.45, 38.15], countries: ['ITA', 'ITA'] },
  { label: 'Kanmon Tunnels and Bridge', a: [130.96, 33.96], b: [130.9, 33.9], countries: ['JPN', 'JPN'] },
  { label: 'Seikan Tunnel', a: [140.35, 41.15], b: [140.25, 41.45], countries: ['JPN', 'JPN'] },
  { label: 'Great Seto Bridge', a: [133.8, 34.5], b: [133.82, 34.3], countries: ['JPN', 'JPN'] },
  { label: 'Akashi Kaikyō Bridge (Honshu–Awaji–Shikoku)', a: [135.02, 34.63], b: [134.65, 34.22], countries: ['JPN', 'JPN'] },
  { label: 'Bosporus bridges and tunnels', a: [28.98, 41.05], b: [29.08, 41.02], countries: ['TUR', 'TUR'] },
  { label: '1915 Çanakkale Bridge (Dardanelles)', a: [26.66, 40.41], b: [26.7, 40.34], countries: ['TUR', 'TUR'] },
  { label: 'Kerch Bridge', a: [36.45, 45.3], b: [36.66, 45.25], countries: ['RUS', 'RUS'] },
  { label: 'Johor–Singapore Causeway', a: [103.77, 1.43], b: [103.76, 1.48], countries: ['SGP', 'MYS'] },
  { label: 'King Fahd Causeway', a: [50.48, 26.17], b: [50.2, 26.2], countries: ['BHR', 'SAU'] },
  { label: 'Penang Bridge', a: [100.31, 5.37], b: [100.4, 5.36], countries: ['MYS', 'MYS'] },
  { label: 'Confederation Bridge', a: [-63.7, 46.27], b: [-63.75, 46.15], countries: ['CAN', 'CAN'] },
  { label: 'Canso Causeway', a: [-61.38, 45.66], b: [-61.43, 45.6], countries: ['CAN', 'CAN'] },
  { label: 'New York bridges (Long Island)', a: [-73.75, 40.78], b: [-73.85, 40.88], countries: ['USA', 'USA'] },
  { label: 'Chalkida bridges (Euboea)', a: [23.8, 38.6], b: [23.4, 38.33], countries: ['GRC', 'GRC'] },
  { label: 'San Juanico Bridge (Samar–Leyte)', a: [125.2, 11.7], b: [124.9, 11.1], countries: ['PHL', 'PHL'] },
  { label: 'Sarasin Bridge (Phuket)', a: [98.3, 8.18], b: [98.28, 8.2], countries: ['THA', 'THA'] },
  { label: 'Menai bridges (Anglesey)', a: [-4.25, 53.23], b: [-4.15, 53.2], countries: ['GBR', 'GBR'] },
  { label: 'Montreal island bridges', a: [-73.6, 45.52], b: [-73.33, 45.45], countries: ['CAN', 'CAN'] },
  { label: 'Hong Kong–Zhuhai–Macau Bridge', a: [113.95, 22.3], b: [113.57, 22.2], countries: ['CHN', 'CHN'] },
];

/**
 * Narrow waterways closed in the sea raster so that passage is ONLY via the canal edge controlled
 * by the `via` province owner (boxes [minLon, minLat, maxLon, maxLat]).
 */
export const RASTER_BARRIERS: readonly [number, number, number, number][] = [
  [28.95, 40.98, 29.2, 41.24], // Bosporus
  [26.15, 40.0, 26.75, 40.45], // Dardanelles
];

export const CANALS: readonly CanalSpec[] = [
  { label: 'Suez Canal', seaA: [32.4, 31.6], seaB: [32.6, 29.6], via: [32.3, 30.6], viaCountry: 'EGY' },
  { label: 'Panama Canal', seaA: [-79.9, 9.6], seaB: [-79.5, 8.6], via: [-79.7, 9.15], viaCountry: 'PAN' },
  { label: 'Bosporus', seaA: [29.6, 41.6], seaB: [28.6, 40.75], via: [28.98, 41.05], viaCountry: 'TUR' },
  { label: 'Dardanelles', seaA: [27.2, 40.6], seaB: [25.8, 39.9], via: [26.4, 40.15], viaCountry: 'TUR' },
  { label: 'Kiel Canal', seaA: [8.3, 54.1], seaB: [10.4, 54.6], via: [9.7, 54.3], viaCountry: 'DEU', optional: true },
];

/** Natural narrows below raster resolution (added only if the two zones are not already adjacent). */
export const SEA_LINKS: readonly SeaLinkSpec[] = [
  { label: 'Kerch Strait', a: [36.7, 45.6], b: [36.6, 45.0] },
  { label: 'Øresund', a: [12.7, 56.0], b: [12.9, 55.3] },
  { label: 'Great Belt', a: [11.0, 55.7], b: [11.0, 55.0] },
  { label: 'Strait of Gibraltar', a: [-6.2, 35.9], b: [-5.0, 36.0] },
  { label: 'Strait of Messina', a: [15.65, 38.4], b: [15.6, 37.9] },
  { label: 'Singapore Strait', a: [103.4, 1.1], b: [104.3, 1.3] },
  { label: 'Bab-el-Mandeb', a: [43.2, 12.9], b: [43.6, 12.4] },
  { label: 'Strait of Hormuz', a: [56.0, 26.6], b: [56.8, 26.3] },
  { label: 'Bering Strait', a: [-169.5, 66.5], b: [-169.0, 65.2] },
];
