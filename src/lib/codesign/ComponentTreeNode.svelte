<script lang="ts">
  import { onMount } from 'svelte';
  import {
    adaptComponentProps,
    loadComponent,
    resolveComponent,
  } from '$lib/design-system/manifest';
  import type { Bounds, DesignNode } from '$lib/model/types';
  import ComponentTreeNode from './ComponentTreeNode.svelte';

  type Props = {
    node: DesignNode;
    nodes: Record<string, DesignNode>;
    parentBounds: Bounds;
    rootProps?: Record<string, unknown>;
    preview?: boolean;
    root?: boolean;
  };

  let {
    node,
    nodes,
    parentBounds,
    rootProps = node.componentBinding?.props ?? {},
    preview = false,
    root = false,
  }: Props = $props();
  let Renderer = $state<any>();
  let failed = $state(false);
  const resolved = $derived(resolveComponent(node.componentBinding?.componentId ?? ''));
  const editableContent = $derived(
    resolved?.part?.editableContent ?? resolved?.root.editableContent ?? false,
  );
  const effectiveRootProps = $derived(
    resolved && !resolved.part ? (node.componentBinding?.props ?? {}) : rootProps,
  );
  const rendererProps = $derived.by(() => {
    const props = node.componentBinding
      ? adaptComponentProps(
          node.componentBinding.componentId,
          node.componentBinding.props,
          effectiveRootProps,
        )
      : {};
    if (preview) {
      delete props.checked;
      delete props.open;
      delete props.value;
    }
    return props;
  });
  const children = $derived(
    node.childIds.map((id) => nodes[id]).filter((item): item is DesignNode => Boolean(item)),
  );
  const position = $derived(
    root
      ? 'position:relative;width:100%;height:100%;'
      : `position:absolute;left:${node.bounds.x - parentBounds.x}px;top:${node.bounds.y - parentBounds.y}px;width:${node.bounds.width}px;height:${node.bounds.height}px;`,
  );

  onMount(() => {
    if (!node.componentBinding) return;
    let current = true;
    void loadComponent(node.componentBinding.componentId)
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

<div class="tree-node" style={position} data-component-part={node.componentBinding?.componentId}>
  {#if Renderer}
    <Renderer {...rendererProps}>
      {#if editableContent && node.text}{node.text}{/if}
      {#each children as child (child.id)}
        <ComponentTreeNode
          node={child}
          {nodes}
          parentBounds={node.bounds}
          rootProps={effectiveRootProps}
          {preview}
        />
      {/each}
    </Renderer>
  {:else if failed}
    <span
      >{node.text ?? resolved?.part?.displayName ?? resolved?.root.displayName ?? node.name}</span
    >
  {/if}
</div>

<style>
  .tree-node {
    box-sizing: border-box;
    min-width: 0;
    min-height: 0;
  }
  .tree-node :global(*) {
    box-sizing: border-box;
    max-width: 100%;
  }
  .tree-node > :global(*) {
    width: 100%;
    min-height: min(100%, 20px);
  }
  span {
    display: grid;
    width: 100%;
    height: 100%;
    place-items: center;
    border: 1px dashed #8b99a8;
    border-radius: 5px;
    color: #5d6975;
  }
</style>
