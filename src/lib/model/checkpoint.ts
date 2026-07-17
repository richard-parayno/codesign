import { applyOperation } from './operations';
import {
  blankDocument,
  defaultStyle,
  type DesignDocument,
  type DesignNode,
  type NodeKind,
} from './types';

function node(
  id: string,
  name: string,
  kind: NodeKind,
  x: number,
  y: number,
  width: number,
  height: number,
  role?: string,
): DesignNode {
  return {
    id,
    name,
    kind,
    screenId: 'screen-1',
    childIds: [],
    bounds: { x, y, width, height },
    style: { ...defaultStyle, fill: kind === 'frame' ? '#f7f8fa' : '#d9dde3' },
    semantics: role ? { role, commitment: 'inferred' } : undefined,
    provenance: { actor: 'user', operationId: `seed-${id}` },
  };
}

export function demoCheckpoint(): DesignDocument {
  let document = blankDocument();
  const nodes = [
    node('frame', 'Application frame', 'frame', 80, 60, 760, 560, 'app-shell'),
    node('sidebar', 'Sidebar', 'rectangle', 100, 80, 150, 520, 'sidebar'),
    node('header', 'Header', 'rectangle', 270, 80, 550, 70, 'header'),
    node('content', 'Content region', 'rectangle', 270, 170, 550, 410, 'content-region'),
    ...[0, 1, 2, 3].map((index) =>
      node(
        `row-${index + 1}`,
        `Customer row ${index + 1}`,
        'rectangle',
        294,
        210 + index * 76,
        500,
        58,
        'record',
      ),
    ),
  ];
  for (const item of nodes)
    document = applyOperation(
      document,
      { id: `seed-create-${item.id}`, type: 'create', actor: 'user', node: item },
      1,
    );
  document = applyOperation(
    document,
    {
      id: 'seed-repeat',
      type: 'repeat',
      actor: 'agent',
      targetIds: ['row-1', 'row-2', 'row-3', 'row-4'],
      repeaterId: 'customer-rows',
    },
    2,
  );
  return document;
}
