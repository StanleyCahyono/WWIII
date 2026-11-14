import React, { useMemo, useState } from 'react';
import { useObjects, selectionIds, objectToSelection } from '../map/MapView';
import { useStore } from '../state/store';
import { ui, select, centerOn } from '../state/ui';
import { Sym } from './common';
import { ageLabel } from '../format';
import type { MapObject } from '../map/objects';

type Filter = 'all' | 'friendly' | 'contacts' | 'orders' | 'reports';

export function Roster({ compact = false }: { compact?: boolean }) {
  const objects = useObjects();
  const sel = useStore(ui, (s) => s.selection);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const selIds = new Set(selectionIds(sel));
  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const f = objects.filter((o) => {
      if (s && !o.search.includes(s)) return false;
      if (filter === 'friendly') return o.kind === 'stack';
      if (filter === 'contacts') return o.kind === 'contact';
      if (filter === 'orders') return o.kind === 'stack' && o.hasOrder;
      if (filter === 'reports') return o.kind === 'report';
      return true;
    });
    const g: { key: string; label: string; items: { o: MapObject; children: MapObject[] }[] }[] = [];
    const add = (key: string, label: string, items: MapObject[]) => {
      if (!items.length) return;
      const top = items.filter((o) => !o.parent || !items.some((p) => p.ref === o.parent));
      g.push({ key, label, items: top.map((o) => ({ o, children: items.filter((c) => c.parent === o.ref) })) });
    };
    add('land', 'Friendly — ground', f.filter((o) => o.kind === 'stack' && o.domain === 'land'));
    add('sea', 'Friendly — naval', f.filter((o) => o.kind === 'stack' && (o.domain === 'sea' || o.domain === 'subsurface')));
    add('air', 'Friendly — air', f.filter((o) => o.kind === 'stack' && o.domain === 'air' && !o.parent));
    add('contacts', 'Known contacts', f.filter((o) => o.kind === 'contact'));
    add('reports', 'Dated reports', f.filter((o) => o.kind === 'report'));
    return g;
  }, [objects, filter, q]);
  const multi = selIds.size > 1;

  const pick = (o: MapObject, additive: boolean) => {
    if (additive && o.kind === 'stack') {
      const cur = new Set([...selIds].filter((i) => i.startsWith('S:')));
      cur.has(o.id) ? cur.delete(o.id) : cur.add(o.id);
      const arr = [...cur];
      if (arr.length === 0) select(null);
      else if (arr.length === 1) select({ kind: 'stack', id: arr[0].slice(2) });
      else select({ kind: 'multi', ids: arr });
      return;
    }
    select(objectToSelection(o));
    centerOn(o.lonlat[0], o.lonlat[1]);
  };

  const row = (o: MapObject, depth: number) => (
    <div key={o.id} className="row" style={{ gap: 0 }}>
      {o.kind === 'stack' && (
        <input type="checkbox" aria-label={`Select ${o.label} for a group order`} checked={selIds.has(o.id) && multi} onChange={() => pick(o, true)} style={{ marginLeft: 6 }} />
      )}
      <button
        type="button"
        className="item"
        role="option"
        aria-selected={selIds.has(o.id)}
        aria-label={o.aria}
        data-roster-id={o.id}
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={(e) => pick(o, e.shiftKey || e.ctrlKey || e.metaKey)}
      >
        <span style={{ opacity: o.kind === 'report' || o.stale ? 0.6 : 1 }}>
          <Sym sidc={o.sidc} size={18} />
        </span>
        <span className="grow" style={{ overflow: 'hidden' }}>
          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.label}</div>
          <div className="meta">
            {o.kind === 'stack' ? `${o.count} unit${o.count === 1 ? '' : 's'} · ${o.status === 'damaged' ? 'damaged · ' : ''}${o.hasOrder ? 'order active' : o.moving ? 'moving' : 'holding'}` : `as of ${ageLabel(o.ageMin ?? 0)}${o.stale ? ' · stale' : ''}`}
          </div>
        </span>
      </button>
    </div>
  );

  return (
    <div className="col" style={{ gap: 0, height: '100%', minHeight: 0 }} data-testid="roster">
      <header>
        <div className="row">
          <strong>Roster</strong>
          <span className="muted" style={{ fontSize: 12 }}>{objects.length} known</span>
        </div>
        <label className="sr-only" htmlFor={`roster-q-${compact ? 'm' : 'd'}`}>Filter roster</label>
        <input id={`roster-q-${compact ? 'm' : 'd'}`} type="search" placeholder="Filter by name, type, place…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="region-filters" role="group" aria-label="Roster filter">
          {(['all', 'friendly', 'contacts', 'orders', 'reports'] as Filter[]).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === 'contacts' ? 'Known contacts' : f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </header>
      <div className="list" role="listbox" aria-label="Formations, contacts and reports" aria-multiselectable="true">
        {groups.length === 0 && <div className="empty" style={{ margin: 10 }}>{q ? 'Nothing matches this filter.' : 'Nothing to show for this filter.'}</div>}
        {groups.map((g) => (
          <div key={g.key} role="group" aria-label={g.label}>
            <button type="button" className="grp" aria-expanded={!collapsed[g.key]} onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}>
              {collapsed[g.key] ? '▸' : '▾'} {g.label} ({g.items.length})
            </button>
            {!collapsed[g.key] &&
              g.items.map(({ o, children }) => (
                <React.Fragment key={o.id}>
                  {row(o, 0)}
                  {children.map((c) => row(c, 1))}
                </React.Fragment>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
