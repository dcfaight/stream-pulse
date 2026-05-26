-- StreamPulse — Incident + Recommendation MVP schema updates
-- Migration: 002_incident_recommendation_mvp

ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS incidents_session_status_started_idx
  ON incidents(session_id, status, started_at DESC);

ALTER TABLE agent_recommendations
  ADD COLUMN IF NOT EXISTS recommendation_text TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'medium';

CREATE INDEX IF NOT EXISTS agent_recommendations_incident_created_idx
  ON agent_recommendations(incident_id, created_at DESC);

CREATE INDEX IF NOT EXISTS operator_actions_recommendation_decided_idx
  ON operator_actions(recommendation_id, decided_at DESC);
