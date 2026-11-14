import { describe, it, expect } from 'vitest';
import { buildWorld120Scenario, createCampaign } from '../../src/engine';
import { techStatus } from '../../src/engine/systems/research';
import { loadMapData } from '../../src/data/map-index';
import { CATALOG } from '../../src/data/catalog/index';
import { MANIFEST } from '../../src/data/countries';
import { PROFILES } from '../../src/data/profiles/index';

// SPEC "first five minutes": every seat must be able to start research on day 1.
describe('day-1 research', () => {
  it('every one of the 120 countries has at least one research program available at the start', () => {
    const sc = buildWorld120Scenario({ map: loadMapData(), catalog: CATALOG as never, manifest: MANIFEST, profiles: PROFILES });
    const st = createCampaign({ seed: 1, humanCountry: 'USA', scenario: sc });
    const stuck = Object.keys(st.countries).filter(
      (c) => !CATALOG.techs.some((t) => techStatus(st, c, t.id).status === 'available'),
    );
    expect(Object.keys(st.countries)).toHaveLength(120);
    expect(stuck).toEqual([]);
  }, 120_000);
});
