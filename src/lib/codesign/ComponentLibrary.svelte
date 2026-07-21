<script lang="ts">
  import type { CodesignComponentDefinition } from '$lib/design-system/manifest';
  import ComponentLibraryPreview from './ComponentLibraryPreview.svelte';
  import { COMPONENT_DRAG_MIME } from './component-drag';

  type Props = {
    components: readonly CodesignComponentDefinition[];
    onInsert: (componentId: string) => void;
  };

  let { components, onInsert }: Props = $props();
  let open = $state(false);
  let view = $state<'list' | 'visual'>('list');
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

  function beginComponentDrag(event: DragEvent, component: CodesignComponentDefinition) {
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(COMPONENT_DRAG_MIME, component.id);
    event.dataTransfer.setData('text/plain', component.id);
  }
</script>

<section class="component-launcher" aria-labelledby="component-library-title">
  <div>
    <span>Assets</span>
    <h2 id="component-library-title">Component library</h2>
    <small>{components.length} components</small>
  </div>
  <button type="button" onclick={() => (open = true)}>Browse components</button>
</section>

{#if open}
  <aside class="component-drawer" aria-label="Component library drawer">
    <header>
      <div>
        <span>Assets</span>
        <h2>Component library</h2>
      </div>
      <button type="button" onclick={() => (open = false)}>Close</button>
    </header>

    <div class="view-switch" aria-label="Component library view">
      <button class:active={view === 'list'} type="button" onclick={() => (view = 'list')}
        >List</button
      >
      <button class:active={view === 'visual'} type="button" onclick={() => (view = 'visual')}
        >Visual</button
      >
    </div>

    <label class="search-field">
      <span>Search components</span>
      <input bind:value={query} type="search" placeholder="Button, dialog, table…" />
    </label>

    <p class="drag-help">Drag a component onto the canvas, or use Insert.</p>

    <div class="component-groups">
      {#each categories as category (category)}
        <section class="category-group">
          <h3>{category.replace('-', ' ')}</h3>
          {#if view === 'list'}
            <div class="component-list">
              {#each filtered.filter((component) => component.category === category) as component (component.id)}
                <div
                  class="component-row"
                  role="group"
                  aria-label={`${component.displayName} component`}
                  draggable="true"
                  title={`Drag ${component.displayName} to the canvas`}
                  ondragstart={(event) => beginComponentDrag(event, component)}
                >
                  <span class="component-copy"
                    ><strong>{component.displayName}</strong><small>{component.description}</small
                    ></span
                  >
                  <button type="button" onclick={() => onInsert(component.id)}>Insert</button>
                </div>
              {/each}
            </div>
          {:else}
            <div class="component-grid">
              {#each filtered.filter((component) => component.category === category) as component (component.id)}
                <article
                  draggable="true"
                  title={`Drag ${component.displayName} to the canvas`}
                  ondragstart={(event) => beginComponentDrag(event, component)}
                >
                  <ComponentLibraryPreview {component} />
                  <div class="card-copy">
                    <strong>{component.displayName}</strong>
                    <button type="button" onclick={() => onInsert(component.id)}>Insert</button>
                  </div>
                </article>
              {/each}
            </div>
          {/if}
        </section>
      {/each}
      {#if !filtered.length}
        <p class="empty-state">No components match “{query}”.</p>
      {/if}
    </div>
  </aside>
{/if}

<style>
  .component-launcher {
    display: grid;
    gap: 8px;
    border-bottom: 1px solid #d6dae0;
    padding: 11px 8px;
    color: #2c3641;
  }
  .component-launcher > div {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: baseline;
    gap: 3px 7px;
  }
  .component-launcher span,
  header span,
  h3 {
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
  .component-launcher small {
    grid-column: 2;
    color: #77818c;
    font-size: 10px;
  }
  .component-launcher button,
  header button,
  .view-switch button,
  .component-row button,
  .card-copy button {
    min-height: 29px;
    border: 1px solid #b9c2cb;
    border-radius: 4px;
    background: white;
    padding: 0 8px;
    color: #35414c;
    font: inherit;
    cursor: pointer;
  }
  .component-launcher button {
    width: 100%;
  }
  .component-launcher button:hover,
  header button:hover,
  .component-row button:hover,
  .card-copy button:hover {
    border-color: #8fa7ba;
    background: #edf4f9;
  }
  .component-drawer {
    position: fixed;
    z-index: 18;
    top: 48px;
    bottom: 0;
    left: 232px;
    width: min(390px, calc(100vw - 232px));
    display: grid;
    grid-template-rows: auto auto auto auto minmax(0, 1fr);
    gap: 12px;
    border-right: 1px solid #bfc7d0;
    background: #f8f9fb;
    padding: 14px;
    color: #2c3641;
    box-shadow: 10px 0 28px #1f293726;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  header > div {
    display: grid;
    gap: 3px;
  }
  .view-switch {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 3px;
    border: 1px solid #c7ced6;
    border-radius: 5px;
    background: #e9edf1;
    padding: 3px;
  }
  .view-switch button {
    border-color: transparent;
    background: transparent;
  }
  .view-switch button.active {
    border-color: #c3cad2;
    background: #fff;
    color: #1e5e91;
    box-shadow: 0 1px 2px #1f293714;
  }
  .search-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .search-field span {
    color: #56616d;
    font-size: 10px;
    font-weight: 700;
  }
  input {
    width: 100%;
    height: 34px;
    border: 1px solid #aeb7c1;
    border-radius: 5px;
    background: white;
    padding: 0 9px;
    color: inherit;
    font: inherit;
  }
  .drag-help {
    margin: 0;
    color: #697581;
    font-size: 10px;
  }
  .component-groups {
    min-height: 0;
    overflow: auto;
    padding-right: 3px;
  }
  .category-group + .category-group {
    margin-top: 15px;
  }
  h3 {
    margin: 0 0 6px;
  }
  .component-list {
    display: grid;
    gap: 4px;
  }
  .component-row {
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    border: 1px solid transparent;
    border-radius: 5px;
    padding: 7px;
    cursor: grab;
  }
  .component-row:hover {
    border-color: #bdc9d4;
    background: #edf3f7;
  }
  .component-row:active,
  article:active {
    cursor: grabbing;
  }
  .component-copy {
    min-width: 0;
    display: grid;
    gap: 2px;
  }
  .component-copy strong,
  .component-copy small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .component-copy small {
    color: #6f7984;
    font-size: 9px;
  }
  .component-row button,
  .card-copy button {
    flex: none;
    min-height: 26px;
    color: #285f8d;
    font-size: 10px;
    font-weight: 700;
  }
  .component-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  article {
    min-width: 0;
    overflow: hidden;
    border: 1px solid #c8d0d8;
    border-radius: 7px;
    background: white;
    cursor: grab;
  }
  article:hover {
    border-color: #8daabd;
    box-shadow: 0 3px 10px #1f293714;
  }
  .card-copy {
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 5px;
    padding: 7px;
  }
  .card-copy strong {
    min-width: 0;
    overflow: hidden;
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .empty-state {
    color: #6c7680;
    line-height: 1.4;
  }
  @media (max-width: 1200px) {
    .component-drawer {
      left: 205px;
      width: min(390px, calc(100vw - 205px));
    }
  }
</style>
