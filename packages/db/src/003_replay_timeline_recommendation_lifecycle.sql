-- StreamPulse — Replay timeline + recommendation lifecycle enhancements
-- Migration: 003_replay_timeline_recommendation_lifecycle

ALTER TABLE agent_recommendations
  ADD COLUMN IF NOT EXISTS confidence NUMERIC NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT,
  ADD COLUMN IF NOT EXISTS superseded_by UUID REFERENCES agent_recommendations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decided_by TEXT;

CREATE INDEX IF NOT EXISTS agent_recommendations_status_created_idx
  ON agent_recommendations(status, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_recommendations_incident_status_created_idx
  ON agent_recommendations(incident_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS agent_recommendations_pending_dedupe_idx
  ON agent_recommendations(dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status = 'pending';

CREATE INDEX IF NOT EXISTS incident_timeline_session_event_idx
  ON incident_timeline(ts DESC, event_type);
