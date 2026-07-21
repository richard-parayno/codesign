<script lang="ts" module>
  import type { Fidelity } from '$lib/model/types';

  export type FidelityStopState =
    'current' | 'saved' | 'generate' | 'candidate' | 'versions' | 'unavailable';

  export type FidelityStopView = {
    fidelity: Fidelity;
    state: FidelityStopState;
    representationId?: string;
    versionCount?: number;
    inheritedFrom?: string;
    disabledReason?: string;
  };
</script>

<script lang="ts">
  import { normalizeCodesignFidelity, shouldNavigateSavedFidelity } from './fidelity-navigation';

  type SupportedFidelity = Extract<Fidelity, 'wireframe' | 'component'>;

  type Props = {
    label?: string;
    stops: FidelityStopView[];
    selectedFidelity?: Fidelity;
    onNavigate: (fidelity: Fidelity, representationId: string) => void;
    onStageGeneration: (fidelity: Fidelity) => void;
    onInspectCandidate: (fidelity: Fidelity) => void;
  };

  let {
    label = 'Fidelity',
    stops,
    selectedFidelity,
    onNavigate,
    onStageGeneration,
    onInspectCandidate,
  }: Props = $props();

  const supportedFidelities: SupportedFidelity[] = ['wireframe', 'component'];
  const fidelityLabel: Record<SupportedFidelity, string> = {
    wireframe: 'Wireframe',
    component: 'Component',
  };

  let supportedStops = $derived(
    supportedFidelities.map(
      (fidelity) =>
        stops.find((stop) => stop.fidelity === fidelity) ?? {
          fidelity,
          state: 'unavailable' as const,
          disabledReason: `${fidelityLabel[fidelity]} is unavailable for this selection.`,
        },
    ),
  );
  let committedFidelity = $derived(
    normalizeCodesignFidelity(
      selectedFidelity ?? stops.find((stop) => stop.state === 'current')?.fidelity,
    ),
  );
  let chosenFidelity = $state<SupportedFidelity>('wireframe');
  let pendingFidelity = $state<SupportedFidelity>();
  let selectedStop = $derived(
    supportedStops.find((stop) => stop.fidelity === chosenFidelity) ?? supportedStops[0],
  );

  $effect(() => {
    chosenFidelity = committedFidelity;
    pendingFidelity = undefined;
  });

  function stateLabel(stop: FidelityStopView) {
    if (stop.state === 'current') return 'Current';
    if (stop.state === 'saved') return 'Saved';
    if (stop.state === 'generate') return 'Not generated';
    if (stop.state === 'candidate') return 'Candidate';
    if (stop.state === 'versions')
      return `${stop.versionCount ?? 2} version${(stop.versionCount ?? 2) === 1 ? '' : 's'}`;
    return 'Unavailable';
  }

  function selectStop(index: number) {
    const stop = supportedStops[index];
    if (!stop) return;

    chosenFidelity = stop.fidelity as SupportedFidelity;
    pendingFidelity = undefined;

    if (stop.disabledReason || stop.state === 'unavailable' || stop.state === 'current') return;
    if (stop.state === 'saved' || stop.state === 'versions') {
      if (shouldNavigateSavedFidelity(stop, committedFidelity) && stop.representationId)
        onNavigate(stop.fidelity, stop.representationId);
      return;
    }
    if (stop.state === 'candidate') {
      onInspectCandidate(stop.fidelity);
      return;
    }
    if (stop.state === 'generate') pendingFidelity = stop.fidelity as SupportedFidelity;
  }

  function confirmGeneration() {
    if (!pendingFidelity) return;
    const fidelity = pendingFidelity;
    pendingFidelity = undefined;
    onStageGeneration(fidelity);
  }
</script>

<nav class="fidelity" aria-label={label}>
  <strong class="fidelity-label">{label}</strong>
  <div class="slider-control">
    <input
      type="range"
      min="0"
      max="1"
      step="1"
      value={supportedFidelities.indexOf(chosenFidelity)}
      aria-label={`${label}: ${fidelityLabel[chosenFidelity]}`}
      aria-valuetext={`${fidelityLabel[chosenFidelity]} · ${stateLabel(selectedStop)}`}
      oninput={(event) => selectStop(Number(event.currentTarget.value))}
    />
    <div class="slider-labels" aria-hidden="true">
      {#each supportedStops as stop (stop.fidelity)}
        <span class:active={stop.fidelity === chosenFidelity}>
          <strong>{fidelityLabel[stop.fidelity as SupportedFidelity]}</strong>
          <small>{stateLabel(stop)}</small>
        </span>
      {/each}
    </div>
  </div>

  <div class="selection-summary" aria-live="polite">
    <span>
      <strong>{fidelityLabel[chosenFidelity]}</strong>
      <small>{stateLabel(selectedStop)}</small>
    </span>
    {#if pendingFidelity}
      <button type="button" onclick={confirmGeneration}>
        Generate {fidelityLabel[pendingFidelity]}
      </button>
    {/if}
  </div>

  {#if pendingFidelity}
    <p class="confirmation-note">
      Confirm to create a {fidelityLabel[pendingFidelity].toLowerCase()} candidate. Moving the slider
      alone never starts generation.
    </p>
  {:else if selectedStop?.inheritedFrom}
    <p>Inherited from {selectedStop.inheritedFrom}</p>
  {:else if selectedStop?.disabledReason}
    <p class="disabled-reason">{selectedStop.disabledReason}</p>
  {:else if selectedStop?.state === 'saved' && !selectedStop.representationId}
    <p class="disabled-reason">Saved representation is unavailable.</p>
  {/if}
</nav>

<style>
  .fidelity {
    display: grid;
    gap: 10px;
  }

  .fidelity-label {
    color: #4b5563;
    font-size: 12px;
  }

  .slider-control {
    display: grid;
    gap: 5px;
    padding: 0 4px;
  }

  input[type='range'] {
    width: 100%;
    margin: 0;
    accent-color: #246da5;
    cursor: pointer;
  }

  input[type='range']:focus-visible {
    outline: 2px solid #246da5;
    outline-offset: 3px;
    border-radius: 999px;
  }

  .slider-labels {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  .slider-labels > span {
    min-width: 0;
    display: grid;
    gap: 1px;
    color: #68727e;
  }

  .slider-labels > span:last-child {
    text-align: right;
  }

  .slider-labels > span.active {
    color: #174f7b;
  }

  .slider-labels strong {
    font-size: 10px;
  }

  small,
  p {
    color: #68727e;
    font-size: 9px;
    line-height: 1.3;
  }

  .selection-summary {
    min-height: 34px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 7px 8px;
    border: 1px solid #d5dbe2;
    border-radius: 5px;
    background: #f4f7f9;
  }

  .selection-summary > span {
    min-width: 0;
    display: grid;
  }

  .selection-summary button {
    min-height: 28px;
    border: 1px solid #175a8e;
    border-radius: 4px;
    background: #246da5;
    padding: 0 10px;
    color: white;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
  }

  .selection-summary button:hover {
    background: #175a8e;
  }

  .selection-summary button:focus-visible {
    outline: 2px solid #246da5;
    outline-offset: 2px;
  }

  p {
    margin: 0;
  }

  .confirmation-note {
    color: #6b4c16;
  }

  .disabled-reason {
    color: #8a4650;
  }
</style>
