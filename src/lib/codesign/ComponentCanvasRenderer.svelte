<script lang="ts">
  import { onMount } from 'svelte';
  import {
    loadComponent,
    resolveComponent,
    adaptComponentProps,
    validateComponentBinding,
  } from '$lib/design-system/manifest';
  import type { Bounds, DesignNode } from '$lib/model/types';
  import ComponentTreeNode from './ComponentTreeNode.svelte';

  type Props = {
    node: DesignNode;
    bounds: Bounds;
    nodes?: Record<string, DesignNode>;
    preview?: boolean;
    ghost?: boolean;
  };

  let { node, bounds, nodes = {}, preview = false, ghost = false }: Props = $props();
  let Renderer = $state<any>();
  let failed = $state(false);
  const binding = $derived(
    node.componentBinding
      ? validateComponentBinding(node.componentBinding.componentId, node.componentBinding.props)
      : undefined,
  );
  const renderComponentId = $derived(
    binding?.ok && binding.legacyTargetId
      ? binding.legacyTargetId
      : (node.componentBinding?.componentId ?? ''),
  );
  const resolved = $derived(resolveComponent(renderComponentId));
  const editableContent = $derived(
    resolved?.part?.editableContent ?? resolved?.root.editableContent ?? false,
  );
  const renderNative = $derived(
    Boolean(resolved && !resolved.part && resolved.root.renderStrategy === 'native'),
  );
  const renderNativeTree = $derived(
    Boolean(resolved && !resolved.part && resolved.root.renderStrategy === 'compound'),
  );
  const renderFallback = $derived(
    Boolean(resolved && !resolved.part && resolved.root.renderStrategy === 'fallback'),
  );
  const rendererProps = $derived.by(() => {
    const props = node.componentBinding
      ? adaptComponentProps(node.componentBinding.componentId, node.componentBinding.props)
      : {};
    if (preview) {
      // Let uncontrolled shadcn primitives own transient Preview state. The saved binding
      // remains the source of truth when the designer returns to Edit.
      delete props.checked;
      delete props.open;
      delete props.value;
    }
    return props;
  });

  onMount(() => {
    if (!node.componentBinding || !renderNative || renderNativeTree) return;
    let current = true;
    void loadComponent(renderComponentId)
      .then((component) => {
        if (current) Renderer = component;
      })
      .catch(() => {
        if (current) failed = true;
      });
    return () => {
      current = false;
    };
  });
</script>

<foreignObject
  class:ghost
  x={bounds.x}
  y={bounds.y}
  width={bounds.width}
  height={bounds.height}
  pointer-events={preview && resolved?.root.interaction.preview === 'enabled' ? 'auto' : 'none'}
>
  <div
    class="component-host"
    data-component={node.componentBinding?.componentId}
    data-preview-interaction={resolved?.root.interaction.preview}
    style={`color:${node.style.textColor};font-size:${node.style.fontSize}px;font-weight:${node.style.fontWeight};line-height:${node.style.lineHeight};text-align:${node.style.textAlign}`}
  >
    {#if renderNativeTree}
      <ComponentTreeNode {node} {nodes} parentBounds={bounds} {preview} root />
    {:else if resolved?.part}
      <span class="component-part">{node.text ?? resolved.part.displayName}</span>
    {:else if renderFallback}
      <span class="component-fallback">{node.text ?? resolved?.root.displayName ?? node.name}</span>
    {:else if Renderer}
      {#if editableContent && node.text}
        <Renderer {...rendererProps}>{node.text}</Renderer>
      {:else}
        <Renderer {...rendererProps} />
      {/if}
    {:else if failed}
      <span>{resolved?.root.displayName ?? node.name}</span>
    {/if}
  </div>
</foreignObject>

<style>
  foreignObject {
    overflow: visible;
  }
  foreignObject.ghost {
    opacity: 0.68;
  }
  .component-host {
    width: 100%;
    height: 100%;
    overflow: hidden;
    color: var(--foreground, #18181b);
    font:
      13px/1.35 Inter,
      ui-sans-serif,
      system-ui,
      sans-serif;
  }
  .component-host :global(*) {
    box-sizing: border-box;
    max-width: 100%;
  }
  .component-host > :global(*) {
    width: 100%;
    height: 100%;
    min-width: min(100%, 24px);
    min-height: min(100%, 20px);
  }
  span {
    display: grid;
    height: 100%;
    place-items: center;
    border: 1px dashed #8b99a8;
    border-radius: 5px;
    color: #5d6975;
  }
  .component-part {
    border-style: solid;
    border-color: color-mix(in srgb, var(--border, #d4d4d8) 75%, transparent);
    background: color-mix(in srgb, var(--background, #fff) 88%, transparent);
    color: var(--foreground, #18181b);
    text-align: left;
  }
</style>
