from app.core.config import Settings
from app.llm.base import PlanningModel
from app.llm.local import LocalPlanningModel
from app.llm.openai import OpenAIPlanningModel


def build_planning_model(settings: Settings) -> PlanningModel:
    if settings.openai_api_key:
        return OpenAIPlanningModel(
            api_key=settings.openai_api_key,
            model=settings.openai_model,
        )
    return LocalPlanningModel()
