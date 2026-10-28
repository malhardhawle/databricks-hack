# CNRL Acquisition Explorer (app)

React + TypeScript (Vite, MapLibre + deck.gl, Recharts) frontend, FastAPI backend, data served from the Lakebase instance `cnrl-acq` (database `acq`).

## Run locally

Prereqs: the repo's `.venv` (see `../requirements-dev.txt` and `requirements.txt`), Node 20+, and the Databricks CLI profile `hack`.

```bash
# 1. backend on :8000 (uses CLI profile `hack` for Lakebase OAuth tokens)
cd app/backend
../../.venv/Scripts/python -m uvicorn main:app --port 8000 --reload

# 2. frontend dev server on :5173 (proxies /api to :8000)
cd app/frontend
npm install
npm run dev
```

Open http://localhost:5173.

To serve the built app from FastAPI alone (as it will run on Databricks Apps): run `npm run build` in `app/frontend`, then start the backend and open http://localhost:8000.

## Map controls

| Action | Does |
|---|---|
| Left-drag | Lasso CNRL assets (blue/green); the table below fills with nearby competitor production |
| Shift + left-drag | Add to the current selection |
| Left-click a dot | Details panel: production, nearest CNRL asset, haul distances, transport savings, operator's rank |
| Right-drag (or middle-drag, or Ctrl + drag) | Pan |
| Scroll | Zoom toward the cursor |
| Click a results row | By facility: open its details. By operator: highlight that operator on the map |

## Refresh the data

```bash
python scripts/run_pipeline.py              # rebuild shm_hack.acq from shm_hack.petrinex
.venv/Scripts/python scripts/load_lakebase.py  # copy the app tables into Lakebase
```
Restart the backend afterwards (it caches the scoring tables per process).

## What's where

| Path | Purpose |
|---|---|
| `backend/main.py` | `/api/facilities`, `/api/nearby` (lasso), `/api/rank`, `/api/assumptions`, `/api/precedents`; serves `frontend/dist` |
| `backend/queries.py` | Lakebase SQL (the lasso search is haversine with a lat/lon bounding-box prefilter) |
| `backend/scoring.py` | NPV@15%, ROCE, proximity, precedent fit, ranking, back-test |
| `backend/db.py` | psycopg pool with short-lived Databricks OAuth tokens |
| `frontend/src/components/` | `MapView` (lasso), `RankingView` + `AssumptionsPanel`, `Top3View`, `PrecedentsView` |

The Lakebase instance bills while running. Stop it between demos:
`databricks -p hack database update-database-instance cnrl-acq stopped --stopped`, and restart it with `--stopped=false`
(or use the Databricks UI: Compute → Database instances).
