import { createProvider, providerSettings } from '$lib/agent/providers';
import { privateJson, providerError } from '../provider/_response.server';

export async function GET() {
  try {
    const settings = providerSettings();
    const provider = createProvider(settings);
    const status = await provider.status();
    return privateJson({
      backend: settings.provider,
      available: status.available,
      connected: status.connected,
      status,
      descriptor: provider.descriptor,
      configuration:
        settings.provider === 'codex'
          ? { model: settings.model, effort: settings.effort, runtime: 'project-pinned' }
          : null,
      supportedActions: ['complete'],
      message: status.message,
    });
  } catch (cause) {
    return providerError(cause);
  }
}
