import { configuredCodexProvider, providerSettings } from '$lib/agent/providers';
import { privateJson, providerError, requireSameOrigin } from '../_response.server';

export async function POST({ request, url }) {
  const rejected = requireSameOrigin(request, url);
  if (rejected) return rejected;
  try {
    const provider = configuredCodexProvider(providerSettings());
    await provider.logout();
    return privateJson({
      provider: 'codex',
      connected: false,
      message: 'Signed out of Codex on this device.',
    });
  } catch (cause) {
    return providerError(cause);
  }
}
