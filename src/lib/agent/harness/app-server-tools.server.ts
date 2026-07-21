import type { DynamicToolCallParams } from '../../../../.generated/codex-app-server/v2/DynamicToolCallParams';
import type { DynamicToolCallResponse } from '../../../../.generated/codex-app-server/v2/DynamicToolCallResponse';
import type { DynamicToolSpec } from '../../../../.generated/codex-app-server/v2/DynamicToolSpec';
import type { JsonValue } from '../../../../.generated/codex-app-server/serde_json/JsonValue';
import { operationSchema } from '$lib/model/types';
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
      changes: z
        .array(
          z
            .object({
              operation: operationSchema,
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
  'candidate.apply_changes': 'Apply a bounded batch of atomic changes to the candidate only.',
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
};

export type CanvasToolDispatcherOptions = {
  onActivity?: (activity: CanvasToolActivity) => void;
};

const MAX_SUMMARY_KEYS = 20;
const MAX_SUMMARY_STRING = 240;
const MAX_TOOL_ARGUMENT_CHARACTERS = 250_000;
const MAX_TOOL_RESULT_CHARACTERS = 500_000;

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

function agentVisibleResult(tool: CanvasToolName, result: unknown) {
  if (tool !== 'candidate.submit' || !result || typeof result !== 'object') return result;
  const submission = result as Record<string, unknown>;
  return {
    submitted: true,
    sessionId: submission.sessionId,
    sourceRevisionId: submission.sourceRevisionId,
    candidateRevisionId: submission.candidateRevisionId,
    operationCount: Array.isArray(submission.operations) ? submission.operations.length : undefined,
  };
}

export class CanvasAppServerToolDispatcher {
  private submission: { tool: CanvasToolName; result: unknown } | null = null;

  constructor(
    private readonly service: CanvasSessionService,
    private readonly sessionId: string,
    private readonly options: CanvasToolDispatcherOptions = {},
  ) {}

  get submittedResult() {
    return this.submission;
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
    const parsed = canvasToolInputSchemas[canonicalName].safeParse(params.arguments);
    if (!parsed.success) {
      const error = {
        error: {
          code: 'invalid-arguments',
          message: `Invalid arguments for ${canonicalName}`,
          diagnostics: parsed.error.issues.slice(0, 20).map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
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
      });
      return {
        success: false,
        contentItems: [{ type: 'inputText', text: JSON.stringify(error) }],
      };
    }

    this.options.onActivity?.({
      phase: 'started',
      sessionId: this.sessionId,
      callId: params.callId,
      tool: canonicalName,
      arguments: parsed.data,
      argumentSummary: boundedSummary(parsed.data),
    });
    try {
      const result = await this.service.dispatch(this.sessionId, canonicalName, parsed.data);
      const visibleResult = agentVisibleResult(canonicalName, result);
      const text = resultText(visibleResult);
      if (canonicalName === 'candidate.submit') this.submission = { tool: canonicalName, result };
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
        contentItems: [{ type: 'inputText', text }],
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
      });
      return {
        success: false,
        contentItems: [{ type: 'inputText', text: JSON.stringify(payload) }],
      };
    }
  }
}
