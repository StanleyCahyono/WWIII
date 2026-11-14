/** Oceania · 3 country specs (owner: profiles agent). */
import type { CountrySpec } from './types';
import { D } from './helpers';

export const OCEANIA: CountrySpec[] = [
  {
    id: 'AUS',
    template: 'regional_industrial',
    doctrine: 'western',
    summary: 'Continental island: Sydney and Melbourne finance and industry, Pilbara rare materials and energy at Port Hedland and Karratha, a navy split between Sydney and Perth, very long internal distances.',
    intensity: 1.2,
    techs: ['nav_destroyer', 'nav_attack_submarine', 'avi_maritime_patrol', 'mob_lift_1', 'ind_extraction_1', 'land_marines'],
    cities: {
      canberra: { fn: ['finance', 'research', 'military'], b: { research_lab: 1 } },
      sydney: { fn: ['finance', 'port', 'military'], b: { naval_base: 3 } },
      melbourne: { fn: ['finance', 'industrial', 'port'], b: { arms_industry: 1 } },
      brisbane: { fn: ['industrial', 'port'] },
      perth: { fn: ['mining', 'port', 'military'], b: { naval_base: 2 } },
      adelaide: { fn: ['shipbuilding', 'port', 'industrial'], b: { arms_industry: 1 } },
      darwin: { fn: ['military', 'port', 'energy'] },
      'port-hedland': { fn: ['mining', 'port'] },
      karratha: { fn: ['energy', 'port'], b: { refinery: 1 } },
      kalgoorlie: { fn: ['mining'] },
      'mount-isa': { fn: ['mining'] },
    },
    rural: [{ deposit: 'rare', type: 'local_industry', level: 1, max: 3 }],
    army: 9,
    air: 7,
    navy: 9,
    decisions: [
      D('aus-distance', 'map', 'Bridge the distances', 'Perth to Sydney is 3,300 km; Darwin faces the north. Decide where the fleet and air wings sit.'),
      D('aus-pilbara', 'market', 'Export Pilbara rare materials', 'Port Hedland and Kalgoorlie produce rare materials industrial powers lack. Sell them or build an electronics plant.'),
      D('aus-partners', 'diplomacy', 'Pacific partners', 'Shared reports with the United States and New Zealand and right of way with Japan give a strong picture of the Pacific.'),
    ],
  },
  {
    id: 'NZL',
    template: 'island_state',
    doctrine: 'western',
    summary: 'Two-island state: Auckland finance and port, Wellington government, Christchurch agriculture; small professional forces far from any threat.',
    intensity: 1.15,
    techs: ['nav_frigate', 'land_mech_infantry'],
    cities: {
      wellington: { fn: ['finance', 'port', 'military'], b: { naval_base: 1 } },
      auckland: { fn: ['finance', 'port', 'industrial'], b: { naval_base: 1 } },
      christchurch: { fn: ['agriculture', 'port'] },
      'new-plymouth': { fn: ['energy', 'port'] },
    },
    navy: 3,
    decisions: [
      D('nzl-agri', 'market', 'Export agriculture', 'Christchurch and the farm provinces produce a supplies surplus; trade it for electronics.'),
      D('nzl-partners', 'diplomacy', 'Lean on Australia', 'Shared reports with Australia and the Northern Watch keep your picture fresh.'),
    ],
  },
  {
    id: 'PNG',
    template: 'archipelago',
    doctrine: 'western',
    difficulty: 'hard',
    summary: 'Mountainous main island and scattered islands: Port Moresby, Lae industry, Tabubil mining and gas; almost every route is by sea or air.',
    intensity: 0.65,
    cities: {
      'port-moresby': { fn: ['finance', 'port'] },
      lae: { fn: ['industrial', 'port', 'logistics'] },
      tabubil: { fn: ['mining'] },
      'mount-hagen': { fn: ['agriculture'] },
      kokopo: { fn: ['port'] },
    },
    army: 4,
    navy: 2,
    decisions: [
      D('png-sea', 'forces', 'Everything moves by sea', 'Lae, Madang and Kokopo connect only by sea. Your patrol boats are your road network.'),
      D('png-mines', 'market', 'Sell Tabubil resources', 'Tabubil mining produces rare materials; sell them to Australia.'),
    ],
  },
];
