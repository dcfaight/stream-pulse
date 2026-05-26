import { listRecentSessionStatus } from '@stream-pulse/db';

export const dynamic = 'force-dynamic';

function formatTimestamp(value: Date | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value);
}

export default async function Home() {
  let sessions = await listRecentSessionStatus(25).catch(() => []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', margin: '2rem auto', maxWidth: 980 }}>
      <h1>StreamPulse Status</h1>
      <p>
        Milestone 1 vertical slice status page with persisted session and telemetry event data from
        Postgres.
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
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
