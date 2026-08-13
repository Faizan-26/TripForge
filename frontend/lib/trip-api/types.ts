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
  intent?: "GENERAL" | "FULL_TRIP_PLAN" | "HOTEL_SEARCH";
  selected_hotel?: SelectedHotelContext;
  context?: ConversationTurn[];
};

export type ConversationTurn = {
  role: "user" | "assistant";
  content: string;
};

export type GeneralAssistantResult = {
  intent: "GENERAL";
  message: string;
  conversation_title: string;
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

export type ProviderRef = {
  provider: string;
  provider_id: string;
  uri?: string | null;
  retrieved_at?: string | null;
};

export type Money = {
  amount: number;
  currency: string;
};

export type ResolvedLocation = {
  label: string;
  formatted_address?: string | null;
  place_id?: string | null;
  provider_ids: Record<string, string>;
  coordinates?: Coordinates | null;
  city?: string | null;
  region?: string | null;
  country_code?: string | null;
  timezone?: string | null;
  google_maps_uri?: string | null;
};

export type HotelSearchConstraints = {
  destination_query?: string | null;
  location?: ResolvedLocation | null;
  check_in?: string | null;
  check_out?: string | null;
  adults?: number | null;
  children: number;
  child_ages: number[];
  rooms?: number | null;
  currency: string;
  min_total_price?: number | null;
  max_total_price?: number | null;
  min_guest_rating?: number | null;
  min_star_rating?: number | null;
  required_amenity_codes: string[];
  property_types: string[];
  refundable_only: boolean;
  preferences: string[];
  radius_km?: number | null;
};

export type HotelImage = {
  id?: string | null;
  url: string;
  width?: number | null;
  height?: number | null;
  alt_text?: string | null;
  category?: string | null;
  attribution?: string | null;
  attribution_url?: string | null;
  google_maps_uri?: string | null;
  flag_content_uri?: string | null;
  source?: ProviderRef | null;
};

export type HotelAmenity = {
  code: string;
  name: string;
  category?: string | null;
  available: boolean;
  details?: string | null;
  source?: ProviderRef | null;
};

export type HotelReview = {
  review_id: string;
  rating: number;
  text?: string | null;
  relative_publish_time_description?: string | null;
  publish_time?: string | null;
  author_name?: string | null;
  author_uri?: string | null;
  author_photo_uri?: string | null;
  google_maps_uri?: string | null;
  flag_content_uri?: string | null;
  source: ProviderRef;
};

export type HotelOpeningHours = {
  open_now?: boolean | null;
  weekday_descriptions: string[];
  next_open_time?: string | null;
  next_close_time?: string | null;
  source: ProviderRef;
};

export type HotelReviewSummary = {
  rating: number;
  scale: number;
  review_count: number;
  label?: string | null;
  subratings: Record<string, number>;
};

export type HotelPricing = {
  currency: string;
  nightly_rate?: Money | null;
  subtotal?: Money | null;
  taxes_and_fees?: Money | null;
  total?: Money | null;
  price_is_estimate: boolean;
  taxes_and_fees_included?: boolean | null;
};

export type HotelAvailability = {
  status: "unknown" | "available" | "unavailable" | "limited";
  check_in?: string | null;
  check_out?: string | null;
  rooms_requested?: number | null;
  rooms_remaining?: number | null;
  checked_at?: string | null;
  expires_at?: string | null;
};

export type HotelOffer = {
  provider: string;
  offer_id: string;
  room_name?: string | null;
  meal_plan?: string | null;
  occupancy?: number | null;
  pricing?: HotelPricing | null;
  availability: HotelAvailability;
  refundable?: boolean | null;
  cancellable_until?: string | null;
  booking_url?: string | null;
  source: ProviderRef;
};

export type HotelPropertyCandidate = {
  property_id: string;
  provider_ids: Record<string, string>;
  name: string;
  location: ResolvedLocation;
  property_types: string[];
  star_rating?: number | null;
  review_summary?: HotelReviewSummary | null;
  reviews: HotelReview[];
  amenities: HotelAmenity[];
  images: HotelImage[];
  description?: string | null;
  website_uri?: string | null;
  national_phone_number?: string | null;
  international_phone_number?: string | null;
  business_status?: string | null;
  opening_hours?: HotelOpeningHours | null;
  offers: HotelOffer[];
  sources: ProviderRef[];
};

export type HotelSearchResult = {
  search_id: string;
  mode: "exploratory" | "bookable";
  constraints: HotelSearchConstraints;
  properties: HotelPropertyCandidate[];
  total_matches?: number | null;
  has_more: boolean;
  warnings: string[];
  sources: ProviderRef[];
  searched_at: string;
};

export type SelectedHotelContext = {
  search_id: string;
  property_id: string;
  provider_ids: Record<string, string>;
  name: string;
  location: ResolvedLocation;
  selected_offer?: HotelOffer | null;
  check_in?: string | null;
  check_out?: string | null;
  selection_source?: "traveler" | "system";
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

export type RunResult = TripPlan | ClarificationResult | HotelSearchResult | GeneralAssistantResult;

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

export type ConversationSummary = {
  id: string;
  title: string;
  status: string;
  last_message_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type ConversationMessage = {
  id: number;
  public_id: string;
  role: "user" | "assistant" | "system" | "tool";
  status: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type ConversationRun = {
  id: string;
  trigger_message_id?: number | null;
  parent_run_id?: string | null;
  status: RunStatus;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
};

export type ConversationArtifact = {
  id: string;
  run_id?: string | null;
  kind: string;
  version: number;
  status: string;
  is_current: boolean;
  title?: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type ConversationDetail = {
  conversation: ConversationSummary;
  messages: ConversationMessage[];
  runs: ConversationRun[];
  artifacts: ConversationArtifact[];
};

export function isClarificationResult(value: unknown): value is ClarificationResult {
  return Boolean(
    value
    && typeof value === "object"
    && "questions" in value
    && Array.isArray(value.questions),
  );
}

export function isTripPlan(value: unknown): value is TripPlan {
  return Boolean(
    value
    && typeof value === "object"
    && "itinerary" in value
    && "budget" in value,
  );
}

export function isHotelSearchResult(value: unknown): value is HotelSearchResult {
  return Boolean(
    value
    && typeof value === "object"
    && "mode" in value
    && "constraints" in value
    && "properties" in value
    && Array.isArray(value.properties),
  );
}

export function isGeneralAssistantResult(value: unknown): value is GeneralAssistantResult {
  return Boolean(
    value
    && typeof value === "object"
    && "intent" in value
    && value.intent === "GENERAL"
    && "message" in value
    && typeof value.message === "string",
  );
}
