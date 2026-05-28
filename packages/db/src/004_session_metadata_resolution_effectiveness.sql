-- StreamPulse — Session metadata, incident resolution, recommendation effectiveness
-- Migration: 004_session_metadata_resolution_effectiveness

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS source_label TEXT,
  ADD COLUMN IF NOT EXISTS runtime_label TEXT,
  ADD COLUMN IF NOT EXISTS session_label TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS sessions_source_type_started_idx
  ON sessions(source_type, started_at DESC);

ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS resolved_by TEXT,
  ADD COLUMN IF NOT EXISTS resolution_notes TEXT,
  ADD COLUMN IF NOT EXISTS resolution_summary TEXT,
  ADD COLUMN IF NOT EXISTS mitigation_summary TEXT;

CREATE INDEX IF NOT EXISTS incidents_status_updated_idx
  ON incidents(status, updated_at DESC);

ALTER TABLE agent_recommendations
  ADD COLUMN IF NOT EXISTS effectiveness_signal TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS effectiveness_reason TEXT,
  ADD COLUMN IF NOT EXISTS effectiveness_assessed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS agent_recommendations_effectiveness_idx
  ON agent_recommendations(effectiveness_signal, created_at DESC);
