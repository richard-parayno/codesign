<script lang="ts">
  import { onMount } from 'svelte';
  import {
    adaptComponentProps,
    type CodesignComponentDefinition,
  } from '$lib/design-system/manifest';

  type Props = { component: CodesignComponentDefinition };

  let { component }: Props = $props();
  let Renderer = $state<any>();
  let failed = $state(false);
  const root = $derived(component.defaultComposition.find((item) => item.key === 'root'));
  const rendererProps = $derived(root ? adaptComponentProps(root.componentId, root.props) : {});
  const canMountStandalone = $derived(
    component.renderStrategy === 'native' && component.id !== 'Slider',
  );
  const previewScale = $derived(
    Math.min(1, 128 / component.defaultSize.width, 68 / component.defaultSize.height),
  );

  onMount(() => {
    // Slider's underlying primitive requires an array-valued binding that is not part of
    // the registry contract yet, so its structural preview is safer than mounting it here.
    if (!canMountStandalone) return;
    let current = true;
    void component
      .load()
      .then((loaded) => {
        if (current) Renderer = loaded;
      })
      .catch(() => {
        if (current) failed = true;
      });
    return () => {
      current = false;
    };
  });
</script>

<div class="preview-stage" aria-hidden="true">
  {#if Renderer}
    <div
      class="native-preview"
      style={`width:${component.defaultSize.width}px;height:${component.defaultSize.height}px;transform:scale(${previewScale})`}
    >
      {#if component.editableContent}
        <Renderer {...rendererProps}>{component.defaultContent}</Renderer>
      {:else}
        <Renderer {...rendererProps} />
      {/if}
    </div>
  {:else}
    <div class:failed class="structural-preview">
      <span class="preview-label">{component.displayName}</span>
      <span></span><span></span><span></span>
    </div>
  {/if}
</div>

<style>
  .preview-stage {
    position: relative;
    width: 100%;
    height: 88px;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-bottom: 1px solid #dce2e8;
    background:
      linear-gradient(#ffffffcc, #ffffffcc), linear-gradient(90deg, #dfe4e9 1px, transparent 1px),
      linear-gradient(#dfe4e9 1px, transparent 1px);
    background-size:
      auto,
      12px 12px,
      12px 12px;
    color: var(--foreground);
    pointer-events: none;
  }
  .native-preview {
    display: grid;
    place-items: center;
    transform-origin: center;
  }
  .native-preview :global(*) {
    box-sizing: border-box;
    max-width: 100%;
  }
  .native-preview > :global(*) {
    width: 100%;
    height: 100%;
  }
  .structural-preview {
    width: min(78%, 118px);
    min-height: 54px;
    display: grid;
    align-content: center;
    gap: 5px;
    border: 1px solid #aeb8c3;
    border-radius: 7px;
    background: #fff;
    padding: 8px;
    box-shadow: 0 2px 5px #1f29370d;
  }
  .structural-preview > span:not(.preview-label) {
    height: 4px;
    border-radius: 2px;
    background: #d6dce2;
  }
  .structural-preview > span:last-child {
    width: 62%;
  }
  .preview-label {
    overflow: hidden;
    color: #35414c;
    font-size: 9px;
    font-weight: 700;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .failed {
    border-style: dashed;
  }
</style>
