import {
  getSessionContext,
  getSessionSummary,
  listRecentRecommendations,
  listSessionIncidents,
  listSessionReplayTimeline,
} from '@stream-pulse/db';

function asString(value: string | null | undefined, fallback = '—'): string {
  if (!value) return fallback;
  return value;
}

function formatTimelineSummary(
  timeline: Awaited<ReturnType<typeof listSessionReplayTimeline>>,
): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const event of timeline) {
    summary[event.event_type] = (summary[event.event_type] ?? 0) + 1;
  }
  return summary;
}

function markdownReport(input: {
  sessionId: string;
  generatedAt: string;
  sessionContext: Awaited<ReturnType<typeof getSessionContext>>;
  sessionSummary: Awaited<ReturnType<typeof getSessionSummary>>;
  incidentCount: number;
  recommendationCount: number;
  timelineSummary: Record<string, number>;
}): string {
  const timelineLines = Object.entries(input.timelineSummary)
    .sort((left, right) => right[1] - left[1])
    .map(([eventType, count]) => `- ${eventType}: ${count}`)
    .join('\n');

  return `# StreamPulse Session Report

- sessionId: ${input.sessionId}
- generatedAt: ${input.generatedAt}
- sourceType: ${asString(input.sessionContext?.source_type, 'unknown')}
- sourceLabel: ${asString(input.sessionContext?.source_label)}
- sourceRole: ${asString(input.sessionContext?.source_role, 'unknown')}
- streamDirection: ${asString(input.sessionContext?.stream_direction, 'unknown')}
- runtimeLabel: ${asString(input.sessionContext?.runtime_label)}
- browserName: ${asString(input.sessionContext?.browser_name)}
- finalQoE: ${asString(input.sessionSummary?.final_qoe_score)} (${asString(input.sessionSummary?.final_qoe_severity)})
- incidents: ${input.incidentCount}
- recommendations: ${input.recommendationCount}
- approvals: ${asString(input.sessionSummary?.approved_recommendation_count, '0')}
- dismissals: ${asString(input.sessionSummary?.dismissed_recommendation_count, '0')}
- effectiveness: helpful=${asString(input.sessionSummary?.helpful_recommendation_count, '0')} not_helpful=${asString(input.sessionSummary?.not_helpful_recommendation_count, '0')}

## Timeline Summary
${timelineLines || '- no timeline events'}
`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  const { sessionId } = await context.params;
  const url = new URL(request.url);
  const format = url.searchParams.get('format') === 'md' ? 'md' : 'json';

  const [sessionContext, sessionSummary, incidents, recommendations, timeline] = await Promise.all([
    getSessionContext(sessionId),
    getSessionSummary(sessionId),
    listSessionIncidents(sessionId, 200),
    listRecentRecommendations(200, sessionId),
    listSessionReplayTimeline(sessionId, 500),
  ]);

  if (!sessionContext && !sessionSummary && incidents.length === 0 && recommendations.length === 0) {
    return Response.json({ error: `No report data found for session ${sessionId}` }, { status: 404 });
  }

  const generatedAt = new Date().toISOString();
  const report = {
    generatedAt,
    session: {
      id: sessionId,
      broadcasterId: sessionContext?.broadcaster_id ?? null,
      startedAt: sessionContext?.started_at?.toISOString?.() ?? null,
      status: sessionContext?.status ?? null,
      sourceType: sessionContext?.source_type ?? 'unknown',
      sourceLabel: sessionContext?.source_label ?? null,
      sourceRole: sessionContext?.source_role ?? 'unknown',
      streamDirection: sessionContext?.stream_direction ?? 'unknown',
      runtimeLabel: sessionContext?.runtime_label ?? null,
      browserName: sessionContext?.browser_name ?? null,
      sessionLabel: sessionContext?.session_label ?? null,
    },
    summary: {
      finalQoeScore: sessionSummary?.final_qoe_score ?? null,
      finalQoeSeverity: sessionSummary?.final_qoe_severity ?? null,
      incidentCount: sessionSummary?.incident_count ?? String(incidents.length),
      openIncidentCount: sessionSummary?.open_incident_count ?? null,
      resolvedIncidentCount: sessionSummary?.resolved_incident_count ?? null,
      dominantRootCause: sessionSummary?.top_root_cause ?? null,
      recommendationCount: sessionSummary?.recommendation_count ?? String(recommendations.length),
      approvedRecommendationCount: sessionSummary?.approved_recommendation_count ?? null,
      dismissedRecommendationCount: sessionSummary?.dismissed_recommendation_count ?? null,
      helpfulRecommendationCount: sessionSummary?.helpful_recommendation_count ?? null,
      notHelpfulRecommendationCount: sessionSummary?.not_helpful_recommendation_count ?? null,
    },
    incidents: incidents.map((incident) => ({
      id: incident.id,
      severity: incident.severity,
      status: incident.status,
      rootCause: incident.root_cause,
      confidence: incident.confidence,
      startedAt: incident.started_at.toISOString(),
      updatedAt: incident.updated_at.toISOString(),
      resolvedAt: incident.resolved_at?.toISOString?.() ?? null,
      resolutionSummary: incident.resolution_summary,
    })),
    recommendations: recommendations.map((recommendation) => ({
      id: recommendation.id,
      actionType: recommendation.action_type,
      priority: recommendation.priority,
      status: recommendation.status,
      effectivenessSignal: recommendation.effectiveness_signal,
      effectivenessReason: recommendation.effectiveness_reason,
      latestDecision: recommendation.latest_decision,
      confidence: recommendation.confidence,
    })),
    timeline: {
      totalEvents: timeline.length,
      from: timeline[0]?.ts?.toISOString?.() ?? null,
      to: timeline[timeline.length - 1]?.ts?.toISOString?.() ?? null,
      eventTypeCounts: formatTimelineSummary(timeline),
    },
  };

  if (format === 'md') {
    return new Response(
      markdownReport({
        sessionId,
        generatedAt,
        sessionContext,
        sessionSummary,
        incidentCount: incidents.length,
        recommendationCount: recommendations.length,
        timelineSummary: report.timeline.eventTypeCounts,
      }),
      {
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `inline; filename="${sessionId}-report.md"`,
        },
      },
    );
  }

  return new Response(JSON.stringify(report, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `inline; filename="${sessionId}-report.json"`,
    },
  });
}
