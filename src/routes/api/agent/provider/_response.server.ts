import { json } from '@sveltejs/kit';
import { asProviderFailure, type ProviderFailureCategory } from '$lib/agent/providers';

const statuses: Record<ProviderFailureCategory, number> = {
  'missing-login': 401,
  'model-unavailable': 422,
  'rate-limited': 429,
  cancelled: 400,
  'protocol-failure': 502,
  unavailable: 503,
};

export function privateJson(data: unknown, init: { status?: number } = {}) {
  return json(data, {
    ...init,
    headers: { 'cache-control': 'no-store, private' },
  });
}

export function requireSameOrigin(request: Request, url: URL) {
  if (request.headers.get('origin') === url.origin) return null;
  return privateJson(
    {
      error: {
        category: 'protocol-failure',
        message: 'Cross-origin provider actions are blocked.',
      },
    },
    { status: 403 },
  );
}

export function providerError(cause: unknown) {
  const failure = asProviderFailure(cause);
  return privateJson(
    { error: { category: failure.category, message: failure.message } },
    { status: statuses[failure.category] },
  );
}
