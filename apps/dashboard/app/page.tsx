import {
  decideRecommendation,
  listRecentIncidents,
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
        audit details. Refreshes every 5 seconds.
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
                'Started',
                'Updated',
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
            {incidents.map((incident) => (
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
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {formatTimestamp(incident.started_at)}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {formatTimestamp(incident.updated_at)}
                </td>
              </tr>
            ))}
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
