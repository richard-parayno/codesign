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
  import { fidelityStageAction, type CodesignStage } from './fidelity-navigation';

  type SupportedFidelity = Extract<Fidelity, 'wireframe' | 'component'>;
  type SliderStop = Omit<FidelityStopView, 'fidelity'> & { fidelity: CodesignStage };

  type Props = {
    label?: string;
    stops: FidelityStopView[];
    resetKey?: string;
    activeStage?: CodesignStage;
    canGenerate?: boolean;
    generationDisabledReason?: string;
    onStageGeneration: (fidelity: Fidelity) => void;
    onInspectCandidate: (fidelity: Fidelity) => void;
  };

  let {
    label = 'Fidelity',
    stops,
    resetKey,
    activeStage = 'base',
    canGenerate = true,
    generationDisabledReason = 'Codesign needs an editable selection inside a group or frame.',
    onStageGeneration,
    onInspectCandidate,
  }: Props = $props();

  const supportedStages: CodesignStage[] = ['base', 'wireframe', 'component'];
  const fidelityLabel: Record<CodesignStage, string> = {
    base: 'Base',
    wireframe: 'AI Draft',
    component: 'AI Hi-Fi',
  };

  let generatedStops: SliderStop[] = $derived(
    (['wireframe', 'component'] as SupportedFidelity[]).map((fidelity) => {
      const stop = stops.find((item) => item.fidelity === fidelity);
      return stop
        ? { ...stop, fidelity }
        : {
            fidelity,
            state: 'unavailable' as const,
            disabledReason: `${fidelityLabel[fidelity]} is unavailable for this selection.`,
          };
    }),
  );
  let supportedStops: SliderStop[] = $derived([
    {
      fidelity: 'base' as const,
      state: 'current' as const,
    },
    ...generatedStops,
  ]);
  let chosenStage = $state<CodesignStage>('base');
  let pendingFidelity = $state<SupportedFidelity>();
  let selectedStop = $derived(
    supportedStops.find((stop) => stop.fidelity === chosenStage) ?? supportedStops[0],
  );

  $effect(() => {
    void resetKey;
    chosenStage = activeStage;
    pendingFidelity = undefined;
  });

  function stateLabel(stop: SliderStop) {
    if (stop.fidelity === 'base') return 'Original canvas';
    if (stop.state === 'current') return 'Current applied';
    if (stop.state === 'saved') return 'Previously applied';
    if (stop.state === 'generate') return 'Available';
    if (stop.state === 'candidate') return 'Review candidate';
    if (stop.state === 'versions') return 'Previous versions';
    return 'Unavailable';
  }

  function selectStop(index: number) {
    const stop = supportedStops[index];
    if (!stop) return;

    chosenStage = stop.fidelity;
    pendingFidelity = undefined;

    const action = fidelityStageAction(stop.fidelity, stop.state);
    if (action === 'stay-live' || stop.disabledReason) return;
    if (action === 'inspect-candidate' && stop.fidelity !== 'base') {
      onInspectCandidate(stop.fidelity);
      return;
    }
    if (!canGenerate) return;
    if (stop.fidelity !== 'base') pendingFidelity = stop.fidelity;
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
      step="1"
      max="2"
      value={supportedStages.indexOf(chosenStage)}
      aria-label={`${label}: ${fidelityLabel[chosenStage]}`}
      aria-valuetext={`${fidelityLabel[chosenStage]} · ${stateLabel(selectedStop)}`}
      oninput={(event) => selectStop(Number(event.currentTarget.value))}
    />
    <div class="slider-labels" aria-hidden="true">
      {#each supportedStops as stop (stop.fidelity)}
        <span class:active={stop.fidelity === chosenStage}>
          <strong>{fidelityLabel[stop.fidelity]}</strong>
          <small>{stateLabel(stop)}</small>
        </span>
      {/each}
    </div>
  </div>

  <div class="selection-summary" aria-live="polite">
    <span>
      <strong>{fidelityLabel[chosenStage]}</strong>
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
      Confirm to create a fresh {fidelityLabel[pendingFidelity]} candidate from the live canvas. Moving
      the slider alone never starts generation or restores history.
    </p>
  {:else if chosenStage === 'base'}
    <p>
      Base is the original editable canvas. Codesign generation is only available in AI Draft and AI
      Hi-Fi.
    </p>
  {:else if !canGenerate && selectedStop?.state !== 'candidate'}
    <p class="disabled-reason">{generationDisabledReason}</p>
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
    grid-template-columns: 1fr 1fr 1fr;
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

  .slider-labels > span:nth-child(2) {
    text-align: center;
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
