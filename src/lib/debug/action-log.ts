import { browser, dev } from '$app/environment';

type DebugValue = string | number | boolean | null | string[] | number[];

export function logAction(action: string, details: Record<string, DebugValue> = {}) {
  if (!browser || !dev) return;
  void fetch('/api/debug/actions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, details, clientTimestamp: Date.now() }),
    keepalive: true,
  }).catch(() => {
    // Debug logging must never interfere with editor interactions.
  });
}
