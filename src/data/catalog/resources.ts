/**
 * Resource catalog — World Command: World 120.
 *
 * Seven accounts, each with a distinct economic job ("give every material a reason to exist").
 * Reference prices are FIXED published game values (money = 1). They feed the opening power
 * index and AI valuation only; live market prices float independently.
 * All numbers are fictional balance values.
 */
import type { Resource, ResourceDef, ResVec } from '../../engine/data-types';

export const RESOURCE_DEFS: ResourceDef[] = [
  {
    id: 'supplies',
    name: 'Supplies',
    role:
      'Rations, ammunition and general stores. The bulk input of infantry mobilization, every formation\'s daily upkeep and most construction. Running short lowers readiness everywhere at once.',
    referencePrice: 3,
  },
  {
    id: 'components',
    name: 'Components',
    role:
      'Machined parts, steel and heavy assemblies. The backbone of armor, artillery, ships and buildings. Shipyards and tank lines compete for it.',
    referencePrice: 6,
  },
  {
    id: 'electronics',
    name: 'Electronics',
    role:
      'Sensors, avionics, radios and guidance sets. Aircraft, radars, air defence, missiles and research all draw on it, so it decides how fast a country can modernize.',
    referencePrice: 12,
  },
  {
    id: 'fuel',
    name: 'Fuel',
    role:
      'Refined fuels for vehicles, aircraft and ships. Paid mainly as upkeep and for long transfers and lift. A fuel shortage grounds air wings and slows fleets before it hurts infantry.',
    referencePrice: 5,
  },
  {
    id: 'rare',
    name: 'Rare materials',
    role:
      'Specialty alloys, rare earths and composites. Small quantities gate advanced units, stealth airframes, missiles and the hypersonic programs; usually the import pressure of an industrial power.',
    referencePrice: 20,
  },
  {
    id: 'manpower',
    name: 'Manpower',
    role:
      'Recruits and trained crews. Every unit needs some; infantry needs a lot. Regenerates from population, recruiting offices and hospitals rather than from industry.',
    referencePrice: 4,
  },
  {
    id: 'money',
    name: 'Money',
    role:
      'Treasury funds for wages, procurement, research contracts and market trades. The universal account: it buys anything on the market but cannot replace a missing factory.',
    referencePrice: 1,
  },
];

export const RESOURCE_BY_ID: Record<Resource, ResourceDef> = Object.fromEntries(
  RESOURCE_DEFS.map((r) => [r.id, r]),
) as Record<Resource, ResourceDef>;

/** Value of a resource vector at the fixed published reference basket (money units). */
export function referenceValue(v: ResVec): number {
  let total = 0;
  for (const [k, q] of Object.entries(v)) {
    const def = RESOURCE_BY_ID[k as Resource];
    if (def && q) total += def.referencePrice * q;
  }
  return total;
}
