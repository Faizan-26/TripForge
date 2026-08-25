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
    assert update.data == {"source": "deepseek"}


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
