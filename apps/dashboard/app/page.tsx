import { listRecentSessionStatus } from '@stream-pulse/db';
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

export default async function Home() {
  const sessions = await listRecentSessionStatus(25).catch(() => []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', margin: '2rem auto', maxWidth: 980 }}>
      <AutoRefresh intervalMs={5000} />
      <h1>StreamPulse Status</h1>
      <p>
        Milestone 1.5/M2 slice status page with persisted session telemetry and deterministic QoE
        segments from Postgres. Refreshes every 5 seconds.
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
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
