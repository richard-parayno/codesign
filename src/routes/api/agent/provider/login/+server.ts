import { configuredCodexProvider, providerSettings } from '$lib/agent/providers';
import { privateJson, providerError, requireSameOrigin } from '../_response.server';

export async function POST({ request, url }) {
  const rejected = requireSameOrigin(request, url);
  if (rejected) return rejected;
  try {
    const provider = configuredCodexProvider(providerSettings());
    const login = await provider.startLogin();
    return privateJson({
      provider: 'codex',
      login,
      message: 'Continue sign-in in the Codex-managed ChatGPT browser flow.',
    });
  } catch (cause) {
    return providerError(cause);
  }
}
