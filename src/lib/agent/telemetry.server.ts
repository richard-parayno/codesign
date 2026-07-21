import { randomUUID } from 'node:crypto';
import type {
  CodesignTelemetryEvent,
  CodesignTelemetryPhase,
  CodesignToolActivity,
  CodesignTokenUsage,
} from './telemetry';
import type { CodesignFailureDiagnostic } from './failure';
import type { ProviderFailureCategory } from './providers/contracts';

type TelemetryDraft = {
  phase: CodesignTelemetryPhase;
  message: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  promptVersion?: string;
  contextNodeCount?: number;
  promptCharacters?: number;
  outputCharacters?: number;
  durationMs?: number;
  usage?: CodesignTokenUsage;
  renderedPrompt?: string;
  toolActivity?: CodesignToolActivity;
  failure?: CodesignFailureDiagnostic & { category: ProviderFailureCategory };
};

type Channel = {
  events: CodesignTelemetryEvent[];
  listeners: Set<(event: CodesignTelemetryEvent) => void>;
  touchedAt: number;
};

const channels = new Map<string, Channel>();
const REQUEST_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/;
const MAX_CHANNELS = 100;
const MAX_EVENTS = 64;
const CHANNEL_TTL_MS = 10 * 60_000;

export function isTelemetryRequestId(value: string | null | undefined): value is string {
  return Boolean(value && REQUEST_ID.test(value));
}

export function telemetryRequestId(value: string | null | undefined) {
  return isTelemetryRequestId(value) ? value : `codesign-${randomUUID()}`;
}

function pruneChannels(now: number) {
  for (const [requestId, channel] of channels) {
    if (!channel.listeners.size && now - channel.touchedAt > CHANNEL_TTL_MS)
      channels.delete(requestId);
  }
  if (channels.size <= MAX_CHANNELS) return;
  const removable = [...channels.entries()]
    .filter(([, channel]) => !channel.listeners.size)
    .sort((left, right) => left[1].touchedAt - right[1].touchedAt);
  for (const [requestId] of removable.slice(0, channels.size - MAX_CHANNELS))
    channels.delete(requestId);
}

function channelFor(requestId: string) {
  const now = Date.now();
  pruneChannels(now);
  const channel = channels.get(requestId) ?? {
    events: [],
    listeners: new Set<(event: CodesignTelemetryEvent) => void>(),
    touchedAt: now,
  };
  channel.touchedAt = now;
  channels.set(requestId, channel);
  return channel;
}

export function publishCodesignTelemetry(requestId: string, draft: TelemetryDraft) {
  const channel = channelFor(requestId);
  const event: CodesignTelemetryEvent = {
    requestId,
    sequence: channel.events.length ? channel.events[channel.events.length - 1].sequence + 1 : 0,
    timestamp: Date.now(),
    ...draft,
  };
  channel.events.push(event);
  if (channel.events.length > MAX_EVENTS)
    channel.events.splice(0, channel.events.length - MAX_EVENTS);
  channel.touchedAt = event.timestamp;

  // The rendered prompt is inspectable in the originating editor, but is not duplicated to logs.
  const { renderedPrompt: _renderedPrompt, toolActivity, ...loggableEvent } = event;
  const loggableToolActivity = toolActivity
    ? {
        ...toolActivity,
        arguments: undefined,
        result: undefined,
      }
    : undefined;
  console.info(`[codesign:ai] ${JSON.stringify(loggableEvent)}`);
  if (loggableToolActivity)
    console.info(`[codesign:ai:tool] ${JSON.stringify({ requestId, ...loggableToolActivity })}`);
  for (const listener of channel.listeners) {
    try {
      listener(event);
    } catch {
      // A disconnected browser subscriber must not affect generation.
    }
  }
  return event;
}

export function subscribeCodesignTelemetry(
  requestId: string,
  listener: (event: CodesignTelemetryEvent) => void,
) {
  const channel = channelFor(requestId);
  for (const event of channel.events) listener(event);
  channel.listeners.add(listener);
  return () => channel.listeners.delete(listener);
}

export function latestCodesignTelemetry(requestId: string) {
  return channels.get(requestId)?.events.at(-1);
}
