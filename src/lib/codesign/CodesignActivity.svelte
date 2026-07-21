<script lang="ts">
  import type { CodesignTelemetryEvent } from '$lib/agent/telemetry';

  export let events: CodesignTelemetryEvent[] = [];

  const phaseLabels = {
    preparing: 'Preparing',
    'prompt-sent': 'Prompt running',
    inspecting: 'Inspecting scene',
    rendering: 'Rendering canvas',
    components: 'Finding components',
    applying: 'Applying changes',
    streaming: 'Receiving proposal',
    validating: 'Validating',
    submitting: 'Submitting',
    completed: 'Complete',
    failed: 'Failed',
    cancelled: 'Cancelled',
  } as const;

  $: latest = events.at(-1);
  $: details = events.reduce<Partial<CodesignTelemetryEvent>>(
    (known, event) => ({ ...known, ...event }),
    {},
  );
  $: usage = latest?.usage ?? [...events].reverse().find((event) => event.usage)?.usage;
  $: statusLabel = latest ? phaseLabels[latest.phase] : 'Idle';
  $: visibleEvents = events.slice(-8);
  $: latestFailure = [...events].reverse().find((event) => event.failure)?.failure;

  function formatNumber(value: number | undefined) {
    return value === undefined ? '—' : new Intl.NumberFormat().format(value);
  }

  function formatDuration(value: number | undefined) {
    if (value === undefined) return '—';
    return value < 1_000 ? `${value} ms` : `${(value / 1_000).toFixed(1)} s`;
  }
</script>

<section class="activity-panel" aria-label="Codesign activity">
  <div class="summary-column">
    <header>
      <div>
        <strong>Codesign activity</strong>
        <p>Live backend interaction for the current or most recent run.</p>
      </div>
      <span
        class="state"
        class:running={latest && !['completed', 'failed', 'cancelled'].includes(latest.phase)}
        >{statusLabel}</span
      >
    </header>

    <dl class="run-summary">
      <div>
        <dt>Model</dt>
        <dd>{details.model ?? '—'}</dd>
      </div>
      <div>
        <dt>Effort</dt>
        <dd>{details.effort ?? '—'}</dd>
      </div>
      <div>
        <dt>Duration</dt>
        <dd>{formatDuration(latest?.durationMs)}</dd>
      </div>
      <div>
        <dt>Prompt version</dt>
        <dd>{details.promptVersion ?? '—'}</dd>
      </div>
      <div>
        <dt>Request ID</dt>
        <dd title={latest?.requestId}>{latest?.requestId ?? '—'}</dd>
      </div>
    </dl>
    {#if latestFailure}<div class="failure-detail">
        <strong>Failure detail</strong>
        <span>{latestFailure.stage} · {latestFailure.category}</span>
        <p>{latestFailure.message}</p>
        {#if latestFailure.code}<code>{latestFailure.code}</code>{/if}
      </div>{/if}
  </div>

  <div class="metrics-column">
    <h3>Token usage</h3>
    <dl class="usage-grid">
      <div>
        <dt>Total</dt>
        <dd>{formatNumber(usage?.totalTokens)}</dd>
      </div>
      <div>
        <dt>Input</dt>
        <dd>{formatNumber(usage?.inputTokens)}</dd>
      </div>
      <div>
        <dt>Cached input</dt>
        <dd>{formatNumber(usage?.cachedInputTokens)}</dd>
      </div>
      <div>
        <dt>Output</dt>
        <dd>{formatNumber(usage?.outputTokens)}</dd>
      </div>
      <div>
        <dt>Reasoning</dt>
        <dd>{formatNumber(usage?.reasoningOutputTokens)}</dd>
      </div>
      <div>
        <dt>Context window</dt>
        <dd>{formatNumber(usage?.modelContextWindow ?? undefined)}</dd>
      </div>
    </dl>
    <p>Usage appears when Codex reports it; Codesign does not estimate token counts.</p>
    <div class="request-line">
      <span>Prompt <strong>{formatNumber(details.promptCharacters)} chars</strong></span>
      <span>Scene <strong>{formatNumber(details.contextNodeCount)} layers</strong></span>
      <span>Output <strong>{formatNumber(details.outputCharacters)} chars</strong></span>
    </div>
  </div>

  <div class="timeline-column">
    <h3>Backend timeline</h3>
    {#if visibleEvents.length}
      <ol>
        {#each visibleEvents as event (`${event.requestId}-${event.sequence}`)}
          <li class:current={event === latest}>
            <span>{phaseLabels[event.phase]}</span>
            <p>{event.message}</p>
            {#if event.failure}<small class="failure-message"
                >{event.failure.stage}: {event.failure.message}</small
              >{/if}
            {#if event.usage}<small>{formatNumber(event.usage.totalTokens)} tokens</small>{/if}
          </li>
        {/each}
      </ol>
    {:else}
      <p class="empty">Run a Codesign prompt to see its backend activity here.</p>
    {/if}
  </div>
</section>

<style>
  .activity-panel {
    box-sizing: border-box;
    min-width: 620px;
    min-height: 100%;
    display: grid;
    grid-template-columns: minmax(160px, 0.8fr) minmax(215px, 1.1fr) minmax(235px, 1.25fr);
    background: #fff;
    color: #252a31;
  }
  .summary-column,
  .metrics-column,
  .timeline-column {
    min-width: 0;
    box-sizing: border-box;
    padding: 12px;
    border-right: 1px solid #dfe3e7;
  }
  .timeline-column {
    border-right: 0;
  }
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 11px;
    border-bottom: 1px solid #e1e4e8;
  }
  header p,
  .metrics-column > p,
  .empty {
    margin: 3px 0 0;
    color: #707986;
    font-size: 11px;
  }
  .state {
    flex: 0 0 auto;
    padding: 3px 7px;
    border-radius: 999px;
    background: #e9edf1;
    color: #56616d;
    font-size: 10px;
    font-weight: 700;
  }
  .state.running {
    background: #dbeaf7;
    color: #245f90;
  }
  h3 {
    margin: 0 0 9px;
    font-size: 11px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  dl {
    margin: 0;
  }
  dl div {
    display: flex;
    justify-content: space-between;
    gap: 10px;
  }
  dt {
    color: #737c87;
  }
  dd {
    overflow: hidden;
    margin: 0;
    font-variant-numeric: tabular-nums;
    font-weight: 650;
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .run-summary {
    display: grid;
    gap: 7px;
    padding-top: 11px;
  }
  .failure-detail {
    display: grid;
    gap: 4px;
    margin-top: 11px;
    border: 1px solid #e1b7b2;
    border-radius: 4px;
    background: #fff4f2;
    padding: 8px;
  }
  .failure-detail strong {
    color: #773b35;
    font-size: 10px;
    text-transform: uppercase;
  }
  .failure-detail span,
  .failure-detail code {
    color: #8b4c45;
    font-size: 10px;
  }
  .failure-detail p {
    margin: 0;
    color: #663c38;
    font-size: 11px;
    overflow-wrap: anywhere;
  }
  .usage-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 7px 12px;
  }
  .request-line {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    margin-top: 11px;
    padding-top: 9px;
    border-top: 1px solid #e5e8eb;
    color: #737c87;
    font-size: 11px;
  }
  .request-line strong {
    margin-left: 3px;
    color: #343b43;
  }
  ol {
    display: grid;
    gap: 7px;
    max-height: 162px;
    margin: 0;
    padding: 0;
    overflow: auto;
    list-style: none;
  }
  li {
    display: grid;
    grid-template-columns: 90px minmax(0, 1fr);
    gap: 8px;
    align-items: baseline;
    padding-left: 9px;
    border-left: 2px solid #d3d9df;
  }
  li.current {
    border-color: #3977aa;
  }
  li span {
    font-weight: 650;
  }
  li p {
    margin: 0;
    color: #5f6873;
    font-size: 11px;
  }
  li small {
    grid-column: 2;
    color: #78818b;
    white-space: nowrap;
  }
  li .failure-message {
    color: #8c403a;
    white-space: normal;
    overflow-wrap: anywhere;
  }
</style>
