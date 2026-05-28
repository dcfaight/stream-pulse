import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PoolClient } from 'pg';

import { getDbPool, runQuery } from './client.js';

const MIGRATIONS_TABLE = 'schema_migrations';

export interface SessionRow {
  id: string;
  broadcaster_id: string;
  source_type: string;
  source_label: string | null;
  runtime_label: string | null;
  session_label: string | null;
  metadata: unknown;
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
  source_type: string;
  source_label: string | null;
  runtime_label: string | null;
  session_label: string | null;
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
  resolved_by: string | null;
  resolution_notes: string | null;
  resolution_summary: string | null;
  mitigation_summary: string | null;
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
  recommendation_count: string;
  active_recommendation_count: string;
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
  confidence: string;
  dedupe_key: string | null;
  superseded_by: string | null;
  decided_at: Date | null;
  decided_by: string | null;
  effectiveness_signal: string;
  effectiveness_reason: string | null;
  effectiveness_assessed_at: Date | null;
}

export interface RecommendationFeedRow extends RecommendationRow {
  session_id: string | null;
  incident_status: string | null;
  incident_severity: string | null;
  incident_root_cause: string | null;
  latest_decision: string | null;
  latest_operator_id: string | null;
  latest_decided_at: Date | null;
}

export interface SessionSummaryRow {
  session_id: string;
  incident_count: string;
  open_incident_count: string;
  resolved_incident_count: string;
  recommendation_count: string;
  approved_recommendation_count: string;
  dismissed_recommendation_count: string;
  helpful_recommendation_count: string;
  not_helpful_recommendation_count: string;
  top_root_cause: string | null;
  final_qoe_score: string | null;
  final_qoe_severity: string | null;
  generated_at: Date;
}

export interface SessionReplayTimelineEventRow {
  ts: Date;
  event_type: string;
  source: string;
  session_id: string;
  incident_id: string | null;
  recommendation_id: string | null;
  severity: string | null;
  status: string | null;
  root_cause: string | null;
  confidence: string | null;
  action_type: string | null;
  priority: string | null;
  operator_id: string | null;
  decision: string | null;
  qoe_score: string | null;
  qoe_severity: string | null;
  payload: unknown;
}

function normalizeForDedupe(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 180);
}

export function buildRecommendationDedupeKey(input: {
  incidentId: string;
  actionType: string;
  recommendationText: string;
  rationale: string;
}): string {
  const normalizedText = normalizeForDedupe(input.recommendationText);
  const normalizedRationale = normalizeForDedupe(input.rationale);
  return `${input.incidentId}|${input.actionType}|${normalizedText}|${normalizedRationale}`;
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

export async function upsertSession(input: {
  sessionId: string;
  broadcasterId: string;
  sourceType?: string;
  sourceLabel?: string;
  runtimeLabel?: string;
  sessionLabel?: string;
  metadata?: Record<string, unknown>;
}): Promise<SessionRow> {
  const safeSourceType = input.sourceType?.trim() || 'unknown';
  const safeSourceLabel = input.sourceLabel?.trim() || null;
  const safeRuntimeLabel = input.runtimeLabel?.trim() || null;
  const safeSessionLabel = input.sessionLabel?.trim() || null;
  const safeMetadata = input.metadata ?? {};
  await runQuery(
    `
      INSERT INTO sessions (
        id,
        broadcaster_id,
        source_type,
        source_label,
        runtime_label,
        session_label,
        metadata,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'active')
      ON CONFLICT (id) DO UPDATE
      SET
        broadcaster_id = EXCLUDED.broadcaster_id,
        source_type = COALESCE(NULLIF(EXCLUDED.source_type, ''), sessions.source_type),
        source_label = COALESCE(EXCLUDED.source_label, sessions.source_label),
        runtime_label = COALESCE(EXCLUDED.runtime_label, sessions.runtime_label),
        session_label = COALESCE(EXCLUDED.session_label, sessions.session_label),
        metadata = COALESCE(sessions.metadata, '{}'::jsonb) || COALESCE(EXCLUDED.metadata, '{}'::jsonb);
    `,
    [
      input.sessionId,
      input.broadcasterId,
      safeSourceType,
      safeSourceLabel,
      safeRuntimeLabel,
      safeSessionLabel,
      JSON.stringify(safeMetadata),
    ],
  );

  const result = await runQuery<SessionRow>(
    `
      SELECT
        id,
        broadcaster_id,
        source_type,
        source_label,
        runtime_label,
        session_label,
        metadata,
        started_at,
        ended_at,
        status
      FROM sessions
      WHERE id = $1
      LIMIT 1;
    `,
    [input.sessionId],
  );

  const session = result.rows[0];
  if (!session) {
    throw new Error(`Failed to upsert session ${input.sessionId}`);
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
        s.source_type,
        s.source_label,
        s.runtime_label,
        s.session_label,
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
        s.source_type,
        s.source_label,
        s.runtime_label,
        s.session_label,
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
      SELECT
        id,
        session_id,
        started_at,
        resolved_at,
        status,
        root_cause,
        confidence::text AS confidence,
        severity,
        updated_at,
        resolved_by,
        resolution_notes,
        resolution_summary,
        mitigation_summary
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
      RETURNING
        id,
        session_id,
        started_at,
        resolved_at,
        status,
        root_cause,
        confidence::text AS confidence,
        severity,
        updated_at,
        resolved_by,
        resolution_notes,
        resolution_summary,
        mitigation_summary;
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
      RETURNING
        id,
        session_id,
        started_at,
        resolved_at,
        status,
        root_cause,
        confidence::text AS confidence,
        severity,
        updated_at,
        resolved_by,
        resolution_notes,
        resolution_summary,
        mitigation_summary;
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
        i.resolved_by,
        i.resolution_notes,
        i.resolution_summary,
        i.mitigation_summary,
        s.broadcaster_id,
        lt.ts AS latest_event_ts,
        lt.event_type AS latest_event_type,
        lt.payload AS latest_event_payload,
        COALESCE(rec.total_count, 0)::text AS recommendation_count,
        COALESCE(rec.active_count, 0)::text AS active_recommendation_count
      FROM incidents i
      JOIN sessions s ON s.id = i.session_id
      LEFT JOIN LATERAL (
        SELECT ts, event_type, payload
        FROM incident_timeline
        WHERE incident_id = i.id
        ORDER BY ts DESC
        LIMIT 1
      ) lt ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) AS total_count,
          COUNT(*) FILTER (WHERE status = 'pending') AS active_count
        FROM agent_recommendations
        WHERE incident_id = i.id
      ) rec ON TRUE
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
        i.resolved_by,
        i.resolution_notes,
        i.resolution_summary,
        i.mitigation_summary,
        s.broadcaster_id,
        lt.ts AS latest_event_ts,
        lt.event_type AS latest_event_type,
        lt.payload AS latest_event_payload,
        COALESCE(rec.total_count, 0)::text AS recommendation_count,
        COALESCE(rec.active_count, 0)::text AS active_recommendation_count
      FROM incidents i
      JOIN sessions s ON s.id = i.session_id
      JOIN LATERAL (
        SELECT ts, event_type, payload
        FROM incident_timeline
        WHERE incident_id = i.id
        ORDER BY ts DESC
        LIMIT 1
      ) lt ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) AS total_count,
          COUNT(*) FILTER (WHERE status = 'pending') AS active_count
        FROM agent_recommendations
        WHERE incident_id = i.id
      ) rec ON TRUE
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
  confidence: number;
  triggerSignals: Record<string, number>;
  dedupeKey?: string;
  summary?: {
    oneLineSummary: string;
    whySummary: string;
    confidenceSummary: string;
    incidentLinkageSummary: string;
  };
}): Promise<{ recommendation: RecommendationRow; deduped: boolean; supersededIds: string[] }> {
  const dedupeKey =
    input.dedupeKey ??
    buildRecommendationDedupeKey({
      incidentId: input.incidentId,
      actionType: input.actionType,
      recommendationText: input.recommendationText,
      rationale: input.rationale,
    });

  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');

    const duplicateResult = await client.query<RecommendationRow>(
      `
        SELECT
          id,
          incident_id,
          agent_name,
          created_at,
          recommendation_text,
          rationale,
          action_type,
          priority,
          status,
          trigger_signals,
          confidence::text AS confidence,
          dedupe_key,
          superseded_by,
          decided_at,
          decided_by,
          effectiveness_signal,
          effectiveness_reason,
          effectiveness_assessed_at
        FROM agent_recommendations
        WHERE status = 'pending'
          AND dedupe_key = $1
        ORDER BY created_at DESC
        LIMIT 1;
      `,
      [dedupeKey],
    );
    const duplicate = duplicateResult.rows[0];
    if (duplicate) {
      await client.query(
        `
          INSERT INTO incident_timeline (incident_id, ts, event_type, payload)
          VALUES ($1, now(), 'recommendation_deduped', $2::jsonb);
        `,
        [
          input.incidentId,
          JSON.stringify({
            existingRecommendationId: duplicate.id,
            dedupeKey,
            actionType: duplicate.action_type,
            status: duplicate.status,
          }),
        ],
      );
      await client.query('COMMIT');
      return { recommendation: duplicate, deduped: true, supersededIds: [] };
    }

    const insertResult = await client.query<RecommendationRow>(
      `
        INSERT INTO agent_recommendations (
          incident_id,
          agent_name,
          recommendation_text,
          rationale,
          action_type,
          priority,
          confidence,
          dedupe_key,
          status,
          trigger_signals
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9::jsonb)
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
          trigger_signals,
          confidence::text AS confidence,
          dedupe_key,
          superseded_by,
          decided_at,
          decided_by,
          effectiveness_signal,
          effectiveness_reason,
          effectiveness_assessed_at;
      `,
      [
        input.incidentId,
        input.agentName,
        input.recommendationText,
        input.rationale,
        input.actionType,
        input.priority,
        input.confidence,
        dedupeKey,
        JSON.stringify(input.triggerSignals),
      ],
    );
    const recommendation = insertResult.rows[0];
    if (!recommendation) {
      throw new Error('Failed to create recommendation');
    }

    const supersededResult = await client.query<{ id: string }>(
      `
        UPDATE agent_recommendations
        SET status = 'superseded',
            superseded_by = $1
        WHERE incident_id = $2
          AND action_type = $3
          AND status = 'pending'
          AND id <> $1
        RETURNING id;
      `,
      [recommendation.id, input.incidentId, input.actionType],
    );

    await client.query(
      `
        INSERT INTO incident_timeline (incident_id, ts, event_type, payload)
        VALUES ($1, $2, 'recommendation_created', $3::jsonb);
      `,
      [
        input.incidentId,
        recommendation.created_at,
        JSON.stringify({
          recommendationId: recommendation.id,
          agentName: input.agentName,
          actionType: input.actionType,
          priority: input.priority,
          confidence: input.confidence,
          dedupeKey,
          summary: input.summary ?? null,
        }),
      ],
    );

    for (const supersededId of supersededResult.rows.map((row) => row.id)) {
      await client.query(
        `
          INSERT INTO incident_timeline (incident_id, ts, event_type, payload)
          VALUES ($1, now(), 'recommendation_superseded', $2::jsonb);
        `,
        [
          input.incidentId,
          JSON.stringify({
            supersededRecommendationId: supersededId,
            supersededByRecommendationId: recommendation.id,
            actionType: input.actionType,
          }),
        ],
      );
    }

    await client.query('COMMIT');
    return {
      recommendation,
      deduped: false,
      supersededIds: supersededResult.rows.map((row) => row.id),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function listRecentRecommendations(
  limit = 25,
  sessionId?: string,
): Promise<RecommendationFeedRow[]> {
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
        r.confidence::text AS confidence,
        r.dedupe_key,
        r.superseded_by,
        r.decided_at,
        r.decided_by,
        r.effectiveness_signal,
        r.effectiveness_reason,
        r.effectiveness_assessed_at,
        i.session_id,
        i.status AS incident_status,
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
      WHERE ($2::uuid IS NULL OR i.session_id = $2)
      ORDER BY r.created_at DESC
      LIMIT $1;
    `,
    [safeLimit, sessionId ?? null],
  );

  return result.rows;
}

export async function listSessionIncidents(
  sessionId: string,
  limit = 50,
): Promise<IncidentFeedRow[]> {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 50;
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
        i.resolved_by,
        i.resolution_notes,
        i.resolution_summary,
        i.mitigation_summary,
        s.broadcaster_id,
        lt.ts AS latest_event_ts,
        lt.event_type AS latest_event_type,
        lt.payload AS latest_event_payload,
        COALESCE(rec.total_count, 0)::text AS recommendation_count,
        COALESCE(rec.active_count, 0)::text AS active_recommendation_count
      FROM incidents i
      JOIN sessions s ON s.id = i.session_id
      LEFT JOIN LATERAL (
        SELECT ts, event_type, payload
        FROM incident_timeline
        WHERE incident_id = i.id
        ORDER BY ts DESC
        LIMIT 1
      ) lt ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) AS total_count,
          COUNT(*) FILTER (WHERE status = 'pending') AS active_count
        FROM agent_recommendations
        WHERE incident_id = i.id
      ) rec ON TRUE
      WHERE i.session_id = $1
      ORDER BY i.updated_at DESC
      LIMIT $2;
    `,
    [sessionId, safeLimit],
  );

  return result.rows;
}

export async function listSessionQoeTrend(
  sessionId: string,
  limit = 120,
): Promise<QoESegmentRow[]> {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(400, Math.floor(limit))) : 120;
  const result = await runQuery<QoESegmentRow>(
    `
      SELECT id, session_id, start_ts, end_ts, score::text AS score, severity, signals
      FROM qoe_segments
      WHERE session_id = $1
      ORDER BY end_ts ASC
      LIMIT $2;
    `,
    [sessionId, safeLimit],
  );
  return result.rows;
}

export async function listSessionReplayTimeline(
  sessionId: string,
  limit = 250,
): Promise<SessionReplayTimelineEventRow[]> {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(1000, Math.floor(limit))) : 250;
  const result = await runQuery<SessionReplayTimelineEventRow>(
    `
      WITH session_incidents AS (
        SELECT id, session_id, severity, status, root_cause, confidence::text AS confidence
        FROM incidents
        WHERE session_id = $1
      )
      SELECT
        timeline.ts,
        timeline.event_type,
        timeline.source,
        timeline.session_id,
        timeline.incident_id,
        timeline.recommendation_id,
        timeline.severity,
        timeline.status,
        timeline.root_cause,
        timeline.confidence,
        timeline.action_type,
        timeline.priority,
        timeline.operator_id,
        timeline.decision,
        timeline.qoe_score,
        timeline.qoe_severity,
        timeline.payload
      FROM (
        SELECT
          q.end_ts AS ts,
          'qoe_segment_created'::text AS event_type,
          'qoe'::text AS source,
          q.session_id,
          NULL::uuid AS incident_id,
          NULL::uuid AS recommendation_id,
          q.severity AS severity,
          NULL::text AS status,
          NULL::text AS root_cause,
          NULL::text AS confidence,
          NULL::text AS action_type,
          NULL::text AS priority,
          NULL::text AS operator_id,
          NULL::text AS decision,
          q.score::text AS qoe_score,
          q.severity AS qoe_severity,
          q.signals AS payload
        FROM qoe_segments q
        WHERE q.session_id = $1

        UNION ALL

        SELECT
          t.ts,
          t.event_type,
          'incident_timeline'::text AS source,
          i.session_id,
          t.incident_id,
          NULL::uuid AS recommendation_id,
          i.severity,
          i.status,
          i.root_cause,
          i.confidence,
          NULL::text AS action_type,
          NULL::text AS priority,
          NULL::text AS operator_id,
          NULL::text AS decision,
          NULL::text AS qoe_score,
          NULL::text AS qoe_severity,
          t.payload
        FROM incident_timeline t
        JOIN session_incidents i ON i.id = t.incident_id
        WHERE t.event_type NOT IN ('recommendation_created', 'recommendation_decided')

        UNION ALL

        SELECT
          r.created_at AS ts,
          'recommendation_created'::text AS event_type,
          'recommendation'::text AS source,
          i.session_id,
          r.incident_id,
          r.id AS recommendation_id,
          i.severity,
          r.status,
          i.root_cause,
          r.confidence::text,
          r.action_type,
          r.priority,
          NULL::text AS operator_id,
          NULL::text AS decision,
          NULL::text AS qoe_score,
          NULL::text AS qoe_severity,
          jsonb_build_object(
            'agentName', r.agent_name,
            'recommendationText', r.recommendation_text,
            'rationale', r.rationale,
            'dedupeKey', r.dedupe_key,
            'triggerSignals', r.trigger_signals
          ) AS payload
        FROM agent_recommendations r
        JOIN session_incidents i ON i.id = r.incident_id

        UNION ALL

        SELECT
          oa.decided_at AS ts,
          'recommendation_decided'::text AS event_type,
          'operator_action'::text AS source,
          i.session_id,
          r.incident_id,
          r.id AS recommendation_id,
          i.severity,
          r.status,
          i.root_cause,
          r.confidence::text,
          r.action_type,
          r.priority,
          oa.operator_id,
          oa.decision,
          NULL::text AS qoe_score,
          NULL::text AS qoe_severity,
          jsonb_build_object(
            'decision', oa.decision,
            'notes', oa.notes
          ) AS payload
        FROM operator_actions oa
        JOIN agent_recommendations r ON r.id = oa.recommendation_id
        JOIN session_incidents i ON i.id = r.incident_id
      ) timeline
      ORDER BY timeline.ts ASC
      LIMIT $2;
    `,
    [sessionId, safeLimit],
  );
  return result.rows;
}

function toNumber(value: string | null): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function resolveIncident(input: {
  incidentId: string;
  operatorId: string;
  notes?: string;
  resolvedAt?: Date;
}): Promise<IncidentRow> {
  const resolvedAt = input.resolvedAt ?? new Date();
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const incidentResult = await client.query<IncidentRow>(
      `
        SELECT
          id,
          session_id,
          started_at,
          resolved_at,
          status,
          root_cause,
          confidence::text AS confidence,
          severity,
          updated_at,
          resolved_by,
          resolution_notes,
          resolution_summary,
          mitigation_summary
        FROM incidents
        WHERE id = $1
        LIMIT 1;
      `,
      [input.incidentId],
    );
    const currentIncident = incidentResult.rows[0];
    if (!currentIncident) {
      throw new Error(`Incident ${input.incidentId} does not exist`);
    }
    if (currentIncident.status === 'resolved') {
      await client.query('COMMIT');
      return currentIncident;
    }

    const approvedRecommendationResult = await client.query<{
      id: string;
      action_type: string;
      priority: string;
      recommendation_text: string;
      decided_at: Date | null;
    }>(
      `
        SELECT id, action_type, priority, recommendation_text, decided_at
        FROM agent_recommendations
        WHERE incident_id = $1
          AND status = 'approved'
        ORDER BY COALESCE(decided_at, created_at) DESC
        LIMIT 1;
      `,
      [input.incidentId],
    );
    const approvedRecommendation = approvedRecommendationResult.rows[0];
    const mitigationSummary = approvedRecommendation
      ? `Likely mitigated by approved action ${approvedRecommendation.action_type} (${approvedRecommendation.priority}).`
      : 'Resolved without a linked approved recommendation.';
    const resolutionSummary = `Resolved ${currentIncident.severity} incident for session ${currentIncident.session_id}; final status is stable/closed.`;

    const updateResult = await client.query<IncidentRow>(
      `
        UPDATE incidents
        SET
          status = 'resolved',
          resolved_at = $2,
          updated_at = $2,
          resolved_by = $3,
          resolution_notes = $4,
          resolution_summary = $5,
          mitigation_summary = $6
        WHERE id = $1
        RETURNING
          id,
          session_id,
          started_at,
          resolved_at,
          status,
          root_cause,
          confidence::text AS confidence,
          severity,
          updated_at,
          resolved_by,
          resolution_notes,
          resolution_summary,
          mitigation_summary;
      `,
      [
        input.incidentId,
        resolvedAt,
        input.operatorId,
        input.notes ?? null,
        resolutionSummary,
        mitigationSummary,
      ],
    );
    const incident = updateResult.rows[0];
    if (!incident) {
      throw new Error(`Failed to resolve incident ${input.incidentId}`);
    }

    await client.query(
      `
        INSERT INTO incident_timeline (incident_id, ts, event_type, payload)
        VALUES ($1, $2, 'incident_resolved', $3::jsonb);
      `,
      [
        input.incidentId,
        resolvedAt,
        JSON.stringify({
          resolvedBy: input.operatorId,
          resolutionNotes: input.notes ?? null,
          resolutionSummary,
          mitigationSummary,
          approvedRecommendationId: approvedRecommendation?.id ?? null,
          approvedActionType: approvedRecommendation?.action_type ?? null,
        }),
      ],
    );
    await client.query('COMMIT');
    return incident;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function assessRecommendationEffectivenessForSession(
  sessionId: string,
): Promise<{ assessed: number }> {
  const result = await runQuery<{
    recommendation_id: string;
    recommendation_status: string;
    decided_at: Date | null;
    incident_status: string;
    incident_resolved_at: Date | null;
    pre_score: string | null;
    post_score: string | null;
    post_severity: string | null;
  }>(
    `
      SELECT
        r.id AS recommendation_id,
        r.status AS recommendation_status,
        r.decided_at,
        i.status AS incident_status,
        i.resolved_at AS incident_resolved_at,
        (
          SELECT q.score::text
          FROM qoe_segments q
          WHERE q.session_id = i.session_id
            AND q.end_ts <= COALESCE(r.decided_at, r.created_at)
          ORDER BY q.end_ts DESC
          LIMIT 1
        ) AS pre_score,
        (
          SELECT q.score::text
          FROM qoe_segments q
          WHERE q.session_id = i.session_id
            AND q.end_ts >= COALESCE(r.decided_at, r.created_at)
          ORDER BY q.end_ts ASC
          LIMIT 1
        ) AS post_score,
        (
          SELECT q.severity
          FROM qoe_segments q
          WHERE q.session_id = i.session_id
            AND q.end_ts >= COALESCE(r.decided_at, r.created_at)
          ORDER BY q.end_ts DESC
          LIMIT 1
        ) AS post_severity
      FROM agent_recommendations r
      JOIN incidents i ON i.id = r.incident_id
      WHERE i.session_id = $1
        AND r.status IN ('approved', 'dismissed');
    `,
    [sessionId],
  );

  let assessed = 0;
  for (const row of result.rows) {
    let signal: 'unknown' | 'helpful' | 'not_helpful' | 'unconfirmed' = 'unknown';
    let reason = 'No deterministic effectiveness evidence yet.';
    const preScore = toNumber(row.pre_score);
    const postScore = toNumber(row.post_score);
    const deltaScore =
      typeof preScore === 'number' && typeof postScore === 'number' ? postScore - preScore : null;

    if (row.recommendation_status !== 'approved') {
      signal = 'unconfirmed';
      reason = 'Recommendation was not approved, so mitigation impact is not attributable.';
    } else if (
      row.incident_status === 'resolved' &&
      row.decided_at &&
      row.incident_resolved_at &&
      row.incident_resolved_at >= row.decided_at
    ) {
      signal = 'helpful';
      reason = 'Incident resolved after recommendation approval.';
    } else if (typeof deltaScore === 'number' && deltaScore >= 8) {
      signal = 'helpful';
      reason = `QoE improved by ${Math.round(deltaScore)} points after approval.`;
    } else if (typeof deltaScore === 'number' && deltaScore <= -5) {
      signal = 'not_helpful';
      reason = `QoE declined by ${Math.round(Math.abs(deltaScore))} points after approval.`;
    } else if (
      row.recommendation_status === 'approved' &&
      row.incident_status === 'open' &&
      row.post_severity &&
      (row.post_severity === 'poor' || row.post_severity === 'critical')
    ) {
      signal = 'not_helpful';
      reason = `Incident remains ${row.post_severity} after recommendation approval.`;
    } else if (typeof postScore === 'number') {
      signal = 'unconfirmed';
      reason = 'Post-action telemetry available but improvement is inconclusive.';
    }

    await runQuery(
      `
        UPDATE agent_recommendations
        SET effectiveness_signal = $2,
            effectiveness_reason = $3,
            effectiveness_assessed_at = now()
        WHERE id = $1;
      `,
      [row.recommendation_id, signal, reason],
    );
    assessed += 1;
  }

  return { assessed };
}

export async function getSessionSummary(sessionId: string): Promise<SessionSummaryRow | null> {
  const result = await runQuery<SessionSummaryRow>(
    `
      SELECT
        $1::uuid AS session_id,
        COALESCE(inc.incident_count, 0)::text AS incident_count,
        COALESCE(inc.open_incident_count, 0)::text AS open_incident_count,
        COALESCE(inc.resolved_incident_count, 0)::text AS resolved_incident_count,
        COALESCE(rec.recommendation_count, 0)::text AS recommendation_count,
        COALESCE(rec.approved_recommendation_count, 0)::text AS approved_recommendation_count,
        COALESCE(rec.dismissed_recommendation_count, 0)::text AS dismissed_recommendation_count,
        COALESCE(rec.helpful_recommendation_count, 0)::text AS helpful_recommendation_count,
        COALESCE(rec.not_helpful_recommendation_count, 0)::text AS not_helpful_recommendation_count,
        root.top_root_cause,
        qoe.final_qoe_score,
        qoe.final_qoe_severity,
        now() AS generated_at
      FROM (SELECT 1) anchor
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) AS incident_count,
          COUNT(*) FILTER (WHERE status = 'open') AS open_incident_count,
          COUNT(*) FILTER (WHERE status = 'resolved') AS resolved_incident_count
        FROM incidents
        WHERE session_id = $1
      ) inc ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) AS recommendation_count,
          COUNT(*) FILTER (WHERE status = 'approved') AS approved_recommendation_count,
          COUNT(*) FILTER (WHERE status = 'dismissed') AS dismissed_recommendation_count,
          COUNT(*) FILTER (WHERE effectiveness_signal = 'helpful') AS helpful_recommendation_count,
          COUNT(*) FILTER (WHERE effectiveness_signal = 'not_helpful') AS not_helpful_recommendation_count
        FROM agent_recommendations r
        JOIN incidents i ON i.id = r.incident_id
        WHERE i.session_id = $1
      ) rec ON TRUE
      LEFT JOIN LATERAL (
        SELECT root_cause AS top_root_cause
        FROM incidents
        WHERE session_id = $1
          AND root_cause <> ''
        GROUP BY root_cause
        ORDER BY COUNT(*) DESC, MAX(updated_at) DESC
        LIMIT 1
      ) root ON TRUE
      LEFT JOIN LATERAL (
        SELECT score::text AS final_qoe_score, severity AS final_qoe_severity
        FROM qoe_segments
        WHERE session_id = $1
        ORDER BY end_ts DESC
        LIMIT 1
      ) qoe ON TRUE;
    `,
    [sessionId],
  );
  return result.rows[0] ?? null;
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
    const updateResult = await client.query<{
      id: string;
      status: string;
      incident_id: string | null;
      action_type: string;
      priority: string;
      confidence: string;
    }>(
      `
        UPDATE agent_recommendations
        SET status = $2,
            decided_at = now(),
            decided_by = $3,
            effectiveness_signal = CASE WHEN $2 = 'approved' THEN 'unknown' ELSE 'unconfirmed' END,
            effectiveness_reason = CASE
              WHEN $2 = 'approved' THEN 'Awaiting follow-up telemetry after operator approval.'
              ELSE 'Recommendation was dismissed by operator.'
            END,
            effectiveness_assessed_at = now()
        WHERE id = $1
          AND status = 'pending'
        RETURNING id, status, incident_id, action_type, priority, confidence::text AS confidence;
      `,
      [input.recommendationId, nextStatus, input.operatorId],
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
    if (recommendation.incident_id) {
      await client.query(
        `
          INSERT INTO incident_timeline (incident_id, ts, event_type, payload)
          VALUES ($1, now(), 'recommendation_decided', $2::jsonb);
        `,
        [
          recommendation.incident_id,
          JSON.stringify({
            recommendationId: recommendation.id,
            decision: input.decision,
            nextStatus,
            operatorId: input.operatorId,
            actionType: recommendation.action_type,
            priority: recommendation.priority,
            confidence: Number(recommendation.confidence),
            notes: input.notes ?? null,
          }),
        ],
      );
    }
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
