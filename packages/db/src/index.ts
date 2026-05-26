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
        COUNT(me.id)::text AS metric_events_count
      FROM sessions s
      LEFT JOIN LATERAL (
        SELECT metric_type, value, ts
        FROM metric_events
        WHERE session_id = s.id
        ORDER BY ts DESC
        LIMIT 1
      ) lm ON TRUE
      LEFT JOIN metric_events me ON me.session_id = s.id
      GROUP BY s.id, s.broadcaster_id, s.started_at, s.status, lm.metric_type, lm.value, lm.ts
      ORDER BY s.started_at DESC
      LIMIT $1;
    `,
    [safeLimit],
  );

  return result.rows;
}

export { getDbPool } from './client.js';
