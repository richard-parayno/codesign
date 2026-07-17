import type { DesignDocument, ProposedOperation } from '$lib/model/types';

const id = () => crypto.randomUUID();
export function localProposal(
  document: DesignDocument,
  targetIds: string[],
  intent: 'interpret' | 'promote',
): ProposedOperation {
  const nodes = targetIds.map((targetId) => document.nodes[targetId]).filter(Boolean);
  if (!nodes.length) throw new Error('Select at least one object');
  if (intent === 'interpret' && nodes.length >= 2) {
    const operationId = id();
    return {
      id: id(),
      baseRevision: document.revision,
      targetIds,
      operation: {
        id: operationId,
        type: 'repeat',
        actor: 'agent',
        targetIds,
        repeaterId: `repeat-${operationId}`,
      },
      rationale: `${nodes.length} aligned objects share similar geometry and spacing.`,
      confidence: 0.92,
      source: 'local',
    };
  }
  const node = nodes[0];
  let componentId = 'Card';
  let props: Record<string, unknown> = {
    density: node.style.density ?? 'comfortable',
    radius: node.style.radius >= 8 ? 'medium' : 'small',
  };
  const ratio = node.bounds.width / node.bounds.height;
  if (node.semantics?.role === 'sidebar' || ratio < 0.5) {
    componentId = 'Sidebar';
    props = { collapsed: false };
  } else if (nodes.length > 1 || node.repeaterId || ratio > 4) {
    componentId = 'DataRow';
    props = { density: node.style.density ?? 'comfortable', interactive: true };
  }
  const operationId = id();
  return {
    id: id(),
    baseRevision: document.revision,
    targetIds,
    operation: { id: operationId, type: 'promote', actor: 'agent', targetIds, componentId, props },
    rationale: `Geometry and confirmed roles best match registered ${componentId}.`,
    confidence: 0.84,
    source: 'local',
  };
}
