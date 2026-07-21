import type {
  Bounds,
  CodesignAction,
  DesignDocument,
  DesignOperation,
  Fidelity,
  GenerationTarget,
} from '$lib/model/types';

export const CANVAS_TOOL_NAMES = [
  'scene.overview',
  'scene.get_nodes',
  'scene.render',
  'components.search',
  'components.describe',
  'candidate.get_state',
  'candidate.apply_changes',
  'candidate.validate',
  'candidate.submit',
] as const;

export type CanvasToolName = (typeof CANVAS_TOOL_NAMES)[number];
export type CanvasSessionState = 'active' | 'submitted' | 'cancelled' | 'expired';

export type CanvasSessionCreateInput = {
  document: DesignDocument;
  target: GenerationTarget;
  pinnedNodeIds?: string[];
  pinnedChangeIds?: string[];
  requestedFidelity: Fidelity;
  action: CodesignAction;
  model?: string;
  backend?: string;
  ttlMs?: number;
};

export type CanvasSessionHandle = {
  id: string;
  state: CanvasSessionState;
  sourceRevisionId: string;
  candidateRevisionId: string;
  expiresAt: number;
};

export type CandidateChangeInput = {
  operation: DesignOperation;
  dependencyIds?: string[];
  evidenceNodeIds: string[];
  summary: string;
};

export type CandidateApplyInput = {
  /** Revision observed by the caller before constructing this mutation batch. */
  candidateRevisionId: string;
  changes: CandidateChangeInput[];
};

export type SessionDiagnostic = {
  code: string;
  message: string;
  path?: string;
  nodeIds?: string[];
  repair?: string;
};

export type CanvasOperationalTrace = {
  sequence: number;
  timestamp: number;
  durationMs: number;
  tool: CanvasToolName | 'session.create' | 'session.cancel' | 'session.cleanup';
  sourceRevisionId: string;
  candidateRevisionId: string;
  argumentSummary: Record<string, string | number | boolean | string[]>;
  resultSummary: Record<string, string | number | boolean | string[]>;
  evidenceNodeIds: string[];
  componentIds: string[];
  renderHash?: string;
};

export type SessionRender = {
  id: string;
  path: string;
  mimeType: 'image/png';
  width: number;
  height: number;
  sha256: string;
  view: 'source' | 'candidate';
  bounds: Bounds;
};

export class CanvasSessionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly diagnostics: SessionDiagnostic[] = [{ code, message }],
  ) {
    super(message);
    this.name = 'CanvasSessionError';
  }
}

export interface CanvasSessionService {
  createSession(input: CanvasSessionCreateInput): Promise<CanvasSessionHandle>;
  dispatch(sessionId: string, toolName: CanvasToolName, args: unknown): Promise<unknown>;
  cancelSession(id: string): Promise<boolean>;
  cleanupExpired(): Promise<number>;
  dispose(): Promise<void>;
}
