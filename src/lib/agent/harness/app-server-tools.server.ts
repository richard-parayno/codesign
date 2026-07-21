import { readFile } from 'node:fs/promises';
import type { DynamicToolCallParams } from '../../../../.generated/codex-app-server/v2/DynamicToolCallParams';
import type { DynamicToolCallResponse } from '../../../../.generated/codex-app-server/v2/DynamicToolCallResponse';
import type { DynamicToolSpec } from '../../../../.generated/codex-app-server/v2/DynamicToolSpec';
import type { JsonValue } from '../../../../.generated/codex-app-server/serde_json/JsonValue';
import { z } from 'zod';
import type { CanvasSessionService, CanvasToolName } from './contracts';

const boundsSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().nonnegative(),
    height: z.number().finite().nonnegative(),
  })
  .strict();

const mutationBoundsSchema = boundsSchema.extend({
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});

const dynamicToolCallParamsSchema = z
  .object({
    threadId: z.string().min(1),
    turnId: z.string().min(1),
    callId: z.string().min(1),
    namespace: z.string().nullable(),
    tool: z.string().min(1),
    arguments: z.json(),
  })
  .strict();

export function parseDynamicToolCallParams(value: unknown): DynamicToolCallParams | null {
  const parsed = dynamicToolCallParamsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const pageSchema = {
  cursor: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(100).optional(),
};

const stylePatchSchema = z
  .object({
    fill: z.string().optional(),
    stroke: z.string().nullable().optional(),
    strokeWidth: z.number().finite().nonnegative().nullable().optional(),
    opacity: z.number().finite().min(0).max(1).optional(),
    radius: z.number().finite().nonnegative().optional(),
    padding: z.number().finite().nonnegative().optional(),
    textColor: z.string().optional(),
    fontSize: z.number().finite().positive().optional(),
    fontWeight: z.number().finite().min(1).max(1_000).optional(),
    textAlign: z.enum(['left', 'center', 'right']).optional(),
    lineHeight: z.number().finite().positive().optional(),
    density: z.enum(['compact', 'comfortable']).optional(),
  })
  .strict();

const createStyleSchema = stylePatchSchema.extend({
  stroke: z.string().optional(),
  strokeWidth: z.number().finite().nonnegative().optional(),
});

const layoutPatchSchema = z
  .object({
    mode: z.enum(['none', 'horizontal', 'vertical', 'grid']).optional(),
    gap: z.number().finite().nonnegative().optional(),
    padding: z
      .union([
        z.number().finite().nonnegative(),
        z
          .object({
            top: z.number().finite().nonnegative(),
            right: z.number().finite().nonnegative(),
            bottom: z.number().finite().nonnegative(),
            left: z.number().finite().nonnegative(),
          })
          .strict(),
      ])
      .optional(),
    align: z.enum(['start', 'center', 'end', 'stretch']).optional(),
    justify: z.enum(['start', 'center', 'end', 'space-between']).optional(),
    widthMode: z.enum(['fixed', 'hug', 'fill']).optional(),
    heightMode: z.enum(['fixed', 'hug', 'fill']).optional(),
    gridColumns: z.number().int().positive().optional(),
  })
  .strict();

const operationBase = {
  id: z.string().min(1).optional(),
  actor: z.literal('agent').optional(),
} as const;

/** Compact wire vocabulary accepted from the agent and normalized to canonical operations. */
export const canvasCandidateOperationSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...operationBase,
      type: z.literal('create'),
      nodeId: z.string().min(1).optional(),
      name: z.string().min(1).max(120),
      kind: z.enum(['frame', 'rectangle', 'text', 'group', 'instance']),
      parentId: z.string().min(1).optional(),
      bounds: mutationBoundsSchema,
      style: createStyleSchema.optional(),
      layout: layoutPatchSchema.optional(),
      text: z.string().max(10_000).optional(),
      clipContent: z.boolean().optional(),
      componentBinding: z
        .object({
          componentId: z.string().min(1),
          props: z.record(z.string(), z.unknown()).optional(),
          slot: z.string().min(1).optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      ...operationBase,
      type: z.literal('move'),
      targetIds: z.array(z.string().min(1)).min(1),
      dx: z.number().finite(),
      dy: z.number().finite(),
    })
    .strict(),
  z
    .object({
      ...operationBase,
      type: z.literal('resize'),
      targetId: z.string().min(1),
      bounds: mutationBoundsSchema,
    })
    .strict(),
  z
    .object({
      ...operationBase,
      type: z.literal('delete'),
      targetIds: z.array(z.string().min(1)).min(1),
    })
    .strict(),
  z
    .object({
      ...operationBase,
      type: z.literal('promote'),
      targetIds: z.array(z.string().min(1)).min(1),
      componentId: z.string().min(1),
      props: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
  z
    .object({
      ...operationBase,
      type: z.literal('style'),
      targetIds: z.array(z.string().min(1)).min(1),
      patch: stylePatchSchema,
    })
    .strict(),
  z
    .object({
      ...operationBase,
      type: z.literal('update-node'),
      targetIds: z.array(z.string().min(1)).min(1),
      patch: z
        .object({
          name: z.string().min(1).max(120).optional(),
          text: z.string().max(10_000).optional(),
          clipContent: z.boolean().optional(),
          layout: layoutPatchSchema.optional(),
        })
        .strict()
        .refine((patch) => Object.keys(patch).length > 0, 'Node patch cannot be empty'),
    })
    .strict(),
  z
    .object({
      ...operationBase,
      type: z.literal('reparent'),
      targetIds: z.array(z.string().min(1)).min(1),
      parentId: z.string().min(1).optional(),
      index: z.number().int().nonnegative().optional(),
    })
    .strict(),
]);

export const canvasToolInputSchemas = {
  'scene.overview': z.object(pageSchema).strict(),
  'scene.get_nodes': z
    .object({
      nodeIds: z.array(z.string().min(1)).min(1).max(100),
      descendants: z.boolean().optional(),
      siblings: z.boolean().optional(),
      ...pageSchema,
    })
    .strict(),
  'scene.render': z
    .object({
      view: z.enum(['source', 'candidate']).optional(),
      nodeIds: z.array(z.string().min(1)).max(100).optional(),
      bounds: boundsSchema.optional(),
    })
    .strict(),
  'components.search': z
    .object({
      query: z.string().max(200).optional(),
      category: z.string().max(100).optional(),
      slots: z.array(z.string().min(1)).max(30).optional(),
      capabilities: z
        .array(z.enum(['editable-content', 'interactive', 'compound', 'children']))
        .max(4)
        .optional(),
      cursor: z.number().int().nonnegative().optional(),
      limit: z.number().int().min(1).max(30).optional(),
    })
    .strict(),
  'components.describe': z.object({ ids: z.array(z.string().min(1)).min(1).max(12) }).strict(),
  'candidate.get_state': z
    .object({
      nodeIds: z.array(z.string().min(1)).max(100).optional(),
      includeTrace: z.boolean().optional(),
      ...pageSchema,
    })
    .strict(),
  'candidate.apply_changes': z
    .object({
      candidateRevisionId: z.string().min(1),
      changes: z
        .array(
          z
            .object({
              operation: canvasCandidateOperationSchema,
              dependencyIds: z.array(z.string().min(1)).max(100).optional(),
              evidenceNodeIds: z.array(z.string().min(1)).min(1).max(50),
              summary: z.string().trim().min(1).max(1_000),
            })
            .strict(),
        )
        .min(1)
        .max(24),
    })
    .strict(),
  'candidate.validate': z.object({}).strict(),
  'candidate.submit': z.object({}).strict(),
} satisfies Record<CanvasToolName, z.ZodType>;

const descriptions: Record<CanvasToolName, string> = {
  'scene.overview': 'Read a compact overview of the observable canvas hierarchy and edit scope.',
  'scene.get_nodes': 'Read exact scene nodes and optionally their descendants or siblings.',
  'scene.render': 'Render the immutable source or copy-on-write candidate scene for inspection.',
  'components.search': 'Search the canonical Codesign component manifest.',
  'components.describe': 'Read exact contracts for selected component manifest entries.',
  'candidate.get_state': 'Read a compact view of candidate state and accumulated changes.',
  'candidate.apply_changes':
    'Apply 1-24 atomic create, move, resize, delete, promote, style, update-node, or reparent operations. Each change requires evidenceNodeIds and summary. For create, put name, kind, parentId, bounds, style, layout, and text directly on the operation. Internal operation ID, node ID, screen ID, provenance, child IDs, and omitted defaults are assigned by Codesign.',
  'candidate.validate': 'Validate candidate scope, hierarchy, geometry, components, and rendering.',
  'candidate.submit': 'Freeze and submit a valid candidate for human review.',
};

const transportNames = {
  'scene.overview': 'scene_overview',
  'scene.get_nodes': 'scene_get_nodes',
  'scene.render': 'scene_render',
  'components.search': 'components_search',
  'components.describe': 'components_describe',
  'candidate.get_state': 'candidate_get_state',
  'candidate.apply_changes': 'candidate_apply_changes',
  'candidate.validate': 'candidate_validate',
  'candidate.submit': 'candidate_submit',
} as const satisfies Record<CanvasToolName, string>;

const canonicalNames = new Map<string, CanvasToolName>(
  Object.entries(transportNames).map(([canonical, transport]) => [
    transport,
    canonical as CanvasToolName,
  ]),
);

/**
 * First-class dynamic tools supported by the pinned Codex App Server experimental protocol.
 * Transport-safe underscore names map one-to-one to the canonical dotted service names.
 */
function jsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error('Dynamic tool schema contains a non-finite number');
    return value;
  }
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
  throw new Error('Dynamic tool schema contains a non-JSON value');
}

export const CANVAS_APP_SERVER_TOOLS: DynamicToolSpec[] = Object.entries(
  canvasToolInputSchemas,
).map(([name, schema]) => ({
  type: 'function',
  name: transportNames[name as CanvasToolName],
  description: descriptions[name as CanvasToolName],
  inputSchema: jsonValue(z.toJSONSchema(schema)),
}));

export type CanvasToolActivity = {
  phase: 'started' | 'completed' | 'failed';
  sessionId: string;
  callId: string;
  tool: CanvasToolName;
  durationMs?: number;
  arguments?: unknown;
  result?: unknown;
  argumentSummary?: Record<string, unknown>;
  resultSummary?: Record<string, unknown>;
  candidateMutation?: {
    candidateRevisionId?: string;
    appliedOperationIds: string[];
  };
  error?: string;
  diagnostics?: Array<{ path?: string; message: string; code?: string; nodeIds?: string[] }>;
};

export type CanvasToolDispatcherOptions = {
  onActivity?: (activity: CanvasToolActivity) => void;
  onFatal?: (error: Error) => void;
};

const MAX_SUMMARY_KEYS = 20;
const MAX_SUMMARY_STRING = 240;
const MAX_TOOL_ARGUMENT_CHARACTERS = 250_000;
const MAX_TOOL_RESULT_CHARACTERS = 500_000;
const MAX_CONSECUTIVE_MUTATION_FAILURES = 5;

function boundedSummary(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { value: summarizeValue(value) };
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, MAX_SUMMARY_KEYS)
      .map(([key, item]) => [key, summarizeValue(item)]),
  );
}

function summarizeValue(value: unknown): unknown {
  if (typeof value === 'string')
    return value.length > MAX_SUMMARY_STRING ? `${value.slice(0, MAX_SUMMARY_STRING)}…` : value;
  if (Array.isArray(value)) return { count: value.length };
  if (value && typeof value === 'object') return { keys: Object.keys(value).slice(0, 20) };
  return value;
}

function errorPayload(error: unknown) {
  const candidate = error as {
    name?: unknown;
    code?: unknown;
    message?: unknown;
    diagnostics?: unknown;
  };
  return {
    error: {
      name: typeof candidate?.name === 'string' ? candidate.name : 'Error',
      code: typeof candidate?.code === 'string' ? candidate.code : 'tool-failed',
      message: typeof candidate?.message === 'string' ? candidate.message : 'Canvas tool failed',
      ...(Array.isArray(candidate?.diagnostics)
        ? { diagnostics: candidate.diagnostics.slice(0, 50) }
        : {}),
    },
  };
}

function normalizeToolArguments(tool: CanvasToolName, value: unknown) {
  if (tool !== 'candidate.apply_changes') return value;
  if (!value || typeof value !== 'object') return value;
  const input = value as { changes?: unknown };
  if (!Array.isArray(input.changes)) return value;
  return {
    ...(value as Record<string, unknown>),
    changes: input.changes.map((rawChange) => {
      if (!rawChange || typeof rawChange !== 'object') return rawChange;
      const change = rawChange as Record<string, unknown>;
      if (!change.operation || typeof change.operation !== 'object') return rawChange;
      const operation = change.operation as Record<string, unknown>;
      if (operation.type === 'create') {
        const node =
          operation.node && typeof operation.node === 'object'
            ? (operation.node as Record<string, unknown>)
            : {};
        return {
          ...change,
          operation: {
            type: 'create',
            ...(typeof operation.id === 'string' ? { id: operation.id } : {}),
            ...(operation.actor === 'agent' ? { actor: 'agent' } : {}),
            ...(typeof operation.nodeId === 'string'
              ? { nodeId: operation.nodeId }
              : typeof node.id === 'string'
                ? { nodeId: node.id }
                : {}),
            name: operation.name ?? node.name,
            kind: operation.kind ?? node.kind,
            parentId: operation.parentId ?? node.parentId,
            bounds: operation.bounds ?? node.bounds,
            style: operation.style ?? node.style,
            layout: operation.layout ?? node.layout,
            text: operation.text ?? node.text,
            clipContent: operation.clipContent ?? node.clipContent,
            componentBinding: operation.componentBinding ?? node.componentBinding,
          },
        };
      }
      if (operation.type === 'resize') return rawChange;
      const targetIds =
        operation.targetIds ??
        (typeof operation.targetId === 'string' ? [operation.targetId] : undefined);
      const { targetId: _targetId, updates, ...operationWithoutAliases } = operation;
      return {
        ...change,
        operation: {
          ...operationWithoutAliases,
          ...(targetIds ? { targetIds } : {}),
          ...(!operation.patch && updates ? { patch: updates } : {}),
        },
      };
    }),
  };
}

function zodDiagnostics(error: z.ZodError) {
  return error.issues.slice(0, 20).map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

function resultText(result: unknown) {
  const text = JSON.stringify({ result });
  if (text.length > MAX_TOOL_RESULT_CHARACTERS)
    throw Object.assign(new Error('Canvas tool result exceeded the transport limit'), {
      code: 'result-too-large',
    });
  return text;
}

function serializedLength(value: unknown) {
  try {
    return JSON.stringify(value).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function mutationSummary(tool: CanvasToolName, result: unknown) {
  if (tool !== 'candidate.apply_changes' || !result || typeof result !== 'object') return undefined;
  const candidate = result as Record<string, unknown>;
  return {
    ...(typeof candidate.candidateRevisionId === 'string'
      ? { candidateRevisionId: candidate.candidateRevisionId }
      : {}),
    appliedOperationIds: Array.isArray(candidate.appliedOperationIds)
      ? candidate.appliedOperationIds
          .filter((id): id is string => typeof id === 'string')
          .slice(0, 24)
      : [],
  };
}

function agentVisibleResult(tool: CanvasToolName, result: unknown, attachRenderImage = true) {
  if (!result || typeof result !== 'object') return result;
  if (tool === 'scene.render') {
    const { path: _path, ...metadata } = result as Record<string, unknown>;
    return {
      ...metadata,
      imageAttached: attachRenderImage,
      ...(!attachRenderImage
        ? { note: 'This identical render was already attached earlier in the turn; reuse it.' }
        : {}),
    };
  }
  if (tool !== 'candidate.submit') return result;
  const submission = result as Record<string, unknown>;
  return {
    submitted: true,
    sessionId: submission.sessionId,
    sourceRevisionId: submission.sourceRevisionId,
    candidateRevisionId: submission.candidateRevisionId,
    operationCount: Array.isArray(submission.operations) ? submission.operations.length : undefined,
  };
}

async function contentItems(tool: CanvasToolName, result: unknown, attachRenderImage = true) {
  const visibleResult = agentVisibleResult(tool, result, attachRenderImage);
  const items: DynamicToolCallResponse['contentItems'] = [
    { type: 'inputText', text: resultText(visibleResult) },
  ];
  if (tool === 'scene.render' && attachRenderImage && result && typeof result === 'object') {
    const render = result as { path?: unknown; mimeType?: unknown };
    if (typeof render.path !== 'string' || render.mimeType !== 'image/png')
      throw Object.assign(new Error('Canvas render did not produce a consumable PNG'), {
        code: 'render-unavailable',
      });
    const bytes = await readFile(render.path);
    if (bytes.length > 5 * 1024 * 1024)
      throw Object.assign(new Error('Canvas render exceeded the image transport limit'), {
        code: 'render-too-large',
      });
    items.push({
      type: 'inputImage',
      imageUrl: `data:image/png;base64,${bytes.toString('base64')}`,
    });
  }
  return { visibleResult, items };
}

export class CanvasAppServerToolDispatcher {
  private submission: { tool: CanvasToolName; result: unknown } | null = null;
  private readonly deliveredRenderHashes = new Set<string>();
  private consecutiveMutationFailures = 0;
  private mutationFailureLimitReported = false;

  constructor(
    private readonly service: CanvasSessionService,
    private readonly sessionId: string,
    private readonly options: CanvasToolDispatcherOptions = {},
  ) {}

  get submittedResult() {
    return this.submission;
  }

  private recordMutationFailure(tool: CanvasToolName) {
    if (tool !== 'candidate.apply_changes') return;
    this.consecutiveMutationFailures += 1;
    if (
      this.consecutiveMutationFailures < MAX_CONSECUTIVE_MUTATION_FAILURES ||
      this.mutationFailureLimitReported
    )
      return;
    this.mutationFailureLimitReported = true;
    const error = Object.assign(
      new Error(
        `Codesign stopped after ${MAX_CONSECUTIVE_MUTATION_FAILURES} consecutive candidate mutation failures`,
      ),
      {
        name: 'CodexProtocolError',
        code: 'mutation-retry-limit',
        stage: 'candidate-mutation',
      },
    );
    this.options.onFatal?.(error);
  }

  async dispatch(params: DynamicToolCallParams): Promise<DynamicToolCallResponse> {
    const canonicalName = canonicalNames.get(params.tool);
    if (!canonicalName) {
      return {
        success: false,
        contentItems: [
          {
            type: 'inputText',
            text: JSON.stringify({
              error: { code: 'unknown-tool', message: `Unknown Codesign tool: ${params.tool}` },
            }),
          },
        ],
      };
    }

    const startedAt = Date.now();
    if (serializedLength(params.arguments) > MAX_TOOL_ARGUMENT_CHARACTERS) {
      const message = `Arguments for ${canonicalName} exceeded the transport limit`;
      this.options.onActivity?.({
        phase: 'failed',
        sessionId: this.sessionId,
        callId: params.callId,
        tool: canonicalName,
        durationMs: Date.now() - startedAt,
        argumentSummary: boundedSummary(params.arguments),
        error: message,
      });
      return {
        success: false,
        contentItems: [
          {
            type: 'inputText',
            text: JSON.stringify({ error: { code: 'arguments-too-large', message } }),
          },
        ],
      };
    }
    const normalizedArguments = normalizeToolArguments(canonicalName, params.arguments);
    const parsed = canvasToolInputSchemas[canonicalName].safeParse(normalizedArguments);
    if (!parsed.success) {
      const diagnostics = zodDiagnostics(parsed.error);
      const error = {
        error: {
          code: 'invalid-arguments',
          message: `Invalid arguments for ${canonicalName}`,
          diagnostics,
        },
      };
      this.options.onActivity?.({
        phase: 'failed',
        sessionId: this.sessionId,
        callId: params.callId,
        tool: canonicalName,
        durationMs: Date.now() - startedAt,
        argumentSummary: boundedSummary(params.arguments),
        error: error.error.message,
        diagnostics,
      });
      this.recordMutationFailure(canonicalName);
      return {
        success: false,
        contentItems: [{ type: 'inputText', text: JSON.stringify(error) }],
      };
    }

    const canonicalArguments = parsed.data;
    this.options.onActivity?.({
      phase: 'started',
      sessionId: this.sessionId,
      callId: params.callId,
      tool: canonicalName,
      arguments: canonicalArguments,
      argumentSummary: boundedSummary(canonicalArguments),
    });
    try {
      const result = await this.service.dispatch(this.sessionId, canonicalName, canonicalArguments);
      const renderHash =
        canonicalName === 'scene.render' && result && typeof result === 'object'
          ? (result as { sha256?: unknown }).sha256
          : undefined;
      const attachRenderImage =
        typeof renderHash !== 'string' || !this.deliveredRenderHashes.has(renderHash);
      const { visibleResult, items } = await contentItems(canonicalName, result, attachRenderImage);
      if (typeof renderHash === 'string' && attachRenderImage)
        this.deliveredRenderHashes.add(renderHash);
      if (canonicalName === 'candidate.submit') this.submission = { tool: canonicalName, result };
      if (canonicalName === 'candidate.apply_changes') {
        this.consecutiveMutationFailures = 0;
        this.mutationFailureLimitReported = false;
      }
      this.options.onActivity?.({
        phase: 'completed',
        sessionId: this.sessionId,
        callId: params.callId,
        tool: canonicalName,
        durationMs: Date.now() - startedAt,
        result: visibleResult,
        resultSummary: boundedSummary(visibleResult),
        candidateMutation: mutationSummary(canonicalName, result),
      });
      return {
        success: true,
        contentItems: items,
      };
    } catch (error) {
      const payload = errorPayload(error);
      this.options.onActivity?.({
        phase: 'failed',
        sessionId: this.sessionId,
        callId: params.callId,
        tool: canonicalName,
        durationMs: Date.now() - startedAt,
        error: payload.error.message,
        ...(Array.isArray(payload.error.diagnostics)
          ? { diagnostics: payload.error.diagnostics }
          : {}),
      });
      this.recordMutationFailure(canonicalName);
      return {
        success: false,
        contentItems: [{ type: 'inputText', text: JSON.stringify(payload) }],
      };
    }
  }
}
