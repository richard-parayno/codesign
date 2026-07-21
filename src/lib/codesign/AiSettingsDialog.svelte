<script lang="ts" module>
  export type AiReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

  export type AiModelOption = {
    id: string;
    model: string;
    displayName: string;
    description: string;
    isDefault: boolean;
    defaultReasoningEffort: AiReasoningEffort;
    supportedReasoningEfforts: Array<{
      reasoningEffort: AiReasoningEffort;
      description: string;
    }>;
  };

  export type AiIntegrationView = {
    status?: {
      available: boolean;
      connected: boolean;
      authMode: string | null;
      planType: string | null;
      accountLabel: string | null;
      failureCategory?: string;
      message: string;
    };
    runtime?: {
      detected: boolean;
      source: 'project-pinned' | 'advanced-override';
      label: string;
    };
    configuration?: {
      model: string;
      effort: AiReasoningEffort;
      runtime: string;
    };
    models: AiModelOption[];
    modelsMessage?: string | null;
    checkedAt?: number;
  };
</script>

<script lang="ts">
  import { onMount } from 'svelte';

  type Props = {
    activeBackend: 'local' | 'codex';
    integration: AiIntegrationView;
    selectedModel: string;
    selectedEffort: AiReasoningEffort;
    loading?: boolean;
    errorMessage?: string;
    onClose: () => void;
    onRefresh: () => void;
    onModelChange: (model: string) => void;
    onEffortChange: (effort: AiReasoningEffort) => void;
    onReset: () => void;
    onSignIn: () => void;
    onSignOut: () => void;
  };

  let {
    activeBackend,
    integration,
    selectedModel,
    selectedEffort,
    loading = false,
    errorMessage = '',
    onClose,
    onRefresh,
    onModelChange,
    onEffortChange,
    onReset,
    onSignIn,
    onSignOut,
  }: Props = $props();

  let dialog: HTMLElement;
  let selectedModelOption = $derived(
    integration.models.find((option) => option.model === selectedModel),
  );
  let effortOptions = $derived(
    selectedModelOption?.supportedReasoningEfforts.length
      ? selectedModelOption.supportedReasoningEfforts
      : (['low', 'medium', 'high', 'xhigh', 'max'] as const).map((reasoningEffort) => ({
          reasoningEffort,
          description: '',
        })),
  );

  onMount(() => dialog?.focus());

  function checkedAt(value?: number) {
    return value
      ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : 'Not checked yet';
  }
</script>

<div
  class="settings-backdrop"
  role="presentation"
  onclick={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}
>
  <div
    class="settings-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="ai-settings-title"
    tabindex="-1"
    bind:this={dialog}
  >
    <header>
      <div>
        <span class="eyebrow">Editor configuration</span>
        <h2 id="ai-settings-title">Codesign AI settings</h2>
        <p>Inspect the local integration and choose what future AI generations use.</p>
      </div>
      <button type="button" class="close" onclick={onClose}>Close settings</button>
    </header>

    <div class="settings-body">
      <section class="settings-section" aria-labelledby="integration-status-title">
        <div class="section-heading">
          <div>
            <h3 id="integration-status-title">Integration status</h3>
            <p>Live checks against the project-owned Codex App Server runtime.</p>
          </div>
          <button type="button" disabled={loading} onclick={onRefresh}>
            {loading ? 'Checking status…' : 'Refresh diagnostics'}
          </button>
        </div>

        <dl class="status-grid">
          <div>
            <dt>Active backend</dt>
            <dd>
              <span class:good={activeBackend === 'codex'} class="status-dot"></span>
              {activeBackend === 'codex' ? 'Codex App Server' : 'Deterministic local'}
            </dd>
          </div>
          <div>
            <dt>Runtime on this machine</dt>
            <dd>
              <span class:good={integration.runtime?.detected} class="status-dot"></span>
              {integration.runtime?.detected ? 'Detected' : 'Not detected'}
            </dd>
            <small>{integration.runtime?.label ?? 'Waiting for runtime check'}</small>
          </div>
          <div>
            <dt>App Server</dt>
            <dd>
              <span class:good={integration.status?.available} class="status-dot"></span>
              {integration.status?.available ? 'Responding' : 'Unavailable'}
            </dd>
          </div>
          <div>
            <dt>ChatGPT account</dt>
            <dd>
              <span class:good={integration.status?.connected} class="status-dot"></span>
              {integration.status?.connected ? 'Connected' : 'Signed out'}
            </dd>
            {#if integration.status?.accountLabel}
              <small>{integration.status.accountLabel}</small>
            {/if}
          </div>
        </dl>

        <p class="status-message" class:error={Boolean(errorMessage)} aria-live="polite">
          {errorMessage || integration.status?.message || 'Run diagnostics to inspect Codex.'}
        </p>

        <div class="account-actions">
          {#if integration.status?.connected}
            <button type="button" onclick={onSignOut}>Sign out of Codex</button>
          {:else}
            <button type="button" disabled={!integration.runtime?.detected} onclick={onSignIn}
              >Sign in to Codex</button
            >
          {/if}
        </div>
      </section>

      <section class="settings-section" aria-labelledby="generation-model-title">
        <div class="section-heading">
          <div>
            <h3 id="generation-model-title">Generation model</h3>
            <p>The browser preference applies to new generations and rerolls.</p>
          </div>
          <button type="button" class="secondary" onclick={onReset}>Use project default</button>
        </div>

        <div class="field-grid">
          <label>
            <span>Model</span>
            <select
              value={selectedModel}
              onchange={(event) => onModelChange(event.currentTarget.value)}
            >
              {#each integration.models as option (option.model)}
                <option value={option.model}>
                  {option.displayName}{option.model === integration.configuration?.model
                    ? ' · project default'
                    : ''}
                </option>
              {/each}
            </select>
            <small>{selectedModelOption?.description || selectedModel}</small>
          </label>

          <label>
            <span>Reasoning effort</span>
            <select
              value={selectedEffort}
              onchange={(event) => onEffortChange(event.currentTarget.value as AiReasoningEffort)}
            >
              {#each effortOptions as option (option.reasoningEffort)}
                <option value={option.reasoningEffort}>{option.reasoningEffort}</option>
              {/each}
            </select>
            <small>
              {effortOptions.find((option) => option.reasoningEffort === selectedEffort)
                ?.description || 'Controls how much reasoning the model uses.'}
            </small>
          </label>
        </div>

        <div class="effective-setting">
          <span>Effective for the next generation</span>
          <strong>{selectedModel} · {selectedEffort}</strong>
        </div>
        {#if activeBackend !== 'codex'}
          <p class="configuration-note">
            The active backend is local. This model preference is saved, but AI generation requires
            <code>CODESIGN_AGENT_BACKEND=codex</code> on the SvelteKit server.
          </p>
        {/if}
        {#if integration.modelsMessage}
          <p class="configuration-note">{integration.modelsMessage}</p>
        {/if}
      </section>

      <details class="settings-section diagnostics">
        <summary>Technical diagnostics</summary>
        <dl>
          <div>
            <dt>Configured model</dt>
            <dd>{integration.configuration?.model ?? 'Unknown'}</dd>
          </div>
          <div>
            <dt>Configured effort</dt>
            <dd>{integration.configuration?.effort ?? 'Unknown'}</dd>
          </div>
          <div>
            <dt>Runtime source</dt>
            <dd>{integration.runtime?.source ?? 'Unknown'}</dd>
          </div>
          <div>
            <dt>Authentication</dt>
            <dd>{integration.status?.authMode ?? 'None'}</dd>
          </div>
          <div>
            <dt>Plan</dt>
            <dd>{integration.status?.planType ?? 'Unknown'}</dd>
          </div>
          <div>
            <dt>Models reported</dt>
            <dd>{integration.models.length}</dd>
          </div>
          <div>
            <dt>Last checked</dt>
            <dd>{checkedAt(integration.checkedAt)}</dd>
          </div>
        </dl>
      </details>
    </div>
  </div>
</div>

<style>
  .settings-backdrop {
    position: fixed;
    inset: 0;
    z-index: 90;
    display: grid;
    place-items: center;
    background: rgb(25 31 38 / 0.48);
    padding: 28px;
  }
  .settings-dialog {
    width: min(760px, calc(100vw - 40px));
    max-height: min(820px, calc(100vh - 40px));
    overflow: auto;
    border: 1px solid #aeb6bf;
    border-radius: 10px;
    background: #f7f8fa;
    box-shadow: 0 24px 80px rgb(20 28 36 / 0.28);
    color: #202833;
    outline: none;
  }
  header {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    border-bottom: 1px solid #d4d9df;
    background: #fff;
    padding: 20px 22px;
  }
  header h2,
  header p,
  .section-heading h3,
  .section-heading p {
    margin: 0;
  }
  header h2 {
    margin-top: 3px;
    font-size: 20px;
  }
  header p,
  .section-heading p {
    margin-top: 5px;
    color: #68727e;
    font-size: 12px;
  }
  .eyebrow {
    color: #52606d;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  button,
  select {
    border: 1px solid #aeb7c1;
    border-radius: 5px;
    background: #fff;
    color: #27323e;
    font: inherit;
  }
  button {
    min-height: 32px;
    padding: 6px 10px;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    border-color: #657b90;
    background: #edf3f8;
  }
  button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
  .close,
  .secondary {
    flex: none;
    background: #f7f8fa;
  }
  .settings-body {
    display: grid;
    gap: 14px;
    padding: 16px;
  }
  .settings-section {
    border: 1px solid #d4d9df;
    border-radius: 7px;
    background: #fff;
    padding: 16px;
  }
  .section-heading {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 18px;
  }
  .section-heading h3 {
    font-size: 14px;
  }
  .status-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    margin: 14px 0 0;
  }
  .status-grid > div {
    min-width: 0;
    border: 1px solid #e0e4e8;
    border-radius: 5px;
    background: #fafbfc;
    padding: 10px;
  }
  dt {
    color: #6d7782;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  dd {
    margin: 5px 0 0;
    overflow-wrap: anywhere;
  }
  .status-grid dd {
    display: flex;
    align-items: center;
    gap: 7px;
    font-weight: 700;
  }
  small {
    display: block;
    margin-top: 4px;
    color: #707a85;
    font-size: 10px;
  }
  .status-dot {
    width: 8px;
    height: 8px;
    flex: none;
    border-radius: 999px;
    background: #b46d24;
    box-shadow: 0 0 0 2px #f8e9d8;
  }
  .status-dot.good {
    background: #23854e;
    box-shadow: 0 0 0 2px #daf1e3;
  }
  .status-message,
  .configuration-note {
    border-radius: 5px;
    background: #eef3f7;
    padding: 9px 10px;
    color: #4f5c69;
    font-size: 11px;
    line-height: 1.45;
  }
  .status-message.error {
    background: #fff0ed;
    color: #9b3d30;
  }
  .account-actions {
    display: flex;
    justify-content: flex-end;
  }
  .field-grid {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(180px, 1fr);
    gap: 12px;
    margin-top: 14px;
  }
  .field-grid label {
    display: grid;
    align-content: start;
    gap: 5px;
    color: #4f5965;
    font-size: 11px;
    font-weight: 700;
  }
  select {
    min-width: 0;
    height: 36px;
    padding: 0 9px;
  }
  .effective-setting {
    display: flex;
    justify-content: space-between;
    gap: 18px;
    margin-top: 14px;
    border-top: 1px solid #e1e5e9;
    padding-top: 12px;
    font-size: 11px;
  }
  .effective-setting span {
    color: #68727e;
  }
  .effective-setting strong {
    overflow-wrap: anywhere;
    text-align: right;
  }
  code {
    font-size: 10px;
  }
  .diagnostics {
    padding: 0;
  }
  .diagnostics summary {
    padding: 13px 16px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
  }
  .diagnostics dl {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px 20px;
    margin: 0;
    border-top: 1px solid #e1e5e9;
    padding: 14px 16px 16px;
  }
  @media (max-width: 620px) {
    .settings-backdrop {
      padding: 10px;
    }
    .settings-dialog {
      width: calc(100vw - 20px);
      max-height: calc(100vh - 20px);
    }
    .status-grid,
    .field-grid,
    .diagnostics dl {
      grid-template-columns: 1fr;
    }
    .section-heading,
    .effective-setting {
      align-items: stretch;
      flex-direction: column;
    }
    .effective-setting strong {
      text-align: left;
    }
  }
</style>
