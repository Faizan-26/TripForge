from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol
from uuid import UUID, uuid4

import httpx

from app.core.config import Settings
from app.schemas.events import RunEvent, RunSnapshot
from app.schemas.trip import PlanTripRequest


class AuthenticationError(Exception):
    pass


class PersistenceError(Exception):
    pass


@dataclass(frozen=True)
class AuthenticatedUser:
    id: UUID


class TripRepository(Protocol):
    async def prepare_run(
        self, *, user_id: UUID, run_id: UUID, request: PlanTripRequest
    ) -> UUID: ...

    async def update_run(self, run_id: UUID, **values: Any) -> None: ...

    async def add_event(
        self, *, conversation_id: UUID, run_id: UUID, event: Any
    ) -> None: ...

    async def save_result(
        self,
        *,
        conversation_id: UUID,
        run_id: UUID,
        result: dict[str, Any],
        needs_clarification: bool,
    ) -> None: ...

    async def set_conversation_title_if_default(
        self, *, conversation_id: UUID, title: str
    ) -> None: ...

    async def owns_run(self, *, user_id: UUID, run_id: UUID) -> bool: ...

    async def soft_delete_conversation(
        self, *, user_id: UUID, conversation_id: UUID
    ) -> bool: ...

    async def get_run(self, run_id: UUID) -> RunSnapshot | None: ...

    async def list_events(self, run_id: UUID, *, after_sequence: int) -> list[RunEvent]: ...

    async def close(self) -> None: ...


class SupabaseGateway:
    """Verifies Supabase users and persists trusted agent output via PostgREST."""

    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        if not (
            settings.supabase_url
            and settings.supabase_publishable_key
            and settings.supabase_secret_key
        ):
            raise ValueError("Supabase URL, publishable key, and secret key are required")
        self._url = settings.supabase_url.rstrip("/")
        self._publishable_key = settings.supabase_publishable_key
        self._secret_key = settings.supabase_secret_key.get_secret_value()
        self._client = client or httpx.AsyncClient(timeout=15)
        self._owns_client = client is None

    async def authenticate(self, token: str) -> AuthenticatedUser:
        try:
            response = await self._client.get(
                f"{self._url}/auth/v1/user",
                headers={
                    "apikey": self._publishable_key,
                    "Authorization": f"Bearer {token}",
                },
            )
        except httpx.HTTPError as exc:
            raise PersistenceError("Supabase Auth is unavailable") from exc
        if response.status_code in {401, 403}:
            raise AuthenticationError("Invalid or expired Supabase access token")
        if response.status_code != 200:
            raise PersistenceError(f"Supabase Auth failed ({response.status_code})")
        try:
            return AuthenticatedUser(id=UUID(response.json()["id"]))
        except (KeyError, TypeError, ValueError) as exc:
            raise AuthenticationError("Supabase returned an invalid user identity") from exc

    async def prepare_run(
        self, *, user_id: UUID, run_id: UUID, request: PlanTripRequest
    ) -> UUID:
        conversation_id = request.conversation_id or uuid4()
        if request.conversation_id:
            rows = await self._request(
                "GET",
                "conversations",
                params={
                    "select": "id",
                    "id": f"eq.{conversation_id}",
                    "owner_user_id": f"eq.{user_id}",
                    "deleted_at": "is.null",
                },
            )
            if not rows:
                raise AuthenticationError("Conversation not found or not owned by this user")
        else:
            await self._request(
                "POST",
                "conversations",
                json={
                    "id": str(conversation_id),
                    "owner_user_id": str(user_id),
                    "client_request_id": str(request.client_request_id or uuid4()),
                    "title": request.title or "New conversation",
                    "status": "active",
                    "metadata": {},
                },
            )

        if request.parent_run_id:
            parent_rows = await self._request(
                "GET",
                "agent_runs",
                params={
                    "select": "id",
                    "id": f"eq.{request.parent_run_id}",
                    "conversation_id": f"eq.{conversation_id}",
                },
            )
            if not parent_rows:
                raise AuthenticationError("Parent run does not belong to this conversation")

        messages = await self._request(
            "POST",
            "messages",
            headers={"Prefer": "return=representation"},
            json={
                "public_id": str(uuid4()),
                "conversation_id": str(conversation_id),
                "author_user_id": str(user_id),
                "role": "user",
                "status": "complete",
                "content": request.message,
                "client_message_id": str(request.client_message_id or uuid4()),
                "metadata": {"answers": request.answers},
            },
        )
        trigger_message_id = messages[0]["id"]
        await self._request(
            "PATCH",
            "conversations",
            params={"id": f"eq.{conversation_id}"},
            json={"last_message_at": datetime.now(UTC).isoformat()},
        )
        await self._request(
            "POST",
            "agent_runs",
            json={
                "id": str(run_id),
                "conversation_id": str(conversation_id),
                "trigger_message_id": trigger_message_id,
                "parent_run_id": str(request.parent_run_id) if request.parent_run_id else None,
                "agent_key": "trip_supervisor",
                "status": "queued",
                "attempt": 1,
                "metrics": {},
            },
        )
        return conversation_id

    async def update_run(self, run_id: UUID, **values: Any) -> None:
        await self._request(
            "PATCH", "agent_runs", params={"id": f"eq.{run_id}"}, json=values
        )

    async def add_event(self, *, conversation_id: UUID, run_id: UUID, event: Any) -> None:
        await self._request(
            "POST",
            "agent_run_events",
            json={
                "conversation_id": str(conversation_id),
                "run_id": str(run_id),
                "event_type": event.type,
                "agent_key": event.agent,
                "payload": event.model_dump(mode="json"),
            },
        )

    async def save_result(
        self,
        *,
        conversation_id: UUID,
        run_id: UUID,
        result: dict[str, Any],
        needs_clarification: bool,
    ) -> None:
        is_hotel_search = (
            not needs_clarification
            and isinstance(result.get("properties"), list)
            and result.get("mode") in {"exploratory", "bookable"}
        )
        is_general = result.get("intent") == "GENERAL" and isinstance(
            result.get("message"), str
        )
        if is_general:
            await self._request(
                "POST",
                "messages",
                json={
                    "public_id": str(uuid4()),
                    "conversation_id": str(conversation_id),
                    "author_user_id": None,
                    "role": "assistant",
                    "status": "complete",
                    "content": result["message"],
                    "metadata": {
                        "run_id": str(run_id),
                        "result_kind": "general_response",
                    },
                },
            )
            await self._request(
                "PATCH",
                "conversations",
                params={"id": f"eq.{conversation_id}"},
                json={"last_message_at": datetime.now(UTC).isoformat()},
            )
            return
        kind = (
            "clarification"
            if needs_clarification
            else "hotel_search"
            if is_hotel_search
            else "trip_plan"
        )
        await self._request(
            "PATCH",
            "artifacts",
            params={
                "conversation_id": f"eq.{conversation_id}",
                "kind": f"eq.{kind}",
                "is_current": "eq.true",
            },
            json={"is_current": False},
        )
        existing = await self._request(
            "GET",
            "artifacts",
            params={
                "select": "version",
                "conversation_id": f"eq.{conversation_id}",
                "kind": f"eq.{kind}",
                "order": "version.desc",
                "limit": "1",
            },
        )
        version = (existing[0]["version"] + 1) if existing else 1
        await self._request(
            "POST",
            "artifacts",
            json={
                "id": str(uuid4()),
                "conversation_id": str(conversation_id),
                "run_id": str(run_id),
                "kind": kind,
                "version": version,
                "schema_version": 1,
                "status": "final",
                "is_current": True,
                "title": (
                    "Trip clarification"
                    if needs_clarification
                    else "Hotel search results"
                    if is_hotel_search
                    else "Trip itinerary"
                ),
                "payload": result,
            },
        )
        await self._request(
            "POST",
            "messages",
            json={
                "public_id": str(uuid4()),
                "conversation_id": str(conversation_id),
                "author_user_id": None,
                "role": "assistant",
                "status": "complete",
                "content": (
                    "I need a few details before planning your trip."
                    if needs_clarification
                    else "I found hotel options for you."
                    if is_hotel_search
                    else "Your trip plan is ready."
                ),
                "metadata": {"run_id": str(run_id), "artifact_kind": kind},
            },
        )
        await self._request(
            "PATCH",
            "conversations",
            params={"id": f"eq.{conversation_id}"},
            json={"last_message_at": datetime.now(UTC).isoformat()},
        )

    async def set_conversation_title_if_default(
        self, *, conversation_id: UUID, title: str
    ) -> None:
        clean_title = " ".join(title.split())[:80]
        if not clean_title:
            return
        rows = await self._request(
            "GET",
            "conversations",
            params={
                "select": "title",
                "id": f"eq.{conversation_id}",
                "limit": "1",
            },
        )
        current_title = rows[0].get("title") if rows else None
        if current_title and current_title not in {"New conversation", "New trip"}:
            return
        await self._request(
            "PATCH",
            "conversations",
            params={"id": f"eq.{conversation_id}"},
            json={"title": clean_title, "updated_at": datetime.now(UTC).isoformat()},
        )

    async def owns_run(self, *, user_id: UUID, run_id: UUID) -> bool:
        runs = await self._request(
            "GET",
            "agent_runs",
            params={
                "select": "conversation_id",
                "id": f"eq.{run_id}",
                "limit": "1",
            },
        )
        if not runs:
            return False
        conversations = await self._request(
            "GET",
            "conversations",
            params={
                "select": "id",
                "id": f"eq.{runs[0]['conversation_id']}",
                "owner_user_id": f"eq.{user_id}",
                "deleted_at": "is.null",
                "limit": "1",
            },
        )
        return bool(conversations)

    async def soft_delete_conversation(
        self, *, user_id: UUID, conversation_id: UUID
    ) -> bool:
        rows = await self._request(
            "PATCH",
            "conversations",
            params={
                "select": "id",
                "id": f"eq.{conversation_id}",
                "owner_user_id": f"eq.{user_id}",
                "deleted_at": "is.null",
            },
            json={
                "deleted_at": datetime.now(UTC).isoformat(),
                "updated_at": datetime.now(UTC).isoformat(),
            },
            headers={"Prefer": "return=representation"},
        )
        return bool(rows)

    async def get_run(self, run_id: UUID) -> RunSnapshot | None:
        rows = await self._request(
            "GET",
            "agent_runs",
            params={
                "select": (
                    "id,conversation_id,parent_run_id,status,error_message,created_at,updated_at"
                ),
                "id": f"eq.{run_id}",
                "limit": "1",
            },
        )
        if not rows:
            return None
        row = rows[0]
        artifacts = await self._request(
            "GET",
            "artifacts",
            params={
                "select": "payload",
                "run_id": f"eq.{run_id}",
                "order": "version.desc",
                "limit": "1",
            },
        )
        return RunSnapshot(
            run_id=row["id"],
            conversation_id=row["conversation_id"],
            parent_run_id=row.get("parent_run_id"),
            status=row["status"],
            result=artifacts[0]["payload"] if artifacts else None,
            error=row.get("error_message"),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    async def list_events(self, run_id: UUID, *, after_sequence: int) -> list[RunEvent]:
        rows = await self._request(
            "GET",
            "agent_run_events",
            params={
                "select": "payload",
                "run_id": f"eq.{run_id}",
                "order": "id.asc",
            },
        )
        events = [RunEvent.model_validate(row["payload"]) for row in rows]
        return [event for event in events if event.sequence > after_sequence]

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def _request(self, method: str, table: str, **kwargs: Any) -> Any:
        headers = {
            "apikey": self._secret_key,
            "Content-Type": "application/json",
            **kwargs.pop("headers", {}),
        }
        try:
            response = await self._client.request(
                method, f"{self._url}/rest/v1/{table}", headers=headers, **kwargs
            )
        except httpx.HTTPError as exc:
            raise PersistenceError(f"Supabase {table} is unavailable") from exc
        if response.status_code >= 400:
            # PostgREST returns the violated column/constraint in a small JSON body.
            # Keep enough detail for server-side diagnosis without logging headers or keys.
            detail = response.text.strip().replace("\n", " ")[:1000]
            suffix = f": {detail}" if detail else ""
            raise PersistenceError(
                f"Supabase {table} request failed ({response.status_code}){suffix}"
            )
        if not response.content:
            return []
        return response.json()
