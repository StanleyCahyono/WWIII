import React, { useEffect, useState } from 'react';
import { useStore } from './state/store';
import { ui } from './state/ui';
import { prefs } from './persist/prefs';
import { getHost } from './sim/host';
import { TitleScreen } from './screens/Title';
import { ChooseCountry } from './screens/ChooseCountry';
import { LoadCampaign } from './screens/LoadCampaign';
import { SettingsScreen, CreditsScreen, DiagnosticsScreen } from './screens/Menus';
import { Game } from './screens/Game';
import { mapRef, synthetic } from './map/MapView';
import { NODES } from './data/static';
import { buildSidc } from '../data/catalog/sidc';
import type { MapObject } from './map/objects';
import { worldToScreen } from './map/projection';
import { unitById, countryName } from './data/static';

// Test/diagnostic hook (read-only accessors; no hidden data beyond the human's own view).
(window as unknown as { __wc: unknown }).__wc = {
  camera: () => (mapRef.current ? { ...mapRef.current.cam, w: mapRef.current.w, h: mapRef.current.h } : null),
  frame: () => getHost().store.get().frame,
  ui: () => ui.get(),
  host: () => getHost(),
  map: () => mapRef.current,
  unitName: (id: string) => unitById.get(id)?.name ?? id,
  /** Perf harness: add N synthetic render-only stacks spread over land provinces. */
  perfInject: (n: number) => {
    const land = NODES.filter((x) => x.kind === 'land' && !x.outside);
    const keys = ['land.infantry.motorized', 'land.armor.mbt', 'land.support.sp_artillery', 'land.air_defense.sam'];
    const aff = ['friend', 'hostile', 'neutral', 'unknown'] as const;
    const out: MapObject[] = [];
    for (let i = 0; i < n; i++) {
      const node = land[(i * 7919) % land.length];
      const a = aff[i % 4];
      const key = a === 'unknown' ? 'contact.land' : keys[i % keys.length];
      out.push({ id: `P:${i}`, kind: a === 'friend' ? 'stack' : 'contact', ref: `p${i}`, lonlat: [node.center[0] + ((i % 5) - 2) * 0.05, node.center[1] + ((i % 3) - 1) * 0.05], node: node.id, affiliation: a, domain: 'land', sidc: buildSidc(key, { affiliation: a, status: 'present' }), symbolKey: key, label: `Synthetic ${i}`, aria: `Synthetic ${i}`, designation: `S${i}`, owner: null, ageMin: a === 'unknown' ? 90 : null, stale: false, count: 1, status: 'present', search: `synthetic ${i}`, moving: false, parent: null, group: 'land', hasOrder: false });
    }
    synthetic.objects = out;
    ui.patch({ pinned: [...ui.get().pinned] });
    return out.length;
  },
  countryName: (id: string) => countryName(id),
  /** Public map geometry: a sector's label point (lon, lat). */
  nodeCenter: (n: number) => NODES[n]?.center ?? null,
  project: (lon: number, lat: number) => {
    const r = mapRef.current;
    if (!r) return null;
    const b = r.canvas.getBoundingClientRect();
    const [x, y] = worldToScreen(r.cam, r.w, r.h, lon, lat);
    return { x: x + b.left, y: y + b.top };
  },
};

class Boundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    (window as unknown as { __wcErrors?: string[] }).__wcErrors = [...((window as unknown as { __wcErrors?: string[] }).__wcErrors ?? []), `${error.message}\n${error.stack ?? ''}`];
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <div className="page-inner">
          <h2>Something went wrong in the interface</h2>
          <p>The simulation and your last save are unaffected. Copy this report for diagnostics:</p>
          <textarea readOnly value={`${this.state.error.message}\n${this.state.error.stack ?? ''}`} rows={10} />
          <div className="row">
            <button className="btn primary" type="button" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
            <button className="btn" type="button" onClick={() => location.reload()}>
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export function App() {
  const screen = useStore(ui, (s) => s.screen);
  const theme = useStore(prefs, (p) => p.theme);
  const reduced = useStore(prefs, (p) => p.reducedMotion);
  const [bootError, setBootError] = useState<string | null>(null);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.motion = reduced ? 'reduced' : 'full';
  }, [theme, reduced]);
  useEffect(() => {
    if (/[?&]e2e=1/.test(location.search)) void getHost().request({ op: 'debugEnable' });
    getHost()
      .init()
      .then(() => ui.get().screen === 'boot' && ui.patch({ screen: 'title' }))
      .catch((e: Error) => setBootError(e.message));
  }, []);
  if (bootError)
    return (
      <div className="page">
        <div className="page-inner">
          <h2>World Command could not start the simulation</h2>
          <p className="bad">{bootError}</p>
          <button className="btn" type="button" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  return (
    <Boundary>
      {screen === 'boot' && (
        <div className="page" aria-busy="true">
          <div className="page-inner">
            <h2>World Command</h2>
            <p className="muted" role="status">Loading the World 120 scenario…</p>
          </div>
        </div>
      )}
      {screen === 'title' && <TitleScreen />}
      {screen === 'new' && <ChooseCountry />}
      {screen === 'load' && <LoadCampaign />}
      {screen === 'settings' && <SettingsScreen />}
      {screen === 'credits' && <CreditsScreen />}
      {screen === 'diagnostics' && <DiagnosticsScreen />}
      {screen === 'game' && <Game />}
    </Boundary>
  );
}
