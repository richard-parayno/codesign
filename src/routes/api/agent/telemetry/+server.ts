import { error } from '@sveltejs/kit';
import { isTerminalTelemetryPhase } from '$lib/agent/telemetry';
import { isTelemetryRequestId, subscribeCodesignTelemetry } from '$lib/agent/telemetry.server';

export function GET({ url, request }) {
  const requestId = url.searchParams.get('requestId');
  if (!isTelemetryRequestId(requestId)) throw error(400, 'Invalid Codesign telemetry request ID');

  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let subscribing = true;
      let terminalDuringSubscribe = false;
      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe();
        controller.close();
      };
      const send = (event: Parameters<typeof JSON.stringify>[0]) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      unsubscribe = subscribeCodesignTelemetry(requestId, (event) => {
        send(event);
        if (isTerminalTelemetryPhase(event.phase)) {
          if (subscribing) terminalDuringSubscribe = true;
          else close();
        }
      });
      subscribing = false;
      if (terminalDuringSubscribe) {
        close();
        return;
      }
      heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(': keep-alive\n\n'));
      }, 15_000);
      request.signal.addEventListener('abort', close, { once: true });
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
