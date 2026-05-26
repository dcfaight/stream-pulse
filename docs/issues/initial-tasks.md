# StreamPulse — Initial Implementation Tasks

These tasks are scoped to **M0** (repository scaffold) and **M1** (telemetry ingestion + live dashboard skeleton). Each task is sized as a GitHub Issue. They are ordered by dependency.

---

## M0 — Repository Scaffold

### TASK-001: Initialise monorepo with pnpm workspaces and Turborepo

**Labels:** `setup`, `m0`
**Description:**
Set up the monorepo tooling foundation.

**Acceptance criteria:**
- `pnpm-workspace.yaml` defines `apps/*` and `packages/*`
- `turbo.json` defines `build`, `dev`, `test`, and `lint` tasks with correct `dependsOn` chains
- Root `package.json` has `pnpm` engine constraint (`>=9`) and workspace-level `dev`/`build`/`test`/`lint` scripts
- `README.md` quick-start section works from a fresh clone

---

### TASK-002: Create shared TypeScript and ESLint configs

**Labels:** `setup`, `m0`
**Depends on:** TASK-001
**Description:**
Create `packages/config` with reusable TypeScript and ESLint configurations.

**Acceptance criteria:**
- `packages/config/tsconfig/base.json` — strict mode, `esModuleInterop`, `moduleResolution: bundler`
- `packages/config/tsconfig/node.json` — extends base, targets Node 20
- `packages/config/tsconfig/nextjs.json` — extends base with Next.js plugin settings
- `packages/config/eslint/index.js` — extends `eslint:recommended`, `@typescript-eslint/recommended`, `prettier`
- All `apps/` and `packages/` extend these shared configs
- `pnpm lint` passes at root with zero errors on empty packages

---

### TASK-003: Create `packages/types` — shared type definitions

**Labels:** `setup`, `m0`
**Depends on:** TASK-002
**Description:**
Scaffold all shared TypeScript types used across services.

**Files to create:**
- `session.ts` — `SessionInfo`, `SessionStatus` (`active | ended | error`)
- `metrics.ts` — `StatSnapshot`, `MetricEvent`, `DerivedMetrics` (bitrate, RTT, loss, jitter, frameDrops, audioLevel)
- `qoe.ts` — `QoESegment`, `QoEEvent`, `Severity` (`good | degraded | poor | critical`)
- `incident.ts` — `Incident`, `AnomalyEvent`, `IncidentTimelineEntry`
- `agent.ts` — `AgentResult`, `Recommendation`, `OperatorAction`, `AgentTrigger`
- `index.ts` — barrel re-export

**Acceptance criteria:**
- All types are exported and importable from `@stream-pulse/types`
- No runtime code — types only
- `pnpm build` passes for this package

---

### TASK-004: Add `docker-compose.yml` with Postgres and Redis

**Labels:** `setup`, `m0`, `infrastructure`
**Depends on:** TASK-001
**Description:**
Create the base Docker Compose file for local development infrastructure.

**Acceptance criteria:**
- `docker-compose.yml` starts Postgres 16 and Redis 7
- Postgres initialises with `streampulse` database and user
- Health checks configured for both services
- `.env.example` documents `DATABASE_URL` and `REDIS_URL`
- `docker compose up -d postgres redis` and `docker compose down` work cleanly

---

### TASK-005: Create `packages/db` — database client and schema

**Labels:** `setup`, `m0`, `database`
**Depends on:** TASK-003, TASK-004
**Description:**
Set up the shared database client and initial schema migration.

**Acceptance criteria:**
- Postgres client initialised (recommend `postgres.js` or `pg`)
- Migration script (`001_initial.sql`) creates tables:
  - `sessions` — `id uuid pk`, `broadcaster_id text`, `started_at timestamptz`, `ended_at timestamptz`, `status text`
  - `metric_events` — `id uuid pk`, `session_id uuid`, `ts timestamptz`, `metric_type text`, `value numeric`, `raw_payload jsonb`
  - `qoe_segments` — `id uuid pk`, `session_id uuid`, `start_ts timestamptz`, `end_ts timestamptz`, `score numeric`, `severity text`, `signals jsonb`
  - `incidents` — `id uuid pk`, `session_id uuid`, `started_at timestamptz`, `resolved_at timestamptz`, `root_cause text`, `confidence numeric`, `severity text`
  - `incident_timeline` — `id uuid pk`, `incident_id uuid`, `ts timestamptz`, `event_type text`, `payload jsonb`
  - `agent_recommendations` — `id uuid pk`, `incident_id uuid`, `agent_name text`, `created_at timestamptz`, `rationale text`, `action_type text`, `status text`
  - `operator_actions` — `id uuid pk`, `recommendation_id uuid`, `operator_id text`, `decided_at timestamptz`, `decision text`, `notes text`
- `pnpm --filter @stream-pulse/db migrate` runs migrations against local Postgres
- Package exports typed query helpers for each table

---

## M1 — Telemetry Ingestion + Live Dashboard Skeleton

### TASK-006: Scaffold `packages/webrtc-sdk`

**Labels:** `m1`, `sdk`
**Depends on:** TASK-003
**Description:**
Create the browser-side WebRTC stat capture SDK.

**Acceptance criteria:**
- `poller.ts`: polls `RTCPeerConnection.getStats()` at a configurable interval (default 1000 ms); calls a user-supplied callback with a `StatSnapshot`
- `normaliser.ts`: maps raw `RTCStatsReport` entries to canonical `StatSnapshot` type; handles Chrome stat naming
- `sender.ts`: opens a WebSocket to the ingestor, sends `StatSnapshot` frames as JSON, reconnects with exponential back-off (max 5 retries)
- `index.ts`: exports `createSessionClient(peerConnection, options)` function
- `hooks/useSessionStats.ts`: React hook wrapping the SDK for dashboard use
- Unit tests for normaliser covering Chrome stat shapes
- Builds as ESM + CJS dual output for browser and Node (test) compatibility

---

### TASK-007: Scaffold `packages/event-bus`

**Labels:** `m1`, `infrastructure`
**Depends on:** TASK-003
**Description:**
Create the typed in-process event bus with a Kafka-ready interface.

**Acceptance criteria:**
- `interface.ts` defines `IEventBus<Topics>` with `publish(topic, payload)` and `subscribe(topic, handler)` methods
- `in-process.ts` implements `IEventBus` using Node.js `EventEmitter`
- `topics.ts` exports topic name constants: `METRIC_RAW`, `QOE_SCORED`, `INCIDENT_DETECTED`, `RECOMMENDATION_CREATED`, `ACTION_REQUESTED`
- Full type inference: `subscribe('qoe.scored', handler)` infers the correct payload type for `handler`
- Unit tests for publish/subscribe round-trip

---

### TASK-008: Scaffold `apps/ingestor` — Telemetry Ingestion Service

**Labels:** `m1`, `backend`
**Depends on:** TASK-005, TASK-006, TASK-007
**Description:**
Create the telemetry ingestion backend service.

**Acceptance criteria:**
- Fastify server with WebSocket plugin accepting connections at `/ws/stats`
- On each `StatSnapshot` frame received:
  1. Validate shape (reject malformed frames with log warning)
  2. Normalise to `MetricEvent` (compute bitrate Δ, loss rate, jitter from counter deltas)
  3. Write `MetricEvent` to `metric_events` table
  4. Update Redis hash `session:{id}:metrics` with latest values
  5. Publish `MetricEvent` to event bus `metric.raw` topic
- `POST /sessions/start` and `POST /sessions/:id/end` REST endpoints
- `GET /health` endpoint returns `{ status: "ok" }`
- Connection state changes captured as `MetricEvent` with `metric_type: "connection_state"`
- Integration test: send 10 stat frames, verify DB row count and Redis state

---

### TASK-009: Scaffold `apps/dashboard` — Live Monitor page

**Labels:** `m1`, `frontend`
**Depends on:** TASK-006, TASK-008
**Description:**
Create the Next.js dashboard with a working Live Monitor page.

**Acceptance criteria:**
- Next.js 14 App Router project initialised in `apps/dashboard`
- Session list page (`/`) shows active sessions from API with status indicator
- Live Monitor page (`/monitor/[sessionId]`) shows:
  - Bitrate tile (current value + trend arrow)
  - RTT tile
  - Packet loss tile (%)
  - Jitter tile (ms)
  - Connection state badge
  - All tiles update via SSE or WebSocket at ≤ 2 s interval
- `useSessionStats` hook consumes SSE stream from ingestor Redis pub/sub (via API route)
- Responsive layout; colour-coded severity for each metric tile
- No external UI component library required in M1 (plain Tailwind CSS)

---

### TASK-010: End-to-end M1 smoke test

**Labels:** `m1`, `testing`
**Depends on:** TASK-008, TASK-009
**Description:**
Write an end-to-end smoke test that validates the full M1 telemetry pipeline.

**Acceptance criteria:**
- Test script uses the session simulator (or inline stat frames) to send 30 s of simulated stats to the ingestor
- Verifies:
  - `metric_events` rows created in Postgres
  - Redis `session:{id}:metrics` hash updated
  - Dashboard SSE stream emits at least 10 update events
- Test runs in `< 60 s` in CI
- Documented in `README.md` under "Running Tests"

---

## M2 Preview — QoE Engine (to be detailed after M1 ships)

### TASK-011: Scaffold `apps/qoe-engine` *(preview)*

**Labels:** `m2`, `backend`
**Description:**
The QoE engine will be detailed when M1 exits. At minimum it will:
- Consume `metric.raw` events from the event bus
- Compute per-10-s segment QoE score using the weighted model in the architecture doc
- Emit `QoEEvent` and write `qoe_segments` rows to Postgres
- Expose a `GET /sessions/:id/qoe` endpoint

---

## Notes for Issue Creation

- Tag each issue with the milestone label (`m0`, `m1`, etc.) and a type label (`setup`, `backend`, `frontend`, `database`, `sdk`, `infrastructure`, `testing`)
- Link issues with "depends on" relationships using GitHub's "linked issues" feature
- Assign all M0 issues before opening any M1 issues
- Keep issues small enough to be completed in 1–2 days of solo development time
