import ms from 'milsymbol';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AFFILIATION_DIGIT,
  SYMBOL_CROSSWALK,
  UNIT_TYPES,
  buildSidc,
  clearAssetValidationErrors,
  contactKeyForDomain,
  getAssetValidationErrors,
  resolveSymbol,
  symbolByKey,
  validateSidc,
  type Affiliation,
} from '../../src/data/catalog';
import { isRenderable, renderSymbol } from '../../src/data/catalog/symbol-render';

const AFFILIATIONS = Object.keys(AFFILIATION_DIGIT) as Affiliation[];

afterEach(() => clearAssetValidationErrors());

describe('symbol crosswalk', () => {
  it('has unique keys and stores 20-digit numeric SIDC strings (leading zeroes kept)', () => {
    const keys = SYMBOL_CROSSWALK.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of SYMBOL_CROSSWALK) {
      expect(typeof s.sidc).toBe('string');
      expect(s.sidc).toMatch(/^\d{20}$/);
      expect(validateSidc(s.sidc), s.key).toEqual({ ok: true });
      expect(s.meaning.length).toBeGreaterThan(3);
    }
  });

  it('every unit symbol key resolves to a crosswalk entry', () => {
    for (const u of UNIT_TYPES) expect(symbolByKey.has(u.symbol), `${u.id} → ${u.symbol}`).toBe(true);
  });

  it('includes installations, generic contacts per domain and missile event icons', () => {
    for (const k of ['installation.city', 'installation.capital', 'installation.air_base', 'installation.naval_base', 'installation.radar',
      'contact.land', 'contact.air', 'contact.sea', 'contact.subsurface',
      'event.missile.cruise', 'event.missile.ballistic', 'event.missile.hgv', 'event.missile.hcm']) {
      expect(symbolByKey.has(k), k).toBe(true);
    }
  });

  it('every SIDC for every affiliation and status passes validation and renders valid in milsymbol', () => {
    for (const s of SYMBOL_CROSSWALK) {
      for (const affiliation of AFFILIATIONS) {
        for (const status of ['present', 'planned', 'damaged'] as const) {
          const sidc = buildSidc(s.key, { affiliation, status });
          expect(sidc).toHaveLength(20);
          expect(sidc[3]).toBe(AFFILIATION_DIGIT[affiliation]);
          expect(validateSidc(sidc).ok, `${s.key} ${affiliation} ${status}`).toBe(true);
          const sym = new ms.Symbol(sidc, { size: 30, standard: 'APP6' });
          expect(sym.isValid(), `${s.key} ${affiliation} ${status} ${sidc}`).toBe(true);
          expect(sym.asSVG()).toContain('<svg');
          expect(isRenderable(sidc, '2525'), `${s.key} 2525`).toBe(true);
        }
      }
    }
    expect(getAssetValidationErrors()).toHaveLength(0);
  });

  it('applies verified echelon and HQ to land units only; contacts ignore both', () => {
    expect(buildSidc('land.infantry.motorized', { affiliation: 'friend', status: 'present', echelon: 'battalion' }).slice(8, 10)).toBe('16');
    expect(buildSidc('land.infantry.motorized', { affiliation: 'friend', status: 'present', hq: true })[7]).toBe('2');
    expect(buildSidc('land.officer.infantry', { affiliation: 'friend', status: 'present' })[7]).toBe('2');
    expect(buildSidc('sea.naval.frigate', { affiliation: 'friend', status: 'present', echelon: 'battalion' }).slice(8, 10)).toBe('00');
    const c = buildSidc('contact.land', { affiliation: 'hostile', status: 'present', echelon: 'brigade', hq: true });
    expect(c.slice(7, 10)).toBe('000');
    expect(buildSidc('land.infantry.motorized', { affiliation: 'friend', status: 'planned' })[6]).toBe('1');
  });

  it('unknown key → generic contact of the known domain + asset-validation error (never infantry)', () => {
    const r = resolveSymbol('sea.naval.battleship_typo', { affiliation: 'hostile', status: 'present' });
    expect(r.fallback).toBe(true);
    expect(r.key).toBe('contact.sea');
    expect(r.sidc.slice(4, 6)).toBe('30');
    expect(r.sidc.slice(10, 16)).toBe('000000');
    const land = resolveSymbol('nonsense', { affiliation: 'unknown', status: 'present' });
    expect(land.key).toBe('contact.land');
    expect(land.sidc.slice(10)).toBe('0000000000');
    expect(land.sidc).not.toBe(buildSidc('land.infantry.motorized', { affiliation: 'unknown', status: 'present' }));
    const hinted = resolveSymbol('mystery', { affiliation: 'neutral', status: 'present', domain: 'subsurface' });
    expect(hinted.key).toBe('contact.subsurface');
    const errs = getAssetValidationErrors();
    expect(errs).toHaveLength(3);
    expect(errs[0]).toMatchObject({ key: 'sea.naval.battleship_typo', fallbackKey: 'contact.sea' });
    for (const x of [r, land, hinted]) expect(isRenderable(x.sidc)).toBe(true);
  });

  it('generic contact SIDCs never encode a hidden branch (entity, modifiers, echelon, HQ all zero)', () => {
    for (const d of ['land', 'air', 'sea', 'subsurface'] as const) {
      const key = contactKeyForDomain(d);
      for (const affiliation of AFFILIATIONS) {
        const sidc = buildSidc(key, { affiliation, status: 'present' });
        expect(sidc.slice(10), `${key}`).toBe('0000000000');
        expect(sidc.slice(7, 10)).toBe('000');
      }
    }
    // A surface contact hiding a submarine still renders as a SURFACE contact (set 30), never set 35.
    const surface = buildSidc(contactKeyForDomain('sea'), { affiliation: 'unknown', status: 'present' });
    expect(surface.slice(4, 6)).toBe('30');
  });

  it('validateSidc rejects malformed codes', () => {
    expect(validateSidc('1303100000121104000').ok).toBe(false); // 19 chars
    expect(validateSidc('1303100000121104000X').ok).toBe(false);
    expect(validateSidc(13031000001211040000).ok).toBe(false); // number, not string
    expect(validateSidc('10031000001211040000').ok).toBe(false); // edition D version
    expect(validateSidc('13039900001211040000').ok).toBe(false); // unsupported set
    expect(validateSidc('13071000001211040000').ok).toBe(false); // invalid identity
    expect(validateSidc('13031000991211040000').ok).toBe(false); // invalid echelon
  });

  it('renderer composes game overlays outside the standard symbol and falls back on invalid input', () => {
    const sidc = buildSidc('land.armor.mbt', { affiliation: 'hostile', status: 'present' });
    const plain = renderSymbol(sidc);
    const decorated = renderSymbol(sidc, { selected: true, staleMinutes: 360, designation: '2', higherFormation: '5 BDE', muted: true });
    expect(plain.valid).toBe(true);
    expect(decorated.svg).toContain('wc-overlay-selection');
    expect(decorated.svg).toContain('wc-overlay-age');
    expect(decorated.svg).toContain('>6h<');
    // The embedded standard symbol (frame) is the same markup with or without overlays.
    const inner = (s: string) => s.slice(s.indexOf('<svg x='), s.lastIndexOf('</svg>', s.lastIndexOf('</svg>') - 1) + 6);
    expect(inner(renderSymbol(sidc, { selected: true, staleMinutes: 90 }).svg)).toBe(inner(plain.svg));
    const bad = renderSymbol('13031000009999000000');
    expect(bad.valid).toBe(false);
    expect(bad.svg).toContain('data-sidc="13011000000000000000"');
  });
});
