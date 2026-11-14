import { describe, it, expect } from 'vitest';
import { MapRenderer, rectDistance, HIT_SLOP, type Hit } from '../../src/ui/map/renderer';
import { fromKeyboard, pointKey } from '../../src/ui/state/targeting';

/** Hit testing used by map clicks (no canvas needed: hitAt only reads the hit list). */
const hitAt = (hits: Hit[], x: number, y: number, slop?: number) => MapRenderer.prototype.hitAt.call({ hits } as unknown as MapRenderer, x, y, slop);

const stack = (id: string, x: number, y: number, w = 37, h = 22): Hit => ({ kind: 'object', ids: [id], label: id, x: x - w / 2, y: y - h / 2, w, h, cx: x, cy: y });
const city = (node: number, x: number, y: number): Hit => ({ kind: 'city', ids: [], node, label: `c${node}`, x: x - 6, y: y - 6, w: 12, h: 12, cx: x, cy: y });

describe('map hit testing', () => {
  it('rectDistance is 0 inside and euclidean outside', () => {
    const r = { x: 0, y: 0, w: 10, h: 10 };
    expect(rectDistance(r, 5, 5)).toBe(0);
    expect(rectDistance(r, 13, 5)).toBe(3);
    expect(rectDistance(r, 13, 14)).toBe(5);
  });

  it('the whole drawn marker plus a forgiving margin selects it', () => {
    const hits = [stack('S:a', 100, 100)];
    expect(hitAt(hits, 100, 100)?.ids).toEqual(['S:a']);
    expect(hitAt(hits, 100 + 18, 100)?.ids).toEqual(['S:a']); // right edge of a 37 px counter
    expect(hitAt(hits, 100 + 18 + HIT_SLOP.mouse - 0.5, 100)?.ids).toEqual(['S:a']);
    expect(hitAt(hits, 100 + 18 + HIT_SLOP.mouse + 2, 100)).toBeNull();
    expect(hitAt(hits, 100 + 30, 100, HIT_SLOP.touch)?.ids).toEqual(['S:a']);
  });

  it('formations win over a city marker underneath or next to them', () => {
    // city drawn first (lower in the list), stack later; and the reverse order
    for (const hits of [[city(7, 104, 100), stack('S:a', 100, 100)], [stack('S:a', 100, 100), city(7, 104, 100)]]) {
      expect(hitAt(hits, 104, 100)?.kind).toBe('object');
      // just outside the stack box but inside the slop: still the stack, not the city
      expect(hitAt([city(7, 122, 100), stack('S:a', 100, 100)], 121, 100)?.kind).toBe('object');
    }
    // far from any formation: the city
    expect(hitAt([city(7, 200, 100), stack('S:a', 100, 100)], 200, 100)?.kind).toBe('city');
  });

  it('overlapping formations: the box containing the point, then the nearest anchor', () => {
    const hits = [stack('S:a', 100, 100), stack('S:b', 125, 100)];
    expect(hitAt(hits, 104, 100)?.ids).toEqual(['S:a']);
    expect(hitAt(hits, 121, 100)?.ids).toEqual(['S:b']);
    expect(hitAt(hits, 112, 100)?.ids).toEqual(['S:a']); // both contain it: nearer anchor
  });

  it('respects an explicit slop (callers probing for empty map points)', () => {
    expect(hitAt([stack('S:a', 100, 100)], 100, 100 + 11 + 12, 14)?.ids).toEqual(['S:a']);
    expect(hitAt([stack('S:a', 100, 100)], 100, 100 + 11 + 12, 10)).toBeNull();
  });
});

describe('targeting helpers', () => {
  it('keyboard activation is detected from the click event', () => {
    expect(fromKeyboard({ detail: 0 })).toBe(true);
    expect(fromKeyboard({ detail: 1 })).toBe(false);
    expect(fromKeyboard({ detail: 0, nativeEvent: { pointerType: 'mouse' } as unknown as Event })).toBe(false);
    expect(fromKeyboard(null)).toBe(false);
  });
  it('point keys change with the sector or the objects under the pointer', () => {
    expect(pointKey({ node: 3, objects: [], lonlat: [0, 0] })).not.toBe(pointKey({ node: 3, objects: ['C:x'], lonlat: [0, 0] }));
    expect(pointKey({ node: 3, objects: [], lonlat: [1, 1] })).toBe(pointKey({ node: 3, objects: [], lonlat: [2, 2] }));
    expect(pointKey(null)).toBe('');
  });
});
