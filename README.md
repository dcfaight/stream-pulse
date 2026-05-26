# StreamPulse

> **Agentic livestream quality observability and incident orchestration for WebRTC sessions.**

StreamPulse is a real-time media control plane — not a livestream platform. It captures WebRTC telemetry from broadcaster and viewer sessions, computes deterministic quality-of-experience (QoE) scores, surfaces degradation reasons, and uses an agentic orchestration layer to analyze incidents, recommend mitigations, and support operator workflows.

---

## What It Does

| Capability | Description |
|---|---|
| **Session Telemetry** | Captures bitrate, RTT, packet loss, jitter, frame drops, reconnects, audio health, and connection-state changes from live WebRTC sessions |
| **QoE Scoring** | Deterministically computes per-session and per-segment quality scores and classifies degradation severity |
| **Incident Detection** | Correlates metric anomalies into timeline-stamped incident events with probable root causes |
| **Agentic Recommendations** | Layered AI agents analyze incidents and surface actionable, explainable mitigations for sellers and operators |
| **Incident Replay** | Records a replayable timeline of events for debugging, trust & safety review, and post-session analysis |
| **Operator Workflows** | Supports human-in-the-loop actions such as fallback triggering, overlay reduction, and quality adjustment |

---

## Documentation

| Document | Description |
|---|---|
| [Architecture Overview](docs/architecture/overview.md) | System design, service boundaries, data flows, and agent roles |
| [Product Requirements (PRD)](docs/product/prd.md) | Goals, non-goals, personas, user stories, and acceptance criteria |
| [MVP Roadmap](docs/roadmap/mvp-roadmap.md) | Milestones, deliverables, and scope per phase |
| [Monorepo Structure](docs/development/monorepo-structure.md) | Directory layout, packages, apps, and service descriptions |
| [Initial Issues / Tasks](docs/issues/initial-tasks.md) | Suggested first implementation tasks ready to become GitHub Issues |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 + TypeScript |
| API / Backend | Node.js + TypeScript (Fastify or Express) |
| Realtime | Browser WebRTC (`RTCPeerConnection` / `getStats()`) |
| Database | PostgreSQL (session storage, incidents) + Redis (live state, pub/sub) |
| Event Pipeline | In-process event bus → Kafka-ready interface |
| Agents | TypeScript agent services, OpenAI-compatible LLM via API |
| Observability | OpenTelemetry + Prometheus + Grafana (optional local stack) |
| Monorepo | pnpm workspaces + Turborepo |

---

## Quick Start (M1.5 + First M2 QoE Slice)

```bash
# Prerequisites: Node 20+, pnpm 9+, Docker
git clone https://github.com/dcfaight/stream-pulse.git
cd stream-pulse

# Enable pnpm if not already available
corepack enable
corepack prepare pnpm@9 --activate

# Install workspace deps
pnpm install

# Start Postgres + Redis
docker compose up -d postgres redis

# Run DB migrations
pnpm --filter @stream-pulse/db migrate

# Start ingestor (http://localhost:4001)
pnpm --filter @stream-pulse/ingestor dev

# In another terminal start QoE engine (polls DB and writes qoe_segments)
pnpm --filter @stream-pulse/qoe-engine dev

# In another terminal start dashboard (http://localhost:3000)
pnpm --filter @stream-pulse/dashboard dev
```

---

## Synthetic Telemetry Demo (End-to-End)

Run the session simulator with named scenarios:

```bash
# healthy baseline scenario
pnpm --filter @stream-pulse/session-simulator start -- \
  --scenario healthy --events 20 --intervalMs 1000

# degraded high latency scenario
pnpm --filter @stream-pulse/session-simulator start -- \
  --scenario high-rtt --events 20 --intervalMs 1000

# unstable quality scenario
pnpm --filter @stream-pulse/session-simulator start -- \
  --scenario unstable-session --events 20 --intervalMs 1000
```

Expected result:
- `GET http://localhost:4001/health` returns `{ "status": "ok", "service": "ingestor" }`
- simulator posts telemetry events to `POST /telemetry`
- QoE engine creates `qoe_segments` rows for those sessions
- dashboard home page refreshes every 5 seconds and shows latest metric + QoE score + severity

---

## Design Principles

1. **Deterministic telemetry first** — QoE scoring is always rule-based and auditable; AI is layered on top.
2. **Explainability** — every agent recommendation includes the metric signals that triggered it.
3. **Human-in-the-loop** — high-impact actions require operator confirmation before execution.
4. **Replayability** — every session event is timestamped and stored for post-session replay.
5. **Pragmatic MVP scope** — no production infrastructure required; local Docker compose is sufficient.

---

## Status

🚧 **M1.5 + initial M2 QoE slice in progress**

What is now runnable:
- pnpm workspace install/build/lint/test baseline
- local Postgres + Redis via Docker Compose
- migration runner in `packages/db`
- ingestor with `/health` and `/telemetry`
- session simulator package with predefined scenarios (`healthy`, `high-rtt`, `packet-loss`, `bitrate-drop`, `unstable-session`)
- deterministic QoE engine that writes segment score + severity (`good`, `degraded`, `poor`, `critical`)
- dashboard session/status page with lightweight polling refresh and latest QoE fields

Still deferred for later milestones:
- Agent orchestrator logic
- WebRTC SDK production ingestion path
- Incident detection/timeline and replay workflows
- Recommendation agents and orchestration actions
