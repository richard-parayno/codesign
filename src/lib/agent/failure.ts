export const codesignFailureStages = [
  'request-validation',
  'provider-status',
  'snapshot-validation',
  'prompt-construction',
  'initialization',
  'thread-start',
  'turn-start',
  'generation',
  'output-validation',
  'candidate-validation',
  'unknown',
] as const;

export type CodesignFailureStage = (typeof codesignFailureStages)[number];

export type CodesignFailureDiagnostic = {
  stage: CodesignFailureStage;
  message: string;
  errorName: string;
  code?: string;
};

const stages = new Set<string>(codesignFailureStages);

function boundedText(value: unknown, fallback: string, max = 4_000) {
  const text = String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '�')
    .trim();
  return (text || fallback).slice(0, max);
}

function rpcStage(method: string | undefined): CodesignFailureStage | undefined {
  if (method === 'initialize') return 'initialization';
  if (method === 'thread/start') return 'thread-start';
  if (method === 'turn/start') return 'turn-start';
  if (method?.startsWith('account/')) return 'provider-status';
  return undefined;
}

/** Extracts bounded, prompt-free transport metadata without replacing the actual error message. */
export function codesignFailureDiagnostic(
  cause: unknown,
  fallbackStage: CodesignFailureStage = 'unknown',
): CodesignFailureDiagnostic {
  const record =
    cause && typeof cause === 'object' ? (cause as Record<string, unknown>) : undefined;
  const method = typeof record?.method === 'string' ? record.method : undefined;
  const declaredStage =
    typeof record?.stage === 'string' && stages.has(record.stage)
      ? (record.stage as CodesignFailureStage)
      : undefined;
  const rawCode = record?.code;
  const message = cause instanceof Error ? cause.message : cause;

  return {
    stage: declaredStage ?? rpcStage(method) ?? fallbackStage,
    message: boundedText(message, 'Unknown Codesign provider failure'),
    errorName: boundedText(cause instanceof Error ? cause.name : typeof cause, 'Error', 120),
    ...(typeof rawCode === 'string' || typeof rawCode === 'number'
      ? { code: boundedText(rawCode, 'unknown', 120) }
      : {}),
  };
}
