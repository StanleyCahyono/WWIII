/**
 * Reviewed territory manifest — maps EVERY feature of the Natural Earth 1:50m admin-0
 * source (world-atlas@2.0.2 `countries-50m.json`, 241 features) to its campaign role.
 *
 * Owner: map agent. Consumed by scripts/build-map.ts; tests/map/* assert full coverage.
 *
 * Roles:
 *  - playable          — one of the 120 World 120 seats (`code` is the scenario CountryId).
 *  - dependent         — a dependent/associated territory that INHERITS a playable parent's game
 *                        ownership (`owner`). Explicitly reviewed below; nodes carry
 *                        territory.status = 'dependent' so the inspector can tag them.
 *  - outside_campaign  — an independent state (or micro-state / self-governing associated state)
 *                        not in the roster. Drawn with its own name, impassable, scores nothing.
 *  - disputed          — a separately drawn disputed area. Kept outside the campaign (impassable),
 *                        never silently granted to a neighbour; has a DisputedArea record.
 *  - antarctica        — outside the campaign.
 *
 * world-atlas features carry numeric ISO 3166-1 ids (`id`, zero-padded string) plus
 * `properties.name`. Some features have no id (Kosovo, N. Cyprus, Somaliland, Siachen Glacier,
 * Indian Ocean Ter.) and one id is duplicated (036 = Australia AND Ashmore and Cartier Is.),
 * so matching is by exact `name` first and the numeric id is cross-checked.
 */
import type { CountryId } from '../engine/data-types';

export type TerritoryRole = 'playable' | 'dependent' | 'outside_campaign' | 'disputed' | 'antarctica';

export interface TerritoryEntry {
  /** Exact `properties.name` in world-atlas countries-50m. */
  name: string;
  /** Numeric ISO 3166-1 id as stored in the source (null where the source has none). */
  num: string | null;
  /** ISO 3166-1 alpha-3 (or a documented user-assigned code where none exists). */
  code: string;
  /** Display name used on the base map / inspector. */
  display: string;
  role: TerritoryRole;
  /** For role 'dependent': the playable parent that owns it in the game. */
  owner?: CountryId;
  note?: string;
}

const P = (name: string, num: string, code: string, display?: string): TerritoryEntry => ({ name, num, code, display: display ?? name, role: 'playable' });
const D = (name: string, num: string | null, code: string, owner: CountryId, display: string, note: string): TerritoryEntry => ({ name, num, code, display, role: 'dependent', owner, note });
const O = (name: string, num: string | null, code: string, display?: string, note?: string): TerritoryEntry => ({ name, num, code, display: display ?? name, role: 'outside_campaign', note });
const X = (name: string, num: string | null, code: string, display: string, note: string): TerritoryEntry => ({ name, num, code, display, role: 'disputed', note });

export const TERRITORY_MANIFEST: readonly TerritoryEntry[] = [
  // ── Playable (120) ──
  P('Argentina', '032', 'ARG'), P('Bolivia', '068', 'BOL'), P('Brazil', '076', 'BRA'), P('Canada', '124', 'CAN'),
  P('Chile', '152', 'CHL'), P('Colombia', '170', 'COL'), P('Costa Rica', '188', 'CRI'), P('Cuba', '192', 'CUB'),
  P('Dominican Rep.', '214', 'DOM', 'Dominican Republic'), P('Ecuador', '218', 'ECU'), P('El Salvador', '222', 'SLV'),
  P('Guatemala', '320', 'GTM'), P('Guyana', '328', 'GUY'), P('Honduras', '340', 'HND'), P('Mexico', '484', 'MEX'),
  P('Nicaragua', '558', 'NIC'), P('Panama', '591', 'PAN'), P('Paraguay', '600', 'PRY'), P('Peru', '604', 'PER'),
  P('United States of America', '840', 'USA', 'United States'), P('Uruguay', '858', 'URY'), P('Venezuela', '862', 'VEN'),

  P('Albania', '008', 'ALB'), P('Austria', '040', 'AUT'), P('Belarus', '112', 'BLR'), P('Belgium', '056', 'BEL'),
  P('Bosnia and Herz.', '070', 'BIH', 'Bosnia and Herzegovina'), P('Bulgaria', '100', 'BGR'), P('Croatia', '191', 'HRV'),
  P('Czechia', '203', 'CZE'), P('Denmark', '208', 'DNK'), P('Estonia', '233', 'EST'), P('Finland', '246', 'FIN'),
  P('France', '250', 'FRA'), P('Germany', '276', 'DEU'), P('Greece', '300', 'GRC'), P('Hungary', '348', 'HUN'),
  P('Ireland', '372', 'IRL'), P('Italy', '380', 'ITA'), P('Latvia', '428', 'LVA'), P('Lithuania', '440', 'LTU'),
  P('Moldova', '498', 'MDA'), P('Netherlands', '528', 'NLD'), P('Norway', '578', 'NOR'), P('Poland', '616', 'POL'),
  P('Portugal', '620', 'PRT'), P('Romania', '642', 'ROU'), P('Russia', '643', 'RUS'), P('Serbia', '688', 'SRB'),
  P('Slovakia', '703', 'SVK'), P('Slovenia', '705', 'SVN'), P('Spain', '724', 'ESP'), P('Sweden', '752', 'SWE'),
  P('Switzerland', '756', 'CHE'), P('Ukraine', '804', 'UKR'), P('United Kingdom', '826', 'GBR'),

  P('Algeria', '012', 'DZA'), P('Angola', '024', 'AGO'), P('Cameroon', '120', 'CMR'), P("Côte d'Ivoire", '384', 'CIV', 'Côte d’Ivoire'),
  P('Dem. Rep. Congo', '180', 'COD', 'Democratic Republic of the Congo'), P('Egypt', '818', 'EGY'), P('Ethiopia', '231', 'ETH'),
  P('Ghana', '288', 'GHA'), P('Kenya', '404', 'KEN'), P('Libya', '434', 'LBY'), P('Morocco', '504', 'MAR'),
  P('Mozambique', '508', 'MOZ'), P('Nigeria', '566', 'NGA'), P('Senegal', '686', 'SEN'), P('South Africa', '710', 'ZAF'),
  P('Sudan', '729', 'SDN'), P('Tanzania', '834', 'TZA'), P('Tunisia', '788', 'TUN'),

  P('Armenia', '051', 'ARM'), P('Azerbaijan', '031', 'AZE'), P('Bahrain', '048', 'BHR'), P('Georgia', '268', 'GEO'),
  P('Iran', '364', 'IRN'), P('Iraq', '368', 'IRQ'), P('Israel', '376', 'ISR'), P('Jordan', '400', 'JOR'),
  P('Kazakhstan', '398', 'KAZ'), P('Kuwait', '414', 'KWT'), P('Kyrgyzstan', '417', 'KGZ'), P('Lebanon', '422', 'LBN'),
  P('Oman', '512', 'OMN'), P('Qatar', '634', 'QAT'), P('Saudi Arabia', '682', 'SAU'), P('Syria', '760', 'SYR'),
  P('Tajikistan', '762', 'TJK'), P('Turkey', '792', 'TUR', 'Türkiye'), P('Turkmenistan', '795', 'TKM'),
  P('United Arab Emirates', '784', 'ARE'), P('Uzbekistan', '860', 'UZB'), P('Yemen', '887', 'YEM'),

  P('Afghanistan', '004', 'AFG'), P('Bangladesh', '050', 'BGD'), P('Cambodia', '116', 'KHM'), P('China', '156', 'CHN'),
  P('India', '356', 'IND'), P('Indonesia', '360', 'IDN'), P('Japan', '392', 'JPN'), P('Laos', '418', 'LAO'),
  P('Malaysia', '458', 'MYS'), P('Mongolia', '496', 'MNG'), P('Myanmar', '104', 'MMR'), P('Nepal', '524', 'NPL'),
  P('North Korea', '408', 'PRK'), P('Pakistan', '586', 'PAK'), P('Philippines', '608', 'PHL'), P('Singapore', '702', 'SGP'),
  P('South Korea', '410', 'KOR'), P('Sri Lanka', '144', 'LKA'), P('Taiwan', '158', 'TWN'), P('Thailand', '764', 'THA'),
  P('Vietnam', '704', 'VNM'),

  P('Australia', '036', 'AUS'), P('New Zealand', '554', 'NZL'), P('Papua New Guinea', '598', 'PNG'),

  // ── Dependent territories inheriting a playable parent (reviewed) ──
  D('Greenland', '304', 'GRL', 'DNK', 'Greenland', 'Autonomous territory within the Kingdom of Denmark.'),
  D('Faeroe Is.', '234', 'FRO', 'DNK', 'Faroe Islands', 'Self-governing territory within the Kingdom of Denmark.'),
  D('Puerto Rico', '630', 'PRI', 'USA', 'Puerto Rico', 'US unincorporated territory (commonwealth).'),
  D('Guam', '316', 'GUM', 'USA', 'Guam', 'US unincorporated territory.'),
  D('U.S. Virgin Is.', '850', 'VIR', 'USA', 'US Virgin Islands', 'US unincorporated territory.'),
  D('N. Mariana Is.', '580', 'MNP', 'USA', 'Northern Mariana Islands', 'US commonwealth.'),
  D('American Samoa', '016', 'ASM', 'USA', 'American Samoa', 'US unincorporated territory.'),
  D('Isle of Man', '833', 'IMN', 'GBR', 'Isle of Man', 'British Crown dependency (defence by the UK).'),
  D('Jersey', '832', 'JEY', 'GBR', 'Jersey', 'British Crown dependency (defence by the UK).'),
  D('Guernsey', '831', 'GGY', 'GBR', 'Guernsey', 'British Crown dependency (defence by the UK).'),
  D('Falkland Is.', '238', 'FLK', 'GBR', 'Falkland Islands', 'British overseas territory; sovereignty claimed by Argentina (see DisputedArea "falklands").'),
  D('S. Geo. and the Is.', '239', 'SGS', 'GBR', 'South Georgia and the South Sandwich Islands', 'British overseas territory; claimed by Argentina (see DisputedArea "south-georgia").'),
  D('Br. Indian Ocean Ter.', '086', 'IOT', 'GBR', 'British Indian Ocean Territory', 'British overseas territory; sovereignty claimed by Mauritius (see DisputedArea "chagos").'),
  D('Bermuda', '060', 'BMU', 'GBR', 'Bermuda', 'British overseas territory.'),
  D('Cayman Is.', '136', 'CYM', 'GBR', 'Cayman Islands', 'British overseas territory.'),
  D('Turks and Caicos Is.', '796', 'TCA', 'GBR', 'Turks and Caicos Islands', 'British overseas territory.'),
  D('British Virgin Is.', '092', 'VGB', 'GBR', 'British Virgin Islands', 'British overseas territory.'),
  D('Anguilla', '660', 'AIA', 'GBR', 'Anguilla', 'British overseas territory.'),
  D('Montserrat', '500', 'MSR', 'GBR', 'Montserrat', 'British overseas territory.'),
  D('Saint Helena', '654', 'SHN', 'GBR', 'Saint Helena, Ascension and Tristan da Cunha', 'British overseas territory.'),
  D('Pitcairn Is.', '612', 'PCN', 'GBR', 'Pitcairn Islands', 'British overseas territory.'),
  D('New Caledonia', '540', 'NCL', 'FRA', 'New Caledonia', 'French sui generis collectivity.'),
  D('Fr. Polynesia', '258', 'PYF', 'FRA', 'French Polynesia', 'French overseas collectivity.'),
  D('St. Pierre and Miquelon', '666', 'SPM', 'FRA', 'Saint Pierre and Miquelon', 'French overseas collectivity.'),
  D('Wallis and Futuna Is.', '876', 'WLF', 'FRA', 'Wallis and Futuna', 'French overseas collectivity.'),
  D('St-Martin', '663', 'MAF', 'FRA', 'Saint Martin (French part)', 'French overseas collectivity.'),
  D('St-Barthélemy', '652', 'BLM', 'FRA', 'Saint Barthélemy', 'French overseas collectivity.'),
  D('Fr. S. Antarctic Lands', '260', 'ATF', 'FRA', 'French Southern Lands', 'French overseas territory (Kerguelen etc.).'),
  D('Aruba', '533', 'ABW', 'NLD', 'Aruba', 'Constituent country of the Kingdom of the Netherlands (defence by the Kingdom).'),
  D('Curaçao', '531', 'CUW', 'NLD', 'Curaçao', 'Constituent country of the Kingdom of the Netherlands (defence by the Kingdom).'),
  D('Sint Maarten', '534', 'SXM', 'NLD', 'Sint Maarten', 'Constituent country of the Kingdom of the Netherlands (defence by the Kingdom).'),
  D('Åland', '248', 'ALA', 'FIN', 'Åland Islands', 'Autonomous, demilitarised region of Finland.'),
  D('Hong Kong', '344', 'HKG', 'CHN', 'Hong Kong', 'Special administrative region of China (tagged dependent for the inspector).'),
  D('Macao', '446', 'MAC', 'CHN', 'Macau', 'Special administrative region of China (tagged dependent for the inspector).'),
  D('Indian Ocean Ter.', null, 'IOA', 'AUS', 'Australian Indian Ocean Territories', 'Christmas Island and Cocos (Keeling) Islands; source has no numeric id (user code IOA).'),
  D('Norfolk Island', '574', 'NFK', 'AUS', 'Norfolk Island', 'Australian external territory.'),
  D('Heard I. and McDonald Is.', '334', 'HMD', 'AUS', 'Heard Island and McDonald Islands', 'Australian external territory.'),
  D('Ashmore and Cartier Is.', '036', 'ATC', 'AUS', 'Ashmore and Cartier Islands', 'Australian external territory; source reuses id 036 (matched by name).'),

  // ── Disputed areas drawn as separate features (outside the campaign, never granted to a neighbour) ──
  X('W. Sahara', '732', 'ESH', 'Western Sahara', 'Non-self-governing territory; status disputed between Morocco and the Sahrawi Arab Democratic Republic.'),
  X('Kosovo', null, 'XKX', 'Kosovo', 'Declared independence 2008; claimed by Serbia. Source has no numeric id (user code XKX).'),
  X('N. Cyprus', null, 'CYN', 'Northern Cyprus', 'Recognised only by Türkiye; claimed by Cyprus. Source has no numeric id (user code CYN).'),
  X('Somaliland', null, 'SOL', 'Somaliland', 'Self-declared state; claimed by Somalia. Source has no numeric id (user code SOL).'),
  X('Siachen Glacier', null, 'KAS', 'Siachen Glacier', 'Disputed between India and Pakistan (Indian-administered in practice). Kept neutral and impassable.'),
  X('Palestine', '275', 'PSE', 'Palestinian territories', 'West Bank and Gaza Strip; not in the roster; status disputed. Kept outside the campaign.'),

  // ── Antarctica ──
  { name: 'Antarctica', num: '010', code: 'ATA', display: 'Antarctica', role: 'antarctica', note: 'Outside the campaign (Antarctic Treaty).' },

  // ── Outside the campaign: independent states not in the roster, micro-states, associated states ──
  O('Zimbabwe', '716', 'ZWE'), O('Zambia', '894', 'ZMB'), O('Vatican', '336', 'VAT', 'Vatican City'), O('Vanuatu', '548', 'VUT'),
  O('Micronesia', '583', 'FSM'), O('Marshall Is.', '584', 'MHL', 'Marshall Islands'), O('Uganda', '800', 'UGA'),
  O('Trinidad and Tobago', '780', 'TTO'), O('Tonga', '776', 'TON'), O('Togo', '768', 'TGO'), O('Timor-Leste', '626', 'TLS'),
  O('eSwatini', '748', 'SWZ', 'Eswatini'), O('Suriname', '740', 'SUR'), O('S. Sudan', '728', 'SSD', 'South Sudan'),
  O('Somalia', '706', 'SOM'), O('Solomon Is.', '090', 'SLB', 'Solomon Islands'), O('Sierra Leone', '694', 'SLE'),
  O('Seychelles', '690', 'SYC'), O('São Tomé and Principe', '678', 'STP', 'São Tomé and Príncipe'), O('San Marino', '674', 'SMR'),
  O('Samoa', '882', 'WSM'), O('St. Vin. and Gren.', '670', 'VCT', 'Saint Vincent and the Grenadines'), O('Saint Lucia', '662', 'LCA'),
  O('St. Kitts and Nevis', '659', 'KNA', 'Saint Kitts and Nevis'), O('Rwanda', '646', 'RWA'), O('Palau', '585', 'PLW'),
  O('Niger', '562', 'NER'), O('Niue', '570', 'NIU', 'Niue', 'Self-governing state in free association with New Zealand; kept outside.'),
  O('Cook Is.', '184', 'COK', 'Cook Islands', 'Self-governing state in free association with New Zealand; kept outside.'),
  O('Nauru', '520', 'NRU'), O('Namibia', '516', 'NAM'), O('Montenegro', '499', 'MNE'), O('Monaco', '492', 'MCO'),
  O('Mauritius', '480', 'MUS'), O('Mauritania', '478', 'MRT'), O('Malta', '470', 'MLT'), O('Mali', '466', 'MLI'),
  O('Maldives', '462', 'MDV'), O('Malawi', '454', 'MWI'), O('Madagascar', '450', 'MDG'), O('Macedonia', '807', 'MKD', 'North Macedonia'),
  O('Luxembourg', '442', 'LUX'), O('Liechtenstein', '438', 'LIE'), O('Liberia', '430', 'LBR'), O('Lesotho', '426', 'LSO'),
  O('Kiribati', '296', 'KIR'), O('Jamaica', '388', 'JAM'), O('Iceland', '352', 'ISL'), O('Haiti', '332', 'HTI'),
  O('Guinea-Bissau', '624', 'GNB'), O('Guinea', '324', 'GIN'), O('Grenada', '308', 'GRD'), O('Gambia', '270', 'GMB'),
  O('Gabon', '266', 'GAB'), O('Fiji', '242', 'FJI'), O('Eritrea', '232', 'ERI'), O('Eq. Guinea', '226', 'GNQ', 'Equatorial Guinea'),
  O('Dominica', '212', 'DMA'), O('Djibouti', '262', 'DJI'), O('Cyprus', '196', 'CYP'), O('Congo', '178', 'COG', 'Republic of the Congo'),
  O('Comoros', '174', 'COM'), O('Chad', '148', 'TCD'), O('Central African Rep.', '140', 'CAF', 'Central African Republic'),
  O('Cabo Verde', '132', 'CPV'), O('Burundi', '108', 'BDI'), O('Burkina Faso', '854', 'BFA'), O('Brunei', '096', 'BRN'),
  O('Botswana', '072', 'BWA'), O('Bhutan', '064', 'BTN'), O('Benin', '204', 'BEN'), O('Belize', '084', 'BLZ'),
  O('Barbados', '052', 'BRB'), O('Bahamas', '044', 'BHS'), O('Antigua and Barb.', '028', 'ATG', 'Antigua and Barbuda'),
  O('Andorra', '020', 'AND'),
];

/**
 * Parts of a playable feature that are tagged as dependent territories (status 'dependent')
 * although the source draws them inside the parent feature. Matched by part centroid inside bbox.
 * French overseas departments are integral parts of France; they are tagged so the inspector
 * shows their territory name, as required by the territory policy.
 */
export interface PartTag {
  feature: string;
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  code: string;
  display: string;
  note: string;
}

export const PART_TAGS: readonly PartTag[] = [
  { feature: 'France', bbox: [-55, 1, -51, 6.5], code: 'GUF', display: 'French Guiana', note: 'French overseas department/region.' },
  { feature: 'France', bbox: [-62, 15.8, -60.9, 16.6], code: 'GLP', display: 'Guadeloupe', note: 'French overseas department/region.' },
  { feature: 'France', bbox: [-61.3, 14.3, -60.7, 15], code: 'MTQ', display: 'Martinique', note: 'French overseas department/region.' },
  { feature: 'France', bbox: [55, -21.5, 56, -20.7], code: 'REU', display: 'Réunion', note: 'French overseas department/region.' },
  { feature: 'France', bbox: [44.9, -13.1, 45.4, -12.5], code: 'MYT', display: 'Mayotte', note: 'French overseas department.' },
  { feature: 'Netherlands', bbox: [-69, 11.9, -62.8, 18], code: 'BES', display: 'Caribbean Netherlands', note: 'Special municipalities of the Netherlands.' },
];

/**
 * Disputed areas that the source draws INSIDE a playable feature (de facto line). They stay with
 * the administering country per the source but get an explicit DisputedArea record. Province
 * selection: provinces of `administeredBy` whose centre lies inside `bbox`, plus the provinces
 * containing any `refPoints`.
 */
export interface DisputedSpec {
  id: string;
  name: string;
  /** Feature-based disputed areas (outside the campaign) reference the manifest code. */
  featureCode?: string;
  administeredBy: CountryId | null;
  claimants: string[];
  bbox?: [number, number, number, number];
  refPoints?: [number, number][];
  source: string;
  displayPolicy: string;
}

const NE = 'Natural Earth 1:50m admin-0 (de facto boundaries) via world-atlas@2.0.2';

export const DISPUTED_SPECS: readonly DisputedSpec[] = [
  { id: 'western-sahara', name: 'Western Sahara', featureCode: 'ESH', administeredBy: null, claimants: ['MAR', 'SADR'], source: NE, displayPolicy: 'Drawn as its own disputed territory with a neutral hatch and the label "Western Sahara". Outside the campaign; not granted to Morocco or any other seat.' },
  { id: 'kosovo', name: 'Kosovo', featureCode: 'XKX', administeredBy: null, claimants: ['XKX', 'SRB'], source: NE, displayPolicy: 'Drawn with its own name and a disputed hatch. Outside the campaign; not granted to Serbia.' },
  { id: 'northern-cyprus', name: 'Northern Cyprus', featureCode: 'CYN', administeredBy: null, claimants: ['CYN', 'CYP'], source: NE, displayPolicy: 'Drawn with its own name and a disputed hatch. Outside the campaign (Cyprus is also outside).' },
  { id: 'somaliland', name: 'Somaliland', featureCode: 'SOL', administeredBy: null, claimants: ['SOL', 'SOM'], source: NE, displayPolicy: 'Drawn with its own name and a disputed hatch. Outside the campaign (Somalia is also outside).' },
  { id: 'siachen', name: 'Siachen Glacier', featureCode: 'KAS', administeredBy: null, claimants: ['IND', 'PAK'], source: NE, displayPolicy: 'Neutral disputed hatch, impassable glacier zone. Not granted to either claimant.' },
  { id: 'palestine', name: 'Palestinian territories', featureCode: 'PSE', administeredBy: null, claimants: ['PSE', 'ISR'], source: NE, displayPolicy: 'Drawn with the label "Palestinian territories" and a disputed hatch. Outside the campaign; not granted to any seat.' },
  { id: 'western-sahara-moroccan', name: 'Western Sahara (Moroccan-administered part)', administeredBy: 'MAR', claimants: ['MAR', 'SADR'], bbox: [-17.5, 20.5, -8.6, 27.66], refPoints: [[-13.2, 27.15], [-15.9, 23.7]], source: NE + ' (source draws the area west of the berm inside the "Morocco" feature)', displayPolicy: 'Administered by Morocco at campaign start per the source’s de facto line; non-self-governing territory claimed by the Sahrawi Arab Democratic Republic. Provinces carry regional names (Saguia el-Hamra, Río de Oro), no city is placed here, and the inspector shows the dispute. The area east of the berm is the separate outside-campaign record "western-sahara". No position implied.' },
  { id: 'crimea', name: 'Crimea', administeredBy: 'RUS', claimants: ['UKR', 'RUS'], bbox: [32.4, 44.3, 36.7, 46.2], refPoints: [[34.1, 45.0], [33.52, 44.62]], source: NE + ' (source draws Crimea inside Russia)', displayPolicy: 'Administered by Russia at campaign start per the source’s de facto line; internationally recognised as part of Ukraine. Inspector shows "Disputed: claimed by Ukraine". No position implied.' },
  { id: 'golan', name: 'Golan Heights', administeredBy: 'ISR', claimants: ['SYR', 'ISR'], refPoints: [[35.75, 33.0]], source: NE + ' (source draws the Golan inside Israel)', displayPolicy: 'Administered by Israel at campaign start per the source; claimed by Syria. Inspector shows the dispute.' },
  { id: 'kashmir-india', name: 'Jammu and Kashmir and Ladakh (Indian-administered)', administeredBy: 'IND', claimants: ['IND', 'PAK', 'CHN'], bbox: [73.5, 32.3, 80.3, 36.0], refPoints: [[74.8, 34.08], [77.58, 34.16]], source: NE, displayPolicy: 'Indian-administered part of Kashmir per the source line of control; claimed in part by Pakistan and China. Inspector shows the dispute.' },
  { id: 'kashmir-pakistan', name: 'Azad Kashmir and Gilgit-Baltistan (Pakistani-administered)', administeredBy: 'PAK', claimants: ['PAK', 'IND'], bbox: [73.3, 33.2, 77.9, 37.1], refPoints: [[74.31, 35.92], [73.47, 34.37]], source: NE, displayPolicy: 'Pakistani-administered part of Kashmir per the source line of control; claimed by India. Inspector shows the dispute.' },
  { id: 'aksai-chin', name: 'Aksai Chin', administeredBy: 'CHN', claimants: ['CHN', 'IND'], refPoints: [[79.3, 35.2]], source: NE, displayPolicy: 'Chinese-administered per the source; claimed by India. Inspector shows the dispute.' },
  { id: 'arunachal', name: 'Arunachal Pradesh', administeredBy: 'IND', claimants: ['IND', 'CHN'], bbox: [91.6, 26.7, 97.4, 29.4], refPoints: [[93.62, 27.08]], source: NE, displayPolicy: 'Indian-administered; claimed by China. Inspector shows the dispute.' },
  { id: 'kurils', name: 'Southern Kuril Islands', administeredBy: 'RUS', claimants: ['RUS', 'JPN'], bbox: [145.4, 43.3, 148.9, 45.6], refPoints: [[146.6, 44.4]], source: NE, displayPolicy: 'Administered by Russia; claimed by Japan. Inspector shows the dispute.' },
  { id: 'falklands', name: 'Falkland Islands', administeredBy: 'GBR', claimants: ['GBR', 'ARG'], bbox: [-61.5, -52.5, -57.5, -50.9], refPoints: [[-59.0, -51.7]], source: NE + ' (separate feature, dependent of GBR in the game)', displayPolicy: 'British overseas territory inheriting United Kingdom ownership; sovereignty claimed by Argentina. Inspector shows the dispute.' },
  { id: 'south-georgia', name: 'South Georgia', administeredBy: 'GBR', claimants: ['GBR', 'ARG'], bbox: [-38.5, -55, -35.5, -53.8], refPoints: [[-36.6, -54.3]], source: NE, displayPolicy: 'British overseas territory; claimed by Argentina. Inspector shows the dispute.' },
  { id: 'chagos', name: 'Chagos Archipelago', administeredBy: 'GBR', claimants: ['GBR', 'MUS'], bbox: [70.5, -8, 73, -4.5], refPoints: [[72.42, -7.32]], source: NE, displayPolicy: 'British Indian Ocean Territory at campaign start; sovereignty claimed by Mauritius. Inspector shows the dispute.' },
  { id: 'abkhazia', name: 'Abkhazia', administeredBy: 'GEO', claimants: ['GEO'], bbox: [40.0, 42.4, 42.2, 43.6], refPoints: [[41.02, 43.0]], source: NE + ' (source draws it inside Georgia)', displayPolicy: 'Breakaway region recognised by few states; the game assigns it to Georgia’s homeland per the source. No extra seat is created.' },
  { id: 'south-ossetia', name: 'South Ossetia', administeredBy: 'GEO', claimants: ['GEO'], bbox: [43.4, 42.0, 44.6, 42.7], refPoints: [[43.96, 42.23]], source: NE + ' (source draws it inside Georgia)', displayPolicy: 'Breakaway region; assigned to Georgia per the source. No extra seat is created.' },
  { id: 'transnistria', name: 'Transnistria', administeredBy: 'MDA', claimants: ['MDA'], bbox: [28.9, 46.4, 30.2, 48.2], refPoints: [[29.63, 46.84]], source: NE + ' (source draws it inside Moldova)', displayPolicy: 'Breakaway region; assigned to Moldova per the source. No extra seat is created.' },
];

export const MANIFEST_BY_NAME: ReadonlyMap<string, TerritoryEntry> = new Map(TERRITORY_MANIFEST.map((e) => [e.name, e]));
