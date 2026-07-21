<script lang="ts" module>
  import type { ProcessEvent } from '$lib/model/types';

  export type ProcessEventView = {
    event: ProcessEvent;
    title: string;
    summary: string;
    canViewCandidate?: boolean;
    canCompareSource?: boolean;
    canReplay?: boolean;
    replayDisabledReason?: string;
  };
</script>

<script lang="ts">
  type Props = {
    events: ProcessEventView[];
    activeEventId?: string;
    onInspectEvent: (eventId: string) => void;
    onViewCandidate: (candidateId: string) => void;
    onCompareSource: (candidateId: string) => void;
    onReplay: (candidateId: string) => void;
  };

  let { events, activeEventId, onInspectEvent, onViewCandidate, onCompareSource, onReplay }: Props =
    $props();

  const eventLabels: Record<ProcessEventView['event']['type'], string> = {
    'legacy-imported': 'Legacy project imported',
    'manual-operation': 'Manual change',
    'checkpoint-created': 'Source checkpoint',
    'generation-requested': 'Generation requested',
    'generation-failed': 'Generation failed',
    'generation-cancelled': 'Generation cancelled',
    'candidates-generated': 'Candidates generated',
    'candidate-viewed': 'Candidate viewed',
    'candidate-rejected': 'Candidate rejected',
    'reroll-requested': 'Candidate rerolled',
    'pin-changed': 'Pin changed',
    'atomic-decision': 'Atomic decision',
    'candidate-accepted': 'Candidate accepted',
    'source-compared': 'Compared with source',
    'revision-activated': 'Representation opened',
    replayed: 'Recorded changes replayed',
    reverted: 'Revision reverted',
  };

  function detailEntries(event: ProcessEventView['event']) {
    return Object.entries(event.details ?? {});
  }

  function detailValue(value: string | number | boolean | null | string[]) {
    if (Array.isArray(value)) return value.join(', ');
    if (value === null) return 'None';
    return String(value);
  }
</script>

<section class="process-panel" aria-labelledby="process-history-title">
  <header>
    <div>
      <span>Design decisions and revisions</span>
      <h2 id="process-history-title">Process history</h2>
    </div>
    <strong>{events.length} {events.length === 1 ? 'event' : 'events'}</strong>
  </header>

  {#if events.length}
    <ol>
      {#each [...events].reverse() as item (item.event.id)}
        <li class:active={activeEventId === item.event.id}>
          <div class="event-marker" aria-hidden="true"></div>
          <article>
            <div class="event-heading">
              <div>
                <span class="event-type">{eventLabels[item.event.type]}</span>
                <h3>{item.title}</h3>
              </div>
              <time datetime={new Date(item.event.timestamp).toISOString()}>
                {new Date(item.event.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
            </div>
            <p>{item.summary}</p>
            <div class="event-meta">
              <span>By {item.event.actor === 'agent' ? 'Codesign' : item.event.actor}</span>
              {#if item.event.revisionId}<span>Revision {item.event.revisionId.slice(-8)}</span
                >{/if}
            </div>

            {#if detailEntries(item.event).length}
              <details>
                <summary>Event details</summary>
                <dl>
                  {#each detailEntries(item.event) as [key, value]}
                    <dt>{key.replaceAll('-', ' ')}</dt>
                    <dd>{detailValue(value)}</dd>
                  {/each}
                </dl>
              </details>
            {/if}

            <div class="event-actions">
              <button type="button" onclick={() => onInspectEvent(item.event.id)}>
                Inspect event
              </button>
              {#if item.canViewCandidate && item.event.candidateId}
                <button type="button" onclick={() => onViewCandidate(item.event.candidateId!)}>
                  View candidate
                </button>
              {/if}
              {#if item.canCompareSource && item.event.candidateId}
                <button type="button" onclick={() => onCompareSource(item.event.candidateId!)}>
                  Compare with source
                </button>
              {/if}
              {#if item.canReplay && item.event.candidateId}
                <button
                  type="button"
                  disabled={Boolean(item.replayDisabledReason)}
                  aria-describedby={item.replayDisabledReason
                    ? `replay-reason-${item.event.id}`
                    : undefined}
                  onclick={() => onReplay(item.event.candidateId!)}>Reapply recorded changes</button
                >
              {/if}
            </div>
            {#if item.replayDisabledReason}
              <p class="disabled-reason" id={`replay-reason-${item.event.id}`}>
                {item.replayDisabledReason}
              </p>
            {/if}
          </article>
        </li>
      {/each}
    </ol>
  {:else}
    <div class="empty-state">
      <strong>No process history yet</strong>
      <p>
        Manual edits, generated candidates, rerolls, rejections, and accepted changes appear here.
      </p>
    </div>
  {/if}
</section>

<style>
  .process-panel {
    display: grid;
    gap: 12px;
    color: #252e38;
    font-size: 12px;
  }

  header,
  .event-heading,
  .event-meta,
  .event-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 9px;
  }

  header span {
    color: #6c7681;
    font-size: 10px;
  }

  h2,
  h3,
  p {
    margin: 0;
  }

  h2 {
    margin-top: 2px;
    font-size: 17px;
  }

  h3 {
    font-size: 13px;
  }

  ol {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    position: relative;
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr);
    gap: 8px;
    padding-bottom: 10px;
  }

  li:not(:last-child)::before {
    position: absolute;
    top: 15px;
    bottom: -2px;
    left: 6px;
    border-left: 1px solid #bfc8d1;
    content: '';
  }

  .event-marker {
    z-index: 1;
    width: 13px;
    height: 13px;
    margin-top: 12px;
    border: 2px solid #637486;
    border-radius: 50%;
    background: #f8fafb;
  }

  li.active .event-marker {
    border-color: #246da5;
    background: #246da5;
    box-shadow: inset 0 0 0 2px #f8fafb;
  }

  article {
    min-width: 0;
    display: grid;
    gap: 8px;
    border: 1px solid #cdd4dc;
    border-radius: 5px;
    padding: 10px;
    background: #fafbfc;
  }

  li.active article {
    border-color: #6c94b4;
    box-shadow: 0 0 0 2px #246da51a;
  }

  .event-heading {
    align-items: flex-start;
  }

  .event-heading > div {
    min-width: 0;
    display: grid;
    gap: 2px;
  }

  .event-type {
    color: #536b80;
    font-size: 9px;
    font-weight: 750;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  time,
  .event-meta {
    color: #747e89;
    font-size: 10px;
  }

  article > p {
    color: #56616c;
    line-height: 1.45;
  }

  .event-meta {
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .event-meta span + span::before {
    margin-right: 9px;
    content: '·';
  }

  details {
    border-top: 1px solid #dce1e6;
    padding-top: 7px;
  }

  summary {
    width: fit-content;
    border-radius: 3px;
    color: #3c607d;
    cursor: pointer;
  }

  dl {
    display: grid;
    grid-template-columns: minmax(100px, auto) minmax(0, 1fr);
    gap: 6px 10px;
    margin: 8px 0 0;
    padding: 8px;
    background: #f0f3f5;
  }

  dt {
    color: #66717d;
    text-transform: capitalize;
  }

  dd {
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
  }

  .event-actions {
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  button {
    min-height: 36px;
    border: 1px solid #abb7c3;
    border-radius: 5px;
    background: white;
    padding: 6px 9px;
    color: #344250;
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    border-color: #70869a;
    background: #edf3f7;
  }

  button:focus-visible,
  summary:focus-visible {
    outline: 2px solid #246da5;
    outline-offset: 2px;
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.52;
  }

  .disabled-reason {
    color: #87531f;
    font-size: 10px;
  }

  .empty-state {
    display: grid;
    gap: 4px;
    min-height: 90px;
    align-content: center;
    border: 1px dashed #bbc5ce;
    border-radius: 5px;
    padding: 14px;
    background: #f8fafb;
  }

  .empty-state p {
    color: #65707c;
    line-height: 1.45;
  }

  @media (max-width: 600px) {
    .event-heading {
      flex-direction: column;
    }

    dl {
      grid-template-columns: 1fr;
    }
  }
</style>
