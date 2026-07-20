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
  type Props = {
    label?: string;
    stops: FidelityStopView[];
    onNavigate: (fidelity: Fidelity, representationId: string) => void;
    onStageGeneration: (fidelity: Fidelity) => void;
    onInspectCandidate: (fidelity: Fidelity) => void;
  };

  let {
    label = 'Fidelity',
    stops,
    onNavigate,
    onStageGeneration,
    onInspectCandidate,
  }: Props = $props();

  const fidelityLabel: Record<Fidelity, string> = {
    structure: 'Structure',
    wireframe: 'Wireframe',
    component: 'Component',
    visual: 'Visual',
    production: 'Production',
  };

  function stateLabel(stop: FidelityStopView) {
    if (stop.state === 'current') return 'Current';
    if (stop.state === 'saved') return 'Saved';
    if (stop.state === 'generate') return 'Generate';
    if (stop.state === 'candidate') return 'Candidate';
    if (stop.state === 'versions')
      return `${stop.versionCount ?? 2} version${(stop.versionCount ?? 2) === 1 ? '' : 's'}`;
    return 'Unavailable';
  }

  function activate(stop: FidelityStopView) {
    if (stop.disabledReason || stop.state === 'unavailable' || stop.state === 'current') return;
    if (stop.state === 'saved' || stop.state === 'versions') {
      if (stop.representationId) onNavigate(stop.fidelity, stop.representationId);
      return;
    }
    if (stop.state === 'generate') {
      onStageGeneration(stop.fidelity);
      return;
    }
    onInspectCandidate(stop.fidelity);
  }

  function canActivate(stop: FidelityStopView) {
    if (stop.disabledReason || stop.state === 'unavailable' || stop.state === 'current')
      return false;
    return !['saved', 'versions'].includes(stop.state) || Boolean(stop.representationId);
  }
</script>

<nav class="fidelity" aria-label={label}>
  <strong class="fidelity-label">{label}</strong>
  <ol>
    {#each stops as stop (stop.fidelity)}
      <li class:active={stop.state === 'current'} class={`state-${stop.state}`}>
        {#if canActivate(stop)}
          <button
            type="button"
            aria-label={`${fidelityLabel[stop.fidelity]} · ${stateLabel(stop)}`}
            onclick={() => activate(stop)}
          >
            <span class="marker" aria-hidden="true"></span>
            <span class="stop-name">{fidelityLabel[stop.fidelity]}</span>
            <span class="stop-state">{stateLabel(stop)}</span>
          </button>
        {:else}
          <div
            class="stop-static"
            aria-current={stop.state === 'current' ? 'step' : undefined}
            aria-disabled={stop.state === 'unavailable' || stop.disabledReason ? 'true' : undefined}
          >
            <span class="marker" aria-hidden="true"></span>
            <span class="stop-name">{fidelityLabel[stop.fidelity]}</span>
            <span class="stop-state">{stateLabel(stop)}</span>
          </div>
        {/if}
        {#if stop.inheritedFrom}
          <small>Inherited from {stop.inheritedFrom}</small>
        {/if}
        {#if stop.disabledReason}
          <small class="disabled-reason">{stop.disabledReason}</small>
        {:else if stop.state === 'saved' && !stop.representationId}
          <small class="disabled-reason">Saved representation is unavailable.</small>
        {/if}
      </li>
    {/each}
  </ol>
</nav>

<style>
  .fidelity {
    display: grid;
    gap: 8px;
  }

  .fidelity-label {
    color: #4b5563;
    font-size: 12px;
  }

  ol {
    display: grid;
    grid-template-columns: repeat(5, minmax(52px, 1fr));
    gap: 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    position: relative;
    min-width: 0;
  }

  li:not(:last-child)::after {
    position: absolute;
    z-index: 0;
    top: 16px;
    left: calc(50% + 8px);
    width: calc(100% - 16px);
    border-top: 1px solid #b9c1ca;
    content: '';
  }

  button,
  .stop-static {
    position: relative;
    z-index: 1;
    width: 100%;
    min-height: 58px;
    display: grid;
    justify-items: center;
    align-content: start;
    gap: 2px;
    border: 0;
    background: transparent;
    padding: 4px 3px;
    color: #303944;
    text-align: center;
  }

  button {
    border-radius: 5px;
    cursor: pointer;
  }

  button:hover,
  button:focus-visible {
    background: #e9eef3;
  }

  button:focus-visible {
    outline: 2px solid #246da5;
    outline-offset: 1px;
  }

  .marker {
    width: 17px;
    height: 17px;
    display: block;
    border: 2px solid #707a86;
    border-radius: 50%;
    background: #f9fafb;
  }

  .state-current .marker,
  .state-saved .marker {
    background: #3b6f97;
    border-color: #3b6f97;
    box-shadow: inset 0 0 0 3px #f9fafb;
  }

  .state-current .marker {
    background: #174f7b;
  }

  .state-generate .marker {
    border-style: dashed;
  }

  .state-candidate .marker {
    border-color: #8a5a12;
    background: #fff7df;
    box-shadow: inset 0 0 0 3px #d89124;
  }

  .state-versions .marker {
    border-style: double;
    border-width: 4px;
    border-color: #6c4f91;
  }

  .state-unavailable {
    opacity: 0.58;
  }

  .stop-name {
    overflow: hidden;
    max-width: 100%;
    font-size: 10px;
    font-weight: 650;
    text-overflow: ellipsis;
  }

  .stop-state {
    color: #68727e;
    font-size: 9px;
    white-space: nowrap;
  }

  small {
    display: block;
    padding: 0 4px 5px;
    color: #68727e;
    font-size: 9px;
    line-height: 1.3;
    text-align: center;
  }

  .disabled-reason {
    color: #875a23;
  }

  @media (max-width: 760px) {
    ol {
      grid-template-columns: 1fr;
      gap: 4px;
    }

    li:not(:last-child)::after {
      display: none;
    }

    button,
    .stop-static {
      min-height: 40px;
      grid-template-columns: 20px 1fr auto;
      justify-items: start;
      align-items: center;
      align-content: center;
      text-align: left;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    * {
      scroll-behavior: auto !important;
    }
  }
</style>
