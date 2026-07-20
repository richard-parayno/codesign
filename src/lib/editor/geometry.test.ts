import { describe, expect, it } from 'vitest';
import type { Bounds, DesignNode } from '../model/types';
import {
  FRAME_PRESETS,
  boundsContain,
  boundsIntersect,
  collectiveSelectionBounds,
  consistentSpacingGuides,
  constrainToDominantAxis,
  framePresetById,
  framePresetSize,
  marqueeSelectedIds,
  rememberFrameSize,
  resizeBounds,
  snapBounds,
  swapFrameOrientation,
} from './geometry';

const bounds = (x: number, y: number, width: number, height: number): Bounds => ({
  x,
  y,
  width,
  height,
});

const selectable = (id: string, value: Bounds): Pick<DesignNode, 'id' | 'bounds'> => ({
  id,
  bounds: value,
});

describe('selection geometry', () => {
  it('finds one collective bounding box', () => {
    expect(collectiveSelectionBounds([bounds(20, 30, 40, 50), bounds(-10, 20, 15, 100)])).toEqual(
      bounds(-10, 20, 70, 100),
    );
    expect(collectiveSelectionBounds([])).toBeNull();
  });

  it('normalizes a reverse-dragged marquee and supports intersection or containment', () => {
    const nodes = [
      selectable('inside', bounds(20, 20, 20, 20)),
      selectable('edge', bounds(5, 5, 20, 20)),
      selectable('outside', bounds(80, 80, 10, 10)),
    ];
    const reverseMarquee = bounds(60, 60, -50, -50);
    expect(marqueeSelectedIds(nodes, reverseMarquee, 'intersect')).toEqual(['inside', 'edge']);
    expect(marqueeSelectedIds(nodes, reverseMarquee, 'contain')).toEqual(['inside']);
    expect(boundsContain(bounds(0, 0, 20, 20), bounds(5, 5, 5, 5))).toBe(true);
    expect(boundsIntersect(bounds(0, 0, 10, 10), bounds(10, 10, 5, 5))).toBe(true);
  });

  it('constrains movement to the dominant axis', () => {
    expect(constrainToDominantAxis({ x: 12, y: -4 })).toEqual({ x: 12, y: 0 });
    expect(constrainToDominantAxis({ x: 3, y: -8 })).toEqual({ x: 0, y: -8 });
  });
});

describe('modifier resize geometry', () => {
  const original = bounds(100, 100, 200, 100);

  it('resizes from every edge direction and enforces a minimum', () => {
    expect(resizeBounds(original, 'e', { x: 30, y: 99 })).toEqual(bounds(100, 100, 230, 100));
    expect(resizeBounds(original, 'w', { x: 30, y: 0 })).toEqual(bounds(130, 100, 170, 100));
    expect(resizeBounds(original, 'n', { x: 0, y: 20 })).toEqual(bounds(100, 120, 200, 80));
    expect(resizeBounds(original, 's', { x: 0, y: 40 })).toEqual(bounds(100, 100, 200, 140));
    expect(resizeBounds(original, 'w', { x: 999, y: 0 })).toEqual(bounds(292, 100, 8, 100));
  });

  it('uses Alt to resize edge and corner handles around the center', () => {
    expect(resizeBounds(original, 'e', { x: 20, y: 0 }, { fromCenter: true })).toEqual(
      bounds(80, 100, 240, 100),
    );
    expect(resizeBounds(original, 'nw', { x: -10, y: -5 }, { fromCenter: true })).toEqual(
      bounds(90, 95, 220, 110),
    );
  });

  it('uses Shift to preserve ratio on corners and edges', () => {
    expect(resizeBounds(original, 'se', { x: 40, y: 5 }, { lockAspectRatio: true })).toEqual(
      bounds(100, 100, 240, 120),
    );
    expect(resizeBounds(original, 's', { x: 0, y: 25 }, { lockAspectRatio: true })).toEqual(
      bounds(75, 100, 250, 125),
    );
  });

  it('combines Alt and Shift with the original center fixed', () => {
    expect(
      resizeBounds(original, 'se', { x: 25, y: 30 }, { fromCenter: true, lockAspectRatio: true }),
    ).toEqual(bounds(40, 70, 320, 160));
  });
});

describe('smart guides', () => {
  it('snaps parent and sibling edges or centers only within the threshold', () => {
    const targets = [
      { id: 'parent', kind: 'parent' as const, bounds: bounds(0, 0, 400, 300) },
      { id: 'sibling', kind: 'sibling' as const, bounds: bounds(105, 107, 40, 40) },
    ];
    const snapped = snapBounds(bounds(102, 104, 40, 40), targets, { threshold: 6 });
    expect(snapped.bounds).toEqual(bounds(105, 107, 40, 40));
    expect(snapped.delta).toEqual({ x: 3, y: 3 });
    expect(snapped.guides.map((guide) => guide.axis)).toEqual(['x', 'y']);

    expect(snapBounds(bounds(20, 20, 40, 40), targets, { threshold: 6 }).delta).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('can snap on only the axis permitted by a constrained drag', () => {
    const result = snapBounds(
      bounds(97, 50, 20, 20),
      [{ id: 'sibling', kind: 'sibling', bounds: bounds(100, 200, 20, 20) }],
      { threshold: 4, axes: ['x'] },
    );
    expect(result.delta).toEqual({ x: 3, y: 0 });
    expect(result.guides).toHaveLength(1);
  });

  it('finds equal spacing between adjacent siblings', () => {
    const guides = consistentSpacingGuides(bounds(100, 20, 50, 40), [
      selectable('left', bounds(20, 20, 50, 40)),
      selectable('right', bounds(180, 20, 50, 40)),
    ]);
    expect(guides).toEqual([
      {
        axis: 'x',
        beforeId: 'left',
        afterId: 'right',
        gap: 30,
        positions: [70, 100, 150, 180],
      },
    ]);
  });
});

describe('frame presets', () => {
  it('ships all required named dimensions as extensible data', () => {
    expect(FRAME_PRESETS.map(({ name, width, height }) => [name, width, height])).toEqual([
      ['Web / Desktop', 1440, 1024],
      ['Desktop compact', 1280, 832],
      ['MacBook Air', 1440, 900],
      ['MacBook Pro', 1512, 982],
    ]);
    expect(framePresetById('macbook-pro')).toMatchObject({ width: 1512, height: 982 });
  });

  it('swaps orientation and records the last freely-resized frame size', () => {
    const desktop = framePresetById('web-desktop')!;
    expect(framePresetSize(desktop, 'portrait')).toEqual({ width: 1024, height: 1440 });
    expect(framePresetSize(desktop, 'landscape')).toEqual({ width: 1440, height: 1024 });
    expect(swapFrameOrientation({ width: 800, height: 600 })).toEqual({ width: 600, height: 800 });
    expect(rememberFrameSize({ width: 900, height: 1200 }, 'custom')).toEqual({
      width: 900,
      height: 1200,
      presetId: 'custom',
      orientation: 'portrait',
    });
  });
});
