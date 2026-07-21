<script lang="ts">
  import type { ProjectComponentDefinition } from '$lib/model/types';

  type Props = { definition: ProjectComponentDefinition };
  let { definition }: Props = $props();
  const root = $derived(definition.nodes[definition.rootId]);
  const nodes = $derived(Object.values(definition.nodes));
</script>

<div class="preview" aria-hidden="true">
  {#if root}
    <svg viewBox={`${root.bounds.x} ${root.bounds.y} ${root.bounds.width} ${root.bounds.height}`}>
      {#each nodes as node (node.id)}
        {#if node.id !== root.id}
          <rect
            x={node.bounds.x}
            y={node.bounds.y}
            width={node.bounds.width}
            height={node.bounds.height}
            rx={node.style.radius}
            fill={node.kind === 'text' ? 'transparent' : node.style.fill}
            stroke={node.style.stroke ?? '#b9c2cc'}
            stroke-width={node.style.strokeWidth ?? 0.75}
          />
          {#if node.text}
            <text
              x={node.bounds.x + Math.max(4, node.style.padding)}
              y={node.bounds.y + Math.min(node.bounds.height - 3, node.style.fontSize + 3)}
              fill={node.style.textColor}
              font-size={node.style.fontSize}
              font-weight={node.style.fontWeight}>{node.text}</text
            >
          {/if}
        {/if}
      {/each}
      <rect
        x={root.bounds.x}
        y={root.bounds.y}
        width={root.bounds.width}
        height={root.bounds.height}
        rx={root.style.radius}
        fill="none"
        stroke="#7655b5"
        stroke-width={Math.max(1, root.bounds.width / 120)}
      />
    </svg>
  {/if}
</div>

<style>
  .preview {
    height: 92px;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-bottom: 1px solid #ded8e9;
    background:
      linear-gradient(#ffffffd9, #ffffffd9), linear-gradient(90deg, #e7e1ef 1px, transparent 1px),
      linear-gradient(#e7e1ef 1px, transparent 1px);
    background-size:
      auto,
      12px 12px,
      12px 12px;
  }
  svg {
    width: calc(100% - 20px);
    height: 72px;
    overflow: visible;
  }
</style>
