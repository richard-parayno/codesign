import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getCodexClient } from '$lib/agent/codex-client.server';
import { localProposal } from '$lib/agent/local';
import { componentRegistry, validateComponentBinding } from '$lib/design-system/registry';
import { blankDocument, nodeSchema, proposalSchema, type DesignDocument } from '$lib/model/types';

const requestSchema = z.object({
  intent: z.enum(['interpret', 'promote']),
  agency: z.enum(['protect', 'guide', 'explore']),
  targetIds: z.array(z.string()).min(1).max(20),
  document: z.object({
    revision: z.number().int().nonnegative(),
    activeScreenId: z.string(),
    nodes: z.record(z.string(), nodeSchema),
  }),
});

function localFallback(input: z.infer<typeof requestSchema>) {
  const document: DesignDocument = {
    ...blankDocument(),
    revision: input.document.revision,
    activeScreenId: input.document.activeScreenId,
    screens: [
      {
        id: input.document.activeScreenId,
        name: 'Active screen',
        branchId: 'branch-main',
        rootIds: Object.keys(input.document.nodes),
      },
    ],
    nodes: input.document.nodes,
  };
  return localProposal(document, input.targetIds, input.intent);
}

function parseJson(text: string) {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  return JSON.parse(trimmed) as unknown;
}

function removeNullProps(value: unknown) {
  if (!value || typeof value !== 'object') return value;
  const proposal = value as { operation?: { props?: Record<string, unknown> } };
  if (proposal.operation?.props) {
    proposal.operation.props = Object.fromEntries(
      Object.entries(proposal.operation.props).filter(([, prop]) => prop !== null),
    );
  }
  return proposal;
}

export async function POST({ request }) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return json({ message: 'Invalid design interpretation request' }, { status: 400 });
  const input = parsed.data;
  if (input.targetIds.some((id) => !input.document.nodes[id]))
    return json({ message: 'A proposal target no longer exists' }, { status: 409 });
  if ((env.MALLEABLE_AGENT_BACKEND ?? 'local') !== 'codex')
    return json({ proposal: localFallback(input), fallback: false });

  const safeContext = {
    intent: input.intent,
    agency: input.agency,
    revision: input.document.revision,
    targetIds: input.targetIds,
    selectedNodes: input.targetIds.map((id) => input.document.nodes[id]),
    registry: Object.values(componentRegistry).map(({ id, allowedProps, slots }) => ({
      id,
      allowedProps,
      slots,
    })),
  };
  const prompt = `Interpret this selected design-document slice. Return exactly one proposal. For interpret with 2+ similar targets prefer repeat; for promote choose only a registry component and permitted props. In the fixed props envelope, set every prop that does not apply to the chosen component to null. Preserve every supplied target ID and revision. Do not use tools.\n${JSON.stringify(safeContext)}`;
  try {
    const text = await getCodexClient(
      env.MALLEABLE_CODEX_COMMAND || 'codex',
      env.MALLEABLE_CODEX_MODEL || undefined,
    ).propose(prompt, request.signal, input.intent);
    const proposal = proposalSchema.parse(removeNullProps(parseJson(text)));
    if (
      proposal.baseRevision !== input.document.revision ||
      proposal.targetIds.some((id) => !input.targetIds.includes(id))
    )
      throw new Error('Codex returned stale or out-of-scope targets');
    if (
      proposal.operation.actor !== 'agent' ||
      (input.intent === 'interpret' && proposal.operation.type !== 'repeat') ||
      (input.intent === 'promote' && proposal.operation.type !== 'promote')
    )
      throw new Error('Codex returned an operation outside the requested capability');
    if (proposal.operation.type === 'promote') {
      const binding = validateComponentBinding(
        proposal.operation.componentId,
        proposal.operation.props,
      );
      if (!binding.ok) throw new Error(binding.error);
    }
    return json({ proposal, fallback: false });
  } catch (cause) {
    console.warn(
      '[malleable] Codex proposal fell back:',
      cause instanceof Error ? cause.message : 'unknown protocol error',
    );
    return json({
      proposal: localFallback(input),
      fallback: true,
      message:
        'Codex was unavailable or returned an invalid proposal; local interpretation is active.',
    });
  }
}
