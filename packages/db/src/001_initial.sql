-- StreamPulse — Initial Schema
-- Migration: 001_initial
-- Run with: pnpm --filter @stream-pulse/db migrate

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS sessions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    broadcaster_id TEXT NOT NULL,
    started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at    TIMESTAMPTZ,
    status      TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS metric_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    ts          TIMESTAMPTZ NOT NULL,
    metric_type TEXT NOT NULL,
    value       NUMERIC NOT NULL,
    raw_payload JSONB
);

CREATE INDEX IF NOT EXISTS metric_events_session_ts ON metric_events(session_id, ts DESC);

CREATE TABLE IF NOT EXISTS qoe_segments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    start_ts    TIMESTAMPTZ NOT NULL,
    end_ts      TIMESTAMPTZ NOT NULL,
    score       NUMERIC NOT NULL,
    severity    TEXT NOT NULL,
    signals     JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS qoe_segments_session ON qoe_segments(session_id, start_ts DESC);

CREATE TABLE IF NOT EXISTS incidents (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    started_at  TIMESTAMPTZ NOT NULL,
    resolved_at TIMESTAMPTZ,
    root_cause  TEXT NOT NULL DEFAULT '',
    confidence  NUMERIC NOT NULL DEFAULT 0,
    severity    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS incident_timeline (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    ts          TIMESTAMPTZ NOT NULL,
    event_type  TEXT NOT NULL,
    payload     JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS incident_timeline_incident ON incident_timeline(incident_id, ts ASC);

CREATE TABLE IF NOT EXISTS agent_recommendations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID REFERENCES incidents(id) ON DELETE SET NULL,
    agent_name  TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    rationale   TEXT NOT NULL,
    action_type TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    trigger_signals JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS operator_actions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recommendation_id   UUID NOT NULL REFERENCES agent_recommendations(id) ON DELETE CASCADE,
    operator_id         TEXT NOT NULL,
    decided_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    decision            TEXT NOT NULL,
    notes               TEXT
);
