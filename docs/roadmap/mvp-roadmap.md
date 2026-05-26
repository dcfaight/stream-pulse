# StreamPulse — MVP Roadmap

**Version:** 0.1
**Status:** Draft

---

## Principles

- Milestones are horizontally sliced: each one produces a running, demonstrable system.
- No milestone requires cloud infrastructure; everything runs on a developer laptop.
- Each milestone closes with a demo script describing what can be shown.
- Scope is intentionally conservative — depth beats breadth at MVP stage.

---

## Milestones

### M0 — Repository & Documentation ✅ (Current)

**Goal:** Establish the project foundation: documentation, architecture design, and monorepo structure.

**Deliverables:**
- [x] README with project overview and tech stack
- [x] Architecture overview (`docs/architecture/overview.md`)
- [x] Product requirements document (`docs/product/prd.md`)
- [x] This roadmap (`docs/roadmap/mvp-roadmap.md`)
- [x] Monorepo structure document (`docs/development/monorepo-structure.md`)
- [x] Initial task list (`docs/issues/initial-tasks.md`)
- [ ] Monorepo scaffold (`pnpm` workspaces + `turbo.json`)
- [ ] `docker-compose.yml` with Postgres + Redis
- [ ] Base TypeScript configs and ESLint setup

**Exit criteria:** A developer can clone the repo, read the docs, and understand the full system design before writing production code.

---

### M1 — Telemetry Ingestion + Live Dashboard Skeleton

**Goal:** A running WebRTC stat capture pipeline that shows raw metrics on a live dashboard.

**Scope:**
- `packages/webrtc-sdk`: TypeScript module that polls `getStats()` and streams stats via WebSocket
- `apps/ingestor`: Node.js service that receives, normalises, and stores raw stat frames; writes live state to Redis
- `apps/dashboard`: Next.js app with a single "Live Monitor" page showing bitrate, RTT, loss, jitter tiles updating in real time via SSE/WebSocket
- `packages/types`: Shared TypeScript types (`StatSnapshot`, `MetricEvent`, `SessionInfo`)
- Docker Compose brings up Postgres, Redis, ingestor, and dashboard together

**Out of scope:** QoE scoring, incident detection, agents

**Demo script:**
> Open the dashboard, open a browser tab with the WebRTC SDK demo page, start a session. The dashboard shows live bitrate, RTT, and packet loss updating every second.

**Exit criteria:**
- Raw WebRTC stats captured from browser → ingestor → Redis → dashboard with ≤ 2 s latency
- Connection state changes appear as events in the dashboard
- All services start with `docker compose up`

---

### M2 — QoE Scoring Engine

**Goal:** Deterministic per-segment QoE scoring with severity labels visible in the dashboard.

**Scope:**
- `apps/qoe-engine`: Consumes `MetricEvent` stream, computes weighted QoE score per segment (~10 s windows), classifies severity, writes `qoe_segments` to Postgres and publishes `QoEEvent`
- QoE score added to dashboard Live Monitor as a prominent indicator with colour-coded severity badge
- Unit-tested scoring formula with threshold configuration
- `packages/event-bus`: Typed in-process event bus abstraction (`IEventBus` interface)

**Out of scope:** Incident detection, agents

**Demo script:**
> Throttle the network in DevTools to simulate packet loss. Watch the QoE score drop from "good" (green) to "degraded" (amber) within 10–20 seconds.

**Exit criteria:**
- QoE score computed and stored for every session segment
- Severity label visible in real time on dashboard
- Scoring logic has ≥ 80 % unit test coverage

---

### M3 — Incident Detection & Incident Feed

**Goal:** Correlated incident events from metric anomalies, visible in a live incident feed.

**Scope:**
- Anomaly detection logic in ingestor/qoe-engine: emit `AnomalyEvent` when metric crosses configured threshold
- Incident Correlator: groups related anomalies into `Incident` records with probable root-cause hypothesis and confidence score (rule-based in M3; LLM-enhanced in M4)
- `incidents` and `incident_timeline` tables populated
- Dashboard "Incident Feed" view: chronological list with severity badge, root-cause chip, and timestamp
- Incident detail side panel: timeline of events, metric snapshots at incident start

**Out of scope:** Agentic recommendations (M4), session replay (M5)

**Demo script:**
> Simulate packet loss and then bandwidth reduction. Two distinct incidents appear in the feed: one for packet loss, one for bitrate drop. Click each to see the correlated metric timeline.

**Exit criteria:**
- At least 3 anomaly types produce distinct incidents (packet loss, bitrate drop, high RTT)
- Related anomalies within a 60 s window are correlated into a single incident
- Incident feed updates without page refresh

---

### M4 — Agentic Orchestration (Session Health + Seller Assistant)

**Goal:** AI-generated, explainable recommendations with human-in-the-loop approval.

**Scope:**
- `apps/agent-orchestrator`: Hosts agent pipeline; wired to event bus
- **Session Health Analyst agent**: Triggers on QoE crossing `degraded`; produces structured trend summary
- **Seller Assistant agent**: Triggers on confirmed incident; calls LLM to generate plain-language recommendation with rationale; structured output stored in `agent_recommendations`
- Dashboard "Recommendation Panel": shows pending recommendations with rationale, trigger signals, priority, and approve/dismiss buttons
- Operator approve/dismiss action stored in `operator_actions`
- LLM provider configurable via env var; graceful degradation (rule-based rationale) if API key absent

**Out of scope:** Replay/Triage agent (M5), Provider Evaluation agent (future)

**Demo script:**
> Simulate bandwidth degradation. Within ~10 s, a recommendation appears: *"Packet loss has increased to 4.2 % over the last 30 s. Consider reducing video quality to 720p to reduce encoder load. [Approve] [Dismiss]"* Approve it; the action is logged.

**Exit criteria:**
- Recommendation generated within 10 s of `degraded` QoE event
- Recommendation includes at least 2 supporting metric signals in the rationale
- Approve/dismiss recorded and visible in recommendation history
- Agent inputs and outputs stored in DB

---

### M5 — Session Replay & Post-Session Timeline

**Goal:** A scrubable post-session timeline of QoE score, metric overlays, and incident markers.

**Scope:**
- **Replay/Triage Agent**: On session end, reconstructs ordered timeline; writes replay index to `incident_timeline`
- Dashboard "Session Replay" page: line chart of QoE score over session duration; incident markers overlaid; click marker to expand incident detail
- Metric overlay panel: per-incident metric timeseries (bitrate, RTT, loss)
- JSON export of full session timeline
- Session list page updated to show "View Replay" link for ended sessions

**Demo script:**
> End a test session. Navigate to the session replay page. Scrub through the QoE timeline, click an incident marker to expand the metric breakdown. Export the timeline as JSON.

**Exit criteria:**
- Replay page loads and renders QoE timeline for any ended session
- At least 3 incident markers shown with correct timestamps
- JSON export contains all incidents with full metric context

---

### M6 — Hardening, Observability & Developer Experience

**Goal:** A production-quality local development experience and optional observability stack.

**Scope:**
- OpenTelemetry SDK integration across all backend services (traces + metrics)
- Prometheus scrape endpoints on ingestor, qoe-engine, agent-orchestrator
- Grafana dashboard: ingestor throughput, QoE distribution, incident rate, agent latency
- End-to-end integration test suite with simulated WebRTC stats
- Simulated session generator (`packages/session-simulator`) for testing without a live stream
- `README` updated with full developer setup guide
- All environment variable configuration documented

**Demo script:**
> Start the full stack with `docker compose --profile observability up`. Open Grafana at `localhost:3001`. Run the session simulator. Watch ingestor throughput, QoE distribution, and agent recommendation rate populate in real time.

**Exit criteria:**
- All services instrumented with OTel
- Grafana dashboards deployed with `docker compose --profile observability up`
- Session simulator can generate realistic degradation scenarios on demand
- CI passes for all unit and integration tests

---

## Future Milestones (Post-MVP)

| Milestone | Description |
|---|---|
| **M7 — Provider Evaluation Agent** | Cross-provider/configuration QoE comparison reports |
| **M8 — Multi-tenancy** | Org-scoped sessions, role-based access control |
| **M9 — Kafka Integration** | Swap in-process event bus for Kafka using `IEventBus` adapter |
| **M10 — Mobile SDK** | React Native WebRTC stat capture support |
| **M11 — Alert Routing** | Webhook / Slack / PagerDuty integration for critical incidents |

---

## Dependency Map

```
M0 → M1 → M2 → M3 → M4 → M5 → M6
              ↗
         (event-bus types from M2 used in M3+)
```

No milestone has circular dependencies. Each can be branched and developed independently after its predecessor ships.
