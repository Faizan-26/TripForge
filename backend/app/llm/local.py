import re

from app.llm.base import PlanningModel
from app.schemas.trip import (
    ItineraryAssignment,
    ItineraryDecision,
    PlaceCandidate,
    ScopeDecision,
    TravelMode,
    TripRequestDraft,
    TripRequirements,
)

_NUMBER_WORDS = {
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
}


class LocalPlanningModel(PlanningModel):
    """Limited, deterministic fallback used when an LLM key is not configured.

    It only structures explicit user input and arranges already-grounded provider
    entities. It never supplies travel facts or invents places.
    """

    name = "local-fallback"

    async def extract_trip(self, message: str) -> TripRequestDraft:
        text = " ".join(message.strip().split())
        lower = text.lower()

        origin: str | None = None
        destination: str | None = None
        route_match = re.search(
            r"\bfrom\s+(.+?)\s+to\s+(.+?)(?=\s+(?:for|with|on a|around|under)\b|[,.]|$)",
            text,
            flags=re.IGNORECASE,
        )
        if route_match:
            origin = route_match.group(1).strip()
            destination = route_match.group(2).strip()
        else:
            destination_match = re.search(
                r"\b(?:trip to|travel to|visit|in)\s+(.+?)"
                r"(?=\s+(?:for|with|on a|around|under)\b|[,.]|$)",
                text,
                flags=re.IGNORECASE,
            )
            if destination_match:
                destination = destination_match.group(1).strip()

        duration_days = self._find_number(
            lower,
            r"\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)[ -]day",
        )
        if duration_days is None:
            duration_days = self._find_number(
                lower,
                r"\bfor\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+days?\b",
            )

        travelers = self._find_number(
            lower,
            r"\b(?:for|with)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+"
            r"(?:people|persons?|travell?ers?|adults?)\b",
        )
        if travelers is None:
            travelers = self._find_number(
                lower,
                r"\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+"
                r"(?:people|persons?|travell?ers?|adults?)\b",
            )

        budget_total: float | None = None
        currency = "USD"
        budget_match = re.search(
            r"(?:budget(?:\s+is)?|around|under|up to)\s*(?:usd\s*)?\$?\s*([\d,]+(?:\.\d+)?)",
            lower,
        )
        if budget_match:
            budget_total = float(budget_match.group(1).replace(",", ""))
        if "pkr" in lower:
            currency = "PKR"
        elif "eur" in lower or "€" in text:
            currency = "EUR"
        elif "gbp" in lower or "£" in text:
            currency = "GBP"

        interests: list[str] = []
        interest_match = re.search(
            r"\b(?:like|love|interested in|interests include)\s+(.+?)(?=[.]|$)",
            lower,
        )
        if interest_match:
            interests = [
                item.strip(" ,")
                for item in re.split(r",|\band\b", interest_match.group(1))
                if item.strip(" ,")
            ][:12]

        pace = None
        if any(word in lower for word in ("relaxed", "relaxing", "slow pace")):
            pace = "relaxed"
        elif any(word in lower for word in ("packed", "active", "fast pace")):
            pace = "active"

        travel_mode = TravelMode.DRIVE
        if "public transport" in lower or "transit" in lower:
            travel_mode = TravelMode.TRANSIT
        elif "walk" in lower:
            travel_mode = TravelMode.WALK
        elif "bicycle" in lower or "cycling" in lower:
            travel_mode = TravelMode.BICYCLE

        return TripRequestDraft(
            destination=destination,
            origin=origin,
            travelers=travelers,
            duration_days=duration_days,
            budget_total=budget_total,
            currency=currency,
            interests=interests,
            pace=pace,
            travel_mode=travel_mode,
        )

    async def decide_scope(self, trip: TripRequirements) -> ScopeDecision:
        return ScopeDecision(
            trip_type="single_base",
            base_regions=[trip.destination],
            max_day_trip_minutes=180 if trip.pace != "relaxed" else 120,
            rationale=(
                "The local fallback keeps one shared base region. Configure an LLM to infer "
                "a grounded multi-region scope for broad destinations."
            ),
        )

    async def arrange_itinerary(
        self,
        trip: TripRequirements,
        stay: PlaceCandidate | None,
        activities: list[PlaceCandidate],
    ) -> ItineraryDecision:
        per_day = {"relaxed": 2, "balanced": 3, "active": 4}[trip.pace]
        days: list[ItineraryAssignment] = []
        for day in range(1, trip.duration_days + 1):
            start = (day - 1) * per_day
            selected = activities[start : start + per_day]
            days.append(
                ItineraryAssignment(
                    day=day,
                    title=f"Day {day} around {trip.destination}",
                    activity_ids=[activity.provider_id for activity in selected],
                )
            )
        return ItineraryDecision(days=days)

    @staticmethod
    def _find_number(text: str, pattern: str) -> int | None:
        match = re.search(pattern, text)
        if not match:
            return None
        token = match.group(1)
        return int(token) if token.isdigit() else _NUMBER_WORDS.get(token)
