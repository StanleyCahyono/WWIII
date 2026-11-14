import { describe, expect, it } from 'vitest';
import { advance, previewCommand, submitCommand, planRoute } from '../../src/engine';
import { newMiniGame, N } from '../fixtures/mini-world';
import { clearStacks, grant, place, must } from '../fixtures/helpers';
import { atWar } from '../../src/engine/systems/world';
import { revokeGrantInternal } from '../../src/engine/systems/diplomacy';

function setup() {
  const s = newMiniGame({ human: 'ARD' });
  clearStacks(s);
  return s;
}

describe('movement & routing', () => {
  it('route preview lists per-segment terrain, mode changes (embark/disembark), canal use and arrival tick', () => {
    const s = setup();
    grant(s, 'BOR', 'ARD', 'right_of_way');
    grant(s, 'ESK', 'ARD', 'right_of_way');
    const st = place(s, 'ARD', N.ardCapital, ['inf', 'inf']);
    const v = previewCommand(s, { type: 'move', country: 'ARD', stack: st.id, dest: N.eskIsle });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const p = v.preview as { route: ReturnType<typeof planRoute> };
    const r = p.route;
    expect(r.segments[0].from).toBe(N.ardCapital);
    expect(r.modeChanges.some((m) => m.to === 'embarked')).toBe(true);
    expect(r.modeChanges[r.modeChanges.length - 1].to).toBe('land');
    expect(r.segments.some((x) => x.kind === 'coast')).toBe(true);
    expect(r.segments.every((x) => x.hours > 0 && typeof x.terrain === 'string')).toBe(true);
    expect(r.arriveTick).toBe(r.segments[r.segments.length - 1].arriveTick);
    must(s, { type: 'move', country: 'ARD', stack: st.id, dest: N.eskIsle });
    advance(s, r.arriveTick + 30);
    expect(s.stacks[st.id].pos).toEqual({ kind: 'node', node: N.eskIsle });
    expect(s.stacks[st.id].mode).toBe('land');
  });

  it('without canal passage the fleet takes the long southern route; with passage it uses the canal', () => {
    const s = setup();
    const f = place(s, 'ARD', N.ardWestport, ['frigate']);
    const noCanal = planRoute(s, f, N.S_NE);
    expect(noCanal.ok).toBe(true);
    expect(noCanal.segments.some((x) => x.kind === 'canal')).toBe(false);
    grant(s, 'BOR', 'ARD', 'right_of_way');
    const canal = planRoute(s, f, N.S_NE);
    expect(canal.segments.some((x) => x.kind === 'canal')).toBe(true);
    expect(canal.arriveTick).toBeLessThan(noCanal.arriveTick);
  });

  it('distinguishes unreachable / no access / missing facility / outside campaign', () => {
    const s = setup();
    const inf = place(s, 'ARD', N.ardCapital, ['inf']);
    const fr = place(s, 'ARD', N.ardWestport, ['frigate']);
    expect(planRoute(s, inf, N.outside).reason).toBe('outside_campaign');
    expect(planRoute(s, inf, N.outsideIslet).reason).toBe('outside_campaign');
    const na = planRoute(s, inf, N.dunCapital);
    expect(na.reason).toBe('no_access');
    expect(na.blockingOwners).toContain('DUN');
    expect(planRoute(s, fr, N.dunCapital).reason).toBe('missing_facility');
    const v = previewCommand(s, { type: 'move', country: 'ARD', stack: fr.id, dest: N.dunCapital });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/port/);
  });

  it('entering a peaceful country without passage requires explicit act-of-war confirmation; war is declared on entry', () => {
    const s = setup();
    const st = place(s, 'ARD', N.ardCapital + 1, ['inf']); // node 13 (ARD), adjacent to BOR 14
    const v = previewCommand(s, { type: 'move', country: 'ARD', stack: st.id, dest: 14 });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.code).toBe('act_of_war');
      expect((v.details as { actOfWar: string[] }).actOfWar).toEqual(['BOR']);
    }
    expect(atWar(s, 'ARD', 'BOR')).toBe(false); // preview/cancel changes nothing
    must(s, { type: 'move', country: 'ARD', stack: st.id, dest: 14, confirmActOfWar: ['BOR'] });
    expect(atWar(s, 'ARD', 'BOR')).toBe(false); // not yet — declared when crossing
    advance(s, 30);
    expect(atWar(s, 'ARD', 'BOR')).toBe(true);
    expect(s.events.some((e) => e.kind === 'war_declared' && e.public?.countries.includes('BOR'))).toBe(true);
  });

  it('A03: multi-waypoint land+strait route; revoking transit stops the stack at the last legal node (no teleport, no third-owner access)', () => {
    const s = setup();
    grant(s, 'BOR', 'ARD', 'right_of_way');
    grant(s, 'FAL', 'ARD', 'right_of_way');
    grant(s, 'CEL', 'ARD', 'right_of_way');
    const st = place(s, 'ARD', N.ardCapital, ['inf']);
    const v = submitCommand(s, { type: 'move', country: 'ARD', stack: st.id, dest: N.celEast, waypoints: [14] });
    expect(v.ok).toBe(true);
    const route = (v.ok ? (v.preview as { route: ReturnType<typeof planRoute> }).route : null)!;
    expect(route.segments.some((x) => x.kind === 'strait' && x.label === 'Falen Strait')).toBe(true);
    expect(route.segments.map((x) => x.to)).toContain(14);
    // advance until the stack is inside BOR, then FAL revokes passage
    let guard = 0;
    const inBor = () => {
      const p = s.stacks[st.id].pos;
      const n = p.kind === 'node' ? p.node : p.kind === 'edge' ? p.to : -1;
      return n === 14;
    };
    while (!inBor() && guard++ < 400) advance(s, 15);
    revokeGrantInternal(s, 'FAL', 'ARD', 'peace');
    const positions: string[] = [];
    for (let i = 0; i < 300; i++) {
      advance(s, 15);
      const p = s.stacks[st.id].pos;
      positions.push(JSON.stringify(p));
      if (p.kind === 'node') expect(s.provinces[p.node]?.owner === 'FAL' || s.provinces[p.node]?.owner === 'CEL').toBe(false);
      if (p.kind === 'edge') expect(s.provinces[p.to]?.owner === 'FAL').toBe(false);
    }
    const end = s.stacks[st.id];
    expect(end.order).toBeNull();
    expect(end.pos.kind).toBe('node');
    expect(s.provinces[(end.pos as { node: number }).node]!.owner).toBe('BOR');
    expect(s.events.some((e) => e.kind === 'route_revoked' && e.private.ARD?.text.includes('no longer legal'))).toBe(true);
    // re-planning cannot gain access through a third owner
    const v2 = previewCommand(s, { type: 'move', country: 'ARD', stack: st.id, dest: N.celEast });
    if (v2.ok) {
      const segs = (v2.preview as { route: ReturnType<typeof planRoute> }).route.segments;
      expect(segs.some((x) => x.kind === 'strait' || s.provinces[x.to]?.owner === 'FAL')).toBe(false);
    } else expect(v2.code).toBe('act_of_war');
    revokeGrantInternal(s, 'CEL', 'ARD', 'peace');
    const v3 = previewCommand(s, { type: 'move', country: 'ARD', stack: st.id, dest: N.celEast });
    expect(v3.ok).toBe(false);
    if (!v3.ok) expect(v3.code).toBe('act_of_war');
  });

  it('a stack mid-edge into a newly illegal province turns back to its origin node', () => {
    const s = setup();
    grant(s, 'BOR', 'ARD', 'right_of_way');
    const st = place(s, 'ARD', 13, ['inf']);
    must(s, { type: 'move', country: 'ARD', stack: st.id, dest: 14 });
    advance(s, 60);
    expect(s.stacks[st.id].pos.kind).toBe('edge');
    revokeGrantInternal(s, 'BOR', 'ARD', 'peace');
    advance(s, 24 * 60);
    expect(s.stacks[st.id].pos).toEqual({ kind: 'node', node: 13 });
    expect(atWar(s, 'ARD', 'BOR')).toBe(false);
  });

  it('landlocked start: cannot build ships; still reaches its own cities', () => {
    const s = newMiniGame({ human: 'DUN' });
    const r = submitCommand(s, { type: 'mobilize', country: 'DUN', unit: 'frigate', cities: ['DUN-dunholm'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unsuitable_port');
    const st = Object.values(s.stacks).find((x) => x.owner === 'DUN')!;
    expect(previewCommand(s, { type: 'move', country: 'DUN', stack: st.id, dest: N.dunLow }).ok).toBe(true);
  });

  it('effective stack speed uses the slowest unit and terrain', () => {
    const s = setup();
    const fast = place(s, 'ARD', N.ardCapital, ['tank']);
    const mixed = place(s, 'ARD', N.ardCapital, ['tank', 'inf']);
    const a = planRoute(s, fast, N.ardWestport);
    const b = planRoute(s, mixed, N.ardWestport);
    expect(b.totalHours).toBeGreaterThan(a.totalHours);
  });
});
