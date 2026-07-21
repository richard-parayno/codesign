import {
  LocalCodesignProvider,
  configuredCodexProvider,
  createProvider,
  providerRuntimeStatus,
  providerSettings,
  type ProviderModelOption,
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
    const codexProvider = requested === 'codex' ? configuredCodexProvider(settings) : undefined;
    const provider =
      codexProvider ??
      (settings.provider === 'local' ? createProvider(settings) : new LocalCodesignProvider());
    const status = await provider.status();
    const runtime = requested === 'codex' ? providerRuntimeStatus(settings) : null;
    let models: ProviderModelOption[] = [];
    let modelsMessage: string | null = null;
    if (codexProvider && status.available && status.connected) {
      try {
        const allowedEfforts = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
        models = (await codexProvider.models()).map((model) => ({
          ...model,
          defaultReasoningEffort: allowedEfforts.has(model.defaultReasoningEffort)
            ? model.defaultReasoningEffort
            : 'high',
          supportedReasoningEfforts: model.supportedReasoningEfforts.filter((option) =>
            allowedEfforts.has(option.reasoningEffort),
          ),
        }));
      } catch {
        modelsMessage = 'The Codex model catalog could not be loaded.';
      }
    }
    return privateJson({
      descriptor: provider.descriptor,
      status,
      models,
      modelsMessage,
      runtime,
      configuration:
        requested === 'codex'
          ? { model: settings.model, effort: settings.effort, runtime: runtime?.source }
          : null,
    });
  } catch (cause) {
    return providerError(cause);
  }
}
