# TripForge LangGraph evaluation dataset

Upload `tripforge-regression.csv` to LangSmith as a dataset named
`tripforge-regression`.

Use the CSV column `message` as the input key. The examples intentionally cover
normal planning requests, constraints, accessibility, budget sensitivity, and
an underspecified request that should exercise the supervisor's clarification
behavior.

After uploading, run from the backend directory:

```powershell
python scripts/evaluate_langsmith.py --dataset tripforge-regression
```
