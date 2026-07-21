import { describe, expect, it } from 'vitest';
import { constrainSidebarPair, constrainSidebarWidth, SIDEBAR_LAYOUT } from './sidebar-layout';

describe('sidebar layout', () => {
  it('keeps both sidebars within their configured limits', () => {
    expect(constrainSidebarWidth('left', 80, 1440, 390)).toBe(SIDEBAR_LAYOUT.left.minWidth);
    expect(constrainSidebarWidth('left', 900, 1440, 390)).toBe(SIDEBAR_LAYOUT.left.maxWidth);
    expect(constrainSidebarWidth('right', 80, 1440, 232)).toBe(SIDEBAR_LAYOUT.right.minWidth);
    expect(constrainSidebarWidth('right', 900, 1440, 232)).toBe(SIDEBAR_LAYOUT.right.maxWidth);
  });

  it('preserves a minimum usable workspace while resizing', () => {
    expect(constrainSidebarWidth('right', 520, 1024, 232)).toBe(372);
    expect(constrainSidebarWidth('left', 360, 900, 280)).toBe(200);
  });

  it('constrains restored sidebar pairs to the current viewport', () => {
    const result = constrainSidebarPair(360, 520, 1024);

    expect(result.left + result.right + SIDEBAR_LAYOUT.minWorkspaceWidth).toBeLessThanOrEqual(1024);
    expect(result.left).toBeGreaterThanOrEqual(SIDEBAR_LAYOUT.left.minWidth);
    expect(result.right).toBeGreaterThanOrEqual(SIDEBAR_LAYOUT.right.minWidth);
  });
});
