<script lang="ts" module>
  import type {
    AtomicChange,
    CandidateRevision,
    CodesignAction,
    DerivationTrace,
    Fidelity,
    GenerationRun,
    ObservationScope,
  } from '$lib/model/types';
  import type { FidelityStopView } from './FidelityStops.svelte';

  export type CodesignActionView = {
    action: CodesignAction;
    disabledReason?: string;
  };

  export type ObservationScopeView = {
    scope: ObservationScope;
    label: string;
    description: string;
    disabledReason?: string;
  };

  export type AtomicChangeView = {
    change: AtomicChange;
    label: string;
    summary: string;
    selected: boolean;
    pinned: boolean;
    dependencyLabels?: string[];
    disabledReason?: string;
  };

  export type CandidateView = {
    candidate: CandidateRevision;
    label?: string;
    changes: AtomicChangeView[];
  };
</script>

<script lang="ts">
  import FidelityStops from './FidelityStops.svelte';

  type Props = {
    mutationLabels: string[];
    observationSummary: string;
    observationScope: ObservationScope;
    observationScopes: ObservationScopeView[];
    supportedActions: CodesignActionView[];
    fidelityStops: FidelityStopView[];
    run?: GenerationRun;
    candidates: CandidateView[];
    activeCandidateId?: string;
    highlightedChangeId?: string;
    compareSource?: boolean;
    busy?: boolean;
    statusMessage?: string;
    acceptSelectedDisabledReason?: string;
    rerollDisabledReason?: string;
    onObservationScopeChange: (scope: ObservationScope) => void;
    onGenerate: (action: CodesignAction) => void;
    onNavigateFidelity: (fidelity: Fidelity, representationId: string) => void;
    onStageFidelity: (fidelity: Fidelity) => void;
    onInspectFidelityCandidate: (fidelity: Fidelity) => void;
    onSelectCandidate: (candidateId: string) => void;
    onToggleAtomicChange: (changeId: string, selected: boolean) => void;
    onTogglePin: (changeId: string, pinned: boolean) => void;
    onHighlightChange: (changeId?: string) => void;
    onCompareSource: (compare: boolean) => void;
    onAcceptAll: (candidateId: string) => void;
    onAcceptSelected: (candidateId: string) => void;
    onRejectCandidate: (candidateId: string) => void;
    onReroll: (candidateId: string) => void;
  };

  let {
    mutationLabels,
    observationSummary,
    observationScope,
    observationScopes,
    supportedActions,
    fidelityStops,
    run,
    candidates,
    activeCandidateId,
    highlightedChangeId,
    compareSource = false,
    busy = false,
    statusMessage = '',
    acceptSelectedDisabledReason,
    rerollDisabledReason,
    onObservationScopeChange,
    onGenerate,
    onNavigateFidelity,
    onStageFidelity,
    onInspectFidelityCandidate,
    onSelectCandidate,
    onToggleAtomicChange,
    onTogglePin,
    onHighlightChange,
    onCompareSource,
    onAcceptAll,
    onAcceptSelected,
    onRejectCandidate,
    onReroll,
  }: Props = $props();

  const actionCopy: Record<CodesignAction, { label: string; description: string }> = {
    complete: { label: 'Complete pattern', description: 'Continue a visible visual pattern.' },
    refine: { label: 'Refine', description: 'Increase fidelity while preserving structure.' },
    vary: { label: 'Vary', description: 'Propose an alternative composition or treatment.' },
    resolve: { label: 'Resolve', description: 'Map rough primitives to registered components.' },
  };

  const statusLabel = {
    candidate: 'Ready for review',
    'partially-accepted': 'Partially accepted',
    accepted: 'Accepted',
    rejected: 'Rejected',
  } as const;

  let activeCandidate = $derived(
    candidates.find((item) => item.candidate.id === activeCandidateId) ?? candidates[0],
  );
  let selectedCount = $derived(
    activeCandidate?.changes.filter((item) => item.selected).length ?? 0,
  );
  let pendingCount = $derived(
    activeCandidate?.changes.filter(
      (item) => activeCandidate?.candidate.decisions[item.change.id] === 'pending',
    ).length ?? 0,
  );

  function selectAdjacentCandidate(event: KeyboardEvent, index: number) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + candidates.length) % candidates.length;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % candidates.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = candidates.length - 1;
    const next = candidates[nextIndex];
    if (!next) return;
    onSelectCandidate(next.candidate.id);
    const tabs = (
      event.currentTarget as HTMLButtonElement
    ).parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs?.[nextIndex]?.focus();
  }

  function traceFor(item: AtomicChangeView): DerivationTrace {
    return item.change.trace;
  }
</script>

<section class="codesign-panel" aria-labelledby="codesign-title">
  <header>
    <div>
      <span class="eyebrow">Explicit visual autocomplete</span>
      <h2 id="codesign-title">Co-design</h2>
    </div>
    {#if run}
      <span class="backend">{run.backend === 'codex' ? 'Codex' : 'Local'} generator</span>
    {/if}
  </header>

  <div class="scope-grid">
    <section class="scope-card mutation-scope" aria-labelledby="mutation-scope-title">
      <h3 id="mutation-scope-title">Can change</h3>
      <strong
        >{mutationLabels.length} selected {mutationLabels.length === 1 ? 'layer' : 'layers'}</strong
      >
      {#if mutationLabels.length}
        <ul>
          {#each mutationLabels as label}
            <li>{label}</li>
          {/each}
        </ul>
      {:else}
        <p>Select a frame or object to choose where Codesign may propose changes.</p>
      {/if}
    </section>

    <fieldset class="scope-card observation-scope">
      <legend>Can reference</legend>
      <strong>{observationSummary}</strong>
      <div class="scope-options">
        {#each observationScopes as option (option.scope.kind)}
          <label class:disabled={Boolean(option.disabledReason)}>
            <input
              type="radio"
              name="codesign-observation-scope"
              value={option.scope.kind}
              checked={observationScope.kind === option.scope.kind}
              disabled={Boolean(option.disabledReason)}
              onchange={() => onObservationScopeChange(option.scope)}
            />
            <span><b>{option.label}</b><small>{option.description}</small></span>
          </label>
          {#if option.disabledReason}
            <small class="disabled-reason">{option.disabledReason}</small>
          {/if}
        {/each}
      </div>
    </fieldset>
  </div>
  <p class="scope-note">
    Codesign may reference the chosen context, but only the selected layers can change.
  </p>

  <section class="generation" aria-labelledby="generation-title">
    <div class="section-heading">
      <div>
        <h3 id="generation-title">Choose a continuation</h3>
        <p>Nothing changes until you accept a candidate.</p>
      </div>
    </div>
    <div class="action-grid">
      {#each supportedActions as item (item.action)}
        <div class="action-option">
          <button
            type="button"
            disabled={busy || mutationLabels.length === 0 || Boolean(item.disabledReason)}
            aria-describedby={`action-help-${item.action}`}
            onclick={() => onGenerate(item.action)}>{actionCopy[item.action].label}</button
          >
          <small id={`action-help-${item.action}`}>
            {item.disabledReason ?? actionCopy[item.action].description}
          </small>
        </div>
      {/each}
    </div>
    {#if !supportedActions.length}
      <p class="empty-state">No generation actions are available for this selection.</p>
    {/if}

    <FidelityStops
      label="Target fidelity"
      stops={fidelityStops}
      onNavigate={onNavigateFidelity}
      onStageGeneration={onStageFidelity}
      onInspectCandidate={onInspectFidelityCandidate}
    />
  </section>

  {#if candidates.length}
    <section class="candidate-review" aria-labelledby="candidate-review-title">
      <div class="candidate-heading">
        <div>
          <span class="eyebrow">Your design is unchanged</span>
          <h3 id="candidate-review-title">Candidate review</h3>
        </div>
        <button
          class="compare"
          type="button"
          aria-pressed={compareSource}
          onclick={() => onCompareSource(!compareSource)}
          >{compareSource ? 'Show candidate' : 'Compare with source'}</button
        >
      </div>

      <div class="candidate-tabs" role="tablist" aria-label="Generated candidates">
        {#each candidates as item, index (item.candidate.id)}
          <button
            id={`candidate-tab-${item.candidate.id}`}
            type="button"
            role="tab"
            aria-selected={item.candidate.id === activeCandidate?.candidate.id}
            aria-controls={`candidate-panel-${item.candidate.id}`}
            tabindex={item.candidate.id === activeCandidate?.candidate.id ? 0 : -1}
            onclick={() => onSelectCandidate(item.candidate.id)}
            onkeydown={(event) => selectAdjacentCandidate(event, index)}
          >
            <span>{item.label ?? `Candidate ${index + 1}`}</span>
            <small>{statusLabel[item.candidate.status]}</small>
          </button>
        {/each}
      </div>

      {#if activeCandidate}
        <div
          class="candidate-body"
          id={`candidate-panel-${activeCandidate.candidate.id}`}
          role="tabpanel"
          aria-labelledby={`candidate-tab-${activeCandidate.candidate.id}`}
        >
          <div class="candidate-meta">
            <strong>
              Candidate {candidates.indexOf(activeCandidate) + 1} of {candidates.length} ·
              {activeCandidate.candidate.fidelity}
            </strong>
            <span>{pendingCount} pending {pendingCount === 1 ? 'change' : 'changes'}</span>
          </div>

          <fieldset class="changes">
            <legend>{activeCandidate.changes.length} proposed changes</legend>
            {#each activeCandidate.changes as item (item.change.id)}
              <article
                class:highlighted={highlightedChangeId === item.change.id}
                class:resolved={activeCandidate.candidate.decisions[item.change.id] !== 'pending'}
              >
                <div class="change-choice">
                  <input
                    id={`atomic-change-${item.change.id}`}
                    type="checkbox"
                    checked={item.selected}
                    disabled={busy || Boolean(item.disabledReason)}
                    onchange={(event) =>
                      onToggleAtomicChange(item.change.id, event.currentTarget.checked)}
                  />
                  <label for={`atomic-change-${item.change.id}`}>
                    <strong>{item.label}</strong>
                    <span>{item.summary}</span>
                  </label>
                </div>

                {#if item.change.dependencyIds.length}
                  <p class="dependencies">
                    Requires:
                    {(item.dependencyLabels ?? item.change.dependencyIds).join(', ')}
                  </p>
                {/if}
                {#if item.disabledReason}
                  <p class="disabled-reason">{item.disabledReason}</p>
                {/if}

                <div class="change-actions">
                  <button
                    type="button"
                    disabled={activeCandidate.candidate.status !== 'candidate'}
                    aria-pressed={item.pinned}
                    onclick={() => onTogglePin(item.change.id, !item.pinned)}
                    >{item.pinned ? 'Pinned for this run' : 'Pin to preserve on reroll'}</button
                  >
                  <button
                    type="button"
                    aria-pressed={highlightedChangeId === item.change.id}
                    onclick={() =>
                      onHighlightChange(
                        highlightedChangeId === item.change.id ? undefined : item.change.id,
                      )}
                    >{highlightedChangeId === item.change.id
                      ? 'Clear canvas highlight'
                      : 'Highlight evidence'}</button
                  >
                </div>

                <details>
                  <summary>Review derivation trace</summary>
                  <dl>
                    <dt>Observed</dt>
                    <dd>{traceFor(item).observation}</dd>
                    <dt>Context</dt>
                    <dd>{traceFor(item).context}</dd>
                    <dt>Codesign proposed</dt>
                    <dd>{traceFor(item).inference}</dd>
                    <dt>Change</dt>
                    <dd>{traceFor(item).proposedChange}</dd>
                    <dt>Decision</dt>
                    <dd>{activeCandidate.candidate.decisions[item.change.id]}</dd>
                  </dl>
                </details>
              </article>
            {/each}
          </fieldset>

          <p class="decision-note">
            Unselected changes will be saved as rejected in process history.
          </p>
          {#if acceptSelectedDisabledReason}
            <p class="disabled-reason">{acceptSelectedDisabledReason}</p>
          {/if}
          {#if rerollDisabledReason}
            <p class="disabled-reason">{rerollDisabledReason}</p>
          {/if}

          <div class="decision-actions">
            <button
              class="primary"
              type="button"
              disabled={busy ||
                pendingCount === 0 ||
                activeCandidate.candidate.status !== 'candidate'}
              onclick={() => onAcceptAll(activeCandidate.candidate.id)}
              >Accept all {activeCandidate.changes.length} changes</button
            >
            <button
              class="primary secondary"
              type="button"
              disabled={busy ||
                selectedCount === 0 ||
                activeCandidate.candidate.status !== 'candidate' ||
                Boolean(acceptSelectedDisabledReason)}
              onclick={() => onAcceptSelected(activeCandidate.candidate.id)}
              >Accept {selectedCount} and reject {activeCandidate.changes.length -
                selectedCount}</button
            >
            <button
              type="button"
              disabled={busy || activeCandidate.candidate.status !== 'candidate'}
              onclick={() => onRejectCandidate(activeCandidate.candidate.id)}
              >Reject candidate</button
            >
            <button
              type="button"
              disabled={busy || Boolean(rerollDisabledReason)}
              onclick={() => onReroll(activeCandidate.candidate.id)}>Reroll unpinned changes</button
            >
          </div>
        </div>
      {/if}
    </section>
  {:else}
    <div class="empty-state candidate-empty">
      <strong>No candidate yet</strong>
      <p>Choose a supported action to stage a visual continuation on the canvas.</p>
    </div>
  {/if}

  <p class="live" aria-live="polite">{statusMessage}</p>
</section>

<style>
  .codesign-panel {
    min-width: 0;
    display: grid;
    gap: 14px;
    color: #202833;
    font-size: 12px;
  }

  header,
  .candidate-heading,
  .section-heading,
  .candidate-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  h2,
  h3,
  p {
    margin: 0;
  }

  h2 {
    margin-top: 2px;
    font-size: 19px;
  }

  h3,
  legend {
    color: #3d4753;
    font-size: 12px;
    font-weight: 700;
  }

  .eyebrow {
    color: #66717d;
    font-size: 9px;
    font-weight: 750;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .backend {
    padding: 4px 7px;
    border: 1px solid #bdc7d1;
    border-radius: 999px;
    background: #f7f9fb;
    color: #52606e;
    font-size: 10px;
  }

  .scope-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr);
    gap: 8px;
  }

  .scope-card {
    min-width: 0;
    margin: 0;
    border: 1px solid #c7cdd4;
    border-radius: 6px;
    padding: 10px;
    background: #f8fafb;
  }

  .scope-card h3,
  .scope-card legend {
    padding: 0 3px;
  }

  .mutation-scope {
    border: 2px solid #246da5;
  }

  .observation-scope {
    border-style: dashed;
    border-color: #7f8b97;
  }

  .scope-card > strong {
    display: block;
    margin: 5px 0;
  }

  .scope-card ul {
    max-height: 84px;
    overflow: auto;
    margin: 7px 0 0;
    padding-left: 18px;
  }

  .scope-card p,
  .scope-note,
  .section-heading p,
  .decision-note,
  .empty-state p {
    color: #65707c;
    line-height: 1.45;
  }

  .scope-note {
    padding: 8px 10px;
    border-left: 3px solid #7f8b97;
    background: #eef2f5;
  }

  .scope-options {
    display: grid;
    gap: 4px;
    margin-top: 7px;
  }

  .scope-options label {
    min-height: 40px;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px;
    border-radius: 4px;
    cursor: pointer;
  }

  .scope-options label:hover {
    background: #e9eef2;
  }

  .scope-options label.disabled {
    cursor: default;
    opacity: 0.62;
  }

  .scope-options input {
    margin-top: 2px;
  }

  .scope-options span {
    display: grid;
    gap: 2px;
  }

  .scope-options small,
  .action-option small {
    color: #697580;
    line-height: 1.35;
  }

  .generation,
  .candidate-review {
    display: grid;
    gap: 12px;
    border-top: 1px solid #d4d9df;
    padding-top: 14px;
  }

  .action-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 7px;
  }

  .action-option {
    display: grid;
    align-content: start;
    gap: 4px;
  }

  button {
    min-height: 36px;
    border: 1px solid #aeb9c4;
    border-radius: 5px;
    background: #fff;
    padding: 7px 9px;
    color: #303b46;
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    border-color: #718599;
    background: #edf3f7;
  }

  button:focus-visible,
  input:focus-visible,
  summary:focus-visible {
    outline: 2px solid #246da5;
    outline-offset: 2px;
  }

  button:disabled,
  input:disabled {
    cursor: not-allowed;
    opacity: 0.52;
  }

  .candidate-heading .compare {
    min-width: 142px;
  }

  .compare[aria-pressed='true'] {
    border-color: #8a5a12;
    background: #fff5dc;
  }

  .candidate-tabs {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    border-bottom: 1px solid #cdd4db;
  }

  .candidate-tabs button {
    min-width: 125px;
    display: grid;
    gap: 2px;
    border: 0;
    border-bottom: 3px solid transparent;
    border-radius: 4px 4px 0 0;
    background: transparent;
    text-align: left;
  }

  .candidate-tabs button[aria-selected='true'] {
    border-bottom-color: #246da5;
    background: #eaf1f6;
  }

  .candidate-tabs small {
    color: #697580;
    font-size: 10px;
  }

  .candidate-body {
    display: grid;
    gap: 10px;
  }

  .candidate-meta span {
    color: #697580;
  }

  .changes {
    display: grid;
    gap: 7px;
    margin: 0;
    border: 0;
    padding: 0;
  }

  .changes legend {
    margin-bottom: 7px;
  }

  article {
    display: grid;
    gap: 7px;
    border: 1px solid #cbd2da;
    border-left: 4px solid #7b8793;
    border-radius: 5px;
    padding: 9px;
    background: #fbfcfd;
  }

  article.highlighted {
    border-color: #246da5;
    box-shadow: 0 0 0 2px #246da524;
  }

  article.resolved {
    border-left-style: double;
    background: #f3f5f7;
  }

  .change-choice {
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr);
    gap: 7px;
  }

  .change-choice input {
    width: 17px;
    height: 17px;
    margin: 2px 0 0;
  }

  .change-choice label {
    display: grid;
    gap: 3px;
    cursor: pointer;
  }

  .change-choice label span,
  .dependencies {
    color: #66717d;
    line-height: 1.4;
  }

  .dependencies {
    margin-left: 27px;
    padding: 5px 7px;
    border-left: 2px solid #94712f;
    background: #faf5e8;
    font-size: 10px;
  }

  .disabled-reason {
    color: #87531f;
    font-size: 10px;
    line-height: 1.4;
  }

  .change-actions,
  .decision-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .change-actions {
    margin-left: 27px;
  }

  .change-actions button {
    min-height: 36px;
    font-size: 10px;
  }

  .change-actions button[aria-pressed='true'] {
    border-color: #6c4f91;
    background: #f3edfa;
  }

  details {
    margin-left: 27px;
    border-top: 1px solid #dce1e6;
    padding-top: 7px;
  }

  summary {
    width: fit-content;
    border-radius: 3px;
    color: #3f5f79;
    cursor: pointer;
  }

  dl {
    display: grid;
    grid-template-columns: 118px minmax(0, 1fr);
    gap: 7px 10px;
    margin: 9px 0 0;
    padding: 9px;
    background: #f1f4f6;
    line-height: 1.4;
  }

  dt {
    color: #5d6874;
    font-weight: 700;
  }

  dd {
    margin: 0;
  }

  .decision-note {
    font-size: 11px;
  }

  .decision-actions button {
    min-height: 40px;
  }

  .decision-actions .primary {
    border-color: #1d5f91;
    background: #246da5;
    color: white;
    font-weight: 700;
  }

  .decision-actions .primary:hover:not(:disabled) {
    background: #1d5f91;
  }

  .decision-actions .secondary {
    background: #fff;
    color: #1d5f91;
  }

  .empty-state {
    padding: 10px;
    border: 1px dashed #bec7d0;
    border-radius: 5px;
    background: #f8fafb;
  }

  .candidate-empty {
    display: grid;
    gap: 4px;
    min-height: 72px;
    align-content: center;
  }

  .live {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  @media (max-width: 760px) {
    .scope-grid {
      grid-template-columns: 1fr;
    }

    .candidate-heading,
    .candidate-meta {
      align-items: flex-start;
      flex-direction: column;
    }

    .candidate-heading .compare {
      width: 100%;
    }

    dl {
      grid-template-columns: 1fr;
    }

    dd:not(:last-child) {
      margin-bottom: 5px;
    }
  }
</style>
