import { z } from 'zod';

export const codesignTelemetryPhaseSchema = z.enum([
  'preparing',
  'prompt-sent',
  'streaming',
  'validating',
  'completed',
  'failed',
  'cancelled',
]);

export const codesignTokenUsageSchema = z.object({
  totalTokens: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningOutputTokens: z.number().int().nonnegative(),
  modelContextWindow: z.number().int().positive().nullable(),
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
});

export type CodesignTelemetryPhase = z.infer<typeof codesignTelemetryPhaseSchema>;
export type CodesignTelemetryEffort = NonNullable<CodesignTelemetryEvent['effort']>;
export type CodesignTokenUsage = z.infer<typeof codesignTokenUsageSchema>;
export type CodesignTelemetryEvent = z.infer<typeof codesignTelemetryEventSchema>;

export function isTerminalTelemetryPhase(phase: CodesignTelemetryPhase) {
  return phase === 'completed' || phase === 'failed' || phase === 'cancelled';
}
