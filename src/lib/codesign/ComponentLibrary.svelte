<script lang="ts">
  import type { CodesignComponentDefinition } from '$lib/design-system/manifest';

  type Props = {
    components: readonly CodesignComponentDefinition[];
    onInsert: (componentId: string) => void;
  };

  let { components, onInsert }: Props = $props();
  let query = $state('');
  let normalizedQuery = $derived(query.trim().toLocaleLowerCase());
  let filtered = $derived(
    components.filter((component) =>
      `${component.displayName} ${component.category} ${component.description}`
        .toLocaleLowerCase()
        .includes(normalizedQuery),
    ),
  );
  let categories = $derived([...new Set(filtered.map((component) => component.category))].sort());
</script>

<section class="component-library" aria-labelledby="component-library-title">
  <header>
    <div>
      <span>Assets</span>
      <h2 id="component-library-title">Components</h2>
    </div>
    <small>{filtered.length}/{components.length}</small>
  </header>
  <label>
    <span>Search components</span>
    <input bind:value={query} type="search" placeholder="Button, dialog, table…" />
  </label>
  <div class="component-groups">
    {#each categories as category (category)}
      <details open={Boolean(normalizedQuery)}>
        <summary>{category.replace('-', ' ')}</summary>
        <div class="component-list">
          {#each filtered.filter((component) => component.category === category) as component (component.id)}
            <button
              type="button"
              title={component.description}
              onclick={() => onInsert(component.id)}
            >
              <span
                ><strong>{component.displayName}</strong><small>{component.description}</small
                ></span
              >
              <span class="insert-label">Insert</span>
            </button>
          {/each}
        </div>
      </details>
    {/each}
    {#if !filtered.length}
      <p>No components match “{query}”.</p>
    {/if}
  </div>
</section>

<style>
  .component-library {
    max-height: 260px;
    min-height: 0;
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    gap: 8px;
    border-top: 1px solid #cbd1d8;
    padding: 12px 8px;
    color: #2c3641;
    font-size: 11px;
  }
  header,
  header > div,
  label {
    display: flex;
  }
  header {
    align-items: end;
    justify-content: space-between;
    gap: 8px;
  }
  header > div {
    align-items: baseline;
    gap: 7px;
  }
  header span,
  summary {
    color: #687480;
    font-size: 9px;
    font-weight: 750;
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }
  h2 {
    margin: 0;
    font-size: 12px;
  }
  header small {
    color: #77818c;
  }
  label {
    flex-direction: column;
    gap: 4px;
  }
  label span {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  input {
    width: 100%;
    height: 30px;
    border: 1px solid #aeb7c1;
    border-radius: 5px;
    background: white;
    padding: 0 8px;
    color: inherit;
    font: inherit;
  }
  .component-groups {
    min-height: 0;
    overflow: auto;
  }
  details + details {
    border-top: 1px solid #e0e4e8;
  }
  summary {
    padding: 8px 2px;
    cursor: pointer;
  }
  .component-list {
    display: grid;
    gap: 3px;
    padding-bottom: 7px;
  }
  button {
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    padding: 6px;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  button:hover,
  button:focus-visible {
    border-color: #9eb5c8;
    background: #edf4f9;
  }
  button > span:first-child {
    min-width: 0;
    display: grid;
    gap: 2px;
  }
  button strong,
  button small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  button small {
    color: #6f7984;
    font-size: 9px;
  }
  .insert-label {
    flex: none;
    color: #31648e;
    font-size: 9px;
    font-weight: 700;
  }
  p {
    color: #6c7680;
    line-height: 1.4;
  }
</style>
