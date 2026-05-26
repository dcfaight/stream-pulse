# StreamPulse — Architecture Overview

## 1. System Purpose

StreamPulse is a **media control plane for observability, diagnosis, recommendations, and operational workflows** built around WebRTC sessions. It is not a streaming platform; it is a layer that sits alongside one, capturing telemetry, computing quality metrics, detecting incidents, and coordinating agentic workflows.

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Browser Clients                                │
│                                                                         │
│  ┌──────────────────────┐          ┌──────────────────────────────┐    │
│  │  Broadcaster Session │          │     Viewer Session(s)        │    │
│  │  WebRTC + Stats SDK  │          │     WebRTC + Stats SDK       │    │
│  └──────────┬───────────┘          └──────────────┬───────────────┘    │
│             │  RTCPeerConnection.getStats()        │                    │
└─────────────┼────────────────────────────────────-┼────────────────────┘
              │  WebSocket / HTTP                   │
              ▼                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       Telemetry Ingestion Service                       │
│                                                                         │
│  • Validates & normalises raw WebRTC stat frames                        │
│  • Applies windowed metric computation (bitrate Δ, loss rate, etc.)     │
│  • Publishes normalised MetricEvents to the Event Bus                   │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │  Event Bus (in-process → Kafka-ready)
              ┌────────────────┼───────────────────┐
              ▼                ▼                   ▼
┌─────────────────┐  ┌──────────────────┐  ┌──────────────────────────────┐
│  QoE Scoring    │  │  Incident Store  │  │  Session State (Redis)       │
│  Engine         │  │  (Postgres)      │  │  • Live metric cache         │
│                 │  │                  │  │  • Session registry          │
│  • Per-segment  │  │  • Incident rows │  │  • Pub/sub for live UI       │
│    QoE score    │  │  • Timeline      │  └──────────────────────────────┘
│  • Severity     │  │    markers       │
│    classifier   │  │  • Replay index  │
└────────┬────────┘  └────────┬─────────┘
         │                    │
         ▼                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      Agentic Orchestration Layer                        │
│                                                                         │
│  ┌─────────────────────┐   ┌─────────────────────┐                     │
│  │ Session Health      │   │ Incident Correlator  │                     │
│  │ Analyst Agent       │   │ Agent                │                     │
│  │                     │   │                      │                     │
│  │ • Monitors live     │   │ • Groups related     │                     │
│  │   QoE trends        │   │   metric anomalies   │                     │
│  │ • Flags degradation │   │ • Assigns root-cause │                     │
│  │   onset             │   │   hypothesis         │                     │
│  └──────────┬──────────┘   └──────────┬───────────┘                    │
│             │                         │                                 │
│  ┌──────────▼──────────┐   ┌──────────▼───────────┐                    │
│  │ Seller Assistant    │   │ Replay / Triage       │                    │
│  │ Agent               │   │ Agent                 │                    │
│  │                     │   │                       │                    │
│  │ • Generates HiTL    │   │ • Reconstructs        │                    │
│  │   recommendations   │   │   incident timeline   │                    │
│  │ • Explains signals  │   │ • Produces replay     │                    │
│  │ • Queues actions    │   │   summary & markers   │                    │
│  └─────────────────────┘   └───────────────────────┘                   │
└──────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Dashboard (Next.js)                             │
│                                                                         │
│  • Live session monitor (bitrate, RTT, QoE score, connection state)    │
│  • Incident feed with correlated root-cause hypotheses                 │
│  • Recommendation panel with rationale and operator actions            │
│  • Session replay timeline viewer                                       │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Service Boundaries

### 3.1 `telemetry-ingestor`

**Responsibility:** Receive raw WebRTC stat payloads from browser SDKs, validate, normalise, and compute derived metrics.

**Inputs:** WebSocket frames carrying `RTCStatsReport` snapshots (polled every ~1 s from `getStats()`).

**Outputs:** `MetricEvent` records on the internal event bus; live metric state written to Redis.

**Key logic:**
- Stat frame normalisation (vendor differences in Chrome/Firefox/Safari stat shapes)
- Windowed derivative computation (bitrate = bytes Δ / time Δ)
- Jitter smoothing, packet-loss rate computation
- Audio-level detection (silence / clipping flags)
- Connection state machine (`new → checking → connected → disconnected → failed`)

### 3.2 `qoe-engine`

**Responsibility:** Consume `MetricEvent` streams and produce deterministic per-segment and per-session QoE scores with severity classifications.

**Scoring model (v1 — deterministic):**

| Metric | Weight | Thresholds |
|---|---|---|
| Video bitrate | 30 % | Good ≥ 2 Mbps, Degraded < 800 kbps, Critical < 200 kbps |
| RTT | 20 % | Good ≤ 80 ms, Degraded > 200 ms, Critical > 500 ms |
| Packet loss | 25 % | Good ≤ 0.5 %, Degraded > 2 %, Critical > 5 % |
| Jitter | 15 % | Good ≤ 30 ms, Degraded > 80 ms, Critical > 150 ms |
| Frame drops | 10 % | Good ≤ 1 fps drop, Degraded > 5 fps drop |

Severity labels: `good` · `degraded` · `poor` · `critical`

**Outputs:** `QoEEvent` on event bus; `session_qoe_segments` rows in Postgres.

### 3.3 `incident-store`

**Responsibility:** Persist incident events, timeline markers, and replay indexes in Postgres. Exposes a query API for the dashboard and agents.

**Key tables:** `sessions`, `metric_events`, `qoe_segments`, `incidents`, `incident_timeline`, `agent_recommendations`, `operator_actions`.

### 3.4 `agent-orchestrator`

**Responsibility:** Host the agentic layer. Receives QoE degradation signals and incident events, orchestrates agent pipelines, and produces explainable recommendations.

**Agent descriptions:**

| Agent | Trigger | Output |
|---|---|---|
| **Session Health Analyst** | QoE crosses `degraded` threshold | Trend summary, signal list, degradation onset time |
| **Incident Correlator** | Multiple degradation events within a time window | Correlated incident group, root-cause hypothesis, confidence score |
| **Seller Assistant** | Incident confirmed by correlator | Human-readable recommendation with rationale and priority; proposed operator action (requires HiTL approval) |
| **Replay / Triage Agent** | Session end or manual trigger | Incident timeline summary, replay markers, severity timeline chart data |
| **Provider Evaluation Agent** *(future)* | Comparison session set | Cross-provider QoE comparison report |

**Agent design constraints:**
- Each agent receives a structured context payload (metric snapshots, QoE history, incident log).
- Each agent produces a structured output (typed `AgentResult` schema).
- LLM calls are used only for explanation text and hypothesis generation — scoring and severity remain deterministic.
- All agent inputs and outputs are stored for auditability.

### 3.5 `dashboard` (Next.js app)

**Responsibility:** Real-time operator and seller UI.

**Key views:**
- **Live Monitor** — per-session metric tiles updating via WebSocket/SSE
- **Incident Feed** — chronological list of incidents with severity badge and root-cause chip
- **Recommendation Panel** — pending and resolved recommendations; approve/dismiss HiTL actions
- **Session Replay** — scrubable timeline of QoE scores, metric overlays, and incident markers

---

## 4. Data Flow — Happy Path (Live Degradation)

```
1. Browser SDK polls getStats() every 1 s
2. SDK serialises RTCStatsReport snapshot → WebSocket → telemetry-ingestor
3. Ingestor normalises, computes derivatives, emits MetricEvent
4. QoE engine consumes MetricEvent, recomputes score, emits QoEEvent (score drops to "degraded")
5. Redis live state updated; dashboard tiles refresh via pub/sub
6. Incident Correlator agent wakes, groups anomalies, emits IncidentEvent with root-cause hypothesis
7. Seller Assistant agent generates recommendation (e.g. "Reduce overlay complexity — jitter ↑ 120 ms, likely GPU encoder contention")
8. Recommendation stored in DB; pushed to dashboard Recommendation Panel
9. Operator approves → operator action logged; optional downstream webhook fired
10. At session end, Replay/Triage Agent constructs timeline and replay markers
```

---

## 5. Event Bus Design

**MVP:** In-process typed event emitter (`EventEmitter`-based with typed wrappers).

**Kafka-ready interface:** All event producers and consumers are coded against an `IEventBus` interface. A Kafka adapter implementing the same interface can be substituted without changing producers or consumers.

**Topic schema (logical names, used as Kafka topic names later):**

| Topic | Producer | Consumers |
|---|---|---|
| `metric.raw` | telemetry-ingestor | qoe-engine, incident-store |
| `qoe.scored` | qoe-engine | agent-orchestrator, incident-store, dashboard |
| `incident.detected` | agent-orchestrator | incident-store, dashboard |
| `recommendation.created` | agent-orchestrator | incident-store, dashboard |
| `action.requested` | dashboard (HiTL approval) | agent-orchestrator, incident-store |

---

## 6. Storage Model

### PostgreSQL (durable, queryable history)

```
sessions             — id, broadcaster_id, started_at, ended_at, status
metric_events        — id, session_id, ts, metric_type, value, raw_payload
qoe_segments         — id, session_id, start_ts, end_ts, score, severity, signals (jsonb)
incidents            — id, session_id, started_at, resolved_at, root_cause, confidence, severity
incident_timeline    — id, incident_id, ts, event_type, payload (jsonb)
agent_recommendations — id, incident_id, agent_name, created_at, rationale, action_type, status
operator_actions     — id, recommendation_id, operator_id, decided_at, decision, notes
```

### Redis

```
session:{id}:metrics     — hash of latest metric values
session:{id}:state       — connection state string
session:{id}:qoe         — latest QoE score + severity
active_sessions          — sorted set (score = last_seen ts)
pubsub channel: session.{id}.updates
```

---

## 7. Browser WebRTC SDK

A thin TypeScript module (`packages/webrtc-sdk`) that:
- Wraps `RTCPeerConnection.getStats()` in a polling loop (configurable interval, default 1 s)
- Normalises the browser-specific stat shape into a canonical `StatSnapshot` type
- Sends snapshots to the ingestor via WebSocket with session metadata
- Handles reconnection with exponential back-off
- Exposes a `useSessionStats()` React hook for dashboard integration

---

## 8. Observability (Optional Local Stack)

| Tool | Purpose |
|---|---|
| OpenTelemetry SDK | Traces and metrics from all backend services |
| Prometheus | Metric scrape endpoint on each service |
| Grafana | Pre-built dashboards for ingestor throughput, QoE distribution, incident rate |

All OTel instrumentation is gated behind an `ENABLE_OTEL` flag; services run without it in minimal local mode.

---

## 9. Deployment Topology (MVP — Local Docker Compose)

```
docker-compose.yml services:
  postgres        — data persistence
  redis           — live state + pub/sub
  ingestor        — telemetry-ingestor (Node.js)
  qoe-engine      — qoe-engine (Node.js)
  agent-orch      — agent-orchestrator (Node.js)
  dashboard       — Next.js app (port 3000)
  prometheus      — optional
  grafana         — optional
```

No Kubernetes, no cloud deployment required for MVP.

---

## 10. Security Boundaries (MVP)

- Session tokens authenticated via short-lived JWT issued at session start
- WebSocket connections require valid session token
- Operator actions require authenticated operator session (basic auth or OAuth placeholder)
- No PII stored in metric events — session IDs are UUIDs with no user linkage in MVP
- Agent LLM calls use backend-held API keys; keys never sent to browser
