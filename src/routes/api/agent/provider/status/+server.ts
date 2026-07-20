import {
  LocalCodesignProvider,
  configuredCodexProvider,
  createProvider,
  providerSettings,
} from '$lib/agent/providers';
import { privateJson, providerError } from '../_response.server';

export async function GET({ url }) {
  try {
    const settings = providerSettings();
    const requested = url.searchParams.get('provider') ?? settings.provider;
    if (requested !== 'local' && requested !== 'codex')
      return privateJson(
        {
          error: {
            category: 'protocol-failure',
            message: 'Unknown Codesign generation provider.',
          },
        },
        { status: 400 },
      );
    const provider =
      requested === 'codex'
        ? configuredCodexProvider(settings)
        : settings.provider === 'local'
          ? createProvider(settings)
          : new LocalCodesignProvider();
    return privateJson({
      descriptor: provider.descriptor,
      status: await provider.status(),
      configuration:
        requested === 'codex'
          ? { model: settings.model, effort: settings.effort, runtime: 'project-pinned' }
          : null,
    });
  } catch (cause) {
    return providerError(cause);
  }
}
