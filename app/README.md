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

## Deploy (Databricks Apps)

Live at https://cnrl-acquisition-explorer-7808899982160538.18.azure.databricksapps.com (workspace sign-in required).
The app is defined in `../databricks.yml` (Asset Bundle) and runs `backend/serve.py`, which serves `frontend/dist` too.

```bash
cd app/frontend && npm run build && cd ../..                    # dist/ is gitignored but the bundle syncs it
databricks bundle deploy -p hack                                # create/update the app, upload ./app
databricks bundle run cnrl_acquisition_explorer -p hack         # deploy the uploaded source and (re)start
.venv/Scripts/python scripts/load_lakebase.py --grant-only      # first deploy only: let the app SP read the tables
```

The app reads Lakebase as its own service principal (database resource `cnrl-acq` / `acq`). `load_lakebase.py`
re-grants it automatically after every data reload. Its compute bills while running; stop it with
`databricks -p hack apps stop cnrl-acquisition-explorer`.

## Ask Genie

The **✦ Ask Genie** button opens a chat with the Databricks Genie space *CNRL Acquisition Explorer - Petrinex Genie*
(id in `genie_space.json`; definition in `../genie/spec.py`, built from `Genie.md` + `sbx_prompts.txt`).

- Whatever is selected on the map is attached as a **Map context** block: lassoed CNRL facility IDs, nearby competitor
  operators (BA IDs), the facility open in the details panel, ticked wells and a focused operator. Untick
  "Attach map context" to ask without it.
- Tick wells in a facility's details panel, then **Ask Genie about this well selection**.
- Answers show Genie's summary, the result table (CSV export), the SQL it ran and follow-up suggestions.

Update the space after editing `genie/spec.py`:
```bash
.venv/Scripts/python scripts/genie_space.py --validate   # run every example/benchmark SQL first
.venv/Scripts/python scripts/genie_space.py              # update the space in place
```
The deployed app reaches Genie as its service principal through the `genie-space` (CAN_RUN) and `sql-warehouse`
(CAN_USE) resources in `databricks.yml`.

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
