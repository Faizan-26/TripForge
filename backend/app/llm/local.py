import re
from datetime import date

from app.schemas.hotel import HotelSearchConstraints, HotelSearchMode

from app.llm.base import PlanningModel
from app.schemas.trip import (
    ConversationTurn,
    GeneralAssistantResult,
    ItineraryAssignment,
    ItineraryDecision,
    Intent,
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

        explicitly_plans_trip = bool(
            re.search(r"\b(plan|build|create|organize)\b.+\btrip\b|\bitinerary\b", lower)
        )
        intent = (
            Intent.FULL_TRIP_PLAN
            if explicitly_plans_trip
            else Intent.HOTEL_SEARCH
            if re.search(r"\b(hotels?|lodging|accommodation|places? to stay)\b", lower)
            else Intent.GENERAL
        )
        hotel_mode: HotelSearchMode | None = None
        if intent == Intent.HOTEL_SEARCH:
            requests_live_data = bool(
                re.search(
                    r"\b(bookable|available|availability|book|price|pricing|rates?|under|"
                    r"budget|costs?|from\s+[a-z]+\s+\d{1,2})\b|[$â‚¬Â£]",
                    lower,
                )
            )
            hotel_mode = (
                HotelSearchMode.BOOKABLE
                if requests_live_data
                else HotelSearchMode.EXPLORATORY
            )

        origin: str | None = None
        destination: str | None = None
        route_match = re.search(
            r"\bfrom\s+(.+?)\s+to\s+(.+?)(?=\s+(?:for|with|on a|around|under)\b|[,.]|$)",
            text,
            flags=re.IGNORECASE,
        )
        destination_first_route_match = re.search(
            r"\b(?:trip|travel)\s+to\s+(.+?)\s+from\s+(.+?)"
            r"(?=\s+(?:for|with|on a|around|under)\b|[,.]|$)",
            text,
            flags=re.IGNORECASE,
        )
        if intent == Intent.HOTEL_SEARCH:
            hotel_location = re.search(
                r"\bhotels?\s+(?:near|around|by|in)\s+(.+?)"
                r"(?=\s+(?:under|below|up to|from|for|with|on)\b|[,.]|$)",
                text,
                flags=re.IGNORECASE,
            )
            if hotel_location and hotel_location.group(1).strip().lower() != "nearby":
                destination = hotel_location.group(1).strip()
        elif route_match:
            origin = route_match.group(1).strip()
            destination = route_match.group(2).strip()
        elif destination_first_route_match:
            destination = destination_first_route_match.group(1).strip()
            origin = destination_first_route_match.group(2).strip()
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

        check_in, check_out = self._find_date_range(text)
        hotel_search = None
        if intent == Intent.HOTEL_SEARCH:
            hotel_search = HotelSearchConstraints(
                destination_query=destination,
                check_in=check_in,
                check_out=check_out,
                adults=travelers,
                currency=currency,
                max_total_price=budget_total,
            )

        return TripRequestDraft(
            intent=intent,
            hotel_search_mode=hotel_mode,
            destination=destination,
            origin=origin,
            travelers=travelers,
            duration_days=duration_days,
            budget_total=budget_total,
            currency=currency,
            interests=interests,
            pace=pace,
            travel_mode=travel_mode,
            start_date=check_in if intent == Intent.HOTEL_SEARCH else None,
            end_date=check_out if intent == Intent.HOTEL_SEARCH else None,
            hotel_search=hotel_search,
        )

    async def answer_general(
        self, message: str, context: list[ConversationTurn]
    ) -> GeneralAssistantResult:
        lower = message.strip().lower()
        if re.fullmatch(r"(?:hi+|hey+|hello|salam|assalamualaikum)[!. ]*", lower):
            response = (
                "Hi! I’m TripForge. I can help you explore destinations, find hotels, "
                "or turn an idea into a complete trip plan. What are you thinking about?"
            )
        elif any(term in lower for term in ("what can you do", "help me", "how can you help")):
            response = (
                "I can answer travel questions, compare grounded hotel options, and build "
                "a day-by-day trip plan. Tell me what you want to explore, or ask me to find "
                "hotels or plan a trip when you’re ready."
            )
        else:
            response = (
                "I can help with that as your TripForge travel assistant. Share the place or "
                "travel question you have in mind; if you want results, say “find hotels,” and "
                "if you want an itinerary, say “plan a trip.”"
            )
        return GeneralAssistantResult(
            message=response,
            conversation_title=await self.suggest_title(message),
        )

    async def suggest_title(self, message: str) -> str:
        words = re.findall(r"[\w'-]+", message.strip(), flags=re.UNICODE)
        if not words:
            return "Travel conversation"
        if len(words) <= 2 and words[0].lower().rstrip("!") in {"hi", "hii", "hiii", "hey", "hello"}:
            return "Travel conversation"
        title = " ".join(words[:7]).strip()
        return title[:80].capitalize()

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

    @staticmethod
    def _find_date_range(text: str) -> tuple[date | None, date | None]:
        months = {
            "january": 1,
            "february": 2,
            "march": 3,
            "april": 4,
            "may": 5,
            "june": 6,
            "july": 7,
            "august": 8,
            "september": 9,
            "october": 10,
            "november": 11,
            "december": 12,
        }
        match = re.search(
            r"\bfrom\s+(" + "|".join(months) + r")\s+(\d{1,2})"
            r"(?:,?\s+(\d{4}))?\s+to\s+(?:(" + "|".join(months) + r")\s+)?"
            r"(\d{1,2})(?:,?\s+(\d{4}))?\b",
            text,
            flags=re.IGNORECASE,
        )
        if not match:
            return None, None
        today = date.today()
        start_month = months[match.group(1).lower()]
        end_month = months[(match.group(4) or match.group(1)).lower()]
        start_year = int(match.group(3)) if match.group(3) else today.year
        if not match.group(3) and (start_month, int(match.group(2))) < (today.month, today.day):
            start_year += 1
        end_year = int(match.group(6)) if match.group(6) else start_year
        if end_month < start_month and not match.group(6):
            end_year += 1
        try:
            return (
                date(start_year, start_month, int(match.group(2))),
                date(end_year, end_month, int(match.group(5))),
            )
        except ValueError:
            return None, None
