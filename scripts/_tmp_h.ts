import { buildWorld120Scenario, createCampaign } from '../src/engine/index';
import { loadMapData } from '../src/data/map-index';
import { CATALOG } from '../src/data/catalog/index';
import { MANIFEST } from '../src/data/countries';
import { PROFILES, PROFILE_ISSUES, PROFILE_PLANS } from '../src/data/profiles/index';
const t0 = Date.now();
console.log("issues", PROFILE_ISSUES, PROFILES.length);
const sc = buildWorld120Scenario({ map: loadMapData(), catalog: CATALOG as any, manifest: MANIFEST, profiles: PROFILES });
const st = createCampaign({ seed: 120, humanCountry: null, scenario: sc });
const op = st.openingPower!;
console.log(Date.now() - t0, 'ms');
console.log('norm', op.normalization);
for (const c of op.rank.slice(0, 25)) { const r = op.raw[c]; console.log(c.padEnd(4), String(op.composite[c]).padStart(7), Object.values(r).map(v=>String(Math.round(v)).padStart(9)).join(''), JSON.stringify(PROFILE_PLANS.get(c)?.consumption ?? '')); }
