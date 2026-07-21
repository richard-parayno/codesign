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
    canvasBackground: string;
    defaultCanvasBackground: string;
    framePresets: Array<{ id: string; name: string; width: number; height: number }>;
    framePresetId: string;
    frameOrientation: 'landscape' | 'portrait';
    frameSize: { width: number; height: number };
    projectSummary: {
      name: string;
      projectCount: number;
      screenCount: number;
      layerCount: number;
      revision: number;
      storageMessage: string;
    };
    integration: AiIntegrationView;
    selectedModel: string;
    selectedEffort: AiReasoningEffort;
    loading?: boolean;
    errorMessage?: string;
    onClose: (source: 'button' | 'backdrop') => void;
    onCanvasBackgroundChange: (color: string) => void;
    onResetCanvasBackground: () => void;
    onFramePresetChange: (presetId: string) => void;
    onFrameOrientationChange: (orientation: 'landscape' | 'portrait') => void;
    onResetViewport: () => void;
    onAiSectionOpen: () => void;
    onRefresh: () => void;
    onModelChange: (model: string) => void;
    onEffortChange: (effort: AiReasoningEffort) => void;
    onReset: () => void;
    onSignIn: () => void;
    onSignOut: () => void;
  };

  let {
    canvasBackground,
    defaultCanvasBackground,
    framePresets,
    framePresetId,
    frameOrientation,
    frameSize,
    projectSummary,
    integration,
    selectedModel,
    selectedEffort,
    loading = false,
    errorMessage = '',
    onClose,
    onCanvasBackgroundChange,
    onResetCanvasBackground,
    onFramePresetChange,
    onFrameOrientationChange,
    onResetViewport,
    onAiSectionOpen,
    onRefresh,
    onModelChange,
    onEffortChange,
    onReset,
    onSignIn,
    onSignOut,
  }: Props = $props();

  let dialog: HTMLElement;
  let activeSection = $state<'editor' | 'ai'>('editor');
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

  function openSection(section: 'editor' | 'ai') {
    activeSection = section;
    if (section === 'ai') onAiSectionOpen();
  }
</script>

<div
  class="settings-backdrop"
  role="presentation"
  onclick={(event) => {
    if (event.target === event.currentTarget) onClose('backdrop');
  }}
>
  <div
    class="settings-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="settings-title"
    tabindex="-1"
    bind:this={dialog}
  >
    <header>
      <div>
        <span class="eyebrow">Editor configuration</span>
        <h2 id="settings-title">Settings</h2>
        <p>Configure the editor, local projects, and Codesign AI integration.</p>
      </div>
      <button type="button" class="close" onclick={() => onClose('button')}>Close settings</button>
    </header>

    <nav class="settings-tabs" aria-label="Settings sections">
      <button
        type="button"
        class:active={activeSection === 'editor'}
        aria-pressed={activeSection === 'editor'}
        onclick={() => openSection('editor')}>Editor and projects</button
      >
      <button
        type="button"
        class:active={activeSection === 'ai'}
        aria-pressed={activeSection === 'ai'}
        onclick={() => openSection('ai')}>Codesign AI</button
      >
    </nav>

    <div class="settings-body">
      {#if activeSection === 'editor'}
        <section class="settings-section" aria-labelledby="canvas-settings-title">
          <div class="section-heading">
            <div>
              <h3 id="canvas-settings-title">Canvas and viewport</h3>
              <p>Choose the workspace color and recover the default view.</p>
            </div>
            <button type="button" class="secondary" onclick={onResetViewport}
              >Reset canvas view</button
            >
          </div>
          <div class="control-grid">
            <label class="color-setting">
              <span>Canvas background</span>
              <span class="color-control">
                <input
                  type="color"
                  aria-label="Settings canvas background"
                  value={canvasBackground}
                  oninput={(event) => onCanvasBackgroundChange(event.currentTarget.value)}
                />
                <code>{canvasBackground}</code>
              </span>
              <small>Stored in this browser and shared across local projects.</small>
            </label>
            <div class="setting-action">
              <span>Color default</span>
              <button
                type="button"
                disabled={canvasBackground === defaultCanvasBackground}
                onclick={onResetCanvasBackground}>Restore default canvas color</button
              >
            </div>
          </div>
        </section>

        <section class="settings-section" aria-labelledby="frame-settings-title">
          <div class="section-heading">
            <div>
              <h3 id="frame-settings-title">New frame defaults</h3>
              <p>These values are used by the Frame tool when placing the next preset.</p>
            </div>
            <strong class="size-readout">{frameSize.width} × {frameSize.height}</strong>
          </div>
          <div class="field-grid">
            <label>
              <span>Frame preset</span>
              <select
                value={framePresetId}
                onchange={(event) => onFramePresetChange(event.currentTarget.value)}
              >
                {#each framePresets as preset (preset.id)}
                  <option value={preset.id}>{preset.name} · {preset.width}×{preset.height}</option>
                {/each}
                {#if framePresetId === 'custom'}<option value="custom">Custom size</option>{/if}
              </select>
            </label>
            <label>
              <span>Orientation</span>
              <select
                value={frameOrientation}
                onchange={(event) =>
                  onFrameOrientationChange(event.currentTarget.value as 'landscape' | 'portrait')}
              >
                <option value="landscape">Landscape</option>
                <option value="portrait">Portrait</option>
              </select>
            </label>
          </div>
        </section>

        <section class="settings-section" aria-labelledby="project-settings-title">
          <div class="section-heading">
            <div>
              <h3 id="project-settings-title">Projects and local storage</h3>
              <p>Codesign saves project files in this browser automatically.</p>
            </div>
          </div>
          <dl class="project-stats">
            <div>
              <dt>Current project</dt>
              <dd>{projectSummary.name}</dd>
            </div>
            <div>
              <dt>Local projects</dt>
              <dd>{projectSummary.projectCount}</dd>
            </div>
            <div>
              <dt>Screens</dt>
              <dd>{projectSummary.screenCount}</dd>
            </div>
            <div>
              <dt>Layers</dt>
              <dd>{projectSummary.layerCount}</dd>
            </div>
            <div>
              <dt>Revision</dt>
              <dd>{projectSummary.revision}</dd>
            </div>
            <div>
              <dt>Storage</dt>
              <dd>{projectSummary.storageMessage}</dd>
            </div>
          </dl>
          <p class="configuration-note">
            Projects are local to this browser profile. Use the project controls in the left panel
            to create, rename, switch, or delete files.
          </p>
        </section>
      {:else}
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
              <dt>Generation provider</dt>
              <dd>
                <span class:good={integration.runtime?.detected} class="status-dot"></span>
                Codex App Server
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
            <div>
              <strong>Provider account</strong>
              <small>
                {integration.status?.connected
                  ? 'Signing out disconnects Codesign generation from this account.'
                  : 'Sign in to enable Codesign generation on this machine.'}
              </small>
            </div>
            {#if integration.status?.connected}
              <button type="button" class="danger" onclick={onSignOut}>Sign out of Codex</button>
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
      {/if}
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
    width: min(800px, calc(100vw - 40px));
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
  .settings-tabs {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid #d4d9df;
    background: #f1f3f5;
    padding: 8px 16px 0;
  }
  .settings-tabs button {
    border-color: transparent;
    border-bottom: 3px solid transparent;
    border-radius: 5px 5px 0 0;
    background: transparent;
    padding: 8px 12px 9px;
    color: #596571;
    font-weight: 700;
  }
  .settings-tabs button.active {
    border-color: #cbd2d9;
    border-bottom-color: #2672ad;
    background: #fff;
    color: #174b78;
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
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    border-top: 1px solid #e1e5e9;
    padding-top: 12px;
  }
  .account-actions > div {
    min-width: 0;
  }
  .account-actions strong {
    font-size: 11px;
  }
  .account-actions .danger {
    flex: none;
    border-color: #c9948d;
    background: #fff5f3;
    color: #9b3127;
  }
  .account-actions .danger:hover:not(:disabled) {
    border-color: #a94a3e;
    background: #fee9e5;
  }
  .account-actions button {
    flex: none;
  }
  .field-grid {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(180px, 1fr);
    gap: 12px;
    margin-top: 14px;
  }
  .control-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(210px, 0.7fr);
    gap: 12px;
    margin-top: 14px;
  }
  .color-setting,
  .setting-action {
    display: grid;
    align-content: start;
    gap: 7px;
    color: #4f5965;
    font-size: 11px;
    font-weight: 700;
  }
  .color-control {
    display: flex;
    align-items: center;
    gap: 9px;
    min-height: 36px;
  }
  .color-control input {
    width: 48px;
    height: 36px;
    border: 1px solid #aeb7c1;
    border-radius: 5px;
    background: #fff;
    padding: 3px;
    cursor: pointer;
  }
  .setting-action button {
    align-self: end;
  }
  .size-readout {
    flex: none;
    border-radius: 4px;
    background: #edf2f6;
    padding: 6px 8px;
    color: #475768;
    font-size: 11px;
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
  .project-stats {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin: 14px 0 0;
  }
  .project-stats > div {
    min-width: 0;
    border: 1px solid #e0e4e8;
    border-radius: 5px;
    background: #fafbfc;
    padding: 9px 10px;
  }
  .project-stats dd {
    font-weight: 700;
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
    .control-grid,
    .project-stats,
    .diagnostics dl {
      grid-template-columns: 1fr;
    }
    .section-heading,
    .effective-setting,
    .account-actions {
      align-items: stretch;
      flex-direction: column;
    }
    .effective-setting strong {
      text-align: left;
    }
  }
</style>
