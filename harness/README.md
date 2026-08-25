# TripForge DeepSeek Harness

This directory is the independently deployable agent runtime for TripForge.
FastAPI remains the product API and system of record; this service owns agent
orchestration, tool execution, session continuation, and agent-runtime events.

DeepSeek Harness is currently in developer preview. Keep all DeepSeek-specific
APIs behind adapters in this directory so breaking upstream changes do not leak
into the FastAPI or frontend contracts.

## Target architecture

```text
Next.js UI
    | create/status/SSE/approval
    v
FastAPI product API
    | authenticated internal run protocol
    v
harness/ DeepSeek Harness service
    |-- supervisor
    |-- trip-scope
    |-- stay-research ---------+
    |-- activity-research -----+ parallel after shared scope
    |-- travel-research -------+
    |-- itinerary
    |-- validator
    `-- narrow TripForge tools
```

## Ownership boundaries

FastAPI owns:

- Supabase authentication and trip ownership
- conversations, messages, run metadata, artifacts, and approvals
- the public `/api/v1` contract and browser-facing SSE stream
- validation of agent outputs before persistence
- cancellation, rate limiting, and user-visible error policy

The harness owns:

- DeepSeek Harness configuration and plugins
- multi-agent delegation and concurrency
- model context, prompts, skills, and tool selection
- durable runtime session identifiers and resumable execution
- raw runtime events, which are translated before leaving FastAPI

Shared deterministic domain logic should remain in FastAPI or move into a
framework-neutral package. Budget arithmetic, dates, geographic compatibility,
schema validation, authorization, and database writes must not depend on an LLM.

## Stable integration contract

The browser contract should remain compatible with the current UI. FastAPI maps
harness events to the existing `RunEvent` envelope:

```json
{
  "sequence": 7,
  "run_id": "uuid",
  "type": "agent.progress",
  "agent": "activity_research",
  "message": "Comparing places near the selected base",
  "data": {}
}
```

Do not expose hidden model reasoning, raw prompts, credentials, or unrestricted
tool arguments. Publish concise progress, sources, warnings, tool outcomes, and
approval requests.

The internal FastAPI-to-harness protocol should support:

- start a run with an idempotency key
- stream normalized runtime events
- retrieve a run snapshot/result
- resume with clarification or approval input
- cancel a run
- report health and runtime/plugin versions

The transport can begin as loopback HTTP plus SSE. Production deployment should
use a private network, service authentication, explicit timeouts, and a durable
event broker before scaling either service horizontally.

## Proposed directory layout

```text
harness/
|-- README.md
|-- package.json
|-- .env.example
|-- src/
|   |-- server.mjs
|   |-- config.mjs
|   |-- runtime.mjs
|   |-- agents/
|   |   |-- supervisor.py
|   |   |-- trip_scope.py
|   |   |-- stay_research.py
|   |   |-- activity_research.py
|   |   |-- travel_research.py
|   |   |-- itinerary.py
|   |   `-- validator.py
|   |-- tools/
|   |   |-- tripforge_client.py
|   |   |-- places.py
|   |   |-- routes.py
|   |   `-- weather.py
|   `-- contracts/
|       |-- commands.py
|       |-- events.py
|       `-- results.py
`-- tests/
    |-- contract/
    `-- integration/
```

The exact plugin entry points must be confirmed against the pinned DeepSeek
Harness version before scaffolding them.

## Current implementation slice

The checked-in scaffold is intentionally smaller than the target layout:

- `src/server.mjs` provides health and authenticated NDJSON execution endpoints.
- `src/runtime.mjs` provides deterministic fake mode and the native CLI adapter.
- `src/config.mjs` validates runtime configuration.
- `test/runtime.test.mjs` verifies the Windows command and execution contract.

Fake mode and the official Node CLI run natively on Windows. The published Python
SDK's persistent PTY composition still requires POSIX, so TripForge uses the Node
headless profile on Windows and keeps the Python SDK out of this service. Production
should still use a pinned package and a least-privilege preset with narrow travel tools.

### Active TripForge plugin policy

`config/tripforge.patch.yml` is applied to every headless run. It retains the core
model/agent/session loop, credentials, JSONL persistence, retry and timeout policy,
token metering, compaction, checkpoints, spill handling, sandbox/permissions, and
spawn-based subagents.

It disables coding shell and filesystem tools, skills, goals, todos, plan mode,
Ralph, generic workflows, forked subagents, attachments, SQLite session search,
telemetry, the extra title-model call, generic DeepSeek web search, and all
browser/interactive facilities. Do not remove their npm packages: the distribution
owns those dependencies, while the Cordis patch owns which plugins activate.

### TripForge plugins to add

These should be narrow TripForge-owned plugins, not general browser or shell tools.
Implement them in this order:

| Priority | Plugin | Responsibility | Decision |
| --- | --- | --- | --- |
| 1 | `tripforge-contracts` | Validate question, hotel, itinerary, source, and progress event schemas | Required before any provider tool |
| 2 | `tripforge-progress` | Publish safe agent/tool lifecycle events to the NDJSON stream | Required for the existing live frontend |
| 3 | `google-places` | Text search, place details, photos, ratings, and stable place IDs | Read-only; port the existing backend client first |
| 4 | `google-routes` | Route matrix, durations, distances, and daily route geometry | Read-only; keep compatibility math deterministic |
| 5 | `tripvlog-properties` | Hotel identity enrichment, offers, availability, rooms, reviews, and media | Read-only until approval infrastructure exists |
| 6 | `tripforge-decisions` | Scope, compatibility ranking, itinerary assignment, budget calculation, and validation | Model ranks; deterministic code enforces constraints |
| 7 | `tripforge-approvals` | Draft/confirm boundary for booking or other consequential writes | Add only when write actions enter scope |

Optional read-only plugins come later: weather for date-aware planning, currency for
budget normalization, and official travel-advisory/time-zone data. Keep generic web
search, browser automation, filesystem, shell, built-in interactive questions, and
direct booking plugins disabled for the current product.

Run the current scaffold:

```powershell
$env:HARNESS_MODE="fake"
$env:HARNESS_SERVICE_TOKEN="local-development-token"
npm.cmd start
```

## Migration plan

### Phase 1: Freeze contracts and add a seam

1. Capture the current create-run, snapshot, clarification, result, and SSE
   behavior in contract tests.
2. Introduce an `AgentRuntime` interface in FastAPI.
3. Adapt the current LangGraph implementation to that interface without changing
   behavior.
4. Move persistence and event publication out of the LangGraph-specific manager.

Exit condition: the current test suite passes through the runtime interface.

### Phase 2: Bootstrap DeepSeek Harness

1. Pin a tested DeepSeek Harness package/commit.
2. Add the local service, configuration validation, health endpoint, and structured
   logging under this directory.
3. Implement session start, event streaming, snapshot, resume, and cancellation.
4. Add a fake runtime so backend and harness contract tests do not require a model.

Exit condition: FastAPI can start a fake harness run and replay its events.

### Phase 3: Port tools before agents

1. Expose narrow, authenticated TripForge tool endpoints or a shared internal tool
   service for places, routes, travel information, and draft persistence.
2. Define JSON schemas, timeouts, retry classes, and permission levels.
3. Keep write tools draft-only; require FastAPI approval for consequential actions.
4. Add malicious/invalid tool-output tests and redact secrets from logs.

Exit condition: harness tool calls return grounded, schema-valid provider data.

### Phase 4: Build the multi-agent preset

1. Port supervisor and clarification behavior.
2. Port trip scope as the mandatory shared constraint step.
3. Run stay, activity, and travel research concurrently only after scope completes.
4. Port itinerary creation and deterministic budget/compatibility calls.
5. Port validator with bounded, targeted retry routing.

Exit condition: representative trips produce schema-compatible results and no
agent invents provider entities.

### Phase 5: Shadow comparison

1. Add `AGENT_RUNTIME=langgraph|deepseek|shadow` configuration.
2. In shadow mode, return the LangGraph result while running DeepSeek asynchronously
   on test/internal traffic.
3. Compare completion rate, grounding, validation failures, latency, token cost,
   and event quality.
4. Store sanitized comparison metrics, not hidden reasoning.

Exit condition: DeepSeek meets agreed quality and reliability thresholds.

### Phase 6: Cut over and remove LangGraph

1. Make DeepSeek the default behind a deployment flag.
2. Retain an immediate rollback path for at least one release.
3. Remove `backend/app/graph`, agent implementations, LangGraph dependencies, and
   LangSmith-specific wiring only after the rollback window.
4. Rename or remove the old `backend/app/harness` package once persistence/event
   responsibilities have moved to framework-neutral modules.
5. Update backend documentation, deployment manifests, and environment examples.

Exit condition: no production path imports LangGraph and rollback evidence is
documented.

## Initial agent topology

```text
Supervisor
    |-- clarification needed -> pause
    `-- trip request
            v
        Trip Scope
            |-- Stay Research ---------+
            |-- Activity Research -----+ join
            `-- Travel Research -------+
                                        v
                              Compatibility + Ranking
                                        v
                                    Itinerary
                                        v
                              Budget + Validator
                              | valid     | invalid
                              v           `-> targeted retry (bounded)
                            result
```

Start with these seven roles. Additional agents should be introduced only when a
distinct context, permission boundary, or independently retryable responsibility
justifies them.

## Safety and operational requirements

- Harness credentials remain server-side and never use `NEXT_PUBLIC_` variables.
- Every internal request carries service authentication and a TripForge run ID.
- Tools use allowlists and typed schemas; there is no unrestricted shell tool in
  deployed presets.
- Cancellation propagates from browser to FastAPI to the harness.
- Every run has maximum duration, model/tool budgets, and bounded retries.
- Event ordering and replay survive reconnects and service restarts before
  multi-instance deployment.
- User or provider content is treated as untrusted input and cannot grant tools or
  override system permissions.
- Booking, payment, messaging, deletion, and confirmed itinerary changes require
  explicit approval enforced by FastAPI.

## First implementation slice

Build one vertical slice before porting the full graph:

```text
prompt -> FastAPI -> DeepSeek supervisor -> progress events -> structured
clarification OR general response -> persisted artifact -> existing UI
```

This validates deployment, streaming, sessions, and contracts with the smallest
possible migration surface.

## Frontend boundary and generated questions

The browser talks only to FastAPI. FastAPI owns authentication, conversation/run
persistence, replayable SSE, approvals, and the private Harness service token. The
Harness service is never exposed through a `NEXT_PUBLIC_` variable or called directly
from the browser.

Harness may compose clarification UI using the versioned `ui_schema_version: "1"`
contract. Supported fields are single-select, multi-select, text, textarea, location,
number, date, and boolean. Harness output is normalized first, validated again by
FastAPI, and then rendered by the frontend as native controls. Arbitrary HTML,
JavaScript, CSS, component names, and unknown field types are rejected. The built-in
interactive `user-questions` Harness plugin stays disabled because TripForge owns this
headless pause/resume experience.

```text
browser -> FastAPI create run -> private Harness NDJSON stream
        <- FastAPI SSE events <- progress / validated clarification
browser -> FastAPI answer run (parent_run_id) -> private Harness continuation
```
