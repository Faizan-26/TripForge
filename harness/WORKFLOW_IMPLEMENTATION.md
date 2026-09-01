# TripForge deterministic workflow implementation

Last updated: 2026-09-01

## Objective

Move full-trip planning from an implicit model-led conversation to a versioned,
goal-driven workflow. The model remains responsible for multilingual semantic
understanding and localized wording. Application code owns stage transitions,
evidence requirements, repetition prevention, and persistence.

## Workflow

`request_understanding -> trip_requirements -> hotel_selection -> historical_places -> itinerary -> complete`

Goals that do not apply to a request are marked `skipped`. Only safe goal names
and statuses may be sent to the browser; private model reasoning is never stored
or exposed.

## Tasks

- [x] Create this durable implementation/progress ledger.
- [x] Define the versioned JavaScript workflow contract and deterministic reducer.
- [x] Add model-facing workflow update fields and controller directives.
- [x] Persist workflow state with conversation messages in Supabase JSON metadata.
- [x] Carry workflow state through the backend and frontend clarification contract.
- [ ] Enforce a grounded hotel-selection gate before itinerary generation.
- [ ] Enforce historical-place evidence when that goal applies.
- [ ] Automatically advance when model questions are all already answered.
- [ ] Expose safe goal progress in the frontend activity UI.
- [ ] Add regression coverage for multi-round planning and hotel-card selection.
- [ ] Update deployment and operational documentation.

## Decisions

- Workflow state is stored in existing Supabase `messages.metadata` JSON. No SQL
  migration is required for the first version.
- Question wording stays dynamic and multilingual. The reducer uses stable machine
  IDs and explicit model workflow updates, not English sentence matching.
- Hotel and historical-place facts must come from tools. A polished model answer
  cannot bypass an unfinished evidence goal.
- DeepSeek Harness session files are not the source of truth. Supabase conversation
  state is the durable source of truth across processes and deployments.
- The UI may show goal/stage progress, tool activity, and results. It must not show
  hidden chain-of-thought.

## Progress log

### 2026-09-01 - Phase 1 started

- Captured the implementation sequence and state ownership rules.
- Added a versioned workflow-state normalizer/reducer with explicit goal statuses,
  next actions, answered-question tracking, and hotel-card evidence detection.
- Added `workflow_update` to the terminal response contract. The model supplies
  multilingual semantic facts; code converts those facts into bounded states.
- Added `complete_after_current_answers`, allowing the controller to move directly
  from the final intake form to hotel search without asking the model to rediscover
  the same stage.
- Carried workflow state through Harness results, backend request validation,
  Supabase message metadata, clarification artifacts, and frontend follow-up calls.
- Restricted the Google Places tool description to the product's supported hotel
  and historical-place categories.
- Next: enforce workflow violations at runtime without surfacing a generic error,
  then publish safe goal transitions as frontend activity events.

## Verification log

- `harness`: `npm.cmd test` - 54 passed.
- `frontend`: `npm.cmd run lint` - passed.
- `backend`: focused Supabase/schema/run-manager/Harness tests - 30 passed.
- Full backend suite: 78 passed and 6 failed. Three API tests selected the live
  Harness runtime from local environment configuration and timed out during the
  isolated test; three legacy LangGraph supervisor assertions fail independently
  of this workflow change. These are recorded rather than hidden by changing the
  developer's local `.env`.
- Browser verification is intentionally deferred to the project owner.
