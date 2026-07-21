<script lang="ts">
  import { CODESIGN_PROMPT_TEMPLATE_INSPECTION } from '$lib/agent/prompt-template';

  export let renderedPrompt: string | undefined = undefined;
  let view: 'system' | 'template' | 'rendered' | 'schema' = 'template';

  $: content =
    view === 'system'
      ? CODESIGN_PROMPT_TEMPLATE_INSPECTION.systemInstructions
      : view === 'template'
        ? CODESIGN_PROMPT_TEMPLATE_INSPECTION.userTemplate
        : view === 'rendered'
          ? (renderedPrompt ?? 'Generate from Codesign with AI to inspect the rendered request.')
          : CODESIGN_PROMPT_TEMPLATE_INSPECTION.outputSchema;
</script>

<section class="prompt-inspector" aria-label="Codesign prompt inspector">
  <div class="heading">
    <div>
      <h2>Codesign prompt</h2>
      <p>
        Inspect the exact versioned instructions and submission contract used by this build. The
        rendered request contains compact session orientation; scene and component details are
        retrieved with tools.
      </p>
    </div>
    <span>{CODESIGN_PROMPT_TEMPLATE_INSPECTION.id}</span>
  </div>
  <div class="controls">
    <nav aria-label="Prompt views">
      <button class:active={view === 'system'} onclick={() => (view = 'system')}
        >System instructions</button
      ><button class:active={view === 'template'} onclick={() => (view = 'template')}
        >Prompt template</button
      ><button class:active={view === 'rendered'} onclick={() => (view = 'rendered')}
        >Rendered request</button
      ><button class:active={view === 'schema'} onclick={() => (view = 'schema')}
        >Output schema</button
      >
    </nav>
    <button class="copy" onclick={() => navigator.clipboard.writeText(content)}
      >Copy current view</button
    >
  </div>
  <pre>{content}</pre>
</section>

<style>
  .prompt-inspector {
    min-width: 620px;
    min-height: 100%;
    background: #f8fafc;
    color: #252a31;
  }
  .heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 14px 9px;
  }
  h2 {
    margin: 0 0 3px;
    font-size: 13px;
  }
  p {
    max-width: 760px;
    margin: 0;
    color: #68727e;
    font-size: 11px;
  }
  .heading > span {
    flex: 0 0 auto;
    border-radius: 3px;
    background: #e5ebf1;
    padding: 3px 6px;
    color: #586573;
    font:
      10px/1.2 ui-monospace,
      SFMono-Regular,
      monospace;
  }
  .controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 14px 8px;
  }
  nav {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  button {
    min-height: 28px;
    border: 1px solid #c6ced7;
    border-radius: 4px;
    background: #fff;
    padding: 0 9px;
    color: #485563;
    font-size: 10px;
    cursor: pointer;
  }
  button.active {
    border-color: #78a1c2;
    background: #e4eff8;
    color: #1e5b89;
  }
  .copy {
    flex: 0 0 auto;
  }
  pre {
    box-sizing: border-box;
    min-height: 132px;
    margin: 0;
    overflow: auto;
    border-top: 1px solid #dfe4e9;
    background: #17202b;
    padding: 13px 15px;
    color: #e5edf5;
    font:
      11px/1.55 ui-monospace,
      SFMono-Regular,
      Consolas,
      monospace;
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
