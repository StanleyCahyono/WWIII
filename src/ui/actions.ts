import { getHost } from './sim/host';
import { ui, select, centerOn } from './state/ui';
import { NODES } from './data/static';

/** Cycle armies (with an army selected) or cities (with a city/province selected). */
export function cycle(kind: 'stack' | 'city', dir: 1 | -1) {
  const f = getHost().store.get().frame;
  if (!f) return;
  const s = ui.get().selection;
  if (kind === 'stack') {
    const list = f.view.stacks;
    if (!list.length) return;
    const i = s?.kind === 'stack' ? list.findIndex((x) => x.id === s.id) : -1;
    const next = list[(i + dir + list.length) % list.length];
    select({ kind: 'stack', id: next.id });
    centerOn(next.lonlat[0], next.lonlat[1]);
  } else {
    const list = [...f.view.cities].sort((a, b) => a.name.localeCompare(b.name));
    if (!list.length) return;
    const cur = s?.kind === 'city' ? s.key : null;
    const i = cur ? list.findIndex((c) => c.key === cur) : -1;
    const next = list[(i + dir + list.length) % list.length];
    select({ kind: 'city', key: next.key, node: next.node });
    const n = NODES[next.node];
    centerOn(n.center[0], n.center[1]);
  }
}

