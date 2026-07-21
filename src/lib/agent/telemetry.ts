import { z } from 'zod';
import { codesignFailureStages } from './failure';

export const codesignTelemetryPhaseSchema = z.enum([
  'preparing',
  'prompt-sent',
  'inspecting',
  'rendering',
  'components',
  'applying',
  'streaming',
  'validating',
  'submitting',
  'completed',
  'failed',
  'cancelled',
]);

export const codesignToolActivitySchema = z.object({
  phase: z.enum(['started', 'completed', 'failed']),
  sessionId: z.string().min(1).max(160),
  callId: z.string().min(1).max(160),
  tool: z.enum([
    'scene.overview',
    'scene.get_nodes',
    'scene.render',
    'components.search',
    'components.describe',
    'candidate.get_state',
    'candidate.apply_changes',
    'candidate.validate',
    'candidate.submit',
  ]),
  durationMs: z.number().int().nonnegative().optional(),
  arguments: z.unknown().optional(),
  result: z.unknown().optional(),
  argumentSummary: z.record(z.string(), z.unknown()).optional(),
  resultSummary: z.record(z.string(), z.unknown()).optional(),
  candidateMutation: z
    .object({
      candidateRevisionId: z.string().optional(),
      appliedOperationIds: z.array(z.string()).max(24),
    })
    .optional(),
  error: z.string().max(4_000).optional(),
  diagnostics: z
    .array(
      z.object({
        path: z.string().max(500).optional(),
        message: z.string().max(1_000),
        code: z.string().max(120).optional(),
        nodeIds: z.array(z.string()).max(50).optional(),
      }),
    )
    .max(20)
    .optional(),
});

export const codesignTokenUsageSchema = z.object({
  totalTokens: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningOutputTokens: z.number().int().nonnegative(),
  modelContextWindow: z.number().int().positive().nullable(),
});

export const codesignFailureDiagnosticSchema = z.object({
  stage: z.enum(codesignFailureStages),
  category: z.enum([
    'missing-login',
    'model-unavailable',
    'rate-limited',
    'cancelled',
    'protocol-failure',
    'unavailable',
  ]),
  message: z.string().min(1).max(4_000),
  errorName: z.string().min(1).max(120),
  code: z.string().max(120).optional(),
});

export const codesignTelemetryEventSchema = z.object({
  requestId: z.string().min(1).max(120),
  sequence: z.number().int().nonnegative(),
  phase: codesignTelemetryPhaseSchema,
  timestamp: z.number().int().nonnegative(),
  message: z.string().min(1).max(240),
  model: z.string().max(120).optional(),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  promptVersion: z.string().max(120).optional(),
  contextNodeCount: z.number().int().nonnegative().optional(),
  promptCharacters: z.number().int().nonnegative().optional(),
  outputCharacters: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  usage: codesignTokenUsageSchema.optional(),
  renderedPrompt: z.string().max(2_000_000).optional(),
  toolActivity: codesignToolActivitySchema.optional(),
  failure: codesignFailureDiagnosticSchema.optional(),
});

export type CodesignTelemetryPhase = z.infer<typeof codesignTelemetryPhaseSchema>;
export type CodesignTelemetryEffort = NonNullable<CodesignTelemetryEvent['effort']>;
export type CodesignTokenUsage = z.infer<typeof codesignTokenUsageSchema>;
export type CodesignTelemetryEvent = z.infer<typeof codesignTelemetryEventSchema>;
export type CodesignToolActivity = z.infer<typeof codesignToolActivitySchema>;

export function isTerminalTelemetryPhase(phase: CodesignTelemetryPhase) {
  return phase === 'completed' || phase === 'failed' || phase === 'cancelled';
}
