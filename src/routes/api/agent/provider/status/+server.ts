import {
  configuredCodexProvider,
  providerRuntimeStatus,
  providerSettings,
  type ProviderModelOption,
} from '$lib/agent/providers';
import { privateJson, providerError } from '../_response.server';

export async function GET() {
  try {
    const settings = providerSettings();
    const provider = configuredCodexProvider(settings);
    const status = await provider.status();
    const runtime = providerRuntimeStatus(settings);
    let models: ProviderModelOption[] = [];
    let modelsMessage: string | null = null;
    if (status.available && status.connected) {
      try {
        const allowedEfforts = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
        models = (await provider.models()).map((model) => ({
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
      configuration: { model: settings.model, effort: settings.effort, runtime: runtime.source },
    });
  } catch (cause) {
    return providerError(cause);
  }
}
