-- StreamPulse — Media realism + reporting intelligence indexes
-- Migration: 005_media_reporting_intelligence_indexes

CREATE INDEX IF NOT EXISTS metric_events_session_role_direction_ts_idx
  ON metric_events(
    session_id,
    COALESCE(NULLIF(raw_payload->>'sourceRole', ''), 'unknown'),
    COALESCE(NULLIF(raw_payload->>'streamDirection', ''), 'unknown'),
    ts DESC
  );

CREATE INDEX IF NOT EXISTS metric_events_session_candidate_ts_idx
  ON metric_events(session_id, ts DESC)
  WHERE raw_payload ? 'candidatePairState'
     OR raw_payload ? 'localCandidateType'
     OR raw_payload ? 'remoteCandidateType';
