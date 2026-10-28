# CNRL acquisition app: the "perfect prompt" (rev 2)

Revised 2026-10-28. This version uses CNRL's own deal history in Petrinex (2024-01 to 2025-12) as the baseline for scoring future candidates. It sits alongside [acquisition-app-plan.md](acquisition-app-plan.md), and the prompt below answers that plan's open decisions Q1 to Q8.

---

## 1. Why use the historicals

The data shows facilities whose reporting operator changed to CNRL (`0HE9`). Those transfers are CNRL's revealed acquisition preferences: which deal sizes, product mixes and distances from existing CNRL infrastructure CNRL actually bought. We can use them to:

1. **Define the CNRL footprint correctly:** BAID `0HE9`, plus every facility transferred in, plus wells still labelled with the seller's name.
2. **Exclude what CNRL already owns** from the candidate list.
3. **Build a "precedent fit" score:** how closely a candidate matches the past deals on size, mix and proximity.
4. **Calibrate the assumptions:** the pre-deal decline and the post-deal production retention of past deals become the defaults for new candidates.

### Historical baseline (measured from `volumetrics`, ActivityID = 'PROD', the 6 months before transfer)

| Prior BAID | Seller | CNRL first month | Facilities transferred | Producing facilities | Oil bbl/d | Gas MMcf/d | Cond bbl/d | boe/d | Median km to legacy CNRL | Share within 25 km |
|---|---|---|---|---|---|---|---|---|---|---|
| A7NW | Torxen Energy | 2025-07 | 653 | 526 | 22,393 | 209.0 | 105 | 57,330 | 8.0 | 100% |
| 0045 | Chevron Canada | 2024-12 | 64 | 54 | 241 | 239.6 | 173 | 40,339 | 4.8 | 100% |
| A8FG | Strathcona Resources | 2025-07 | 15 | 6 | 0 | 154.5 | 180 | 25,926 | 4.8 | 100% |
| A56R | Lycos Energy | 2025-11 | 3 | 3 | 1,140 | 0.6 | 0 | 1,240 | 0.0 | 100% |
| A2PH | Journey Energy | 2025-09 | 8 | 2 | 0 | 2.1 | 0 | 349 | 16.0 | 75% |
| A7NA | Prairie Thunder | 2024-07 | 7 | 6 | 73 | 0.8 | 0 | 211 | 4.8 | 100% |
| 0YK4 | Surge Energy | 2025-07 | 1 | 1 | 0 | 1.1 | 0 | 178 | 0.0 | 100% |
| A894 | Archer Exploration | 2025-07 | 1 | 1 | 0 | 1.1 | 0 | 178 | 0.0 | 100% |

What the baseline says:
* **Three material deals (26k to 57k boe/d).** Two are gas-weighted (Chevron, Strathcona) and one is oil-weighted (Torxen). The rest are small tuck-ins under 1,300 boe/d.
* **Proximity is decisive.** Every material deal sits a median 5 to 8 km from an existing CNRL facility, with essentially all facilities within 25 km. CNRL buys infill, not new basins.
* **Seller names linger.** 263 wells under `0HE9` are still named CHEVRON CANADA LIMITED in `wells`, so always key on BAID or facility_id, never on name.

Caveats:
* Distance is facility-to-facility using the `facilities` table's current lat/lon. The 100% within 25 km figure may partly reflect co-located or shared-LSD facilities, so verify it with a 10 km cut.
* This is facility-level transfer detection only. Corporate deals done before 2024-01, and partial working-interest deals that don't change the reporting operator, are invisible.
* Petrinex has no deal prices, so the $/flowing boe/d multiple remains an explicit assumption.

---

## 2. Data facts the prompt must state (verified 2026-10-28)

* **Catalog (decided):** `shm_hack.petrinex` in workspace `adb-7808899982160538` (CLI profile `hack`). The brief's `sbx_petrinex_app` holds the same data in another workspace; the deal history reproduces exactly. The catalog is a config setting (`ACQ_CATALOG`), so it can be switched.
* **CNRL** = BAID `0HE9`. No other BAID carries a CNRL-type name.
* `volumetrics` and `ngl_volumes` are all STRING, so use `try_cast`. Production is `ActivityID = 'PROD'` only.
* `operators.total_*` are inflated, and `facilities.region` and `wells.formation` are unreliable.
* `market_prices` covers 2025-01 to 2026-02 only.
* **Found while building the pipeline (2026-10-28):** `facilities.operator_baid` is stale, so the current operator comes from `volumetrics`; CNRL has 4,698 facilities by current operator. boe = oil + cond + raw gas/6, with NGLs reported separately (they sit inside raw gas). Surge (0YK4) is not a CNRL seller: its facility went Surge → Archer → CNRL. `ROYALTY` rows are oil-in-kind only, so royalty is the flat 15% fallback.
* **No pipelines, financials or tariffs.** Pipelines are proxied by CNRL gas plants and gathering systems plus the `DISP` flow edges. Everything else is an assumption, held in a table.

---

## 3. The prompt (copy and paste; edit anything in [brackets])

```text
ROLE & GOAL
We are CNRL executives. Identify and rank the next best acquisition in Alberta, using CNRL's own
2024-2025 deal history in Petrinex as the baseline. Primary criterion: value accretion at a 15%
discount rate (NPV@15% and ROCE). Secondary criterion: proximity to existing CNRL facilities.
Quantify transport-cost savings for the top 3 candidates. Deliver a Lakebase-backed Databricks App
with a map: lassoing CNRL assets returns the nearest competitor assets' oil, gas and NGL production.

DATA (single source of truth)
- Use only shm_hack.petrinex (8 tables). No external data.
- Write all derived tables to shm_hack.acq [confirm CREATE SCHEMA permission first].
- Follow ref/acquisition-app-plan.md and .claude/data/*.md for the traps: try_cast the STRING
  volumes; production = ActivityID='PROD' only; don't use operators.total_*, facilities.region or
  wells.formation; prices cover 2025 only.
- Units: oil/cond m3 -> bbl (x6.2898); gas e3m3 -> Mcf (x35.3147); BOE at 6:1.
- NGLs = C2-C5 + pentanes plus from ngl_volumes (well level) or the volumetrics NGL products,
  never both.

STEP 1 - CNRL FOOTPRINT (from history)
- CNRL = BAID 0HE9. Identify facilities whose reporting operator changed to 0HE9 during the window
  (prior operator's last month <= CNRL's first month). Expected sellers: Torxen A7NW (653 facilities,
  2025-07), Chevron 0045 (64, 2024-12), Strathcona A8FG (15, 2025-07), plus small tuck-ins
  (Journey, Prairie Thunder, Lycos, Surge, Archer).
- Table acq.cnrl_footprint: facility_id, is_legacy vs acquired, seller_baid, deal_month, lat/lon,
  facility type. Key on BAID/facility_id, never operator name.
- Validate: CNRL 2025 PROD reconciles with the EDA (~431k bbl/d oil, ~1.7 Bcf/d gas average over
  2024-25).

STEP 2 - PRECEDENT BASELINE (acq.deal_precedents)
For each historical seller, compute:
- pre-deal 6-month avg oil, gas, cond, NGL and boe/d, plus gas share of boe
- pre-deal decline (exponential fit on monthly boe for the full pre-deal history)
- post-deal retention = boe/d in the months after the deal / pre-deal boe/d, for the same facilities
- median and 90th-percentile km to the nearest legacy CNRL facility, and share within 10/25/50 km
- share of the seller's volume that, before the deal, was already DISPosed to a CNRL facility
Use the size-weighted means of the material deals (>= [5,000] boe/d) as the baseline profile.
Use precedent decline and retention as the default decline and integration haircut for candidates.

STEP 3 - CANDIDATE UNIVERSE
- Non-CNRL operators with 2025 PROD >= [1,000] boe/d, excluding sellers already absorbed and
  [Cenovus, Suncor, Imperial, ConocoPhillips, Tourmaline] (not realistic targets).
- Scorable unit: whole operator (corporate). Also report an "asset package" view = the candidate's
  facilities within [25] km of CNRL.

STEP 4 - VALUATION (assumptions in acq.assumptions, one row per key, editable in the app)
- Price deck: flat 2025 average from market_prices (WCS for heavy, WTI-[diff] for light,
  AECO CAD/GJ using volumetrics Energy, NGL at [50]% of WTI, FX from the table).
- Royalty: operator-specific from ROYALTY rows; fallback [15]%.
- Opex $/boe: gas-weighted [8], light oil [14], heavy/thermal [18]. Tax [23]%.
- Price paid = flowing boe/d x [$45,000]/boe/d (sensitivity 35k/45k/55k).
- NPV@15% over [10] years with precedent decline, minus the precedent integration haircut.
- ROCE = year-1 NOPAT (+ synergies) / price paid. Accretive if ROCE > 15% AND NPV@15% - price > 0.

STEP 5 - PROXIMITY, PRECEDENT FIT & TRANSPORT SAVINGS
- Tie-in points (pipeline proxy): gas -> CNRL gas plants + gathering systems;
  oil -> CNRL batteries + injection facilities. Use H3 res 7 + haversine.
- Proximity score = production-weighted share within 10/25/50 km + mean km.
- Precedent fit (0-1) = similarity to the baseline on size band, gas share, median km and
  share within 25 km.
- Transport savings per facility = max(0, today_km - cnrl_km) x volume x tariff, where today_km comes
  from the facility's actual DISP destinations (volume-weighted). Tariffs: liquids trucking
  [$0.12]/m3/km, gas [$X]/e3m3/km. Report $/yr, $/boe and PV@15% for the top 3.
- Final rank = [60]% accretion + [25]% proximity + [15]% precedent fit (weights in assumptions).
- Back-test: score the historical sellers as if pre-deal. Torxen, Chevron and Strathcona should rank
  in the top decile; report where each one lands.

STEP 6 - LAKEBASE + APP
- Load gold tables (facility_summary, operator_metrics, cnrl_footprint, deal_precedents,
  assumptions) into a dedicated Lakebase instance [cnrl-acq] (CU_1, owned by us; stop it when not
  demoing), database [acq], with a direct load script. Index on lat/lon (and PostGIS if available).
- Databricks App [cnrl-acquisition-explorer]: React + TypeScript + Vite frontend (MapLibre GL +
  deck.gl map, freehand lasso, TanStack Table, Recharts) served by a FastAPI backend that queries
  Lakebase and holds the scoring logic. Basemap tiles are visual only; all numbers come from shm_hack.
  * Map tab: legacy CNRL, acquired-by-CNRL (distinct colour, labelled with seller and deal month)
    and competitor facilities sized by boe/d; top-3 candidates outlined. Lasso on CNRL
    points -> table of competitor facilities within [25] km (toggle k-nearest): operator, facility,
    nearest CNRL asset, km, oil bbl/d, gas MMcf/d, NGL bbl/d, boe/d (2025 avg; toggle last 3
    months), plus an operator roll-up and CSV export.
  * Ranking tab: ROCE, NPV@15%, accretion, boe/d, decline, proximity, precedent fit, transport
    savings; sliders for the assumptions re-rank live.
  * Precedents tab: the historical deal table and back-test result.
  * Top-3 tab: side-by-side cards, transport-savings bar chart, sensitivity on multiple and oil price.
- Access: [hackathon team / exec group].

WORKING RULES
- Build in order: footprint -> precedents -> candidate metrics -> Lakebase sync -> app. At each step,
  show validation (row counts, reconciliation to EDA, top-5 sanity check) before moving on.
- Every number Petrinex can't provide is an assumption row, never a hard-coded constant.
- Ask before creating schemas, Lakebase databases or apps.
```

---

## 4. Executive decisions (agreed 2026-10-28)

| # | Decision | Agreed |
|---|---|---|
| 1 | Catalog for reads and writes | `shm_hack` (this workspace); configurable |
| 2 | $/flowing boe/d multiple and its sensitivity range | $45k (35k/55k) |
| 3 | Exclusion list of non-realistic targets | Cenovus, Suncor, Imperial, ConocoPhillips, Tourmaline. Sellers that still produce elsewhere (e.g. Strathcona) remain candidates. |
| 4 | Ranking weights (accretion / proximity / precedent fit) | 60 / 25 / 15 |
| 5 | Gas transport tariff $/e3m3/km and liquids trucking $/m3/km | gas: labelled placeholder, adjustable in the app; liquids $0.12 |
| 6 | Material-deal threshold for the baseline | 5,000 boe/d |
| 7 | Lasso radius and production window | 25 km, 2025 average |
| 8 | Lakebase instance/database names and app audience | new instance `cnrl-acq` (CU_1) / `acq` / hackathon team |

The deal-history query for section 1 lives in [../pipelines/](../pipelines/) (`01_cnrl_footprint.sql`).
