# TripForge FastAPI backend

This service runs the planning pipeline described in `PROJECT_ALIGNMENT.md`:

```text
Supervisor → Trip Scope → Stay + Activity + Travel Info (parallel)
           → Compatibility → Itinerary + Maps → Budget → Validator
```

The graph streams typed progress events into an in-memory run harness. Travel entities
come from provider responses and retain IDs, coordinates, and source links. Deterministic
code handles distances, route ordering, cost arithmetic, and validation.

## Run locally

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env
uvicorn app.main:create_app --factory --reload
```

The backend's real environment file is exactly `backend/.env`. Supabase requires
`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY`. These are the
current `sb_publishable_...` and `sb_secret_...` API keys. Set
`SUPABASE_AUTH_REQUIRED=true` in deployed environments so configuration is fail-closed.
The secret key must exist only in this backend file and must never use a
`NEXT_PUBLIC_` prefix. Tests explicitly disable auth and use mocks rather than real keys.

Authenticated requests must send the access token issued by Supabase Auth:

```http
Authorization: Bearer SUPABASE_USER_ACCESS_TOKEN
```

The API verifies that token with Supabase Auth, creates or checks the owned conversation,
stores the user message, and persists the run, events, clarification/final artifact, and
assistant message. Run status and SSE endpoints enforce the same authenticated ownership.

The API is available at `http://localhost:8000`, with Swagger UI at `/docs`.

- An OpenAI key enables structured LLM intake, geographic scoping, and itinerary
  arrangement. Without it, a deliberately limited parser remains available.
- A Google Maps server key with Places API (New) and Routes API enabled is required for
  grounded place research, optimized waypoint order, distance, and route polylines.
- Without Google Maps, the pipeline completes as `invalid` with explicit grounding
  errors; it does not fabricate hotels or activities.

## Create and stream a run

Create a run:

```bash
curl -sS http://localhost:8000/api/v1/trips/runs \
  -H 'Authorization: Bearer SUPABASE_USER_ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "message": "Plan a relaxed 5-day food and culture trip from Lahore to Islamabad for two people under $1500"
  }'
```

The response includes `events_url` and `status_url`. Open the event stream with native
`EventSource` or `fetch`:

```bash
curl -N http://localhost:8000/api/v1/runs/RUN_ID/events
```

Because native browser `EventSource` cannot set an Authorization header, use a streaming
`fetch` client or a same-origin Next.js proxy for authenticated SSE.

If the run pauses with `needs_clarification`, render the returned question schemas as
single-select, multi-select, text, or location controls. Start a new run with the same
message, the answers, and `parent_run_id`:

```json
{
  "message": "Plan a trip to Islamabad",
  "parent_run_id": "PREVIOUS_RUN_ID",
  "answers": {
    "origin": "Lahore, Pakistan",
    "travelers": "2",
    "duration_days": "5",
    "interests": ["food", "culture"],
    "pace": "balanced",
    "budget_band": "balanced"
  }
}
```

`Last-Event-ID` is supported for reconnecting and replaying missed events. Supabase now
stores run metadata, events, and artifacts, but live subscriptions and graph execution are
still held in-process. Keep one Uvicorn worker until a shared event broker/checkpoint
store is added.

## Mapping behavior

Each day starts and ends at the selected stay, with Google Routes optimizing that day's
intermediate stops when driving. An overview route starts at the traveler-provided origin,
visits the selected trip base, and returns home. The response also carries a Google Maps
directions URL, ordered place coordinates, route legs, and an encoded polyline where the
provider returns one.

## Tests

```bash
pytest
```
