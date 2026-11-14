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
