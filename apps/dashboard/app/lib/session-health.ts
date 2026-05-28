import type { SessionSummaryRow } from '@stream-pulse/db';

function toNumber(value: string | null | undefined, fallback = 0): number {
  if (value == null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export interface SessionHealthGrade {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  label: 'Excellent' | 'Good' | 'Fair' | 'Poor' | 'Critical' | 'Failing';
  narrative: string;
}

export function computeSessionHealthGrade(summary: SessionSummaryRow | null): SessionHealthGrade {
  const finalQoe = toNumber(summary?.final_qoe_score, 60);
  const openIncidents = toNumber(summary?.open_incident_count, 0);
  const resolvedIncidents = toNumber(summary?.resolved_incident_count, 0);
  const criticalIncidents = toNumber(summary?.critical_incident_count, 0);
  const poorIncidents = toNumber(summary?.poor_incident_count, 0);
  const degradedIncidents = toNumber(summary?.degraded_incident_count, 0);
  const helpful = toNumber(summary?.helpful_recommendation_count, 0);
  const notHelpful = toNumber(summary?.not_helpful_recommendation_count, 0);

  const penalty =
    openIncidents * 8 + criticalIncidents * 10 + poorIncidents * 6 + degradedIncidents * 3 + notHelpful * 4;
  const bonus = resolvedIncidents * 1.5 + helpful * 2;
  const score = Math.max(0, Math.min(100, Math.round((finalQoe - penalty + bonus) * 100) / 100));

  if (score >= 90) {
    return {
      score,
      grade: 'A',
      label: 'Excellent',
      narrative: 'Session remained stable with high QoE and low operational risk.',
    };
  }
  if (score >= 80) {
    return {
      score,
      grade: 'B',
      label: 'Good',
      narrative: 'Session quality was strong with manageable incident impact.',
    };
  }
  if (score >= 70) {
    return {
      score,
      grade: 'C',
      label: 'Fair',
      narrative: 'Session quality was mixed and showed noticeable degradation periods.',
    };
  }
  if (score >= 60) {
    return {
      score,
      grade: 'D',
      label: 'Poor',
      narrative: 'Session required active intervention due to recurring quality issues.',
    };
  }
  if (score >= 50) {
    return {
      score,
      grade: 'E',
      label: 'Critical',
      narrative: 'Session quality was consistently unstable with elevated operator burden.',
    };
  }
  return {
    score,
    grade: 'F',
    label: 'Failing',
    narrative: 'Session quality collapsed and remediation outcomes were weak.',
  };
}
