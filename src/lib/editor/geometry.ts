import type { Bounds, DesignNode } from '../model/types';

export type Point = { x: number; y: number };
export type Axis = 'x' | 'y';
export type ResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
export type MarqueeMode = 'contain' | 'intersect';

export type ResizeOptions = {
  lockAspectRatio?: boolean;
  fromCenter?: boolean;
  minWidth?: number;
  minHeight?: number;
};

export type SnapTarget = {
  id: string;
  bounds: Bounds;
  kind: 'parent' | 'sibling';
};

export type Alignment = 'start' | 'center' | 'end';
export type SmartGuide = {
  axis: Axis;
  position: number;
  targetId: string;
  targetKind: SnapTarget['kind'];
  movingAlignment: Alignment;
  targetAlignment: Alignment;
};

export type SnapResult = {
  bounds: Bounds;
  delta: Point;
  guides: SmartGuide[];
};

export type SpacingGuide = {
  axis: Axis;
  beforeId: string;
  afterId: string;
  gap: number;
  positions: [number, number, number, number];
};

export type FramePresetCategory = 'web' | 'mobile' | 'tablet' | 'presentation' | 'custom';

export type FramePreset = {
  id: string;
  name: string;
  category: FramePresetCategory;
  width: number;
  height: number;
  canSwapOrientation: boolean;
};

export type FrameOrientation = 'landscape' | 'portrait';
export type LastFrameSize = {
  width: number;
  height: number;
  presetId?: string;
  orientation: FrameOrientation;
};

/** Built-ins are data rather than UI conditionals, so later presets can append to this list. */
export const FRAME_PRESETS: readonly FramePreset[] = [
  {
    id: 'web-desktop',
    name: 'Web / Desktop',
    category: 'web',
    width: 1440,
    height: 1024,
    canSwapOrientation: true,
  },
  {
    id: 'desktop-compact',
    name: 'Desktop compact',
    category: 'web',
    width: 1280,
    height: 832,
    canSwapOrientation: true,
  },
  {
    id: 'macbook-air',
    name: 'MacBook Air',
    category: 'web',
    width: 1440,
    height: 900,
    canSwapOrientation: true,
  },
  {
    id: 'macbook-pro',
    name: 'MacBook Pro',
    category: 'web',
    width: 1512,
    height: 982,
    canSwapOrientation: true,
  },
];

const handleDirection: Record<ResizeHandle, Point> = {
  n: { x: 0, y: -1 },
  ne: { x: 1, y: -1 },
  e: { x: 1, y: 0 },
  se: { x: 1, y: 1 },
  s: { x: 0, y: 1 },
  sw: { x: -1, y: 1 },
  w: { x: -1, y: 0 },
  nw: { x: -1, y: -1 },
};

const EPSILON = 0.000_001;

export function normalizeBounds(bounds: Bounds): Bounds {
  return {
    x: bounds.width < 0 ? bounds.x + bounds.width : bounds.x,
    y: bounds.height < 0 ? bounds.y + bounds.height : bounds.y,
    width: Math.abs(bounds.width),
    height: Math.abs(bounds.height),
  };
}

export function collectiveSelectionBounds(
  items: readonly (Bounds | Pick<DesignNode, 'bounds'>)[],
): Bounds | null {
  if (!items.length) return null;
  const bounds = items.map((item) => normalizeBounds('bounds' in item ? item.bounds : item));
  const left = Math.min(...bounds.map((item) => item.x));
  const top = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.x + item.width));
  const bottom = Math.max(...bounds.map((item) => item.y + item.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function boundsContain(outer: Bounds, inner: Bounds): boolean {
  const a = normalizeBounds(outer);
  const b = normalizeBounds(inner);
  return (
    a.x <= b.x && a.y <= b.y && a.x + a.width >= b.x + b.width && a.y + a.height >= b.y + b.height
  );
}

export function boundsIntersect(first: Bounds, second: Bounds): boolean {
  const a = normalizeBounds(first);
  const b = normalizeBounds(second);
  return (
    a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y
  );
}

export function marqueeSelectedIds(
  nodes: readonly Pick<DesignNode, 'id' | 'bounds'>[],
  marquee: Bounds,
  mode: MarqueeMode = 'intersect',
): string[] {
  const area = normalizeBounds(marquee);
  return nodes
    .filter((node) =>
      mode === 'contain' ? boundsContain(area, node.bounds) : boundsIntersect(area, node.bounds),
    )
    .map((node) => node.id);
}

/** Constrains pointer movement to the axis with the greatest absolute travel. */
export function constrainToDominantAxis(delta: Point): Point {
  return Math.abs(delta.x) >= Math.abs(delta.y) ? { x: delta.x, y: 0 } : { x: 0, y: delta.y };
}

function anchoredCoordinate(
  start: number,
  originalSize: number,
  nextSize: number,
  direction: number,
  fromCenter: boolean,
) {
  if (fromCenter || direction === 0) return start + (originalSize - nextSize) / 2;
  return direction < 0 ? start + originalSize - nextSize : start;
}

/**
 * Computes a resize from the original pointer-down bounds. Calling this for live pointer moves
 * avoids accumulating floating-point drift. Shift maps to lockAspectRatio and Alt maps to
 * fromCenter. Bounds never flip through themselves; they stop at the configured minimum size.
 */
export function resizeBounds(
  originalInput: Bounds,
  handle: ResizeHandle,
  pointerDelta: Point,
  options: ResizeOptions = {},
): Bounds {
  const original = normalizeBounds(originalInput);
  const direction = handleDirection[handle];
  const factor = options.fromCenter ? 2 : 1;
  const minWidth = Math.max(EPSILON, options.minWidth ?? 8);
  const minHeight = Math.max(EPSILON, options.minHeight ?? 8);

  let width = original.width + direction.x * pointerDelta.x * factor;
  let height = original.height + direction.y * pointerDelta.y * factor;

  if (options.lockAspectRatio && original.width > EPSILON && original.height > EPSILON) {
    const minimumScale = Math.max(minWidth / original.width, minHeight / original.height);
    let scale: number;
    if (direction.x === 0) {
      scale = height / original.height;
    } else if (direction.y === 0) {
      scale = width / original.width;
    } else {
      const widthScale = width / original.width;
      const heightScale = height / original.height;
      scale = Math.abs(widthScale - 1) >= Math.abs(heightScale - 1) ? widthScale : heightScale;
    }
    scale = Math.max(minimumScale, scale);
    width = original.width * scale;
    height = original.height * scale;
  } else {
    width = direction.x === 0 ? original.width : Math.max(minWidth, width);
    height = direction.y === 0 ? original.height : Math.max(minHeight, height);
  }

  return {
    x: anchoredCoordinate(original.x, original.width, width, direction.x, !!options.fromCenter),
    y: anchoredCoordinate(original.y, original.height, height, direction.y, !!options.fromCenter),
    width,
    height,
  };
}

function alignmentValues(bounds: Bounds, axis: Axis): Record<Alignment, number> {
  const start = axis === 'x' ? bounds.x : bounds.y;
  const size = axis === 'x' ? bounds.width : bounds.height;
  return { start, center: start + size / 2, end: start + size };
}

type SnapCandidate = SmartGuide & { adjustment: number };

function bestAxisSnap(
  moving: Bounds,
  targets: readonly SnapTarget[],
  axis: Axis,
  threshold: number,
): SnapCandidate | null {
  const movingValues = alignmentValues(moving, axis);
  const candidates: SnapCandidate[] = [];
  for (const target of targets) {
    const targetValues = alignmentValues(normalizeBounds(target.bounds), axis);
    for (const movingAlignment of ['start', 'center', 'end'] as const) {
      for (const targetAlignment of ['start', 'center', 'end'] as const) {
        const adjustment = targetValues[targetAlignment] - movingValues[movingAlignment];
        if (Math.abs(adjustment) <= threshold) {
          candidates.push({
            axis,
            adjustment,
            position: targetValues[targetAlignment],
            targetId: target.id,
            targetKind: target.kind,
            movingAlignment,
            targetAlignment,
          });
        }
      }
    }
  }
  return (
    candidates.sort(
      (a, b) =>
        Math.abs(a.adjustment) - Math.abs(b.adjustment) ||
        Number(a.targetKind === 'sibling') - Number(b.targetKind === 'sibling'),
    )[0] ?? null
  );
}

/**
 * Snaps independently on each axis. A target farther than threshold is never considered, which
 * prevents the large jumps caused by snapping to the globally-nearest guide.
 */
export function snapBounds(
  input: Bounds,
  targets: readonly SnapTarget[],
  options: { threshold?: number; axes?: readonly Axis[] } = {},
): SnapResult {
  const bounds = normalizeBounds(input);
  const threshold = Math.max(0, options.threshold ?? 6);
  const axes = new Set(options.axes ?? ['x', 'y']);
  const horizontal = axes.has('x') ? bestAxisSnap(bounds, targets, 'x', threshold) : null;
  const vertical = axes.has('y') ? bestAxisSnap(bounds, targets, 'y', threshold) : null;
  const delta = { x: horizontal?.adjustment ?? 0, y: vertical?.adjustment ?? 0 };
  const guides = [horizontal, vertical].filter((guide): guide is SnapCandidate => !!guide);
  return {
    bounds: { ...bounds, x: bounds.x + delta.x, y: bounds.y + delta.y },
    delta,
    guides: guides.map(({ adjustment: _adjustment, ...guide }) => guide),
  };
}

function overlapOnCrossAxis(a: Bounds, b: Bounds, axis: Axis) {
  if (axis === 'x') return a.y <= b.y + b.height && a.y + a.height >= b.y;
  return a.x <= b.x + b.width && a.x + a.width >= b.x;
}

/** Returns equal-gap guides when the moving bounds sit between two aligned siblings. */
export function consistentSpacingGuides(
  movingInput: Bounds,
  siblings: readonly Pick<DesignNode, 'id' | 'bounds'>[],
  threshold = 4,
): SpacingGuide[] {
  const moving = normalizeBounds(movingInput);
  const guides: SpacingGuide[] = [];
  for (const axis of ['x', 'y'] as const) {
    const start = axis === 'x' ? moving.x : moving.y;
    const end = start + (axis === 'x' ? moving.width : moving.height);
    const candidates = siblings
      .map((sibling) => ({ ...sibling, bounds: normalizeBounds(sibling.bounds) }))
      .filter((sibling) => overlapOnCrossAxis(moving, sibling.bounds, axis));
    const before = candidates
      .filter((sibling) =>
        axis === 'x'
          ? sibling.bounds.x + sibling.bounds.width <= start
          : sibling.bounds.y + sibling.bounds.height <= start,
      )
      .sort((a, b) => {
        const aEnd = axis === 'x' ? a.bounds.x + a.bounds.width : a.bounds.y + a.bounds.height;
        const bEnd = axis === 'x' ? b.bounds.x + b.bounds.width : b.bounds.y + b.bounds.height;
        return bEnd - aEnd;
      })[0];
    const after = candidates
      .filter((sibling) => (axis === 'x' ? sibling.bounds.x >= end : sibling.bounds.y >= end))
      .sort((a, b) => (axis === 'x' ? a.bounds.x - b.bounds.x : a.bounds.y - b.bounds.y))[0];
    if (!before || !after) continue;
    const beforeEnd =
      axis === 'x' ? before.bounds.x + before.bounds.width : before.bounds.y + before.bounds.height;
    const afterStart = axis === 'x' ? after.bounds.x : after.bounds.y;
    const firstGap = start - beforeEnd;
    const secondGap = afterStart - end;
    if (Math.abs(firstGap - secondGap) <= threshold) {
      guides.push({
        axis,
        beforeId: before.id,
        afterId: after.id,
        gap: (firstGap + secondGap) / 2,
        positions: [beforeEnd, start, end, afterStart],
      });
    }
  }
  return guides;
}

export function framePresetById(
  presetId: string,
  presets: readonly FramePreset[] = FRAME_PRESETS,
): FramePreset | undefined {
  return presets.find((preset) => preset.id === presetId);
}

export function framePresetSize(
  preset: Pick<FramePreset, 'width' | 'height'>,
  orientation: FrameOrientation = 'landscape',
): Pick<Bounds, 'width' | 'height'> {
  const landscape = preset.width >= preset.height;
  const shouldSwap =
    (orientation === 'portrait' && landscape) || (orientation === 'landscape' && !landscape);
  return shouldSwap
    ? { width: preset.height, height: preset.width }
    : { width: preset.width, height: preset.height };
}

export function swapFrameOrientation(size: Pick<Bounds, 'width' | 'height'>) {
  return { width: size.height, height: size.width };
}

export function rememberFrameSize(
  size: Pick<Bounds, 'width' | 'height'>,
  presetId?: string,
): LastFrameSize {
  return {
    width: size.width,
    height: size.height,
    ...(presetId ? { presetId } : {}),
    orientation: size.width >= size.height ? 'landscape' : 'portrait',
  };
}
