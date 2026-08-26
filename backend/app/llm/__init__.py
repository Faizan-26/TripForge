from typing import Any

__all__ = ["build_planning_model"]


def build_planning_model(*args: Any, **kwargs: Any) -> Any:
    """Load the legacy model factory only when the LangGraph runtime needs it."""
    from app.llm.factory import build_planning_model as factory

    return factory(*args, **kwargs)
