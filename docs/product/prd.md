# StreamPulse — Product Requirements Document

**Version:** 0.1 (Pre-MVP)
**Status:** Draft
**Owner:** dcfaight

---

## 1. Executive Summary

StreamPulse is an agentic livestream quality observability and incident orchestration platform for WebRTC sessions. It gives broadcasters and operators real-time visibility into session health, deterministic quality-of-experience scores, and AI-generated, explainable recommendations — all backed by a replayable incident timeline.

StreamPulse is a **media control plane**, not a livestream platform. It sits alongside an existing WebRTC session and monitors it.

---

## 2. Problem Statement

Livestream operators and sellers running WebRTC sessions today have no structured way to:

- Know in real time that a session is degrading and *why*
- Receive actionable, context-aware mitigation suggestions without deep technical knowledge
- Review a post-session timeline of quality events for debugging or trust & safety review
- Compare session quality across time or provider configuration

When something goes wrong in a live session, the operator is left reacting blindly — refreshing dashboards, guessing causes, and making expensive trial-and-error decisions. Post-session debugging is manual and slow.

---

## 3. Goals

| Goal | Priority |
|---|---|
| Capture WebRTC telemetry (bitrate, RTT, loss, jitter, frames, audio, state) from live sessions | Must |
| Compute deterministic per-segment QoE scores with severity labels | Must |
| Detect and log quality degradation incidents with timeline markers | Must |
| Generate explainable, rationale-backed recommendations for sellers and operators | Must |
| Support human-in-the-loop (HiTL) approval for high-impact operator actions | Must |
| Store a replayable incident timeline per session for post-session analysis | Must |
| Display live metrics and incident feed in a real-time dashboard | Must |
| Provide session replay view with scrubable QoE timeline | Should |
| Support optional OpenTelemetry / Prometheus / Grafana observability stack | Could |
| Evaluate and compare quality across provider configurations | Won't (MVP) |

---

## 4. Non-Goals (MVP)

- This is **not** a streaming platform, encoder, CDN, or media server
- This does **not** perform SFU/MCU media routing
- This does **not** replace WebRTC infrastructure (no ICE servers, no signalling server)
- This does **not** provide a production-grade multi-tenant SaaS product in MVP
- This does **not** automatically remediate sessions without operator approval for high-impact actions
- AI agents do **not** override deterministic QoE scoring — they explain and recommend

---

## 5. Personas

### 5.1 Broadcaster / Seller

A content creator or e-commerce seller running a live WebRTC session. Technically non-expert. Wants to know if their session is degrading, what to do about it, and whether the issue is on their end.

**Primary needs:**
- Simple quality indicator (good / degraded / poor)
- Plain-language explanation of what is wrong
- Actionable suggestions they can act on immediately

### 5.2 Operator / Platform Admin

A technical operator managing multiple live sessions. Wants aggregate visibility and the ability to trigger remediations across sessions. Has context on platform-side configuration.

**Primary needs:**
- Multi-session dashboard
- Incident feed with correlated root causes
- Ability to approve or dismiss agentic recommendations
- Post-session audit trail

### 5.3 Developer / QA Engineer (Secondary)

A developer debugging session quality or validating platform changes. Needs raw metric access and session replay.

**Primary needs:**
- Raw metric timeseries access
- Session replay timeline
- Incident and recommendation history

---

## 6. User Stories

### Telemetry & Metrics

- As a **broadcaster**, I want my session's bitrate, RTT, packet loss, jitter, and frame drop rate to be collected automatically so I don't have to manually report quality issues.
- As a **developer**, I want WebRTC `getStats()` data normalised across Chrome, Firefox, and Safari so I get consistent metrics regardless of browser.
- As an **operator**, I want the ingestor to handle brief SDK disconnections gracefully so telemetry gaps are labelled rather than silently lost.

### QoE Scoring

- As an **operator**, I want each session segment to have a deterministic QoE score (0–100) with a severity label so I can quickly assess session health.
- As a **developer**, I want the scoring formula to be transparent, documented, and independently testable so I can trust and audit its output.
- As a **broadcaster**, I want to see my current quality score as a live indicator in the dashboard.

### Incident Detection

- As an **operator**, I want related metric anomalies to be grouped into a single incident event so the incident feed is signal-rich, not noisy.
- As an **operator**, I want each incident to have a timestamped start, a probable root-cause hypothesis, and a confidence level.
- As a **developer**, I want incidents persisted in Postgres with full metric context so I can query them post-session.

### Agentic Recommendations

- As a **broadcaster**, I want recommendations written in plain language with a brief explanation of why the action is suggested (e.g. "Your jitter has increased sharply over the last 60 seconds, likely due to GPU encoder load — consider reducing overlay complexity").
- As an **operator**, I want each recommendation to show the specific metric signals that triggered it so I can verify the agent's reasoning.
- As an **operator**, I want to approve or dismiss agentic recommendations before any high-impact action is taken.
- As a **developer**, I want all agent inputs and outputs stored so I can audit agent behaviour and improve prompts over time.

### Session Replay & Audit

- As an **operator**, I want a post-session timeline that shows QoE score over time, with incident markers overlaid.
- As a **trust & safety reviewer**, I want to replay a session's quality events with timestamp precision so I can correlate quality degradation with viewer complaints.
- As a **developer**, I want to export incident timeline data as JSON so I can integrate it with external tools.

### Dashboard & UX

- As a **broadcaster**, I want a live dashboard that updates every second with current bitrate, RTT, and QoE score.
- As an **operator**, I want an incident feed that shows new incidents as they occur, without requiring a page refresh.
- As an **operator**, I want a recommendation panel where I can act on pending agentic suggestions with a single click.

---

## 7. Functional Requirements

### FR-1: Telemetry Ingestion
- FR-1.1 SDK polls `RTCPeerConnection.getStats()` at a configurable interval (default 1 s)
- FR-1.2 Stats are serialised and sent to the ingestor via WebSocket
- FR-1.3 Ingestor normalises stat shapes across Chrome, Firefox, and Safari
- FR-1.4 Derived metrics (bitrate, loss rate, jitter) are computed server-side from raw counters
- FR-1.5 Connection state changes are captured as discrete events
- FR-1.6 Audio health signals (silence detection, clipping) are captured

### FR-2: QoE Scoring
- FR-2.1 A score (0–100) is computed for each ~10 s segment using a weighted metric model (see Architecture doc)
- FR-2.2 Severity is classified as `good`, `degraded`, `poor`, or `critical`
- FR-2.3 Scoring logic is deterministic, versioned, and independently unit-testable
- FR-2.4 Score and severity are stored per segment in Postgres

### FR-3: Incident Detection & Storage
- FR-3.1 Anomalies meeting configured thresholds trigger incident creation
- FR-3.2 Related anomalies within a time window are correlated into a single incident
- FR-3.3 Each incident has: session_id, start_ts, severity, root_cause hypothesis, confidence
- FR-3.4 Incident timeline entries are stored for each notable metric change during the incident
- FR-3.5 Incidents are queryable by session, time range, and severity

### FR-4: Agentic Orchestration
- FR-4.1 Session Health Analyst agent triggers when QoE crosses `degraded` threshold
- FR-4.2 Incident Correlator agent groups anomalies and assigns root-cause hypothesis
- FR-4.3 Seller Assistant agent generates HiTL recommendation with plain-language rationale
- FR-4.4 All agent inputs and outputs are persisted in the `agent_recommendations` table
- FR-4.5 Recommendations include: trigger signals, recommended action, rationale text, priority
- FR-4.6 High-impact actions require operator approval before logging as `action.requested` event

### FR-5: Session Replay
- FR-5.1 At session end, Replay/Triage Agent produces a replay index (list of timestamped events)
- FR-5.2 Dashboard provides a scrubable timeline view with QoE score graph and incident markers
- FR-5.3 Timeline data is exportable as JSON

### FR-6: Dashboard
- FR-6.1 Live metric tiles update at ≤ 2 s latency via WebSocket/SSE
- FR-6.2 Incident feed shows incidents in reverse-chronological order with severity badge
- FR-6.3 Recommendation panel shows pending recommendations with approve/dismiss actions
- FR-6.4 Session list shows all sessions with current status and latest QoE score

---

## 8. Non-Functional Requirements

| Requirement | Target (MVP) |
|---|---|
| Telemetry ingestion latency | < 500 ms end-to-end (browser → DB) |
| Dashboard refresh latency | ≤ 2 s for live metric tiles |
| Session capacity | ≥ 10 concurrent sessions on local Docker stack |
| Metric retention | Configurable, default 30 days |
| Agent response time | < 5 s per recommendation generation |
| Availability | Best-effort MVP; no SLA required |
| Security | Session JWT auth; operator auth; no PII in metric events |
| Observability | OTel-ready; optional Prometheus/Grafana stack |

---

## 9. Constraints

- Must run on a developer laptop (Mac/Linux) with Docker Compose
- No paid cloud infrastructure required for MVP
- LLM API key required for agentic features (configurable, with graceful degradation if absent)
- Kafka not required in MVP; event bus must be Kafka-swappable

---

## 10. Success Metrics (MVP Exit Criteria)

| Metric | Target |
|---|---|
| A live WebRTC session's bitrate, RTT, and loss are visible in the dashboard within 2 s | ✅ Required |
| A degradation event produces at least one incident with a root-cause hypothesis | ✅ Required |
| The Seller Assistant generates a recommendation with rationale text for a degradation event | ✅ Required |
| An operator can approve/dismiss a recommendation | ✅ Required |
| A session's QoE timeline is viewable post-session | ✅ Required |
| All services start with a single `docker compose up` command | ✅ Required |

---

## 11. Open Questions

1. Should the broadcaster-facing UI be a separate simplified view, or a simplified mode of the operator dashboard?
2. What is the preferred LLM provider for the agentic layer (OpenAI, Anthropic, local Ollama)?
3. Should the MVP include a simulated WebRTC session generator for testing without a live stream?
4. Should audio health metrics (silence, clipping) be gated behind a separate feature flag in MVP?
