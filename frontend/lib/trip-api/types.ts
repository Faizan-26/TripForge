export type RunStatus =
  | "queued"
  | "running"
  | "needs_clarification"
  | "completed"
  | "failed";

export type AnswerValue = string | number | boolean | string[];

export type PlanTripRequest = {
  message: string;
  conversation_id?: string;
  client_request_id?: string;
  client_message_id?: string;
  title?: string;
  answers?: Record<string, AnswerValue>;
  parent_run_id?: string;
};

export type CreateRunResponse = {
  run_id: string;
  conversation_id: string;
  status: RunStatus;
  events_url: string;
  status_url: string;
};

export type ClarificationOption = {
  value: string;
  label: string;
  description?: string | null;
};

export type ClarificationQuestion = {
  id: string;
  prompt: string;
  kind: "single_select" | "multi_select" | "text" | "location" | "number";
  required: boolean;
  options: ClarificationOption[];
};

export type ClarificationResult = {
  draft?: Record<string, unknown> | null;
  questions: ClarificationQuestion[];
};

export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type LocationRef = {
  label: string;
  formatted_address?: string | null;
  place_id?: string | null;
  coordinates?: Coordinates | null;
  google_maps_uri?: string | null;
};

export type SourceRef = {
  provider: "google_places" | "google_routes" | "user";
  provider_id?: string | null;
  uri?: string | null;
  retrieved_at?: string | null;
};

export type PlaceCandidate = {
  provider_id: string;
  kind: "stay" | "activity" | "travel_info";
  name: string;
  location: LocationRef;
  types: string[];
  rating?: number | null;
  user_rating_count?: number | null;
  price_level?: string | null;
  website_uri?: string | null;
  estimated_cost?: number | null;
  cost_currency?: string | null;
  source: SourceRef;
};

export type RouteLeg = {
  from_label: string;
  to_label: string;
  distance_meters?: number | null;
  duration_seconds?: number | null;
};

export type MapRoute = {
  kind: "trip_overview" | "daily_round_trip";
  day?: number | null;
  origin: LocationRef;
  destination: LocationRef;
  ordered_stops: LocationRef[];
  legs: RouteLeg[];
  distance_meters?: number | null;
  duration_seconds?: number | null;
  encoded_polyline?: string | null;
  google_maps_url: string;
  source?: SourceRef | null;
  warnings: string[];
};

export type ItineraryDay = {
  day: number;
  date?: string | null;
  title: string;
  stops: Array<{ sequence: number; place: PlaceCandidate }>;
  route?: MapRoute | null;
};

export type BudgetSummary = {
  currency: string;
  budget_total?: number | null;
  known_cost_total: number;
  remaining_from_known_costs?: number | null;
  coverage: "complete" | "partial" | "unavailable";
  unknown_cost_categories: string[];
  is_within_budget?: boolean | null;
  notes: string[];
};

export type ValidationIssue = {
  code: string;
  message: string;
  severity: "error" | "warning";
  retry_nodes: string[];
  details: Record<string, unknown>;
};

export type TripPlan = {
  status: "valid" | "invalid";
  requirements: {
    destination: string;
    travelers: number;
    duration_days: number;
    budget_total?: number | null;
    currency: string;
    interests: string[];
    pace: string;
  };
  scope: {
    trip_type: "single_base" | "multi_base";
    base_regions: string[];
    rationale: string;
  };
  selected_stay?: PlaceCandidate | null;
  itinerary: ItineraryDay[];
  trip_overview_route?: MapRoute | null;
  budget: BudgetSummary;
  validation: ValidationIssue[];
  research_warnings: string[];
};

export type RunResult = TripPlan | ClarificationResult;

export type RunSnapshot = {
  run_id: string;
  conversation_id: string;
  status: RunStatus;
  created_at: string;
  updated_at: string;
  parent_run_id?: string | null;
  result?: RunResult | null;
  error?: string | null;
};

export type RunEvent = {
  sequence: number;
  run_id: string;
  type: string;
  timestamp: string;
  agent?: string | null;
  message: string;
  data: Record<string, unknown>;
};

export function isClarificationResult(value: RunResult | null | undefined): value is ClarificationResult {
  return Boolean(value && "questions" in value && Array.isArray(value.questions));
}

export function isTripPlan(value: RunResult | null | undefined): value is TripPlan {
  return Boolean(value && "itinerary" in value && "budget" in value);
}
