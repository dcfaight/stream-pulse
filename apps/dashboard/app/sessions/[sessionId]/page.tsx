import {
  getSessionSummary,
  type IncidentFeedRow,
  listRecentRecommendations,
  type RecommendationFeedRow,
  type SessionReplayTimelineEventRow,
  listSessionIncidents,
  listSessionQoeTrend,
  listSessionReplayTimeline,
  resolveIncident,
} from '@stream-pulse/db';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { AutoRefresh } from '../../auto-refresh';

export const dynamic = 'force-dynamic';

function formatTimestamp(value: Date | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(value);
}

function prettyPayload(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return 'unserializable payload';
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function incidentSummary(incident: IncidentFeedRow): string {
  if (incident.status === 'resolved' && incident.resolution_summary) return incident.resolution_summary;
  const payload = asObject(incident.latest_event_payload);
  if (typeof payload?.oneLineSummary === 'string') return payload.oneLineSummary;
  if (typeof payload?.resolutionSummary === 'string') return payload.resolutionSummary;
  return `Incident ${incident.severity} (${incident.status}) with root-cause hypothesis ${incident.root_cause || 'generalized stream degradation'}.`;
}

function recommendationSummary(recommendation: RecommendationFeedRow): string {
  const confidence = `${(Number(recommendation.confidence) * 100).toFixed(0)}% confidence`;
  return `${recommendation.action_type} (${recommendation.priority}) for ${
    recommendation.incident_severity ?? 'unknown'
  } severity incident. ${confidence}.`;
}

function timelineSummary(event: SessionReplayTimelineEventRow): string {
  const payload = asObject(event.payload);
  if (typeof payload?.oneLineSummary === 'string') return payload.oneLineSummary;
  if (typeof payload?.summary === 'string') return payload.summary;
  if (typeof payload?.resolutionSummary === 'string') return payload.resolutionSummary;
  const recommendationSummaryValue = asObject(payload?.recommendationSummary);
  if (typeof recommendationSummaryValue?.oneLineSummary === 'string') {
    return recommendationSummaryValue.oneLineSummary;
  }
  if (event.event_type === 'recommendation_created' && payload) {
    const recommendationText =
      typeof payload.recommendationText === 'string' ? payload.recommendationText : null;
    if (recommendationText) return recommendationText;
  }
  if (event.event_type === 'recommendation_decided' && event.decision) {
    return `Recommendation ${event.decision} by ${event.operator_id ?? 'operator'}.`;
  }
  return '—';
}

async function resolveIncidentAction(formData: FormData): Promise<void> {
  'use server';
  const incidentId = String(formData.get('incidentId') ?? '');
  const sessionId = String(formData.get('sessionId') ?? '');
  if (!incidentId || !sessionId) return;
  const notes = String(formData.get('resolutionNotes') ?? '').trim();
  await resolveIncident({
    incidentId,
    operatorId: 'local-operator',
    notes: notes || 'Resolved from session timeline',
  });
  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath('/');
}

export default async function SessionTimelinePage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const [qoeTrend, incidents, recommendations, timeline, sessionSummary] = await Promise.all([
    listSessionQoeTrend(sessionId, 120).catch(() => []),
    listSessionIncidents(sessionId, 50).catch(() => []),
    listRecentRecommendations(100, sessionId).catch(() => []),
    listSessionReplayTimeline(sessionId, 300).catch(() => []),
    getSessionSummary(sessionId).catch(() => null),
  ]);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', margin: '2rem auto', maxWidth: 1100 }}>
      <AutoRefresh intervalMs={5000} />
      <p>
        <Link href="/">← Back to dashboard</Link>
      </p>
      <h1>Session Replay Timeline</h1>
      <p>
        Session <code>{sessionId}</code> chronological audit trail: QoE segments, incident changes,
        recommendations, and operator decisions.
      </p>
      {sessionSummary ? (
        <section style={{ border: '1px solid #ddd', padding: '0.9rem', marginBottom: '1rem' }}>
          <h2 style={{ marginTop: 0 }}>Session Summary</h2>
          <p>
            Incidents: {sessionSummary.incident_count} ({sessionSummary.resolved_incident_count} resolved /{' '}
            {sessionSummary.open_incident_count} open) • Recommendations: {sessionSummary.recommendation_count}{' '}
            ({sessionSummary.approved_recommendation_count} approved /{' '}
            {sessionSummary.dismissed_recommendation_count} dismissed) • Effectiveness:{' '}
            {sessionSummary.helpful_recommendation_count} helpful /{' '}
            {sessionSummary.not_helpful_recommendation_count} not helpful
          </p>
          <p>
            Dominant root cause: {sessionSummary.top_root_cause ?? '—'} • Final QoE:{' '}
            {sessionSummary.final_qoe_score ?? '—'} ({sessionSummary.final_qoe_severity ?? '—'})
          </p>
        </section>
      ) : null}

      <h2>QoE Trend ({qoeTrend.length})</h2>
      {qoeTrend.length === 0 ? (
        <p>No QoE segments yet for this session.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%', border: '1px solid #ddd' }}>
          <thead>
            <tr>
              {['Segment End', 'QoE Score', 'Severity', 'Signals'].map((heading) => (
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
            {qoeTrend.map((segment) => (
              <tr key={segment.id}>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {formatTimestamp(segment.end_ts)}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{segment.score}</td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{segment.severity}</td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  <code>{prettyPayload(segment.signals)}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ marginTop: '2rem' }}>Incident Markers ({incidents.length})</h2>
      {incidents.length === 0 ? (
        <p>No incidents found for this session.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%', border: '1px solid #ddd' }}>
          <thead>
            <tr>
              {[
                'Incident ID',
                'Severity',
                'Status',
                'Root Cause',
                'Confidence',
                'Recommendations',
                'Summary',
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
            {incidents.map((incident) => (
              <tr key={incident.id}>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  <code>{incident.id}</code>
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{incident.severity}</td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{incident.status}</td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{incident.root_cause}</td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {(Number(incident.confidence) * 100).toFixed(0)}%
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {incident.active_recommendation_count} active / {incident.recommendation_count} total
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {incidentSummary(incident)}
                </td>
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
                      <input type="hidden" name="sessionId" value={sessionId} />
                      <input
                        type="text"
                        name="resolutionNotes"
                        placeholder="Resolution notes"
                        style={{ width: 180 }}
                      />
                      <button type="submit">Resolve</button>
                    </form>
                  ) : (
                    <>
                      {incident.resolved_by ?? 'operator'} at {formatTimestamp(incident.resolved_at)}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ marginTop: '2rem' }}>Recommendations ({recommendations.length})</h2>
      {recommendations.length === 0 ? (
        <p>No recommendations for this session yet.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%', border: '1px solid #ddd' }}>
          <thead>
            <tr>
              {[
                'Recommendation ID',
                'Incident ID',
                'Action',
                'Priority',
                'Status',
                'Confidence',
                'Created',
                'Decision Timing',
                'Effectiveness',
                'Summary',
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
                  {recommendation.incident_id ? <code>{recommendation.incident_id}</code> : '—'}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{recommendation.action_type}</td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{recommendation.priority}</td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{recommendation.status}</td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {(Number(recommendation.confidence) * 100).toFixed(0)}%
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {formatTimestamp(recommendation.created_at)}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {recommendation.latest_decision
                    ? `${recommendation.latest_decision} by ${recommendation.latest_operator_id ?? 'unknown'} at ${formatTimestamp(recommendation.latest_decided_at)}`
                    : recommendation.decided_by
                      ? `status ${recommendation.status} by ${recommendation.decided_by} at ${formatTimestamp(recommendation.decided_at)}`
                      : '—'}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {recommendation.effectiveness_signal.replace('_', ' ')}
                  {recommendation.effectiveness_reason
                    ? ` — ${recommendation.effectiveness_reason}`
                    : ''}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {recommendationSummary(recommendation)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ marginTop: '2rem' }}>Unified Replay Timeline ({timeline.length})</h2>
      {timeline.length === 0 ? (
        <p>No replay events found yet for this session.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%', border: '1px solid #ddd' }}>
          <thead>
            <tr>
              {[
                'Time',
                'Event',
                'Source',
                'Incident',
                'Recommendation',
                'Severity',
                'Status',
                'Confidence',
                'Decision',
                'Summary',
                'Payload',
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
            {timeline.map((event, index) => (
              <tr key={`${event.source}-${event.event_type}-${event.ts.toISOString()}-${index}`}>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{formatTimestamp(event.ts)}</td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{event.event_type}</td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{event.source}</td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {event.incident_id ? <code>{event.incident_id}</code> : '—'}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {event.recommendation_id ? <code>{event.recommendation_id}</code> : '—'}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {event.qoe_severity ?? event.severity ?? '—'}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{event.status ?? '—'}</td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {event.confidence ? `${Math.round(Number(event.confidence) * 100)}%` : '—'}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  {event.decision
                    ? `${event.decision}${event.operator_id ? ` by ${event.operator_id}` : ''}`
                    : '—'}
                </td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{timelineSummary(event)}</td>
                <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>
                  <code>{prettyPayload(event.payload)}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
