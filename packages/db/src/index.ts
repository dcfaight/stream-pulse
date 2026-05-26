import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PoolClient } from 'pg';

import { getDbPool, runQuery } from './client.js';

const MIGRATIONS_TABLE = 'schema_migrations';

export interface SessionRow {
  id: string;
  broadcaster_id: string;
  started_at: Date;
  ended_at: Date | null;
  status: string;
}

export interface MetricEventRow {
  id: string;
  session_id: string;
  ts: Date;
  metric_type: string;
  value: string;
  raw_payload: unknown;
}

export interface SessionStatusRow {
  id: string;
  broadcaster_id: string;
  started_at: Date;
  status: string;
  latest_metric_type: string | null;
  latest_metric_value: string | null;
  latest_metric_ts: Date | null;
  metric_events_count: string;
  latest_qoe_score: string | null;
  latest_qoe_severity: string | null;
  latest_qoe_end_ts: Date | null;
}

export interface ScorableSessionRow {
  id: string;
  latest_metric_ts: Date;
  latest_qoe_end_ts: Date | null;
}

export interface MetricEventSampleRow {
  ts: Date;
  metric_type: string;
  value: string;
}

export interface QoESegmentRow {
  id: string;
  session_id: string;
  start_ts: Date;
  end_ts: Date;
  score: string;
  severity: string;
  signals: unknown;
}

export interface IncidentRow {
  id: string;
  session_id: string;
  started_at: Date;
  resolved_at: Date | null;
  status: string;
  root_cause: string;
  confidence: string;
  severity: string;
  updated_at: Date;
}

export interface IncidentTimelineRow {
  id: string;
  incident_id: string;
  ts: Date;
  event_type: string;
  payload: unknown;
}

export interface IncidentFeedRow extends IncidentRow {
  broadcaster_id: string;
  latest_event_ts: Date | null;
  latest_event_type: string | null;
  latest_event_payload: unknown;
}

export interface RecommendationRow {
  id: string;
  incident_id: string | null;
  agent_name: string;
  created_at: Date;
  recommendation_text: string;
  rationale: string;
  action_type: string;
  priority: string;
  status: string;
  trigger_signals: unknown;
}

export interface RecommendationFeedRow extends RecommendationRow {
  session_id: string | null;
  incident_severity: string | null;
  incident_root_cause: string | null;
  latest_decision: string | null;
  latest_operator_id: string | null;
  latest_decided_at: Date | null;
}

function assertMigrationFile(fileName: string): void {
  if (!/^\d+_.+\.sql$/.test(fileName)) {
    throw new Error(`Invalid migration filename: ${fileName}`);
  }
}

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function getAppliedMigrationIds(client: PoolClient): Promise<Set<string>> {
  const result = await client.query<{ id: string }>(`SELECT id FROM ${MIGRATIONS_TABLE};`);
  return new Set(result.rows.map((row) => row.id));
}

async function loadMigrations(sqlDir: string): Promise<Array<{ id: string; sql: string }>> {
  const files = await readdir(sqlDir);
  const sqlFiles = files.filter((file) => extname(file) === '.sql').sort();
  const migrations: Array<{ id: string; sql: string }> = [];

  for (const file of sqlFiles) {
    assertMigrationFile(file);
    migrations.push({
      id: file.replace(/\.sql$/, ''),
      sql: await readFile(join(sqlDir, file), 'utf8'),
    });
  }

  return migrations;
}

export async function runMigrations(): Promise<{ applied: string[]; skipped: string[] }> {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const migrations = await loadMigrations(currentDir);
  const client = await getDbPool().connect();
  const applied: string[] = [];
  const skipped: string[] = [];

  try {
    await client.query('BEGIN');
    await ensureMigrationsTable(client);
    const alreadyApplied = await getAppliedMigrationIds(client);

    for (const migration of migrations) {
      if (alreadyApplied.has(migration.id)) {
        skipped.push(migration.id);
        continue;
      }

      await client.query(migration.sql);
      await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (id) VALUES ($1);`, [migration.id]);
      applied.push(migration.id);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return { applied, skipped };
}

export async function upsertSession(
  sessionId: string,
  broadcasterId: string,
): Promise<SessionRow> {
  await runQuery(
    `
      INSERT INTO sessions (id, broadcaster_id, status)
      VALUES ($1, $2, 'active')
      ON CONFLICT (id) DO NOTHING;
    `,
    [sessionId, broadcasterId],
  );

  const result = await runQuery<SessionRow>(
    `
      SELECT id, broadcaster_id, started_at, ended_at, status
      FROM sessions
      WHERE id = $1
      LIMIT 1;
    `,
    [sessionId],
  );

  const session = result.rows[0];
  if (!session) {
    throw new Error(`Failed to upsert session ${sessionId}`);
  }

  return session;
}

export async function insertMetricEvent(input: {
  sessionId: string;
  ts: Date;
  metricType: string;
  value: number;
  rawPayload?: unknown;
}): Promise<MetricEventRow> {
  const result = await runQuery<MetricEventRow>(
    `
      INSERT INTO metric_events (session_id, ts, metric_type, value, raw_payload)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, session_id, ts, metric_type, value, raw_payload;
    `,
    [input.sessionId, input.ts, input.metricType, input.value, input.rawPayload ?? null],
  );

  const metricEvent = result.rows[0];
  if (!metricEvent) {
    throw new Error('Failed to create metric event');
  }

  return metricEvent;
}

export async function listRecentSessionStatus(limit = 20): Promise<SessionStatusRow[]> {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 20;
  const result = await runQuery<SessionStatusRow>(
    `
      SELECT
        s.id,
        s.broadcaster_id,
        s.started_at,
        s.status,
        lm.metric_type AS latest_metric_type,
        lm.value::text AS latest_metric_value,
        lm.ts AS latest_metric_ts,
        COUNT(me.id)::text AS metric_events_count,
        lq.score::text AS latest_qoe_score,
        lq.severity AS latest_qoe_severity,
        lq.end_ts AS latest_qoe_end_ts
      FROM sessions s
      LEFT JOIN LATERAL (
        SELECT metric_type, value, ts
        FROM metric_events
        WHERE session_id = s.id
        ORDER BY ts DESC
        LIMIT 1
      ) lm ON TRUE
      LEFT JOIN LATERAL (
        SELECT score, severity, end_ts
        FROM qoe_segments
        WHERE session_id = s.id
        ORDER BY end_ts DESC
        LIMIT 1
      ) lq ON TRUE
      LEFT JOIN metric_events me ON me.session_id = s.id
      GROUP BY
        s.id,
        s.broadcaster_id,
        s.started_at,
        s.status,
        lm.metric_type,
        lm.value,
        lm.ts,
        lq.score,
        lq.severity,
        lq.end_ts
      ORDER BY s.started_at DESC
      LIMIT $1;
    `,
    [safeLimit],
  );

  return result.rows;
}

export async function listScorableSessions(limit = 50): Promise<ScorableSessionRow[]> {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 50;
  const result = await runQuery<ScorableSessionRow>(
    `
      SELECT
        s.id,
        lm.ts AS latest_metric_ts,
        lq.end_ts AS latest_qoe_end_ts
      FROM sessions s
      JOIN LATERAL (
        SELECT ts
        FROM metric_events
        WHERE session_id = s.id
        ORDER BY ts DESC
        LIMIT 1
      ) lm ON TRUE
      LEFT JOIN LATERAL (
        SELECT end_ts
        FROM qoe_segments
        WHERE session_id = s.id
        ORDER BY end_ts DESC
        LIMIT 1
      ) lq ON TRUE
      WHERE lq.end_ts IS NULL OR lm.ts > lq.end_ts
      ORDER BY lm.ts DESC
      LIMIT $1;
    `,
    [safeLimit],
  );

  return result.rows;
}

export async function listMetricEventsSince(
  sessionId: string,
  sinceTs: Date | null,
  limit = 500,
): Promise<MetricEventSampleRow[]> {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(2000, Math.floor(limit))) : 500;
  const result = await runQuery<MetricEventSampleRow>(
    `
      SELECT ts, metric_type, value::text AS value
      FROM metric_events
      WHERE session_id = $1
        AND ($2::timestamptz IS NULL OR ts > $2)
      ORDER BY ts ASC
      LIMIT $3;
    `,
    [sessionId, sinceTs, safeLimit],
  );

  return result.rows;
}

export async function insertQoeSegment(input: {
  sessionId: string;
  startTs: Date;
  endTs: Date;
  score: number;
  severity: string;
  signals: Record<string, number>;
}): Promise<QoESegmentRow> {
  const result = await runQuery<QoESegmentRow>(
    `
      INSERT INTO qoe_segments (session_id, start_ts, end_ts, score, severity, signals)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      RETURNING id, session_id, start_ts, end_ts, score::text AS score, severity, signals;
    `,
    [
      input.sessionId,
      input.startTs,
      input.endTs,
      input.score,
      input.severity,
      JSON.stringify(input.signals),
    ],
  );

  const qoeSegment = result.rows[0];
  if (!qoeSegment) {
    throw new Error('Failed to create QoE segment');
  }

  return qoeSegment;
}

export async function findRecentOpenIncidentForSession(
  sessionId: string,
  withinMinutes = 10,
): Promise<IncidentRow | null> {
  const safeWithinMinutes = Number.isFinite(withinMinutes)
    ? Math.max(1, Math.min(120, Math.floor(withinMinutes)))
    : 10;
  const result = await runQuery<IncidentRow>(
    `
      SELECT id, session_id, started_at, resolved_at, status, root_cause, confidence::text AS confidence, severity, updated_at
      FROM incidents
      WHERE session_id = $1
        AND status = 'open'
        AND updated_at >= now() - ($2 * interval '1 minute')
      ORDER BY updated_at DESC
      LIMIT 1;
    `,
    [sessionId, safeWithinMinutes],
  );

  return result.rows[0] ?? null;
}

export async function createIncident(input: {
  sessionId: string;
  startedAt: Date;
  severity: string;
  rootCause: string;
  confidence: number;
}): Promise<IncidentRow> {
  const result = await runQuery<IncidentRow>(
    `
      INSERT INTO incidents (session_id, started_at, updated_at, severity, root_cause, confidence, status)
      VALUES ($1, $2, $2, $3, $4, $5, 'open')
      RETURNING id, session_id, started_at, resolved_at, status, root_cause, confidence::text AS confidence, severity, updated_at;
    `,
    [input.sessionId, input.startedAt, input.severity, input.rootCause, input.confidence],
  );
  const incident = result.rows[0];
  if (!incident) {
    throw new Error('Failed to create incident');
  }
  return incident;
}

export async function updateIncident(input: {
  incidentId: string;
  updatedAt: Date;
  severity: string;
  rootCause: string;
  confidence: number;
}): Promise<IncidentRow> {
  const result = await runQuery<IncidentRow>(
    `
      UPDATE incidents
      SET severity = $2,
          root_cause = $3,
          confidence = $4,
          updated_at = $5
      WHERE id = $1
      RETURNING id, session_id, started_at, resolved_at, status, root_cause, confidence::text AS confidence, severity, updated_at;
    `,
    [input.incidentId, input.severity, input.rootCause, input.confidence, input.updatedAt],
  );
  const incident = result.rows[0];
  if (!incident) {
    throw new Error(`Failed to update incident ${input.incidentId}`);
  }
  return incident;
}

export async function insertIncidentTimelineEntry(input: {
  incidentId: string;
  ts: Date;
  eventType: string;
  payload: Record<string, unknown>;
}): Promise<IncidentTimelineRow> {
  const result = await runQuery<IncidentTimelineRow>(
    `
      INSERT INTO incident_timeline (incident_id, ts, event_type, payload)
      VALUES ($1, $2, $3, $4::jsonb)
      RETURNING id, incident_id, ts, event_type, payload;
    `,
    [input.incidentId, input.ts, input.eventType, JSON.stringify(input.payload)],
  );

  const timelineEntry = result.rows[0];
  if (!timelineEntry) {
    throw new Error('Failed to create incident timeline entry');
  }
  return timelineEntry;
}

export async function listRecentIncidents(limit = 25): Promise<IncidentFeedRow[]> {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 25;
  const result = await runQuery<IncidentFeedRow>(
    `
      SELECT
        i.id,
        i.session_id,
        i.started_at,
        i.resolved_at,
        i.status,
        i.root_cause,
        i.confidence::text AS confidence,
        i.severity,
        i.updated_at,
        s.broadcaster_id,
        lt.ts AS latest_event_ts,
        lt.event_type AS latest_event_type,
        lt.payload AS latest_event_payload
      FROM incidents i
      JOIN sessions s ON s.id = i.session_id
      LEFT JOIN LATERAL (
        SELECT ts, event_type, payload
        FROM incident_timeline
        WHERE incident_id = i.id
        ORDER BY ts DESC
        LIMIT 1
      ) lt ON TRUE
      ORDER BY i.updated_at DESC
      LIMIT $1;
    `,
    [safeLimit],
  );

  return result.rows;
}

export async function listIncidentsForRecommendation(limit = 25): Promise<IncidentFeedRow[]> {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 25;
  const result = await runQuery<IncidentFeedRow>(
    `
      SELECT
        i.id,
        i.session_id,
        i.started_at,
        i.resolved_at,
        i.status,
        i.root_cause,
        i.confidence::text AS confidence,
        i.severity,
        i.updated_at,
        s.broadcaster_id,
        lt.ts AS latest_event_ts,
        lt.event_type AS latest_event_type,
        lt.payload AS latest_event_payload
      FROM incidents i
      JOIN sessions s ON s.id = i.session_id
      JOIN LATERAL (
        SELECT ts, event_type, payload
        FROM incident_timeline
        WHERE incident_id = i.id
        ORDER BY ts DESC
        LIMIT 1
      ) lt ON TRUE
      WHERE i.status = 'open'
        AND NOT EXISTS (
          SELECT 1
          FROM agent_recommendations pending
          WHERE pending.incident_id = i.id
            AND pending.status = 'pending'
        )
        AND COALESCE((
          SELECT MAX(created_at)
          FROM agent_recommendations rec
          WHERE rec.incident_id = i.id
        ), 'epoch'::timestamptz) < lt.ts
      ORDER BY lt.ts DESC
      LIMIT $1;
    `,
    [safeLimit],
  );

  return result.rows;
}

export async function createRecommendation(input: {
  incidentId: string;
  agentName: string;
  recommendationText: string;
  rationale: string;
  actionType: string;
  priority: string;
  triggerSignals: Record<string, number>;
}): Promise<RecommendationRow> {
  const result = await runQuery<RecommendationRow>(
    `
      INSERT INTO agent_recommendations (
        incident_id,
        agent_name,
        recommendation_text,
        rationale,
        action_type,
        priority,
        status,
        trigger_signals
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7::jsonb)
      RETURNING
        id,
        incident_id,
        agent_name,
        created_at,
        recommendation_text,
        rationale,
        action_type,
        priority,
        status,
        trigger_signals;
    `,
    [
      input.incidentId,
      input.agentName,
      input.recommendationText,
      input.rationale,
      input.actionType,
      input.priority,
      JSON.stringify(input.triggerSignals),
    ],
  );
  const recommendation = result.rows[0];
  if (!recommendation) {
    throw new Error('Failed to create recommendation');
  }
  return recommendation;
}

export async function listRecentRecommendations(limit = 25): Promise<RecommendationFeedRow[]> {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 25;
  const result = await runQuery<RecommendationFeedRow>(
    `
      SELECT
        r.id,
        r.incident_id,
        r.agent_name,
        r.created_at,
        r.recommendation_text,
        r.rationale,
        r.action_type,
        r.priority,
        r.status,
        r.trigger_signals,
        i.session_id,
        i.severity AS incident_severity,
        i.root_cause AS incident_root_cause,
        oa.decision AS latest_decision,
        oa.operator_id AS latest_operator_id,
        oa.decided_at AS latest_decided_at
      FROM agent_recommendations r
      LEFT JOIN incidents i ON i.id = r.incident_id
      LEFT JOIN LATERAL (
        SELECT decision, operator_id, decided_at
        FROM operator_actions
        WHERE recommendation_id = r.id
        ORDER BY decided_at DESC
        LIMIT 1
      ) oa ON TRUE
      ORDER BY r.created_at DESC
      LIMIT $1;
    `,
    [safeLimit],
  );

  return result.rows;
}

export async function decideRecommendation(input: {
  recommendationId: string;
  operatorId: string;
  decision: 'approve' | 'dismiss';
  notes?: string;
}): Promise<{ recommendationId: string; status: string }> {
  const nextStatus = input.decision === 'approve' ? 'approved' : 'dismissed';
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const updateResult = await client.query<{ id: string; status: string }>(
      `
        UPDATE agent_recommendations
        SET status = $2
        WHERE id = $1
          AND status = 'pending'
        RETURNING id, status;
      `,
      [input.recommendationId, nextStatus],
    );
    const recommendation = updateResult.rows[0];
    if (!recommendation) {
      throw new Error('Recommendation is not pending or does not exist');
    }
    await client.query(
      `
        INSERT INTO operator_actions (recommendation_id, operator_id, decision, notes)
        VALUES ($1, $2, $3, $4);
      `,
      [input.recommendationId, input.operatorId, input.decision, input.notes ?? null],
    );
    await client.query('COMMIT');
    return { recommendationId: recommendation.id, status: recommendation.status };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export { getDbPool } from './client.js';
