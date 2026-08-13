from typing import Any

from langgraph.types import StreamWriter

from app.agents.common import emit
from app.graph.state import TripState
from app.llm.base import PlanningModel


class GeneralAssistantAgent:
    name = "general"

    def __init__(self, model: PlanningModel) -> None:
        self._model = model

    async def __call__(self, state: TripState, writer: StreamWriter) -> dict[str, Any]:
        request = state["request"]
        emit(writer, "agent.started", self.name, "Thinking about your message")
        result = await self._model.answer_general(request.message, request.context)
        emit(writer, "agent.completed", self.name, "Response ready")
        return {
            "general_result": result,
            "conversation_title": state.get("conversation_title") or result.conversation_title,
        }
