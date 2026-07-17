import type { DesignDocument, DesignNode } from './types';

const safeText = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('{', '&#123;');
const safeProp = (value: unknown) => JSON.stringify(value).replaceAll('<', '\\u003c');

function renderNode(node: DesignNode, depth = 1) {
  const pad = '  '.repeat(depth);
  const label = safeText(node.text || node.name);
  if (node.componentBinding) {
    const props = Object.entries(node.componentBinding.props)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => ` ${key}={${safeProp(value)}}`)
      .join('');
    return `${pad}<${node.componentBinding.componentId}${props}>${label}</${node.componentBinding.componentId}>`;
  }
  return `${pad}<div class="greybox" data-role="${safeText(node.semantics?.role ?? 'ambiguous')}">${label}</div>`;
}

export function generateSvelte(document: DesignDocument, screenId = document.activeScreenId) {
  const nodes = Object.values(document.nodes)
    .filter((node) => node.screenId === screenId)
    .sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x || a.id.localeCompare(b.id));
  const components = [
    ...new Set(
      nodes.flatMap((node) => (node.componentBinding ? [node.componentBinding.componentId] : [])),
    ),
  ].sort();
  const script = components.length
    ? `<script lang="ts">\n  import { ${components.join(', ')} } from '$lib/design-system';\n</script>\n\n`
    : '';
  return `${script}<!-- Generated projection: edit the design document, not this view. -->\n<section class="malleable-screen" data-screen="${safeText(screenId)}">\n${nodes.map((node) => renderNode(node)).join('\n')}\n</section>\n\n<style>\n  .malleable-screen { position: relative; }\n  .greybox { border: 1px solid #a7adb7; background: #d9dde3; }\n</style>\n`;
}
