<script lang="ts">
  import type { ProjectComponentDefinition } from '$lib/model/types';
  import { PROJECT_COMPONENT_DRAG_MIME } from './component-drag';
  import ProjectComponentPreview from './ProjectComponentPreview.svelte';

  type Props = {
    definitions: readonly ProjectComponentDefinition[];
    onInsert: (componentId: string) => void;
  };

  let { definitions, onInsert }: Props = $props();
  let open = $state(false);
  let query = $state('');
  const filtered = $derived(
    definitions.filter((definition) =>
      definition.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    ),
  );

  function beginDrag(event: DragEvent, definition: ProjectComponentDefinition) {
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(PROJECT_COMPONENT_DRAG_MIME, definition.id);
    event.dataTransfer.setData('text/plain', definition.name);
  }
</script>

<section class="launcher" aria-labelledby="project-components-title">
  <div>
    <span>Local assets</span>
    <h2 id="project-components-title">Project components</h2>
    <small
      >{definitions.length} reusable {definitions.length === 1 ? 'component' : 'components'}</small
    >
  </div>
  <button type="button" onclick={() => (open = true)}>Browse project components</button>
</section>

{#if open}
  <aside class="drawer" aria-label="Project components drawer">
    <header>
      <div>
        <span>Current project</span>
        <h2>Project components</h2>
      </div>
      <button type="button" onclick={() => (open = false)}>Close</button>
    </header>
    <label>
      <span>Search project components</span>
      <input bind:value={query} type="search" placeholder="Search this project…" />
    </label>
    <p>Drag a reusable component onto the canvas, or use Insert.</p>
    {#if filtered.length}
      <div class="grid">
        {#each filtered as definition (definition.id)}
          <article
            draggable="true"
            title={`Drag ${definition.name} to the canvas`}
            ondragstart={(event) => beginDrag(event, definition)}
          >
            <ProjectComponentPreview {definition} />
            <div>
              <strong>{definition.name}</strong><button
                type="button"
                onclick={() => onInsert(definition.id)}>Insert</button
              >
            </div>
          </article>
        {/each}
      </div>
    {:else if definitions.length}
      <div class="empty">
        <strong>No matches</strong>
        <p>Try a different component name.</p>
      </div>
    {:else}
      <div class="empty">
        <strong>No project components yet</strong>
        <p>Select a frame, then choose Create component in Properties or the context menu.</p>
      </div>
    {/if}
  </aside>
{/if}

<style>
  .launcher {
    display: grid;
    gap: 8px;
    border-bottom: 1px solid #d6dae0;
    padding: 11px 8px;
    color: #2c3641;
  }
  .launcher > div {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: baseline;
    gap: 3px 7px;
  }
  .launcher span,
  header span {
    color: #735e91;
    font-size: 9px;
    font-weight: 750;
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }
  h2 {
    margin: 0;
    font-size: 12px;
  }
  .launcher small {
    grid-column: 2;
    color: #77818c;
    font-size: 10px;
  }
  button {
    min-height: 29px;
    border: 1px solid #b9c2cb;
    border-radius: 4px;
    background: white;
    padding: 0 8px;
    color: #35414c;
    font: inherit;
    cursor: pointer;
  }
  button:hover {
    border-color: #8065ac;
    background: #f3eff9;
  }
  .launcher > button {
    width: 100%;
  }
  .drawer {
    position: fixed;
    z-index: 19;
    top: 48px;
    bottom: 0;
    left: 232px;
    width: min(390px, calc(100vw - 232px));
    display: grid;
    grid-template-rows: auto auto auto minmax(0, 1fr);
    gap: 12px;
    border-right: 1px solid #bdb3cc;
    background: #f9f7fb;
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
  label {
    display: grid;
    gap: 4px;
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
  .drawer > p {
    margin: 0;
    color: #697581;
    font-size: 10px;
  }
  .grid {
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-content: start;
    gap: 8px;
    overflow: auto;
  }
  article {
    min-width: 0;
    overflow: hidden;
    border: 1px solid #c9c0d5;
    border-radius: 7px;
    background: white;
    cursor: grab;
  }
  article:hover {
    border-color: #8065ac;
    box-shadow: 0 3px 10px #34264a1c;
  }
  article > div:last-child {
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 5px;
    padding: 7px;
  }
  article strong {
    min-width: 0;
    overflow: hidden;
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  article button {
    flex: none;
    min-height: 26px;
    color: #63438f;
    font-size: 10px;
    font-weight: 700;
  }
  .empty {
    align-self: start;
    border: 1px dashed #b9aec8;
    border-radius: 7px;
    background: #fff;
    padding: 18px;
    text-align: center;
  }
  .empty strong {
    color: #4d3e62;
  }
  .empty p {
    margin: 6px 0 0;
    color: #727985;
    font-size: 11px;
    line-height: 1.5;
  }
  @media (max-width: 1200px) {
    .drawer {
      left: 205px;
      width: min(390px, calc(100vw - 205px));
    }
  }
</style>
