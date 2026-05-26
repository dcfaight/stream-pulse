import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

import { insertMetricEvent, upsertSession } from '@stream-pulse/db';
import type { MetricType, StatSnapshot } from '@stream-pulse/types';

interface TelemetryRequestBody {
  sessionId?: string;
  broadcasterId?: string;
  metricType?: MetricType;
  value?: number;
  ts?: number;
  rawPayload?: Partial<StatSnapshot>;
}

interface ValidTelemetryRequestBody extends TelemetryRequestBody {
  metricType: MetricType;
  value: number;
}

const port = Number(process.env.INGESTOR_PORT ?? 4001);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(payload));
}

async function parseJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

function validateBody(body: unknown): ValidTelemetryRequestBody {
  if (!body || typeof body !== 'object') {
    throw new Error('JSON body is required');
  }

  const candidate = body as TelemetryRequestBody;
  if (!candidate.metricType) throw new Error('metricType is required');
  if (typeof candidate.value !== 'number' || Number.isNaN(candidate.value)) {
    throw new Error('value must be a number');
  }

  return candidate as ValidTelemetryRequestBody;
}

const server = createServer(async (request, response) => {
  if (!request.url || !request.method) {
    sendJson(response, 400, { error: 'Invalid request' });
    return;
  }

  if (request.method === 'GET' && request.url === '/health') {
    sendJson(response, 200, { status: 'ok', service: 'ingestor' });
    return;
  }

  if (request.method === 'POST' && request.url === '/telemetry') {
    try {
      const body = validateBody(await parseJsonBody(request));

      if (body.sessionId && !UUID_PATTERN.test(body.sessionId)) {
        sendJson(response, 400, { error: 'sessionId must be a UUID when provided' });
        return;
      }

      const sessionId = body.sessionId ?? randomUUID();
      const broadcasterId = body.broadcasterId?.trim() || 'synthetic-broadcaster';
      const eventTimestamp = new Date(body.ts ?? Date.now());

      await upsertSession(sessionId, broadcasterId);
      const metricEvent = await insertMetricEvent({
        sessionId,
        ts: eventTimestamp,
        metricType: body.metricType,
        value: body.value,
        rawPayload: body.rawPayload,
      });

      sendJson(response, 201, {
        sessionId,
        eventId: metricEvent.id,
        metricType: metricEvent.metric_type,
        value: Number(metricEvent.value),
        ts: metricEvent.ts.toISOString(),
      });
      return;
    } catch (error) {
      if (error instanceof SyntaxError) {
        sendJson(response, 400, { error: 'Request body must be valid JSON' });
        return;
      }

      const message = error instanceof Error ? error.message : 'Unexpected ingest error';
      sendJson(response, 400, { error: message });
      return;
    }
  }

  sendJson(response, 404, { error: 'Not found' });
});

server.listen(port, () => {
  console.log(`StreamPulse ingestor listening on http://localhost:${port}`);
});
