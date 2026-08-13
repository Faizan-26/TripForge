import json
from uuid import uuid4

import httpx
import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.schemas.trip import PlanTripRequest
from app.supabase import AuthenticationError, PersistenceError, SupabaseGateway


async def test_supabase_authentication_and_new_run_persistence_are_mocked() -> None:
    user_id = uuid4()
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/auth/v1/user":
            assert request.headers["authorization"] == "Bearer user-token"
            return httpx.Response(200, json={"id": str(user_id)})
        assert request.headers["apikey"] == "sb_secret_test"
        assert "authorization" not in request.headers
        if request.url.path.endswith("/messages"):
            body = json.loads(request.content)
            if body["role"] == "user":
                return httpx.Response(201, json=[{"id": 42}])
        return httpx.Response(201, json=[])

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    gateway = SupabaseGateway(
        Settings(
            supabase_url="https://example.supabase.co",
            supabase_publishable_key="sb_publishable_test",
            supabase_secret_key="sb_secret_test",
        ),
        client=client,
    )
    try:
        user = await gateway.authenticate("user-token")
        conversation_id = await gateway.prepare_run(
            user_id=user.id,
            run_id=uuid4(),
            request=PlanTripRequest(
                message="Plan a three day trip to Islamabad",
                client_request_id=uuid4(),
                client_message_id=uuid4(),
            ),
        )
    finally:
        await client.aclose()

    assert user.id == user_id
    assert conversation_id
    paths = [request.url.path for request in requests]
    assert "/rest/v1/conversations" in paths
    assert "/rest/v1/messages" in paths
    assert "/rest/v1/agent_runs" in paths


async def test_supabase_rejects_invalid_access_token() -> None:
    client = httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(401, json={}))
    )
    gateway = SupabaseGateway(
        Settings(
            supabase_url="https://example.supabase.co",
            supabase_publishable_key="sb_publishable_test",
            supabase_secret_key="sb_secret_test",
        ),
        client=client,
    )
    try:
        with pytest.raises(AuthenticationError):
            await gateway.authenticate("expired-token")
    finally:
        await client.aclose()


def test_settings_reject_legacy_supabase_keys_when_auth_is_enabled() -> None:
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            supabase_url="https://example.supabase.co",
            supabase_publishable_key="legacy-anon-jwt",
            supabase_secret_key="legacy-service-role-jwt",
            supabase_auth_required=True,
        )


def test_settings_accept_current_supabase_keys() -> None:
    settings = Settings(
        _env_file=None,
        supabase_url="https://example.supabase.co",
        supabase_publishable_key="sb_publishable_test",
        supabase_secret_key="sb_secret_test",
        supabase_auth_required=True,
    )

    assert settings.supabase_publishable_key == "sb_publishable_test"
    assert settings.supabase_secret_key is not None
    assert settings.supabase_secret_key.get_secret_value() == "sb_secret_test"


async def test_save_result_uses_final_artifact_status() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.method == "GET":
            return httpx.Response(200, json=[])
        return httpx.Response(201, json=[])

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    gateway = SupabaseGateway(
        Settings(
            _env_file=None,
            supabase_url="https://example.supabase.co",
            supabase_publishable_key="sb_publishable_test",
            supabase_secret_key="sb_secret_test",
        ),
        client=client,
    )
    try:
        await gateway.save_result(
            conversation_id=uuid4(),
            run_id=uuid4(),
            result={"status": "valid"},
            needs_clarification=False,
        )
    finally:
        await client.aclose()

    artifact_insert = next(
        request
        for request in requests
        if request.method == "POST" and request.url.path.endswith("/artifacts")
    )
    assert json.loads(artifact_insert.content)["status"] == "final"


async def test_hotel_result_uses_hotel_search_artifact_kind() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200 if request.method == "GET" else 201, json=[])

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    gateway = SupabaseGateway(
        Settings(
            _env_file=None,
            supabase_url="https://example.supabase.co",
            supabase_publishable_key="sb_publishable_test",
            supabase_secret_key="sb_secret_test",
        ),
        client=client,
    )
    try:
        await gateway.save_result(
            conversation_id=uuid4(),
            run_id=uuid4(),
            result={"mode": "exploratory", "properties": [], "constraints": {}},
            needs_clarification=False,
        )
    finally:
        await client.aclose()

    artifact_insert = next(
        request
        for request in requests
        if request.method == "POST" and request.url.path.endswith("/artifacts")
    )
    message_insert = [
        request
        for request in requests
        if request.method == "POST" and request.url.path.endswith("/messages")
    ][-1]
    assert json.loads(artifact_insert.content)["kind"] == "hotel_search"
    assert json.loads(message_insert.content)["content"] == "I found hotel options for you."


async def test_general_result_is_saved_as_chat_message_without_artifact() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200 if request.method == "GET" else 201, json=[])

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    gateway = SupabaseGateway(
        Settings(
            _env_file=None,
            supabase_url="https://example.supabase.co",
            supabase_publishable_key="sb_publishable_test",
            supabase_secret_key="sb_secret_test",
        ),
        client=client,
    )
    try:
        await gateway.save_result(
            conversation_id=uuid4(),
            run_id=uuid4(),
            result={
                "intent": "GENERAL",
                "message": "Hello from TripForge",
                "conversation_title": "Travel conversation",
            },
            needs_clarification=False,
        )
    finally:
        await client.aclose()

    artifact_requests = [
        request for request in requests if request.url.path.endswith("/artifacts")
    ]
    message = next(
        request
        for request in requests
        if request.method == "POST" and request.url.path.endswith("/messages")
    )
    assert artifact_requests == []
    assert json.loads(message.content)["content"] == "Hello from TripForge"


async def test_generated_title_only_targets_default_titles() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.method == "GET":
            return httpx.Response(200, json=[{"title": "New conversation"}])
        return httpx.Response(204)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    gateway = SupabaseGateway(
        Settings(
            _env_file=None,
            supabase_url="https://example.supabase.co",
            supabase_publishable_key="sb_publishable_test",
            supabase_secret_key="sb_secret_test",
        ),
        client=client,
    )
    try:
        await gateway.set_conversation_title_if_default(
            conversation_id=uuid4(), title="Dubai hotel ideas"
        )
    finally:
        await client.aclose()

    request = requests[-1]
    assert request.method == "PATCH"
    assert json.loads(request.content)["title"] == "Dubai hotel ideas"


async def test_persistence_error_includes_postgrest_detail() -> None:
    client = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                400,
                json={"code": "23514", "message": "violates check constraint"},
            )
        )
    )
    gateway = SupabaseGateway(
        Settings(
            _env_file=None,
            supabase_url="https://example.supabase.co",
            supabase_publishable_key="sb_publishable_test",
            supabase_secret_key="sb_secret_test",
        ),
        client=client,
    )
    try:
        with pytest.raises(PersistenceError, match="23514"):
            await gateway.update_run(uuid4(), status="failed")
    finally:
        await client.aclose()
