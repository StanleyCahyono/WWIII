/**
 * Deterministic default CountryProfile synthesized from map data when an authored profile is
 * missing (keeps every seat playable until the profiles agent supplies real data).
 * Rules: city output by tier; garrison of one capture-capable starter unit per city (two at
 * tier ≥ 3, plus one armour-family starter unit in the capital when available); stockpile scaled
 * by Σ city tiers; doctrine by region; neutral personality from a seeded hash.
 */
import type { CountryId, CountryProfile, Doctrine, MapData, ResVec, UnitType } from '../data-types';
import type { Catalog } from './types';
import { hash32 } from '../rng';

export function defaultCityOutput(tier: number): ResVec {
  return {
    supplies: 40 * tier,
    components: 20 * tier,
    electronics: 8 * tier,
    fuel: 15 * tier,
    rare: 4 * tier,
    manpower: 10 * tier,
    money: 60 * tier,
  };
}

function starter(catalog: Catalog, pred: (u: UnitType) => boolean): UnitType | undefined {
  return [...catalog.units]
    .filter((u) => !u.unlockTech && u.requires.length === 0 && pred(u))
    .sort((a, b) => (a.cost.money ?? 0) - (b.cost.money ?? 0) || (a.id < b.id ? -1 : 1))[0];
}

export function synthesizeProfile(map: MapData, catalog: Catalog, c: CountryId, name?: string): CountryProfile {
  const mc = map.countries.find((x) => x.id === c);
  const cities = map.cities.filter((x) => x.country === c);
  const region = mc?.region ?? 'Europe';
  const doctrine: Doctrine = region === 'Europe' ? 'european' : region === 'West and Central Asia' || region === 'South, East and Southeast Asia' ? 'eastern' : 'western';
  const inf = starter(catalog, (u) => u.capture && u.domain === 'land');
  const arm = starter(catalog, (u) => u.family === 'armor');
  const forces: CountryProfile['forces'] = [];
  for (const city of cities) {
    if (inf) forces.push({ unit: inf.id, count: city.tier >= 3 ? 2 : 1, at: city.key, readiness: 90, designation: `${city.name} Garrison` });
    if (arm && city.capital) forces.push({ unit: arm.id, count: 1, at: city.key, readiness: 90, designation: `${city.name} Armoured Group` });
  }
  const tiers = cities.reduce((a, x) => a + x.tier, 0) || 1;
  const h = hash32(c);
  const p = (k: number) => Math.round((0.35 + ((h >>> (k * 4)) % 30) / 100) * 100) / 100;
  return {
    id: c,
    name: name ?? mc?.name ?? c,
    region,
    doctrine,
    template: 'synthesized-default',
    startDifficulty: tiers >= 12 ? 'easy' : tiers >= 5 ? 'moderate' : 'hard',
    summary: 'Synthesized default profile (authored profile not yet available).',
    cities: cities.map((x) => ({ city: x.key, functions: [], buildings: [], output: defaultCityOutput(x.tier) })),
    stockpile: { supplies: 300 * tiers, components: 150 * tiers, electronics: 60 * tiers, fuel: 120 * tiers, rare: 30 * tiers, manpower: 100 * tiers, money: 600 * tiers },
    forces,
    techs: [],
    lift: Math.max(1, Math.round(tiers / 4)),
    maintenanceSlots: 1,
    tradeNeeds: [],
    openingDecisions: [
      { id: 'research', title: 'Start a research program', detail: 'Pick a first technology.', screen: 'research' },
      { id: 'build', title: 'Invest in your capital', detail: 'Queue a building in your capital.', screen: 'cities' },
      { id: 'neighbours', title: 'Inspect your neighbours', detail: 'Open diplomacy and check relations.', screen: 'diplomacy' },
    ],
    personality: { aggression: p(0), caution: p(1), trade: p(2), loyalty: p(3), expansion: p(4), research: p(5) },
  };
}
