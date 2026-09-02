# TripForge DeepSeek Harness

For the implemented end-to-end architecture, plugin responsibilities, data flow,
and design rationale, see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

This directory is the independently deployable agent runtime for TripForge.
FastAPI remains the product API and system of record; this service owns agent
orchestration, tool execution, transient model context, and agent-runtime events.

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
- ephemeral per-run DSH execution and deterministic correlation identifiers
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
- `src/inspect.mjs` boots the local DeepSeek Web/Trajectory inspector with the
  production TripForge composition plus a Web-only service override.
- `src/plugin-patch.mjs` generates portable literal file URLs for local plugins;
  plugin paths are never evaluated as JavaScript configuration objects.
- `src/config.mjs` validates runtime configuration.
- `prompts/supervisor.md` owns the shared agent persona used by Headless and Inspector.
- `prompts/headless-task.md` owns the backend execution/output contract prompt.
- `plugins/progress` emits sanitized tool lifecycle events into the existing NDJSON/SSE path.
- `plugins/google-places` registers the typed, read-only `search_google_places` tool.
- `plugins/google-routes` registers the typed, read-only `compute_google_route` tool.
- `test/` verifies Windows startup, contracts, progress framing, provider normalization,
  cancellation boundaries, and safe provider failures without using live credentials.

Fake mode and the official Node CLI run natively on Windows. The published Python
SDK's persistent PTY composition still requires POSIX, so TripForge uses the Node
headless profile on Windows and keeps the Python SDK out of this service. Production
should still use a pinned package and a least-privilege preset with narrow travel tools.

## Migration checkpoint — 2026-08-26

This is the continuation point for `feature/deepseek-harness`.

### Completed

- [x] Created an independently runnable Node Harness service under `harness/`.
- [x] Added authenticated `POST /internal/v1/execute` NDJSON execution and `/health`.
- [x] Added fake and native DeepSeek CLI runtime modes with Windows-safe process startup,
  cancellation, timeouts, output limits, and stderr logging.
- [x] Added the FastAPI `AgentRuntime` boundary with LangGraph and private Harness HTTP
  adapters; the browser continues to call FastAPI only.
- [x] Added `AGENT_RUNTIME=langgraph|deepseek`, Harness service settings, health reporting,
  and shutdown handling in FastAPI.
- [x] Pinned DeepSeek Harness `0.1.1-rc.2` and added the least-privilege
  `config/tripforge.patch.yml` composition.
- [x] Disabled generic coding, filesystem, shell, interactive-question, browser-search,
  workflow, telemetry, and task-management plugins that TripForge does not need.
- [x] Added schema-v1 headless clarification output with normalization in Harness and a
  second validation boundary in FastAPI.
- [x] Added a flexible frontend question renderer for select, multi-select, text,
  textarea, location, number, date, date-range, and boolean fields.
- [x] Preserved the FastAPI/SSE pause-and-resume flow using `parent_run_id`; Harness
  credentials and provider keys never reach the browser.
- [x] Added the `tripforge-progress` plugin and runtime framing for sanitized
  agent, answer-preparation, and `tool.started`, `tool.completed`, and `tool.failed`
  lifecycle events. Private reasoning and raw model output are never published.
- [x] Streamed throttled model phases and bounded latency/token metrics from native
  DSH session events while explicitly discarding reasoning-delta text.
- [x] Added the `submit_trip_response` terminal tool and a private result frame so
  a validated structured response ends the turn without waiting for a lingering
  Headless process or requiring another model-formatting pass.
- [x] Compacted model input to authoritative planning fields and at most four useful,
  non-duplicate conversation turns; browser/run identifiers never enter the prompt.
- [x] Added the versioned public activity contract at the FastAPI boundary with an
  event allowlist, bounded fields, secret redaction, and fail-closed handling for
  unknown Harness event types.
- [x] Replaced the frontend's single transient thinking row with an expandable live
  activity timeline. Tool calls are paired with their outcomes and durations, the
  timeline is persisted with run events, and completed conversations rehydrate it.
- [x] Hardened long-running turns with safe seven-second activity heartbeats, explicit
  terminal NDJSON failure frames, actionable browser errors, and sanitized Harness logs.
- [x] Hardened provider output parsing so wrapped JSON still reaches the question/result
  contracts instead of appearing as raw JSON in chat.
- [x] Normalized combined adult-and-child questions to flexible text inputs in both the
  Harness result boundary and frontend, while retaining numeric controls for one count.
- [x] Made clarification answers authoritative in the headless continuation prompt so
  completed fields are not requested again.
- [x] Made Supabase the durable conversation source: FastAPI reloads trusted message
  context and merges persisted clarification answers/draft before every Harness turn.
- [x] Moved production DSH transcripts and plugin patches into a temporary per-run
  directory that is removed after completion instead of accumulating in the repository.
- [x] Replaced the English rule-based fast intake with model-driven multilingual
  understanding so questions adapt to the user's language, wording, region, and scenario.
- [x] Made structured answers such as date ranges JSON-safe at the Supabase boundary;
  failed pre-run submissions now preserve the form without adding duplicate messages.
- [x] Compacted live planning activity to one current row per agent while preserving
  request milestones and paired provider tool calls.
- [x] Added grounded hotel-selection guidance so the model can offer 3–5 Google Places
  matches as an interactive single-choice question before continuing the plan.
- [x] Added a bounded absolute run limit and provider answer budget; the Mistral
  Medium 3.5 profile uses low reasoning with an 8,192-token response cap.
  A turn that reaches the token ceiling before submitting its terminal response gets
  one concise recovery attempt instead of failing silently.
- [x] Added dynamic multi-round intake that preserves confirmed facts, asks only the
  next high-value missing details, and avoids repeating questions across turns.
- [x] Added a bounded structured presentation contract for compact trip answers, plus
  grounded hotel-choice cards with Google rating, address, Maps links, and photo metadata.
- [x] Added backend-generated, same-origin photo URLs so the browser renders hotel media
  without receiving a Google API key or calling Google Places directly.
- [x] Restricted the assistant to general travel guidance, hotel or historical-place
  search, and full trip planning, with multilingual semantic scope classification.
- [x] Kept the internal `submit_trip_response` terminal call out of public activity
  events and frontend source-check counts.
- [x] Normalized enriched hotel choices to lossless JSON before returning the terminal
  tool result, omitting absent optional provider fields instead of emitting `undefined`.
- [x] Added a provider-wide rate-limit cooldown that stops repeated `429` requests and
  returns a safe wait-and-retry message while preserving submitted trip details.
- [x] Added the typed, read-only `search_google_places` plugin with bounded requests,
  fixed-host enforcement, cancellation, normalized provider IDs, and native Harness
  inspector presentation metadata.
- [x] Added the typed, read-only `compute_google_route` plugin with grounded-location
  requirements, optimized round trips, normalized legs/duration/polyline, fixed-host
  enforcement, cancellation, and inspector metadata. It remains installed but is
  disabled by default behind `TRIPFORGE_GOOGLE_ROUTES_ENABLED`.
- [x] Extracted agent instructions into the versioned `prompts/` directory with
  bounded file loading and explicit template substitution.
- [x] Added the local Inspector launcher using DeepSeek Harness Web and its native
  Trajectory viewer with the same patch, tools, model, and read-only permissions as
  production.
- [x] Isolated Inspector runtime/session files in an OS temporary directory, remove them
  on normal Inspector exit, and bind the Web profile to `127.0.0.1` only.
- [x] Replaced Windows `.cmd` child launching with the pinned DSH JavaScript entrypoint
  through Node, avoiding `spawn EINVAL` without enabling a command shell.
- [x] Added a generated local-plugin patch with literal module URLs and a separate
  Inspector-only patch for the browser services excluded from production Headless.
- [x] Added plugin activation reporting to Harness `/health`.
- [x] Added mocked Google provider, plugin-registration, persistence, progress-contract,
  HTTP, and Windows launcher tests. The Harness suite currently passes 49 tests; the Next.js
  production build and ESLint also passed during this checkpoint.
- [x] Verified the custom composition loads in both pinned Headless and Web profiles
  without making a model call.

### Started but incomplete

- [ ] Run a live `search_google_places` prompt with a restricted Google key and inspect
  the resulting model/tool behavior. Unit tests currently use mocked responses only.
- [ ] Restore the full legacy LangGraph backend test suite on this Windows host. The
  Python 3.12 environment is repaired, but six legacy local-planner/API assertions are
  currently out of sync with the newer clarification behavior.

### Not started

- [ ] `tripvlog-properties` plugin for hotel offers, availability, rooms, reviews, and
  media.
- [ ] Optional weather, currency, timezone, and official travel-advisory plugins.
- [ ] Specialized Trip Scope, Stay Research, Activity Research, Travel Research,
  Compatibility, Itinerary, Budget, and Validator Harness agent presets.
- [ ] Deterministic compatibility, budget, and validation modules callable by those
  agents.
- [ ] Versioned Harness hotel-search and full `TripPlan` result production. The current
  native migration slice returns general or clarification results only.
- [ ] Approval plugin and FastAPI confirmation boundary for any future booking/write
  action.
- [ ] Shadow comparison against LangGraph, quality/cost/latency evaluation, DeepSeek
  cutover, rollback window, and removal of the legacy graph implementation.
- [ ] Durable shared run/event infrastructure for multiple FastAPI workers.

### Recommended next session

1. Recreate the backend virtual environment and run all Python tests.
2. Browser-check the compact trip response and grounded hotel-choice cards with a live,
   read-only Google Places prompt.
3. Implement `tripvlog-properties` for live price and availability data using the same
   typed-tool and mocked-provider pattern.
4. Expand the structured presentation contract into the versioned full `TripPlan` result.

Before committing, keep `harness/.env` and `backend/.env` untracked, and rotate any API
key that has appeared in chat or screenshots. Legacy `.dsh-*` and `.workspaces*`
directories remain ignored until they are manually removed.

### Active TripForge plugin policy

`config/tripforge.patch.yml` is applied to every headless run. It retains the core
model/agent/session loop, credentials, transient JSONL persistence, retry and timeout policy,
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
| 1 | `tripforge-contracts` | Validate question, hotel, itinerary, source, and progress event schemas | Question/progress boundary implemented; hotel/plan contracts remain |
| 2 | `tripforge-progress` | Publish safe agent/tool lifecycle events to the NDJSON stream | Agent, answer-preparation, and tool lifecycle implemented; hidden reasoning is intentionally excluded |
| 3 | `google-places` | Text search, place details, ratings, stable place IDs, and photo references | Implemented read-only; photos are served through the authenticated backend proxy |
| 4 | `google-routes` | Route order, durations, distances, legs, and geometry | Implemented read-only; keep compatibility math deterministic |
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

### Configure the Mistral model

TripForge registers Mistral through the native adapter shipped in DSH's pi-ai
catalog. This preserves structured thinking chunks across tool-result turns.
The API key stays in the server-side Harness environment and is never sent to the
browser or FastAPI clients:

```dotenv
MISTRAL_API_KEY=replace-with-a-new-mistral-key
DSH_MODEL=mistral-medium-3.5
DSH_REASONING_EFFORT=low
DSH_CONTEXT_WINDOW_TOKENS=262144
DSH_MAX_OUTPUT_TOKENS=8192
DSH_PROVIDER_TIMEOUT_MS=60000
DSH_PROVIDER_IDLE_TIMEOUT_MS=45000
DSH_PROVIDER_MAX_RETRIES=1
HARNESS_RUN_TIMEOUT_MS=180000
HARNESS_RATE_LIMIT_COOLDOWN_MS=60000
```

For the current local cutover, a Mistral key stored under `NVIDIA_API_KEY` is also
accepted. New deployments should use the correctly named `MISTRAL_API_KEY`.
The context bound keeps long sessions from growing without limit. Low reasoning keeps
clarification turns responsive, while the 8,192-token cap and provider deadlines keep
each turn bounded and leave enough room for the model to submit its structured response.
The installed pi-ai Mistral catalog does not provide an effort map for Medium 3.5, so
TripForge explicitly maps its `low` profile to Mistral's `none` wire value. Without that
override, the adapter silently falls back to `high` and can consume the complete response
budget before calling the terminal response tool.
Provider request, stream-idle, and retry bounds stop an unhealthy upstream stream before
it consumes the complete Harness run budget.
The supervisor asks the next relevant trip or hotel questions dynamically and avoids
provider searches until the requirements needed for that result are complete.

Mistral Medium 3.5 uses native Mistral streaming and function calling. The selected
TripForge `low` profile explicitly disables provider reasoning so short interactive
turns reliably reach the terminal tool. The native adapter still preserves any
structured provider content required across tool-result turns. The public TripForge
event stream publishes only safe progress summaries rather than private model text.

### Conversation and run identity

Supabase is the durable conversation source. Before an existing conversation starts a
new run, FastAPI loads its latest trusted messages and merges saved clarification answers
and draft facts into the Harness request. DSH receives that compact context in a fresh
temporary session; its raw internal transcript is deleted after the run. This prevents
confirmed facts from being requested again without storing private runtime events in the
product database.

A new `run_id` is still generated for every submitted message. Runs are execution
attempts used for status, SSE events, retries, errors, and audit history; they are not
conversation identities. The stable `conversation_id` is what links those runs, and the
Harness derives a stable private correlation ID from it, but does not use that identifier
as durable local storage.

### Enable the Google provider plugins

Set `GOOGLE_MAPS_API_KEY` in `harness/.env` to enable `search_google_places`.
`compute_google_route` remains disabled unless you also set
`TRIPFORGE_GOOGLE_ROUTES_ENABLED=true`; leave it `false` for the current phase.
When enabled, the key must be authorized for Google Places API (New) and Google Routes
API. During migration the backend
may still have its own copy; after the legacy agent path is removed, keep the
provider credential only with the Harness service.

The plugins send the key in Google headers, never URLs, and accept only the fixed HTTPS
`places.googleapis.com` and `routes.googleapis.com` endpoints. They bound provider
data and request sizes, reject ungrounded or invalid locations, forward cancellation,
and strip unsupported fields before the model sees results. Calls are read-only and
concurrency-safe only after their arguments pass Harness schema validation.

Check activation without exposing the key:

```powershell
Invoke-RestMethod http://127.0.0.1:8090/health
```

With the current configuration, the response reports `plugins.google_places: true` and
`plugins.google_routes: false`.
Tool start/completion/failure events then stream through FastAPI to the existing
frontend planning indicator.

### Open the local Harness Inspector

Start the native DeepSeek Harness Web UI from the Harness directory:

```powershell
npm.cmd run inspect
```

It opens `http://127.0.0.1:8091` by default. Use `npm.cmd run inspect:no-open` when
you want the URL printed without opening a browser. The launcher inherits provider
configuration from `harness/.env` but keeps DSH session logs under the OS temporary
directory by default. The selected Inspector workspace remains the tool context only. It also applies
`config/tripforge.inspector.patch.yml` to restore only the browser-facing services
required by Web; the production Headless runtime does not load that override.

Open a conversation, send a travel prompt, then select the **Trajectory** view to inspect
turns, steps, tool/subtool calls, sanitized inputs and outputs, duration, timing, and
token usage. This is observable execution telemetry, not private chain-of-thought.
Inspector sessions are intentionally disposable and are removed when Inspector exits
normally. Set `HARNESS_INSPECTOR_EPHEMERAL=false` only when local Inspector history is
explicitly needed; the configured `DSH_INSPECTOR_HOME` is used in that mode.

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
3. Implement per-run session start, Supabase context reconstruction, event streaming,
   snapshots, and cancellation.
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
