import { describe, expect, it } from 'vitest';
import { latestDocumentEditTimestamp, relativeEditLabel } from './edit-status';

describe('project edit status', () => {
  it('uses the newest operation or process event timestamp', () => {
    const first = new Date('2026-07-22T03:00:00Z').getTime();
    const newest = new Date('2026-07-22T04:00:00Z').getTime();
    expect(
      latestDocumentEditTimestamp({
        operations: [{ timestamp: first }],
        processEvents: [{ timestamp: newest }, { timestamp: first + 1_000 }],
      }),
    ).toBe(newest);
  });

  it('ignores missing and placeholder epoch activity', () => {
    expect(
      latestDocumentEditTimestamp({
        operations: [{ timestamp: 0 }],
        processEvents: [{ timestamp: 250 }],
      }),
    ).toBe(0);
  });

  it('formats recent edits compactly', () => {
    const now = new Date('2026-07-22T04:00:00Z').getTime();

    expect(relativeEditLabel(now - 5_000, now)).toBe('just now');
    expect(relativeEditLabel(now - 45_000, now)).toBe('less than a minute ago');
    expect(relativeEditLabel(now - 4 * 60_000, now)).toBe('4m ago');
    expect(relativeEditLabel(now - 3 * 60 * 60_000, now)).toBe('3h ago');
    expect(relativeEditLabel(now - 2 * 24 * 60 * 60_000, now)).toBe('2d ago');
  });
});
