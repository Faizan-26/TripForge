"""Run a LangSmith dataset against TripForge's graph.

Usage:
  python scripts/evaluate_langsmith.py --dataset tripforge-regression

Examples in the dataset should use ``{"message": "..."}`` inputs. Optional
reference outputs can be scored by adding a custom evaluator in LangSmith.
"""

import argparse
import asyncio
import sys
from pathlib import Path

# Allow `python scripts/evaluate_langsmith.py` when launched from backend/.
# Installed/package-based execution continues to work as normal.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from langsmith import Client

from app.core.config import get_settings
from app.graph.builder import build_trip_graph
from app.llm.factory import build_planning_model
from app.services.langsmith import configure_langsmith
from app.tools.google_maps import GoogleMapsClient


async def main(dataset: str) -> None:
    settings = get_settings()
    if not configure_langsmith(settings):
        raise SystemExit("Set LANGSMITH_TRACING=true and LANGSMITH_API_KEY first.")
    maps = GoogleMapsClient(settings.google_maps_api_key)
    try:
        graph = build_trip_graph(
            settings=settings, model=build_planning_model(settings), maps=maps
        )

        async def target(inputs: dict) -> dict:
            from app.schemas.trip import PlanTripRequest

            result = await graph.ainvoke({"request": PlanTripRequest(**inputs)})
            return {"output": result}

        # Client.evaluate handles dataset runs, concurrency, and result links.
        await Client().aevaluate(
            target, data=dataset, experiment_prefix="tripforge"
        )
    finally:
        await maps.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True)
    args = parser.parse_args()
    asyncio.run(main(args.dataset))
