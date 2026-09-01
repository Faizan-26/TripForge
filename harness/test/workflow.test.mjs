import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeWorkflowState,
  prepareWorkflowContext,
  reduceWorkflow,
  workflowResponseViolation,
} from "../src/workflow.mjs";

test("workflow starts with semantic classification instead of a static questionnaire", () => {
  const state = normalizeWorkflowState();

  assert.equal(state.version, "1");
  assert.equal(state.mode, "UNKNOWN");
  assert.equal(state.current_goal, "request_understanding");
  assert.equal(state.next_action, "classify_and_extract");
});

test("workflow tracks answered machine IDs without inspecting user language", () => {
  const state = prepareWorkflowContext({
    answers: { origin: "Sargodha", travel_dates: { start_date: "2026-09-02" } },
  });

  assert.deepEqual(state.answered_question_ids, ["origin", "travel_dates"]);
});

test("full trip requirements advance to a grounded hotel selection goal", () => {
  const state = reduceWorkflow({
    context: {
      draft: { duration_days: 3 },
      answers: { destination: "Lahore" },
    },
    result: {
      outcome: "clarification",
      mode: "FULL_TRIP_PLAN",
      workflow_update: {
        requirements_complete: true,
        lodging_required: true,
      },
    },
    questions: [{
      id: "hotel_selection",
      options: [{
        value: "place-1",
        label: "Lahore Hotel",
        place_id: "place-1",
      }],
    }],
  });

  assert.equal(state.goals.trip_requirements, "completed");
  assert.equal(state.goals.hotel_selection, "in_progress");
  assert.equal(state.evidence.hotel_candidates_grounded, true);
  assert.equal(state.current_goal, "hotel_selection");
  assert.equal(state.next_action, "ground_and_present_hotel_choices");
});

test("itinerary cannot complete before a required hotel is selected", () => {
  const state = reduceWorkflow({
    context: {
      workflow: {
        version: "1",
        mode: "FULL_TRIP_PLAN",
        requirements: { lodging_required: true, historical_places_required: false },
      },
      draft: { duration_days: 3 },
    },
    result: {
      outcome: "general",
      mode: "FULL_TRIP_PLAN",
      presentation: { kind: "trip_plan" },
      workflow_update: { requirements_complete: true, lodging_required: true },
    },
  });

  assert.equal(state.goals.hotel_selection, "pending");
  assert.equal(state.goals.itinerary, "pending");
  assert.equal(state.goals.complete, "pending");
  assert.equal(state.current_goal, "hotel_selection");
});

test("selected hotel unlocks itinerary composition when other goals are skipped", () => {
  const state = reduceWorkflow({
    context: {
      workflow: {
        version: "1",
        mode: "FULL_TRIP_PLAN",
        requirements: { lodging_required: true, historical_places_required: false },
      },
      selected_hotel: { place_id: "place-1", name: "Lahore Hotel" },
      answers: { hotel_selection: "place-1" },
    },
    result: {
      outcome: "general",
      mode: "FULL_TRIP_PLAN",
      presentation: { kind: "trip_plan" },
      workflow_update: { requirements_complete: true },
    },
  });

  assert.equal(state.goals.hotel_selection, "completed");
  assert.equal(state.goals.historical_places, "skipped");
  assert.equal(state.goals.itinerary, "completed");
  assert.equal(state.current_goal, "complete");
});

test("answering a declared final requirement round advances before the next model call", () => {
  const state = prepareWorkflowContext({
    workflow: {
      version: "1",
      mode: "FULL_TRIP_PLAN",
      turn: 2,
      current_goal: "trip_requirements",
      goals: {
        request_understanding: "completed",
        trip_requirements: "in_progress",
        hotel_selection: "pending",
        historical_places: "pending",
        itinerary: "pending",
        complete: "pending",
      },
      requirements: {
        lodging_required: true,
        historical_places_required: true,
        complete_after_current_answers: true,
      },
      evidence: {
        hotel_candidates_grounded: false,
        historical_places_grounded: false,
      },
      answered_question_ids: ["origin"],
      last_question_ids: ["budget", "travel_dates"],
      next_action: "ask_only_missing_requirements",
    },
    answers: {
      origin: "Sargodha",
      budget: "PKR 20,000",
      travel_dates: { start_date: "2026-09-02", end_date: "2026-09-05" },
    },
  });

  assert.equal(state.goals.trip_requirements, "completed");
  assert.equal(state.goals.hotel_selection, "in_progress");
  assert.equal(state.current_goal, "hotel_selection");
  assert.equal(state.next_action, "ground_and_present_hotel_choices");
});

test("controller rejects clarification rounds containing only answered questions", () => {
  const violation = workflowResponseViolation({
    context: {
      answers: { origin: "Sargodha" },
      workflow: {
        version: "1",
        mode: "FULL_TRIP_PLAN",
        turn: 1,
        current_goal: "trip_requirements",
        goals: {
          request_understanding: "completed",
          trip_requirements: "in_progress",
          hotel_selection: "pending",
          historical_places: "pending",
          itinerary: "pending",
          complete: "pending",
        },
        requirements: {},
        evidence: {},
        answered_question_ids: ["origin"],
        last_question_ids: ["origin"],
        next_action: "ask_only_missing_requirements",
      },
    },
    response: {
      outcome: "clarification",
      questions: [{ id: "origin", prompt: "Where from?", kind: "location" }],
    },
  });

  assert.equal(violation.code, "REPEATED_QUESTIONS");
});
