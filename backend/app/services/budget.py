from app.schemas.trip import BudgetSummary, ItineraryDay, PlaceCandidate, TripRequirements


def calculate_budget(
    trip: TripRequirements,
    stay: PlaceCandidate | None,
    itinerary: list[ItineraryDay],
) -> BudgetSummary:
    known_total = 0.0
    unknown: list[str] = []

    if stay and stay.estimated_cost is not None:
        known_total += stay.estimated_cost * max(trip.duration_days - 1, 1)
    else:
        unknown.append("accommodation")

    activities = [stop.place for day in itinerary for stop in day.stops]
    known_activity_costs = [
        item.estimated_cost for item in activities if item.estimated_cost is not None
    ]
    known_total += sum(known_activity_costs) * trip.travelers
    if len(known_activity_costs) != len(activities):
        unknown.append("activities")

    unknown.append("transport")
    unknown = list(dict.fromkeys(unknown))
    remaining = trip.budget_total - known_total if trip.budget_total is not None else None
    complete = not unknown
    within_budget = None
    if trip.budget_total is not None and complete:
        within_budget = known_total <= trip.budget_total

    notes = []
    if unknown:
        notes.append("Unknown costs are excluded; no within-budget claim is made.")
    if trip.budget_total is None:
        notes.append("The traveler did not set a hard numeric budget.")

    return BudgetSummary(
        currency=trip.currency,
        budget_total=trip.budget_total,
        known_cost_total=round(known_total, 2),
        remaining_from_known_costs=round(remaining, 2) if remaining is not None else None,
        coverage="complete" if complete else ("partial" if known_total else "unavailable"),
        unknown_cost_categories=unknown,
        is_within_budget=within_budget,
        notes=notes,
    )
