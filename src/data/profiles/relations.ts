/**
 * Initial diplomatic stances (owner: profiles agent). Fictional-modern and authored.
 *
 * Status semantics (engine): 'right_of_way' and 'shared_intel' are directional grants; every
 * pair authored here is written in BOTH directions so the opening is symmetric. No seat starts
 * at war. `trust` is the authored base value; the engine adds a seeded ±10 variation.
 *
 * Blocs are fictional game groupings (they are not coalitions in the scoring sense):
 *  - Atlantic Compact (collective-defence bloc): right of way among members.
 *  - Northern Watch (intelligence-sharing core): shared intel.
 *  - Eurasian Accord: right of way; Moscow–Minsk shared intel.
 *  - Gulf Council, Southern Cone Pact: right of way.
 *  - Pacific partnerships: bilateral right of way / shared intel with the United States.
 */
import type { CountryId } from '../../engine/data-types';

type Status = 'peace' | 'right_of_way' | 'shared_intel' | 'war';
interface Rel {
  with: CountryId;
  status: Status;
  trust?: number;
}

export const BLOCS: { id: string; name: string; status: Status; trust: number; members: CountryId[] }[] = [
  {
    id: 'atlantic',
    name: 'Atlantic Compact',
    status: 'right_of_way',
    trust: 35,
    members: ['USA', 'CAN', 'GBR', 'FRA', 'DEU', 'ITA', 'ESP', 'PRT', 'NLD', 'BEL', 'DNK', 'NOR', 'POL', 'CZE', 'SVK', 'HUN', 'ROU', 'BGR', 'GRC', 'TUR', 'EST', 'LVA', 'LTU', 'HRV', 'SVN', 'ALB', 'FIN', 'SWE'],
  },
  { id: 'northern_watch', name: 'Northern Watch', status: 'shared_intel', trust: 55, members: ['USA', 'GBR', 'CAN', 'AUS', 'NZL'] },
  { id: 'eurasian', name: 'Eurasian Accord', status: 'right_of_way', trust: 30, members: ['RUS', 'BLR', 'KAZ', 'KGZ', 'TJK', 'ARM'] },
  { id: 'gulf', name: 'Gulf Council', status: 'right_of_way', trust: 30, members: ['SAU', 'ARE', 'KWT', 'QAT', 'BHR', 'OMN'] },
  { id: 'southern_cone', name: 'Southern Cone Pact', status: 'right_of_way', trust: 25, members: ['BRA', 'ARG', 'URY', 'PRY'] },
];

/** Bilateral authored pairs (applied symmetrically; later entries override bloc defaults). */
export const PAIRS: [CountryId, CountryId, Status, number][] = [
  // Pacific partnerships
  ['USA', 'JPN', 'shared_intel', 50],
  ['USA', 'KOR', 'shared_intel', 45],
  ['USA', 'AUS', 'shared_intel', 55],
  ['USA', 'PHL', 'right_of_way', 30],
  ['USA', 'SGP', 'right_of_way', 30],
  ['USA', 'TWN', 'peace', 30],
  ['USA', 'ISR', 'shared_intel', 40],
  ['USA', 'SAU', 'peace', 20],
  ['USA', 'MEX', 'peace', 25],
  ['JPN', 'AUS', 'right_of_way', 35],
  ['JPN', 'KOR', 'peace', 10],
  ['AUS', 'NZL', 'shared_intel', 60],
  ['AUS', 'PNG', 'right_of_way', 30],
  ['GBR', 'FRA', 'shared_intel', 40],
  ['FRA', 'DEU', 'shared_intel', 40],
  ['DEU', 'NLD', 'shared_intel', 40],
  ['POL', 'LTU', 'shared_intel', 40],
  ['EST', 'LVA', 'shared_intel', 45],
  ['LVA', 'LTU', 'shared_intel', 45],
  ['FIN', 'SWE', 'shared_intel', 50],
  ['NOR', 'SWE', 'shared_intel', 40],
  ['DNK', 'NOR', 'shared_intel', 40],
  ['AUT', 'DEU', 'right_of_way', 30],
  ['CHE', 'AUT', 'peace', 30],
  ['IRL', 'GBR', 'peace', 30],
  // Eurasian side
  ['RUS', 'BLR', 'shared_intel', 50],
  ['RUS', 'CHN', 'peace', 20],
  ['CHN', 'PRK', 'right_of_way', 20],
  ['CHN', 'PAK', 'shared_intel', 40],
  ['CHN', 'KHM', 'right_of_way', 20],
  ['CHN', 'LAO', 'right_of_way', 15],
  ['RUS', 'SYR', 'right_of_way', 20],
  ['IRN', 'SYR', 'right_of_way', 25],
  ['RUS', 'IRN', 'peace', 15],
  ['RUS', 'SRB', 'peace', 20],
  ['RUS', 'UZB', 'peace', 10],
  ['RUS', 'TKM', 'peace', 5],
  // Regional partners
  ['IND', 'BGD', 'peace', 15],
  ['IND', 'NPL', 'right_of_way', 20],
  ['IND', 'LKA', 'peace', 15],
  ['TUR', 'AZE', 'shared_intel', 45],
  ['EGY', 'SAU', 'right_of_way', 25],
  ['EGY', 'ARE', 'peace', 25],
  ['JOR', 'SAU', 'peace', 25],
  ['SGP', 'MYS', 'right_of_way', 25],
  ['MYS', 'IDN', 'peace', 20],
  ['IDN', 'SGP', 'peace', 20],
  ['THA', 'KHM', 'peace', 0],
  ['ZAF', 'MOZ', 'right_of_way', 20],
  ['KEN', 'TZA', 'right_of_way', 20],
  ['NGA', 'GHA', 'peace', 20],
  ['SEN', 'CIV', 'peace', 20],
  ['MAR', 'SEN', 'peace', 20],
  ['COL', 'PER', 'peace', 15],
  ['CHL', 'PER', 'peace', 5],
  ['CUB', 'VEN', 'right_of_way', 30],
  ['NIC', 'VEN', 'peace', 20],
  ['CRI', 'PAN', 'right_of_way', 25],
  ['GTM', 'HND', 'right_of_way', 20],
  ['HND', 'SLV', 'right_of_way', 20],
  ['DOM', 'CUB', 'peace', 5],
  ['ECU', 'COL', 'peace', 10],
  ['BOL', 'PER', 'right_of_way', 20],
  ['GUY', 'BRA', 'peace', 15],
  ['MNG', 'RUS', 'peace', 10],
  ['MNG', 'CHN', 'peace', 5],
  ['NZL', 'PNG', 'peace', 25],
  // Low-trust pairs (peace, no war at start)
  ['RUS', 'UKR', 'peace', -60],
  ['IND', 'PAK', 'peace', -45],
  ['KOR', 'PRK', 'peace', -55],
  ['CHN', 'TWN', 'peace', -45],
  ['ISR', 'IRN', 'peace', -60],
  ['ISR', 'SYR', 'peace', -45],
  ['ISR', 'LBN', 'peace', -35],
  ['ARM', 'AZE', 'peace', -50],
  ['SAU', 'IRN', 'peace', -30],
  ['SAU', 'YEM', 'peace', -35],
  ['USA', 'IRN', 'peace', -45],
  ['USA', 'PRK', 'peace', -55],
  ['USA', 'CUB', 'peace', -20],
  ['USA', 'VEN', 'peace', -20],
  ['GRC', 'TUR', 'right_of_way', -5],
  ['CHN', 'IND', 'peace', -20],
  ['CHN', 'JPN', 'peace', -20],
  ['CHN', 'VNM', 'peace', -15],
  ['CHN', 'PHL', 'peace', -20],
  ['JPN', 'PRK', 'peace', -40],
  ['RUS', 'POL', 'peace', -40],
  ['RUS', 'EST', 'peace', -35],
  ['RUS', 'LVA', 'peace', -35],
  ['RUS', 'LTU', 'peace', -35],
  ['RUS', 'GEO', 'peace', -35],
  ['RUS', 'FIN', 'peace', -25],
  ['UKR', 'BLR', 'peace', -25],
  ['UKR', 'POL', 'right_of_way', 30],
  ['UKR', 'ROU', 'peace', 15],
  ['UKR', 'MDA', 'right_of_way', 20],
  ['DZA', 'MAR', 'peace', -30],
  ['EGY', 'ETH', 'peace', -25],
  ['ETH', 'SDN', 'peace', -15],
  ['VEN', 'GUY', 'peace', -30],
  ['VEN', 'COL', 'peace', -15],
  ['SRB', 'HRV', 'peace', -10],
  ['SRB', 'BIH', 'peace', -5],
  ['AFG', 'PAK', 'peace', -20],
  ['IRQ', 'IRN', 'peace', 10],
  ['QAT', 'SAU', 'right_of_way', 10],
  ['TUR', 'SYR', 'peace', -30],
  ['KGZ', 'TJK', 'right_of_way', -10],
];

const TABLE = new Map<CountryId, Map<CountryId, Rel>>();
function set(a: CountryId, b: CountryId, status: Status, trust: number): void {
  if (a === b) return;
  for (const [x, y] of [
    [a, b],
    [b, a],
  ]) {
    const m = TABLE.get(x) ?? new Map<CountryId, Rel>();
    m.set(y, { with: y, status, trust });
    TABLE.set(x, m);
  }
}
for (const bloc of BLOCS) for (const a of bloc.members) for (const b of bloc.members) if (a < b) set(a, b, bloc.status, bloc.trust);
for (const [a, b, s, t] of PAIRS) set(a, b, s, t);

/** Authored relations of one seat, sorted by partner id. */
export function relationsFor(id: CountryId): Rel[] {
  const m = TABLE.get(id);
  if (!m) return [];
  return [...m.values()].sort((x, y) => (x.with < y.with ? -1 : 1)).map((r) => ({ ...r }));
}
