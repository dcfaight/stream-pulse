# StreamPulse — Monorepo Structure

## Tooling

| Tool | Purpose |
|---|---|
| **pnpm workspaces** | Package manager and workspace root |
| **Turborepo** | Build orchestration, caching, task pipelines |
| **TypeScript** | All packages and apps (strict mode) |
| **ESLint + Prettier** | Linting and formatting (shared config package) |
| **Vitest** | Unit and integration testing |
| **Docker Compose** | Local multi-service development |

---

## Directory Tree

```
stream-pulse/
├── apps/
│   ├── dashboard/              # Next.js 14 operator/seller UI (TypeScript)
│   │   ├── app/                # Next.js App Router pages
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx        # Session list / home
│   │   │   ├── monitor/
│   │   │   │   └── [sessionId]/page.tsx   # Live Monitor view
│   │   │   ├── incidents/
│   │   │   │   └── [sessionId]/page.tsx   # Incident Feed view
│   │   │   ├── recommendations/
│   │   │   │   └── page.tsx    # Recommendation Panel (HiTL)
│   │   │   └── replay/
│   │   │       └── [sessionId]/page.tsx   # Session Replay view
│   │   ├── components/         # React components (MetricTile, IncidentCard, etc.)
│   │   ├── hooks/              # React hooks (useSessionStats, useIncidentFeed, etc.)
│   │   ├── lib/                # API clients, WebSocket helpers
│   │   ├── public/
│   │   ├── next.config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── ingestor/               # Telemetry Ingestion Service (Node.js / Fastify)
│   │   ├── src/
│   │   │   ├── index.ts        # Service entry point
│   │   │   ├── server.ts       # Fastify app setup
│   │   │   ├── ws/             # WebSocket handler
│   │   │   │   └── stats-handler.ts
│   │   │   ├── normaliser/     # Browser stat shape normalisation
│   │   │   │   ├── chrome.ts
│   │   │   │   ├── firefox.ts
│   │   │   │   └── index.ts
│   │   │   ├── metrics/        # Derived metric computation (bitrate Δ, loss rate, jitter)
│   │   │   │   └── compute.ts
│   │   │   ├── state/          # Redis live state writer
│   │   │   │   └── redis-writer.ts
│   │   │   └── routes/         # REST routes (health, session management)
│   │   ├── test/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── qoe-engine/             # QoE Scoring Engine (Node.js)
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── scorer/         # QoE scoring formula (deterministic)
│   │   │   │   ├── score.ts    # Weighted score computation
│   │   │   │   ├── severity.ts # Severity classifier
│   │   │   │   └── thresholds.ts
│   │   │   ├── window/         # Metric windowing (10 s segments)
│   │   │   │   └── segment.ts
│   │   │   └── store/          # Postgres qoe_segments writer
│   │   │       └── qoe-store.ts
│   │   ├── test/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── agent-orchestrator/     # Agentic Orchestration Service (Node.js)
│       ├── src/
│       │   ├── index.ts
│       │   ├── agents/
│       │   │   ├── session-health-analyst.ts
│       │   │   ├── incident-correlator.ts
│       │   │   ├── seller-assistant.ts
│       │   │   └── replay-triage.ts
│       │   ├── llm/            # LLM client abstraction (OpenAI-compatible)
│       │   │   ├── client.ts
│       │   │   └── prompts/
│       │   ├── store/          # agent_recommendations, operator_actions writers
│       │   └── types.ts        # AgentContext, AgentResult types
│       ├── test/
│       ├── package.json
│       └── tsconfig.json
│
├── packages/
│   ├── types/                  # Shared TypeScript types (used by all apps + packages)
│   │   ├── src/
│   │   │   ├── session.ts      # SessionInfo, SessionStatus
│   │   │   ├── metrics.ts      # StatSnapshot, MetricEvent, DerivedMetrics
│   │   │   ├── qoe.ts          # QoEEvent, QoESegment, Severity
│   │   │   ├── incident.ts     # Incident, IncidentTimeline, AnomalyEvent
│   │   │   ├── agent.ts        # AgentResult, Recommendation, OperatorAction
│   │   │   └── index.ts        # Barrel re-export
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── webrtc-sdk/             # Browser WebRTC stat capture SDK
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── poller.ts       # getStats() polling loop
│   │   │   ├── normaliser.ts   # Canonical StatSnapshot shape
│   │   │   ├── sender.ts       # WebSocket transport with reconnect
│   │   │   └── hooks/
│   │   │       └── useSessionStats.ts   # React hook for dashboard
│   │   ├── test/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── event-bus/              # Typed in-process event bus (Kafka-ready interface)
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── interface.ts    # IEventBus<T> interface
│   │   │   ├── in-process.ts   # EventEmitter-backed implementation
│   │   │   └── topics.ts       # Topic name constants
│   │   ├── test/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── db/                     # Database client, schema, and migrations
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── client.ts       # Postgres client (pg / postgres.js)
│   │   │   ├── schema/         # SQL schema files (or Drizzle ORM schema)
│   │   │   │   └── 001_initial.sql
│   │   │   └── migrations/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── config/                 # Shared ESLint, Prettier, TypeScript base configs
│   │   ├── eslint/
│   │   │   └── index.js
│   │   ├── prettier/
│   │   │   └── index.js
│   │   └── tsconfig/
│   │       ├── base.json
│   │       ├── nextjs.json
│   │       └── node.json
│   │
│   └── session-simulator/      # (M6) Synthetic WebRTC stat generator for testing
│       ├── src/
│       │   ├── index.ts
│       │   ├── scenarios/      # Degradation scenarios (packet loss, bandwidth drop, etc.)
│       │   └── emitter.ts      # Sends simulated stats to ingestor
│       ├── package.json
│       └── tsconfig.json
│
├── infra/
│   ├── docker/
│   │   ├── ingestor.Dockerfile
│   │   ├── qoe-engine.Dockerfile
│   │   └── agent-orchestrator.Dockerfile
│   └── grafana/
│       └── dashboards/
│           └── stream-pulse-overview.json
│
├── docs/
│   ├── architecture/
│   │   └── overview.md
│   ├── product/
│   │   └── prd.md
│   ├── roadmap/
│   │   └── mvp-roadmap.md
│   ├── development/
│   │   └── monorepo-structure.md    # This file
│   └── issues/
│       └── initial-tasks.md
│
├── .env.example                # Environment variable template
├── docker-compose.yml          # Core services (postgres, redis, ingestor, qoe-engine, agent-orch, dashboard)
├── docker-compose.observability.yml  # Optional: prometheus, grafana
├── package.json                # pnpm workspace root
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.json               # Root TypeScript config (references only)
├── .eslintrc.js                # Root ESLint config
├── .prettierrc.js
└── README.md
```

---

## Package Dependency Graph

```
apps/dashboard         → packages/types, packages/webrtc-sdk
apps/ingestor          → packages/types, packages/event-bus, packages/db
apps/qoe-engine        → packages/types, packages/event-bus, packages/db
apps/agent-orchestrator → packages/types, packages/event-bus, packages/db
packages/webrtc-sdk    → packages/types
packages/event-bus     → packages/types
packages/db            → (external: postgres, redis)
packages/session-simulator → packages/types, packages/webrtc-sdk
```

No circular dependencies. `packages/types` is the only leaf dependency.

---

## Workspace Configuration

### `pnpm-workspace.yaml`

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

### `turbo.json` (key tasks)

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "dependsOn": ["^build"],
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "lint": {}
  }
}
```

---

## Environment Variables

All services read configuration from environment variables. The `.env.example` file at the repo root documents all required and optional variables:

```
# Postgres
DATABASE_URL=postgresql://streampulse:streampulse@localhost:5432/streampulse

# Redis
REDIS_URL=redis://localhost:6379

# LLM (required for agentic features; omit for rule-based fallback)
LLM_API_KEY=
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini

# Ingestor
INGESTOR_PORT=4001
INGESTOR_WS_PATH=/ws/stats

# QoE Engine
QOE_ENGINE_PORT=4002
QOE_SEGMENT_WINDOW_MS=10000

# Agent Orchestrator
AGENT_ORCHESTRATOR_PORT=4003

# Dashboard
NEXT_PUBLIC_INGESTOR_WS_URL=ws://localhost:4001/ws/stats
NEXT_PUBLIC_API_BASE_URL=http://localhost:4003

# Observability (optional)
ENABLE_OTEL=false
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

---

## Local Development Commands

```bash
# Install all dependencies
pnpm install

# Start all services in dev mode (uses docker compose for postgres + redis)
docker compose up -d postgres redis
pnpm dev

# Run all tests
pnpm test

# Build all packages and apps
pnpm build

# Lint all packages
pnpm lint

# Start with optional observability stack
docker compose -f docker-compose.yml -f docker-compose.observability.yml up -d
```

---

## Service Ports (Local)

| Service | Port | Protocol |
|---|---|---|
| dashboard | 3000 | HTTP / WebSocket |
| ingestor | 4001 | HTTP / WebSocket |
| qoe-engine | 4002 | HTTP (internal) |
| agent-orchestrator | 4003 | HTTP |
| postgres | 5432 | TCP |
| redis | 6379 | TCP |
| prometheus | 9090 | HTTP |
| grafana | 3001 | HTTP |
