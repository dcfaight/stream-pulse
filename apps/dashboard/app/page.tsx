import {
  decideRecommendation,
  resolveIncident,
  type IncidentFeedRow,
  listRecentIncidents,
  type RecommendationFeedRow,
  listRecentRecommendations,
  listRecentSessionStatus,
} from '@stream-pulse/db';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { AutoRefresh } from './auto-refresh';

export const dynamic = 'force-dynamic';

function formatTimestamp(value: Date | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value);
}

function severityStyle(severity: string | null): { backgroundColor: string; color: string } {
  if (severity === 'good') return { backgroundColor: '#e7f8ed', color: '#166534' };
  if (severity === 'degraded') return { backgroundColor: '#fff8db', color: '#854d0e' };
  if (severity === 'poor') return { backgroundColor: '#ffe7d6', color: '#9a3412' };
  if (severity === 'critical') return { backgroundColor: '#fee2e2', color: '#991b1b' };
  return { backgroundColor: '#f3f4f6', color: '#374151' };
}

function statusStyle(status: string | null): { backgroundColor: string; color: string } {
  if (status === 'pending') return { backgroundColor: '#fff8db', color: '#854d0e' };
  if (status === 'approved') return { backgroundColor: '#e7f8ed', color: '#166534' };
  if (status === 'dismissed') return { backgroundColor: '#fee2e2', color: '#991b1b' };
  if (status === 'superseded') return { backgroundColor: '#f3f4f6', color: '#4b5563' };
  if (status === 'open') return { backgroundColor: '#ffe7d6', color: '#9a3412' };
  return { backgroundColor: '#f3f4f6', color: '#374151' };
}

function effectivenessStyle(
  status: string | null,
): { backgroundColor: string; color: string } {
  if (status === 'helpful') return { backgroundColor: '#e7f8ed', color: '#166534' };
  if (status === 'not_helpful') return { backgroundColor: '#fee2e2', color: '#991b1b' };
  if (status === 'unconfirmed') return { backgroundColor: '#fff8db', color: '#854d0e' };
  return { backgroundColor: '#f3f4f6', color: '#374151' };
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function buildIncidentOperatorSummary(incident: IncidentFeedRow): {
  oneLine: string;
  rootCause: string;
  supportingSignals: string;
} {
  const payload = asObject(incident.latest_event_payload);
  const oneLine =
    typeof payload?.oneLineSummary === 'string'
      ? payload.oneLineSummary
      : typeof payload?.resolutionSummary === 'string'
        ? payload.resolutionSummary
      : `Incident ${incident.severity} for session ${incident.session_id}.`;
  const rootCause =
    typeof payload?.rootCauseSummary === 'string'
      ? payload.rootCauseSummary
      : typeof payload?.rootCauseHypothesis === 'string'
        ? payload.rootCauseHypothesis
      : incident.root_cause || 'generalized stream degradation';
  const supportingSignals =
    typeof payload?.supportingSignalsSummary === 'string'
      ? payload.supportingSignalsSummary
      : typeof payload?.mitigationSummary === 'string'
        ? payload.mitigationSummary
      : 'No signal summary available.';

  return { oneLine, rootCause, supportingSignals };
}

function buildRecommendationOperatorSummary(recommendation: RecommendationFeedRow): string {
  const confidence = `${(Number(recommendation.confidence) * 100).toFixed(0)}% confidence`;
  const severity = recommendation.incident_severity ?? 'unknown-severity';
  const linkage = recommendation.incident_id
    ? `Linked to incident ${recommendation.incident_id}.`
    : 'No linked incident.';
  return `${recommendation.action_type} (${recommendation.priority}) for ${severity} incident. ${confidence}. ${linkage}`;
}

async function approveRecommendation(formData: FormData): Promise<void> {
  'use server';

  const recommendationId = String(formData.get('recommendationId') ?? '');
  if (!recommendationId) return;

  await decideRecommendation({
    recommendationId,
    operatorId: 'local-operator',
    decision: 'approve',
    notes: 'Approved from dashboard',
  });
  revalidatePath('/');
}

async function dismissRecommendation(formData: FormData): Promise<void> {
  'use server';

  const recommendationId = String(formData.get('recommendationId') ?? '');
  if (!recommendationId) return;

  await decideRecommendation({
    recommendationId,
    operatorId: 'local-operator',
    decision: 'dismiss',
    notes: 'Dismissed from dashboard',
  });
  revalidatePath('/');
}

async function resolveIncidentAction(formData: FormData): Promise<void> {
  'use server';

  const incidentId = String(formData.get('incidentId') ?? '');
  if (!incidentId) return;

  const notes = String(formData.get('resolutionNotes') ?? '').trim();
  await resolveIncident({
    incidentId,
    operatorId: 'local-operator',
    notes: notes || 'Resolved from dashboard',
  });
  revalidatePath('/');
}

export default async function Home() {
  const sessions = await listRecentSessionStatus(25).catch(() => []);
  const incidents = await listRecentIncidents(25).catch(() => []);
  const recommendations = await listRecentRecommendations(25).catch(() => []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', margin: '2rem auto', maxWidth: 980 }}>
      <AutoRefresh intervalMs={5000} />
      <h1>StreamPulse Status</h1>
      <p>
        Session QoE, incidents, and recommendation lifecycle view. Open a session timeline for replay and
        audit details. Refreshes every 5 seconds. Use the{' '}
        <Link href="/demo/webrtc">WebRTC demo page</Link> to ingest real browser getStats telemetry.
      </p>

      <h2>Recent Sessions ({sessions.length})</h2>
      {sessions.length === 0 ? (
        <p>No sessions found yet. Send telemetry to the ingestor to populate this page.</p>
      ) : (
        <table
          style={{
            borderCollapse: 'collapse',
            width: '100%',
            border: '1px solid #ddd',
          }}
        >
          <thead>
            <tr>
              {[
                'Session ID',
                'Broadcaster',
                'Source',
                'Session Label',
                'Status',
                'Started',
                'Event Count',
                'Latest Metric',
                'Latest Value',
                'Latest Event Time',
                'QoE Score',
                'QoE Severity',
                'QoE Updated',
                'Replay',
              ].map((heading) => (
                <th
                  key={heading}
                  style={{ border: '1px solid #ddd', padding: '0.5rem', textAlign: 'left' }}
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id}>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  <code>{session.id}</code>
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {session.broadcaster_id}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {session.source_type}
                  {session.source_label ? ` (${session.source_label})` : ''}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {session.session_label ?? '—'}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{session.status}</td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {formatTimestamp(session.started_at)}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {session.metric_events_count}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {session.latest_metric_type ?? '—'}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {session.latest_metric_value ?? '—'}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {formatTimestamp(session.latest_metric_ts)}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {session.latest_qoe_score ?? '—'}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {session.latest_qoe_severity ? (
                    <span
                      style={{
                        ...severityStyle(session.latest_qoe_severity),
                        borderRadius: '999px',
                        display: 'inline-block',
                        fontWeight: 600,
                        padding: '0.15rem 0.5rem',
                        textTransform: 'capitalize',
                      }}
                    >
                      {session.latest_qoe_severity}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {formatTimestamp(session.latest_qoe_end_ts)}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  <Link href={`/sessions/${session.id}`}>Open Timeline</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ marginTop: '2rem' }}>Incident Feed ({incidents.length})</h2>
      {incidents.length === 0 ? (
        <p>No incidents yet. Run a degraded simulator scenario to trigger deterministic detection.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%', border: '1px solid #ddd' }}>
          <thead>
            <tr>
              {[
                'Incident ID',
                'Session ID',
                'Broadcaster',
                'Severity',
                'Status',
                'Root Cause Hypothesis',
                'Confidence',
                'Recommendations',
                'Summary',
                'Root Cause Summary',
                'Supporting Signals',
                'Resolution',
                'Started',
                'Updated',
                'Action',
              ].map((heading) => (
                <th
                  key={heading}
                  style={{ border: '1px solid #ddd', padding: '0.5rem', textAlign: 'left' }}
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {incidents.map((incident) => {
              const summary = buildIncidentOperatorSummary(incident);
              return (
                <tr key={incident.id}>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  <code>{incident.id}</code>
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  <code>{incident.session_id}</code>
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {incident.broadcaster_id}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  <span
                    style={{
                      ...severityStyle(incident.severity),
                      borderRadius: '999px',
                      display: 'inline-block',
                      fontWeight: 600,
                      padding: '0.15rem 0.5rem',
                      textTransform: 'capitalize',
                    }}
                  >
                    {incident.severity}
                  </span>
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  <span
                    style={{
                      ...statusStyle(incident.status),
                      borderRadius: '999px',
                      display: 'inline-block',
                      fontWeight: 600,
                      padding: '0.15rem 0.5rem',
                      textTransform: 'capitalize',
                    }}
                  >
                    {incident.status}
                  </span>
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {incident.root_cause || '—'}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {(Number(incident.confidence) * 100).toFixed(0)}%
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {incident.active_recommendation_count} active / {incident.recommendation_count} total
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{summary.oneLine}</td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{summary.rootCause}</td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{summary.supportingSignals}</td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {incident.status === 'resolved'
                    ? incident.resolution_summary || 'Resolved'
                    : '—'}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {formatTimestamp(incident.started_at)}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {formatTimestamp(incident.updated_at)}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {incident.status === 'open' ? (
                    <form action={resolveIncidentAction} style={{ display: 'grid', gap: '0.35rem' }}>
                      <input type="hidden" name="incidentId" value={incident.id} />
                      <input
                        type="text"
                        name="resolutionNotes"
                        placeholder="Resolution notes"
                        style={{ width: 180 }}
                      />
                      <button type="submit">Mark Resolved</button>
                    </form>
                  ) : (
                    <>
                      {incident.resolved_by ?? 'operator'} at {formatTimestamp(incident.resolved_at)}
                    </>
                  )}
                </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h2 style={{ marginTop: '2rem' }}>Recommendations ({recommendations.length})</h2>
      {recommendations.length === 0 ? (
        <p>No recommendations yet. Start the agent orchestrator to generate recommendations.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%', border: '1px solid #ddd' }}>
          <thead>
            <tr>
              {[
                'Recommendation ID',
                'Session ID',
                'Incident ID',
                'Incident Severity',
                'Agent',
                'Priority',
                'Action Type',
                'Confidence',
                'Recommendation',
                'Rationale',
                'Summary',
                'Effectiveness',
                'Effectiveness Reason',
                'Status',
                'Created',
                'Decision',
              ].map((heading) => (
                <th
                  key={heading}
                  style={{ border: '1px solid #ddd', padding: '0.5rem', textAlign: 'left' }}
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recommendations.map((recommendation) => (
              <tr key={recommendation.id}>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  <code>{recommendation.id}</code>
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {recommendation.session_id ? <code>{recommendation.session_id}</code> : '—'}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {recommendation.incident_id ? <code>{recommendation.incident_id}</code> : '—'}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {recommendation.incident_severity ? (
                    <span
                      style={{
                        ...severityStyle(recommendation.incident_severity),
                        borderRadius: '999px',
                        display: 'inline-block',
                        fontWeight: 600,
                        padding: '0.15rem 0.5rem',
                        textTransform: 'capitalize',
                      }}
                    >
                      {recommendation.incident_severity}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {recommendation.agent_name}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem', textTransform: 'capitalize' }}>
                  {recommendation.priority}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {recommendation.action_type}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {(Number(recommendation.confidence) * 100).toFixed(0)}%
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {recommendation.recommendation_text}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {recommendation.rationale}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {buildRecommendationOperatorSummary(recommendation)}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  <span
                    style={{
                      ...effectivenessStyle(recommendation.effectiveness_signal),
                      borderRadius: '999px',
                      display: 'inline-block',
                      fontWeight: 600,
                      padding: '0.15rem 0.5rem',
                      textTransform: 'capitalize',
                    }}
                  >
                    {recommendation.effectiveness_signal.replace('_', ' ')}
                  </span>
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {recommendation.effectiveness_reason ?? '—'}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  <span
                    style={{
                      ...statusStyle(recommendation.status),
                      borderRadius: '999px',
                      display: 'inline-block',
                      fontWeight: 600,
                      padding: '0.15rem 0.5rem',
                      textTransform: 'capitalize',
                    }}
                  >
                    {recommendation.status}
                  </span>
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {formatTimestamp(recommendation.created_at)}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {recommendation.status === 'pending' ? (
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <form action={approveRecommendation}>
                        <input type="hidden" name="recommendationId" value={recommendation.id} />
                        <button type="submit">Approve</button>
                      </form>
                      <form action={dismissRecommendation}>
                        <input type="hidden" name="recommendationId" value={recommendation.id} />
                        <button type="submit">Dismiss</button>
                      </form>
                    </div>
                  ) : recommendation.latest_decision ? (
                    <>
                      {recommendation.latest_decision} by {recommendation.latest_operator_id ?? 'unknown'} at{' '}
                      {formatTimestamp(recommendation.latest_decided_at)}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
