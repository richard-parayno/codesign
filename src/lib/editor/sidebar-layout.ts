export type SidebarSide = 'left' | 'right';

export const SIDEBAR_LAYOUT = {
  left: { defaultWidth: 232, minWidth: 180, maxWidth: 360 },
  right: { defaultWidth: 390, minWidth: 280, maxWidth: 520 },
  minWorkspaceWidth: 420,
  keyboardStep: 8,
} as const;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function constrainSidebarWidth(
  side: SidebarSide,
  proposedWidth: number,
  viewportWidth: number,
  otherSidebarWidth: number,
) {
  const limits = SIDEBAR_LAYOUT[side];
  const availableMaximum = viewportWidth - otherSidebarWidth - SIDEBAR_LAYOUT.minWorkspaceWidth;
  const maximum = Math.max(limits.minWidth, Math.min(limits.maxWidth, availableMaximum));
  return Math.round(clamp(proposedWidth, limits.minWidth, maximum));
}

export function constrainSidebarPair(leftWidth: number, rightWidth: number, viewportWidth: number) {
  const left = constrainSidebarWidth('left', leftWidth, viewportWidth, rightWidth);
  const right = constrainSidebarWidth('right', rightWidth, viewportWidth, left);
  return {
    left: constrainSidebarWidth('left', left, viewportWidth, right),
    right,
  };
}
