from typing import Any

from langgraph.types import StreamWriter


def emit(
    writer: StreamWriter,
    event_type: str,
    agent: str,
    message: str,
    data: dict[str, Any] | None = None,
) -> None:
    writer(
        {
            "type": event_type,
            "agent": agent,
            "message": message,
            "data": data or {},
        }
    )
