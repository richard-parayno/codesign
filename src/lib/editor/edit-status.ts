export function latestDocumentEditTimestamp(document: {
  operations: ReadonlyArray<{ timestamp: number }>;
  processEvents: ReadonlyArray<{ timestamp: number }>;
}) {
  const timestamps = [
    ...document.operations.map((operation) => operation.timestamp),
    ...document.processEvents.map((event) => event.timestamp),
  ].filter((timestamp) => Number.isFinite(timestamp) && timestamp >= Date.UTC(2000, 0, 1));
  return timestamps.length ? Math.max(...timestamps) : 0;
}

export function relativeEditLabel(timestamp: number, now = Date.now()) {
  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (elapsedSeconds < 15) return 'just now';
  if (elapsedSeconds < 60) return 'less than a minute ago';

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return `${elapsedDays}d ago`;

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: new Date(timestamp).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric',
  }).format(timestamp);
}
