# Multi-Agent Travel Planner --- Project Alignment Guide

## 1. Project Vision

Build a **web-based multi-agent travel planning platform** where a user
describes a trip naturally and a coordinated group of AI agents
researches, validates, and assembles a realistic travel plan.

The project is intentionally more than an itinerary chatbot. It is also
a practical **agent-harness project** demonstrating orchestration,
shared state, tool execution, parallel work, constraints, retries,
validation, human approval, observability, and later MCP/RAG where they
genuinely add value.

### Core principle

> **Agents decide. Tools execute. Deterministic code validates what
> should not be left to an LLM.**

------------------------------------------------------------------------

## 2. What the User Experience Should Feel Like

A user should be able to say:

> "Plan a 7-day trip to Pakistan for two people. Budget is around
> \$3,000. We like mountains, food, and relaxing places."

The application should then:

1.  Understand the request.
2.  Establish a realistic geographic scope.
3.  Research stays and activities using external tools/APIs.
4.  Ensure stays and activities are geographically compatible.
5.  Rank the best combinations.
6.  Build a realistic itinerary.
7.  Check budget and hard constraints.
8.  Validate the final plan.
9.  Explain the result to the user.
10. Later, allow approved real-world actions such as booking-related
    workflows.

The frontend should expose enough of the execution to make the
multi-agent nature visible without overwhelming a normal traveler.

------------------------------------------------------------------------

## 3. High-Level Architecture

``` text
User
  │
  ▼
Next.js Frontend
  │
  ▼
FastAPI Backend
  │
  ▼
Agent Harness / LangGraph
  │
  ▼
Supervisor Agent
  │
  ▼
Trip Scope Agent
  │
  ├───────────────────────┐
  ▼                       ▼
Stay Agent          Activities Agent
  │                       │
  └───────────┬───────────┘
              ▼
    Compatibility Layer
              │
              ▼
       Ranking / Planning
              │
              ▼
       Itinerary Agent
              │
              ▼
         Budget Engine
              │
              ▼
       Validator / Critic
              │
        ┌─────┴─────┐
        │           │
      Valid       Invalid
        │           │
        ▼           ▼
      User       Re-plan
```

------------------------------------------------------------------------

## 4. Agent Responsibilities

### 4.1 Supervisor Agent

The entry point for agentic execution.

Responsibilities:

-   Understand the user's request.
-   Extract structured trip requirements.
-   Determine what information is missing.
-   Decide which workflow/nodes need to run.
-   Route retries when validation fails.

It should **not** search hotels, calculate distances, or create the
entire itinerary itself.

Example structured output:

``` json
{
  "destination": "Pakistan",
  "travelers": 2,
  "duration_days": 7,
  "budget": 3000,
  "interests": ["mountains", "food", "relaxation"]
}
```

### 4.2 Trip Scope Agent

Establishes geographic and planning constraints **before independent
research begins**.

Responsibilities:

-   Determine base city/region.
-   Decide whether the trip is single-base or multi-base.
-   Establish allowed regions/radius.
-   Prevent agents from independently choosing incompatible parts of a
    country.

Example:

``` json
{
  "country": "Pakistan",
  "trip_type": "multi_base",
  "base_regions": ["Islamabad", "Hunza"],
  "max_day_trip_minutes": 180
}
```

This prevents a Stay Agent from selecting Karachi while an Activities
Agent independently plans Hunza for the same daily itinerary.

### 4.3 Stay Agent

Researches and ranks accommodation candidates within the established
trip scope.

Responsibilities:

-   Call hotel/property search tools.
-   Respect geographic scope and allocated budget.
-   Return real IDs/data from tools rather than inventing properties.
-   Produce a shortlist rather than blindly selecting the globally
    highest-rated hotel.

### 4.4 Activities Agent

Researches activities, attractions, experiences, food, and relevant
places within the same geographic scope.

Responsibilities:

-   Use places/experience APIs.
-   Respect interests, dates, geography, and pacing.
-   Preserve external entity IDs and coordinates where available.
-   Return candidates for later compatibility/ranking.

### 4.5 Compatibility Layer

Prefer deterministic logic here rather than another LLM whenever
possible.

Checks:

-   Stay ↔ activity distance.
-   Travel time.
-   Region compatibility.
-   Date/time conflicts.
-   Excessive transit relative to trip duration.

Example:

``` text
Hotel → Activity A: 25 min   ✓
Hotel → Activity B: 1h 20m  ✓/warning
Hotel → Activity C: 14h     ✗
```

### 4.6 Ranking Agent

Evaluates the trip as a whole.

It should consider:

-   Accommodation quality.
-   Nearby activities.
-   User interests.
-   Convenience.
-   Budget.
-   Travel overhead.

The individually best hotel is not necessarily the best **trip base**.

### 4.7 Itinerary Agent

Turns approved/compatible entities into a day-by-day plan.

Responsibilities:

-   Arrange selected stays and activities.
-   Maintain realistic pacing.
-   Avoid impossible overlaps.
-   Avoid inventing unsupported hotels/activities.
-   Keep IDs so the UI can render real entity cards.

### 4.8 Validator / Critic

Checks the nearly completed plan before it reaches the user.

Validate:

-   Entity grounding.
-   Geography.
-   Dates.
-   Duplicate activities.
-   Schedule conflicts.
-   Budget constraints.
-   Missing required information.

If invalid, return a structured failure describing **what needs to be
retried**, rather than restarting the entire graph.

------------------------------------------------------------------------

## 5. Parallel vs Sequential Execution

Do not parallelize agents merely because LangGraph supports it.

### Rule

> Two tasks can run in parallel only when each can complete correctly
> without the other's output.

Recommended flow:

``` text
Supervisor                    sequential
    ↓
Trip Scope                    sequential
    ↓
┌──────────────┐
│              │
Stay       Activities          parallel
│              │
└──────┬───────┘
       ↓
Compatibility                 sequential
       ↓
Ranking                       sequential
       ↓
Itinerary                     sequential
       ↓
Budget / Validation           sequential
```

The shared Trip Scope is what makes Stay + Activities safe to
parallelize.

------------------------------------------------------------------------

## 6. Shared State

Agents should not pass arbitrary prose to one another as the primary
system state.

Use a structured `TripState`.

``` python
class TripState(TypedDict, total=False):
    user_message: str

    destination: str
    country_code: str
    travelers: int
    duration_days: int
    start_date: str
    end_date: str
    budget: float
    interests: list[str]

    trip_type: str
    base_regions: list[str]
    max_travel_minutes: int

    stay_candidates: list[dict]
    activity_candidates: list[dict]

    compatible_options: list[dict]
    selected_stay: dict
    selected_activities: list[dict]

    itinerary: list[dict]
    estimated_cost: float

    validation_errors: list[dict]
    status: str
```

### State ownership

-   Supervisor → request/routing fields.
-   Scope → geographic constraints.
-   Stay → stay candidates.
-   Activities → activity candidates.
-   Compatibility → compatibility results.
-   Itinerary → itinerary.
-   Budget code → cost fields.
-   Validator → validation fields.

Parallel agents should avoid writing to the same state key unless an
explicit reducer/merge strategy exists.

------------------------------------------------------------------------

## 7. Agent Harness

The harness is a major learning objective of this project.

``` text
Agent Harness
├── Runtime
├── Context Builder
├── Tool Registry
├── Permissions
├── Shared State
├── Retry Policy
├── Checkpoints
├── Events / Streaming
├── Human Approval
├── Tracing
└── Evaluation
```

### Runtime

Controls how an agent is invoked, timeout behavior, errors, retries, and
metadata.

### Context Builder

Gives each agent only the information it needs instead of dumping the
entire conversation/state into every prompt.

### Tool Registry

Central registry describing available tools, schemas, ownership, and
permissions.

### Permissions

Read-only tools can generally execute automatically. Actions with
financial or destructive consequences require explicit approval.

### Retry Policy

Retry transient tool/API failures differently from reasoning/validation
failures.

### Events

Emit events such as:

``` text
scope.started
scope.completed
stay.started
activities.started
stay.completed
activities.completed
compatibility.completed
itinerary.started
validation.completed
```

Use SSE initially to stream these to Next.js.

------------------------------------------------------------------------

## 8. Tools vs Agents

Do **not** turn every function into an agent.

### Good agent tasks

-   Interpreting ambiguous user intent.
-   Selecting among alternatives.
-   Planning.
-   Ranking based on qualitative preferences.
-   Resolving conflicting soft constraints.
-   Critiquing a generated plan.

### Good deterministic/tool tasks

-   API calls.
-   Distance calculations.
-   Currency conversion.
-   Budget arithmetic.
-   Date calculations.
-   Availability checks.
-   Database operations.
-   Authentication/authorization.
-   Schema validation.

Example:

``` text
Stay Agent
    ↓ decides it needs properties
search_hotels() tool
    ↓
Hotel Provider API
```

------------------------------------------------------------------------

## 9. Initial Technology Stack

### Frontend

-   Next.js
-   TypeScript
-   Tailwind CSS
-   shadcn/ui
-   Lucide icons
-   Motion where useful

### Backend

-   FastAPI
-   Python
-   Pydantic
-   HTTPX

### Agent orchestration

-   LangGraph
-   Provider abstraction for LLM calls

### Persistence --- add when needed

-   PostgreSQL
-   Redis only when a concrete caching/queue/state requirement appears

### Streaming

-   Server-Sent Events (SSE) initially

### Observability --- later phase

-   LangSmith or Langfuse

------------------------------------------------------------------------

## 10. Frontend Direction

The product should feel like a modern AI application combined with a
premium travel experience, rather than a traditional booking portal.

### Visual direction

-   Neutral application chrome.
-   Travel photography provides most visual color.
-   Spacious layouts.
-   Rounded cards without excessive decoration.
-   Clear execution states.
-   Minimal gradients/effects.

### Typography

Use **Geist** as the primary UI font and **Geist Mono** for technical
harness information.

Suggested hierarchy:

-   Hero: 48--64px, semibold.
-   Page title: 30--36px, semibold.
-   Section title: 20--24px, semibold.
-   Body: 14--16px.
-   Secondary: 13--14px.
-   Technical metadata: 12--13px monospace.

### Key screens

1.  **Landing / Trip Prompt** --- natural-language input.
2.  **Planning Workspace** --- trip details + itinerary + live agent
    activity.
3.  **Trip Result** --- polished final itinerary and recommendations.
4.  **Agent Run Detail** --- optional developer/harness view showing
    agent input, tools, result, latency, tokens, and errors.

------------------------------------------------------------------------

## 11. Backend Structure

``` text
backend/
└── app/
    ├── main.py
    │
    ├── api/
    │   ├── chat.py
    │   ├── trips.py
    │   ├── runs.py
    │   └── approvals.py
    │
    ├── graph/
    │   ├── graph.py
    │   ├── state.py
    │   └── routing.py
    │
    ├── agents/
    │   ├── supervisor.py
    │   ├── scope.py
    │   ├── stay.py
    │   ├── activities.py
    │   ├── ranking.py
    │   ├── itinerary.py
    │   └── validator.py
    │
    ├── harness/
    │   ├── runtime.py
    │   ├── context.py
    │   ├── tool_registry.py
    │   ├── permissions.py
    │   ├── retries.py
    │   ├── checkpoints.py
    │   └── events.py
    │
    ├── tools/
    │   ├── hotels.py
    │   ├── places.py
    │   ├── maps.py
    │   ├── weather.py
    │   ├── currency.py
    │   └── travel_info.py
    │
    ├── services/
    │   ├── geo.py
    │   ├── budget.py
    │   └── ranking.py
    │
    ├── schemas/
    │   ├── trip.py
    │   ├── agents.py
    │   └── tools.py
    │
    └── db/
```

------------------------------------------------------------------------

## 12. Frontend Structure

``` text
frontend/src/
├── app/
│   ├── page.tsx
│   ├── plan/
│   │   └── page.tsx
│   └── trips/
│       └── page.tsx
│
├── components/
│   ├── layout/
│   ├── chat/
│   ├── trip/
│   └── agents/
│
└── lib/
    ├── api.ts
    ├── types.ts
    └── utils.ts
```

------------------------------------------------------------------------

## 13. Implementation Phases

### Phase 0 --- Foundation

-   [ ] Install Git, NVM, Node LTS, npm, Python, VS Code.
-   [ ] Initialize repository.
-   [ ] Create Next.js frontend.
-   [ ] Create FastAPI backend.
-   [ ] Configure Tailwind/shadcn.
-   [ ] Establish theme and typography.
-   [ ] Create `/health` API.
-   [ ] Confirm Next.js → FastAPI communication.

### Phase 1 --- Single Structured AI Flow

-   [ ] Add LLM provider abstraction.
-   [ ] Build `TripRequest` Pydantic model.
-   [ ] Convert natural language into structured trip requirements.
-   [ ] Display extracted trip information in UI.
-   [ ] Add basic error handling.

**Goal:** prove the complete frontend → backend → LLM → structured
response loop.

### Phase 2 --- Shared State + Supervisor

-   [ ] Define `TripState`.
-   [ ] Add Supervisor Agent.
-   [ ] Add Scope Agent.
-   [ ] Add LangGraph.
-   [ ] Implement basic routing.

**Goal:** establish the orchestration foundation before adding many
tools.

### Phase 3 --- Real Travel Tools

-   [ ] Hotel/property provider integration.
-   [ ] Places/activity integration.
-   [ ] Maps/distance tool.
-   [ ] Weather tool if useful.
-   [ ] Currency tool if useful.
-   [ ] Normalize external provider data into internal schemas.

**Goal:** agents reason over real tool results rather than model memory.

### Phase 4 --- Parallel Multi-Agent Research

-   [ ] Stay Agent.
-   [ ] Activities Agent.
-   [ ] Pass shared Trip Scope to both.
-   [ ] Run independent research concurrently.
-   [ ] Ensure state keys cannot overwrite one another.

**Goal:** genuine multi-agent concurrency with controlled state
ownership.

### Phase 5 --- Compatibility + Itinerary

-   [ ] Geo compatibility checks.
-   [ ] Travel-time constraints.
-   [ ] Ranking Agent.
-   [ ] Itinerary Agent.
-   [ ] Deterministic budget engine.

### Phase 6 --- Validation + Recovery

-   [ ] Validator/Critic.
-   [ ] Structured validation errors.
-   [ ] Targeted retries.
-   [ ] Avoid restarting the entire workflow when one component fails.
-   [ ] Limit retry counts.

### Phase 7 --- Harness UX

-   [ ] Agent execution events.
-   [ ] SSE streaming.
-   [ ] Agent status panel.
-   [ ] Tool-call display.
-   [ ] Latency/token metadata.
-   [ ] Run history/checkpoints.

### Phase 8 --- Human Approval / Actions

-   [ ] Define read vs action tools.
-   [ ] Add approval state.
-   [ ] Require explicit approval for booking/payment-like actions.
-   [ ] Resume graph after approval.

### Phase 9 --- Evaluation / Observability

-   [ ] Trace graph executions.
-   [ ] Record tool failures.
-   [ ] Track latency and token usage.
-   [ ] Create representative travel test cases.
-   [ ] Evaluate itinerary quality, geographic compatibility, grounding,
    and tool selection.

### Phase 10 --- MCP / RAG / Memory (Only When Justified)

-   [ ] Introduce MCP for reusable/externalized tool interfaces if
    beneficial.
-   [ ] Add RAG for unstructured travel documents/policies/guides if
    needed.
-   [ ] Add long-term user preference memory if product requirements
    justify it.

Do not add these merely to increase the number of AI technologies in the
project.

------------------------------------------------------------------------

## 14. V1 Scope

The first meaningful V1 should support:

``` text
Natural-language trip request
        ↓
Structured requirements
        ↓
Geographic scope
        ↓
Stay + activity research
        ↓
Compatibility checks
        ↓
Ranking
        ↓
Itinerary
        ↓
Budget
        ↓
Validation
        ↓
Final plan
```

### V1 does NOT need

-   Real payments.
-   Full hotel booking.
-   Flight booking.
-   RAG.
-   MCP.
-   Long-term memory.
-   Redis.
-   Complex authentication.
-   Ten+ agents.
-   Autonomous browser control.

Build those only after the core graph works reliably.

------------------------------------------------------------------------

## 15. Important Engineering Rules

### Rule 1 --- Do not create an agent per API endpoint

Bad:

``` text
HotelSearchAgent
HotelDetailAgent
HotelPriceAgent
HotelReviewAgent
```

Better:

``` text
Stay Agent
├── search_hotels()
├── get_hotel_details()
├── get_prices()
└── get_reviews()
```

### Rule 2 --- Preserve external IDs

Never reduce a provider result to only a human-readable name. Preserve
IDs, coordinates, prices, and source metadata so later nodes can verify
and render the same entity.

### Rule 3 --- Do not use LLMs for arithmetic

Budget, distances, dates, and other deterministic calculations belong in
code.

### Rule 4 --- Establish constraints before parallel execution

Agents working concurrently must receive the same destination,
geographic scope, dates, traveler count, and relevant budget
constraints.

### Rule 5 --- Prefer targeted retries

If the hotel violates geography, rerun hotel selection. Do not repeat
activity research unless its result is also invalid.

### Rule 6 --- Treat external data as source of truth

The model should rank and reason over tool results, not invent
availability, prices, hotels, or attractions.

### Rule 7 --- Keep the harness observable

Every meaningful run should eventually be traceable:

``` text
agent
input context
output
tools called
latency
errors
retry count
token/model usage
```

------------------------------------------------------------------------

## 16. How to Decide Whether to Add a Technology

Before adding anything, ask:

> **What concrete problem does this solve in the current architecture?**

### LangGraph

Use it for orchestration, shared state, conditional routing, retries,
parallel branches, and human-in-the-loop flows.

### MCP

Add when tool interfaces need to be reusable across agents/applications
or externally exposed in a standardized way. It is **not required for
V1**.

### RAG

Add when agents need reliable retrieval from unstructured knowledge such
as travel policies, guides, uploaded documents, insurance terms, or
private knowledge. Do not use RAG for live hotel availability or simple
API data.

### Vector Database

Only when semantic retrieval is genuinely required.

### Redis

Only when there is a concrete caching, distributed state, queue, or
coordination requirement.

------------------------------------------------------------------------

## 17. Definition of Success

The project is successful when it can demonstrate all of the following:

-   A normal user can describe a trip naturally.
-   The system converts it into structured constraints.
-   Multiple specialized agents collaborate rather than one prompt
    pretending to be multiple agents.
-   Independent work runs concurrently where appropriate.
-   Shared state remains controlled and predictable.
-   Real tools/APIs ground recommendations.
-   Geographic incompatibilities are detected.
-   Deterministic calculations are kept outside LLM reasoning.
-   Invalid plans trigger targeted recovery.
-   Users can see useful progress while agents work.
-   Agent/tool execution can be inspected and evaluated.

------------------------------------------------------------------------

## 18. Current Immediate Goal

Do **not** start with the full agent graph.

Current milestone:

``` text
Next.js UI
    ↓
FastAPI
    ↓
One LLM call
    ↓
Structured TripRequest
    ↓
Display extracted trip requirements
```

Complete that vertical slice first.

Then move to:

``` text
TripState
    ↓
Supervisor
    ↓
Scope Agent
    ↓
LangGraph
```

Only after that should Stay/Activities and external travel tools be
introduced.

------------------------------------------------------------------------

## 19. One-Sentence Alignment Check

Whenever the implementation starts becoming complicated, return to this
sentence:

> **We are building a travel-planning product that uses an observable
> agent harness to coordinate specialized agents over real tools, shared
> constraints, deterministic validation, and controlled actions.**
