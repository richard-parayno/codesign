import {
  adaptComponentProps,
  resolveComponent,
  validateComponentBinding,
  type ResolvedComponent,
} from '$lib/design-system/registry';
import { defaultLayout, layoutForNode, type DesignDocument, type DesignNode } from './types';

const safeText = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('{', '&#123;');
const safeProp = (value: unknown) => JSON.stringify(value).replaceAll('<', '\\u003c');

function resolvedBinding(node: DesignNode): ResolvedComponent | undefined {
  if (!node.componentBinding) return undefined;
  const binding = validateComponentBinding(
    node.componentBinding.componentId,
    node.componentBinding.props,
  );
  if (!binding.ok) return undefined;
  return resolveComponent(binding.legacyTargetId ?? node.componentBinding.componentId);
}

function namespaceName(resolved: ResolvedComponent) {
  return resolved.root.id.replace(/[^a-zA-Z0-9_$]/g, '');
}

function componentTag(resolved: ResolvedComponent) {
  if (resolved.root.codegen.importStyle === 'named') return resolved.root.codegen.exportName;
  if (!resolved.part) return `${namespaceName(resolved)}.Root`;
  const shortExport = resolved.part.exportName.startsWith(resolved.root.id)
    ? resolved.part.exportName.slice(resolved.root.id.length)
    : resolved.part.exportName;
  return `${namespaceName(resolved)}.${shortExport || 'Root'}`;
}

function layoutStyle(node: DesignNode) {
  const layout = layoutForNode(node);
  if (JSON.stringify(layout) === JSON.stringify(defaultLayout)) return '';
  const declarations: string[] = [];
  if (layout.mode === 'horizontal' || layout.mode === 'vertical') {
    declarations.push(
      'display:flex',
      `flex-direction:${layout.mode === 'horizontal' ? 'row' : 'column'}`,
    );
  } else if (layout.mode === 'grid') {
    declarations.push(
      'display:grid',
      `grid-template-columns:repeat(${layout.gridColumns},minmax(0,1fr))`,
    );
  }
  if (layout.mode !== 'none') {
    const padding =
      typeof layout.padding === 'number'
        ? `${layout.padding}px`
        : `${layout.padding.top}px ${layout.padding.right}px ${layout.padding.bottom}px ${layout.padding.left}px`;
    const align = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' }[
      layout.align
    ];
    const justify = {
      start: 'flex-start',
      center: 'center',
      end: 'flex-end',
      'space-between': 'space-between',
    }[layout.justify];
    declarations.push(
      `gap:${layout.gap}px`,
      `padding:${padding}`,
      `align-items:${align}`,
      `justify-content:${justify}`,
    );
  }
  if (layout.widthMode === 'fill') declarations.push('width:100%');
  else if (layout.widthMode === 'hug') declarations.push('width:fit-content');
  if (layout.heightMode === 'fill') declarations.push('height:100%');
  else if (layout.heightMode === 'hug') declarations.push('height:fit-content');
  return declarations.length ? ` style="${declarations.join(';')}"` : '';
}

function renderNode(
  document: DesignDocument,
  node: DesignNode,
  depth = 1,
  rootComponentProps?: Record<string, unknown>,
): string {
  const pad = '  '.repeat(depth);
  const resolved = resolvedBinding(node);
  const nextRootComponentProps =
    resolved && !resolved.part
      ? node.componentBinding?.props
      : (rootComponentProps ?? node.componentBinding?.props);
  const children = node.childIds
    .map((id) => document.nodes[id])
    .filter((child): child is DesignNode => Boolean(child));
  const content = children.length
    ? `\n${children
        .map((child) => renderNode(document, child, depth + 1, nextRootComponentProps))
        .join('\n')}\n${pad}`
    : safeText(node.text || node.name);
  if (node.componentBinding && resolved) {
    const props = Object.entries(
      adaptComponentProps(
        node.componentBinding.componentId,
        node.componentBinding.props,
        nextRootComponentProps,
      ),
    )
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => ` ${key}={${safeProp(value)}}`)
      .join('');
    const tag = componentTag(resolved);
    return `${pad}<${tag}${props}${layoutStyle(node)}>${content}</${tag}>`;
  }
  return `${pad}<div class="greybox" data-kind="${node.kind}"${layoutStyle(node)}>${content}</div>`;
}

function importsFor(nodes: DesignNode[]) {
  const imports = new Map<string, { path: string; statement: string }>();
  for (const node of nodes) {
    const resolved = resolvedBinding(node);
    if (!resolved) continue;
    const root = resolved.root;
    const key = `${root.codegen.importStyle}:${root.codegen.importPath}:${root.id}`;
    const statement =
      root.codegen.importStyle === 'namespace'
        ? `import * as ${namespaceName(resolved)} from '${root.codegen.importPath}';`
        : `import { ${root.codegen.exportName} } from '${root.codegen.importPath}';`;
    imports.set(key, { path: root.codegen.importPath, statement });
  }
  return [...imports.values()]
    .sort((a, b) => a.path.localeCompare(b.path) || a.statement.localeCompare(b.statement))
    .map((item) => `  ${item.statement}`)
    .join('\n');
}

export function generateSvelte(document: DesignDocument, screenId = document.activeScreenId) {
  const screen = document.screens.find((item) => item.id === screenId);
  const nodes = Object.values(document.nodes).filter((node) => node.screenId === screenId);
  const imports = importsFor(nodes);
  const script = imports ? `<script lang="ts">\n${imports}\n</script>\n\n` : '';
  const roots = (screen?.rootIds ?? [])
    .map((id) => document.nodes[id])
    .filter((node): node is DesignNode => Boolean(node));
  return `${script}<!-- Generated projection: edit the design document, not this view. -->\n<section class="codesign-screen" data-screen="${safeText(screenId)}">\n${roots.map((node) => renderNode(document, node)).join('\n')}\n</section>\n\n<style>\n  .codesign-screen { position: relative; }\n  .greybox { border: 1px solid #a7adb7; background: #d9dde3; }\n</style>\n`;
}
