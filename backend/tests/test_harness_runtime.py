import json

import pytest

from app.core.config import Settings
from app.runtime.base import RuntimeCompleted, RuntimeProgress
from app.runtime.harness_http import HarnessProtocolError, _parse_update


def test_harness_progress_update_maps_to_runtime_contract() -> None:
    update = _parse_update(
        json.dumps(
            {
                "kind": "progress",
                "type": "agent.progress",
                "agent": "supervisor",
                "message": "Understanding your message",
                "data": {"source": "deepseek"},
            }
        )
    )

    assert isinstance(update, RuntimeProgress)
    assert update.agent == "supervisor"
    assert update.data == {"activity_schema_version": "1"}


def test_harness_progress_contract_allows_safe_tool_context_and_redacts_secrets() -> None:
    update = _parse_update(
        json.dumps(
            {
                "kind": "progress",
                "type": "tool.started",
                "agent": "supervisor",
                "message": "Google Places search running",
                "data": {
                    "tool": "search_google_places",
                    "call_id": "call-1",
                    "arguments": {"query": "quiet hotels in Kyoto", "api_key": "nope"},
                    "reasoning": "must never reach the browser",
                },
            }
        )
    )

    assert isinstance(update, RuntimeProgress)
    assert update.data["arguments"] == {
        "query": "quiet hotels in Kyoto",
        "api_key": "[redacted]",
    }
    assert "reasoning" not in update.data


def test_harness_unknown_progress_type_falls_back_without_forwarding_private_data() -> None:
    update = _parse_update(
        json.dumps(
            {
                "kind": "progress",
                "type": "reasoning.delta",
                "message": "private reasoning",
                "data": {"content": "hidden"},
            }
        )
    )

    assert isinstance(update, RuntimeProgress)
    assert update.type == "agent.progress"
    assert update.data == {"activity_schema_version": "1"}


def test_harness_completed_update_maps_to_runtime_contract() -> None:
    update = _parse_update(
        json.dumps({"kind": "completed", "state": {"general_result": {"message": "ok"}}})
    )

    assert isinstance(update, RuntimeCompleted)
    assert update.state["general_result"]["message"] == "ok"


def test_harness_rejects_unknown_updates() -> None:
    with pytest.raises(HarnessProtocolError):
        _parse_update('{"kind":"reasoning","content":"private"}')


def test_deepseek_runtime_requires_service_token() -> None:
    with pytest.raises(ValueError, match="HARNESS_SERVICE_TOKEN"):
        Settings(agent_runtime="deepseek", supabase_auth_required=False)
