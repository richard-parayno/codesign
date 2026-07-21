<script lang="ts" module>
  import type {
    AtomicChange,
    CandidateRevision,
    CodesignAction,
    DerivationTrace,
    Fidelity,
    ObservationScope,
  } from '$lib/model/types';

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
  import FidelityStops, { type FidelityStopView } from './FidelityStops.svelte';

  type Props = {
    selectionLabel: string;
    canGenerate: boolean;
    commandLabel: string;
    statusMessage: string;
    busy: boolean;
    observationScope: ObservationScope;
    observationScopes: ObservationScopeView[];
    fidelityStops: FidelityStopView[];
    requestedFidelity: Fidelity;
    candidates: CandidateView[];
    activeCandidateId?: string;
    highlightedChangeId?: string;
    compareSource?: boolean;
    rerollDisabledReason?: string;
    onScopePreviewChange?: (open: boolean) => void;
    onObservationScopeChange: (scope: ObservationScope) => void;
    onGenerate: (action: CodesignAction) => void;
    onCancel: () => void;
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
    selectionLabel,
    canGenerate,
    commandLabel,
    statusMessage,
    busy,
    observationScope,
    observationScopes,
    fidelityStops,
    requestedFidelity,
    candidates,
    activeCandidateId,
    highlightedChangeId,
    compareSource = false,
    rerollDisabledReason,
    onScopePreviewChange,
    onObservationScopeChange,
    onGenerate,
    onCancel,
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

  function traceFor(item: AtomicChangeView): DerivationTrace {
    return item.change.trace;
  }

  function fidelityModeLabel(fidelity: Fidelity) {
    if (fidelity === 'wireframe') return 'primitives';
    return 'shadcn-first';
  }

  function supportedFidelity(fidelity: Fidelity): Extract<Fidelity, 'wireframe' | 'component'> {
    return fidelity === 'component' || fidelity === 'visual' || fidelity === 'production'
      ? 'component'
      : 'wireframe';
  }

  let displayedFidelity = $derived(supportedFidelity(requestedFidelity));
</script>

<section class="inline-codesign" aria-label="Codesign controls">
  <div class="primary-row">
    <div class="selection-context">
      <span class="spark" aria-hidden="true">✦</span>
      <span><strong>{selectionLabel}</strong><small>{statusMessage}</small></span>
    </div>

    {#if busy}
      <span class="progress" role="status"><i aria-hidden="true"></i>Generating candidate</span>
      <button type="button" onclick={onCancel}>Cancel</button>
    {:else if activeCandidate?.candidate.status === 'candidate'}
      <div class="candidate-navigation" aria-label="Generated candidates">
        {#each candidates as item, index (item.candidate.id)}
          <button
            type="button"
            class:active={item.candidate.id === activeCandidate.candidate.id}
            aria-label={`View candidate ${index + 1}`}
            aria-pressed={item.candidate.id === activeCandidate.candidate.id}
            onclick={() => onSelectCandidate(item.candidate.id)}>{index + 1}</button
          >
        {/each}
      </div>
      <button
        type="button"
        aria-pressed={compareSource}
        onclick={() => onCompareSource(!compareSource)}
        >{compareSource ? 'Show candidate' : 'Compare source'}</button
      >
      <button
        class="primary"
        type="button"
        disabled={!pendingCount}
        onclick={() => onAcceptAll(activeCandidate.candidate.id)}>Accept all</button
      >
      <details class="review-menu">
        <summary>Review {selectedCount}/{activeCandidate.changes.length}</summary>
        <div class="review-popover">
          <header>
            <div>
              <strong>Proposed changes</strong><small>Select a dependency-safe subset.</small>
            </div>
            <span>{activeCandidate.candidate.fidelity}</span>
          </header>
          <div class="change-list">
            {#each activeCandidate.changes as item (item.change.id)}
              <article class:highlighted={highlightedChangeId === item.change.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={item.selected}
                    disabled={Boolean(item.disabledReason)}
                    onchange={(event) =>
                      onToggleAtomicChange(item.change.id, event.currentTarget.checked)}
                  />
                  <span><strong>{item.label}</strong><small>{item.summary}</small></span>
                </label>
                {#if item.change.dependencyIds.length}
                  <small class="dependency"
                    >Requires {(item.dependencyLabels ?? item.change.dependencyIds).join(
                      ', ',
                    )}</small
                  >
                {/if}
                <div class="change-actions">
                  <button
                    type="button"
                    aria-pressed={highlightedChangeId === item.change.id}
                    onclick={() =>
                      onHighlightChange(
                        highlightedChangeId === item.change.id ? undefined : item.change.id,
                      )}
                    >{highlightedChangeId === item.change.id
                      ? 'Clear evidence'
                      : 'Evidence'}</button
                  >
                  <button
                    type="button"
                    disabled={!['create', 'style'].includes(item.change.operation.type)}
                    aria-pressed={item.pinned}
                    onclick={() => onTogglePin(item.change.id, !item.pinned)}
                    >{item.pinned ? 'Unpin change' : 'Pin change'}</button
                  >
                </div>
                <details class="trace">
                  <summary>Why this change?</summary>
                  <dl>
                    <dt>Observation</dt>
                    <dd>{traceFor(item).observation}</dd>
                    <dt>Context</dt>
                    <dd>{traceFor(item).context}</dd>
                    <dt>Proposed interpretation</dt>
                    <dd>{traceFor(item).inference}</dd>
                    <dt>Change</dt>
                    <dd>{traceFor(item).proposedChange}</dd>
                    <dt>User decision</dt>
                    <dd>{activeCandidate.candidate.decisions[item.change.id]}</dd>
                  </dl>
                </details>
              </article>
            {/each}
          </div>
          <footer>
            <button
              class="primary"
              type="button"
              disabled={!selectedCount}
              onclick={() => onAcceptSelected(activeCandidate.candidate.id)}
              >Accept {selectedCount}, reject {activeCandidate.changes.length -
                selectedCount}</button
            >
          </footer>
        </div>
      </details>
      <button
        type="button"
        disabled={Boolean(rerollDisabledReason)}
        title={rerollDisabledReason}
        onclick={() => onReroll(activeCandidate.candidate.id)}>Reroll</button
      >
      <button type="button" onclick={() => onRejectCandidate(activeCandidate.candidate.id)}
        >Reject</button
      >
    {:else if activeCandidate}
      <div class="candidate-navigation" aria-label="Recorded candidates">
        {#each candidates as item, index (item.candidate.id)}
          <button
            type="button"
            class:active={item.candidate.id === activeCandidate.candidate.id}
            aria-label={`View candidate ${index + 1}`}
            aria-pressed={item.candidate.id === activeCandidate.candidate.id}
            onclick={() => onSelectCandidate(item.candidate.id)}>{index + 1}</button
          >
        {/each}
      </div>
      <span class="recorded-status">{activeCandidate.candidate.status}</span>
      <button
        type="button"
        aria-pressed={compareSource}
        onclick={() => onCompareSource(!compareSource)}
        >{compareSource ? 'Show candidate' : 'Compare source'}</button
      >
      <button
        type="button"
        disabled={Boolean(rerollDisabledReason)}
        title={rerollDisabledReason}
        onclick={() => onReroll(activeCandidate.candidate.id)}>Reroll</button
      >
    {:else}
      <button
        class="primary"
        type="button"
        disabled={!canGenerate}
        title={`Complete with Codesign · ${commandLabel}+Enter`}
        onclick={() => onGenerate('complete')}>Complete with Codesign</button
      >
    {/if}

    <details class="fidelity-menu">
      <summary>Fidelity · {displayedFidelity} · {fidelityModeLabel(displayedFidelity)}</summary>
      <div class="fidelity-popover">
        <FidelityStops
          label="Selection fidelity"
          stops={fidelityStops}
          selectedFidelity={requestedFidelity}
          onNavigate={onNavigateFidelity}
          onStageGeneration={onStageFidelity}
          onInspectCandidate={onInspectFidelityCandidate}
        />
        <p>
          {displayedFidelity === 'wireframe'
            ? 'Wireframe uses editor primitives. Move to Component and confirm to generate with installed shadcn-svelte components.'
            : 'Component fidelity uses compatible installed shadcn-svelte components and creates a reusable local component.'}
        </p>
      </div>
    </details>

    <details
      class="scope-menu"
      ontoggle={(event) => onScopePreviewChange?.(event.currentTarget.open)}
    >
      <summary>Scope</summary>
      <fieldset class="scope-popover">
        <legend>Codesign can reference</legend>
        {#each observationScopes as option (option.scope.kind)}
          <label class:disabled={Boolean(option.disabledReason)}>
            <input
              type="radio"
              name="inline-codesign-scope"
              checked={observationScope.kind === option.scope.kind}
              disabled={Boolean(option.disabledReason)}
              onchange={() => onObservationScopeChange(option.scope)}
            />
            <span><strong>{option.label}</strong><small>{option.description}</small></span>
          </label>
        {/each}
        <p>The highlighted selection may change; the containing scene is context only.</p>
      </fieldset>
    </details>
  </div>
</section>

<style>
  .inline-codesign {
    position: absolute;
    z-index: 12;
    top: 48px;
    left: 50%;
    max-width: calc(100% - 24px);
    transform: translateX(-50%);
    color: #f8fafc;
    font-size: 11px;
  }
  .primary-row {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 38px;
    padding: 5px;
    border: 1px solid #111827;
    border-radius: 7px;
    background: #202731;
    box-shadow: 0 8px 24px #11182738;
  }
  .selection-context {
    min-width: 120px;
    max-width: 220px;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 0 7px 0 4px;
  }
  .selection-context > span:last-child,
  .review-popover header div,
  .change-list label span,
  .scope-popover label span {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .selection-context strong,
  .selection-context small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .selection-context small {
    max-width: 190px;
    color: #aeb8c5;
    font-size: 9px;
  }
  .spark {
    color: #f7c95c;
    font-size: 15px;
  }
  button,
  summary {
    min-height: 28px;
    border: 0;
    border-radius: 4px;
    background: #394452;
    padding: 0 8px;
    color: white;
    cursor: pointer;
    white-space: nowrap;
  }
  button:hover,
  summary:hover,
  button:focus-visible,
  summary:focus-visible {
    background: #4a596b;
  }
  button:disabled {
    opacity: 0.48;
    cursor: default;
  }
  button.primary {
    background: #2874ae;
  }
  button.primary:hover:not(:disabled) {
    background: #3686c2;
  }
  summary {
    display: flex;
    align-items: center;
    list-style: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  details {
    position: relative;
  }
  details[open] > summary {
    background: #526274;
  }
  .candidate-navigation {
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: 4px;
    background: #111827;
  }
  .candidate-navigation button {
    min-width: 25px;
    padding: 0 5px;
  }
  .candidate-navigation button.active {
    background: #b97920;
  }
  .progress {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    color: #d7dee7;
  }
  .progress i {
    width: 12px;
    height: 12px;
    border: 2px solid #718096;
    border-top-color: #f7c95c;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .review-popover,
  .fidelity-popover,
  .scope-popover {
    position: absolute;
    z-index: 50;
    top: calc(100% + 8px);
    border: 1px solid #b8c0ca;
    border-radius: 7px;
    background: #fbfcfd;
    color: #202833;
    box-shadow: 0 18px 45px #11182742;
  }
  .review-popover {
    right: -138px;
    width: min(440px, calc(100vw - 40px));
  }
  .review-popover header,
  .review-popover footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
  }
  .review-popover header {
    border-bottom: 1px solid #dce1e6;
  }
  .review-popover header small,
  .change-list small,
  .scope-popover small {
    color: #687380;
    font-size: 9px;
  }
  .change-list {
    max-height: 330px;
    overflow: auto;
    padding: 4px;
  }
  .change-list article {
    padding: 8px;
    border-radius: 5px;
  }
  .change-list article + article {
    border-top: 1px solid #e2e6ea;
  }
  .change-list article.highlighted {
    background: #fff6dc;
  }
  .change-list label,
  .scope-popover label {
    display: flex;
    gap: 8px;
  }
  .change-list label input,
  .scope-popover label input {
    margin: 2px 0 0;
  }
  .change-list .dependency {
    display: block;
    margin: 5px 0 0 22px;
    color: #835e20;
  }
  .change-actions {
    display: flex;
    gap: 5px;
    margin: 7px 0 0 22px;
  }
  .change-actions button,
  .review-popover footer button {
    border: 1px solid #c7cdd4;
    background: white;
    color: #33404d;
  }
  .change-actions button[aria-pressed='true'] {
    border-color: #bb781d;
    background: #fff6dd;
  }
  .trace {
    margin: 6px 0 0 22px;
  }
  .trace summary {
    min-height: 22px;
    display: inline-flex;
    background: transparent;
    padding: 0;
    color: #53606d;
  }
  .trace dl {
    display: grid;
    grid-template-columns: 110px 1fr;
    gap: 5px 8px;
    margin: 5px 0 0;
    color: #596470;
    font-size: 10px;
  }
  .trace dd {
    margin: 0;
  }
  .fidelity-popover {
    right: 0;
    width: min(520px, calc(100vw - 40px));
    padding: 12px;
  }
  .fidelity-popover p,
  .scope-popover p {
    margin: 6px 0 0;
    color: #66717e;
    font-size: 9px;
  }
  .scope-popover {
    right: 0;
    width: 320px;
    margin: 0;
    padding: 12px;
  }
  .scope-popover legend {
    padding: 0;
    font-weight: 700;
  }
  .scope-popover label {
    margin-top: 8px;
  }
  .scope-popover label.disabled {
    opacity: 0.55;
  }
</style>
