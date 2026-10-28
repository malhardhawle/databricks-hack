# CNRL acquisition app: plan

**Brief:** acting as CNRL executives, find the next best acquisition. Rank candidates by ROCE / accretion at a 15% discount rate, with proximity to existing CNRL assets as the secondary criterion. Compare transport-cost savings for the top 3. Ship a Lakebase-backed map app where you lasso CNRL assets and get a table of the nearest competitor assets' oil, gas and NGL production.

Data: `shm_hack.petrinex` (the brief says `sbx_petrinex_app`, which doesn't exist in this workspace; same 8 tables). **All data comes from the `shm_hack` catalog. No external sources.** Anything Petrinex lacks is an explicit, editable assumption, stored in `shm_hack.acq.assumptions`. See [eda-report.html](eda-report.html) and [../.claude/data/](../.claude/data/) for the traps.

---

## 1. Deliverables

| # | Deliverable | Demo moment |
|---|---|---|
| D1 | **Map + lasso** (Lakebase-served): CNRL assets vs competitor assets; lasso CNRL assets → nearest-competitor table (oil / gas / NGL) | "Select our Montney plants → here's who's next door and what they produce" |
| D2 | **Acquisition ranking**: every non-CNRL operator scored on ROCE and NPV@15% accretion, plus a proximity score | "Ranked list, top 3 called out" |
| D3 | **Top-3 transport savings**: $/yr saved by tying candidate volumes into nearby CNRL facilities | "Candidate B is #2 on ROCE but #1 once synergies are in" |
| D4 | **Assumptions panel**: price deck, opex, royalty, acquisition multiple, discount rate (default 15%), trucking rate | Live re-ranking when a slider moves |

## 2. What the data can and can't support

**Can (directly from Petrinex)**
- CNRL footprint: BAID **`0HE9`**, with **3,963 facilities** (3,383 batteries, 291 gathering systems, 221 injection, 68 gas plants) and **20,904 wells** in `wells`.
- Production by operator / facility / month from `volumetrics` with `ActivityID='PROD'`: oil, gas, condensate, water.
- NGLs: well-level C2–C5 in `ngl_volumes`, plus facility-level NGL products (`C2-MX`, `C3-MX`, …) in `volumetrics`.
- Locations: all 25,316 facilities have lat/lon. Wells inherit their facility's location; `well_id` also encodes the DLS location (e.g. `ABWI100011008810W600` = 01-10-088-10W6) if we need well-level points.
- **Current product flows**: `DISP` rows give `FromToID`, which says where each facility ships its product. That lets us compute *today's* haul distance, which is the baseline for transport savings.
- Royalty volumes (`ROYALTY` rows), so we can estimate an effective royalty rate per operator.
- Fuel/flare/vent volumes, which give an operating intensity and an ESG lens on candidates.
- 2025 prices (WTI, WCS, AECO, FX).

**Can't, so it needs explicit, adjustable assumptions**
- **Capital employed / acquisition price**: Petrinex has no financials. Proxy: price = $/flowing boe/d multiple (or the seller's PV10).
- **Opex, G&A, tax**: assumed $/boe by product mix.
- **Pipelines**: none in the dataset. Proxy: CNRL gas plants, gathering systems and batteries are the tie-in points, and the `DISP` flow edges show the existing transport network.
- **Transport tariffs**: assumed trucking $/m³/km and pipeline $/boe.
- **Forward prices**: `market_prices` overlaps 2025 only, so use a flat 2025-average deck (editable).

**Traps that affect this app** (from EDA)
- Don't use `operators.total_*`, because they're inflated 2.6–9.5×. Recompute from PROD.
- Don't use `facilities.region` (lat bands) or `wells.formation` (bad pool mapping).
- `volumetrics` / `ngl_volumes` are all STRING, so use `try_cast`.

## 3. Method

### 3.1 Candidate universe
Non-CNRL operators with 2025 PROD ≥ **1,000 boe/d** (6:1). Midstream companies drop out naturally because they have no PROD. The scorable unit is the **operator** (corporate deal). Optionally add **asset packages**: a candidate's facilities within X km of CNRL (see decision Q2).

### 3.2 Production profile
- 2025 average and latest-quarter run rate per operator: oil, cond, gas, NGL → boe/d.
- Decline: fit an exponential to each operator's 24-month boe series (stretch goal: Arps per well from `ngl_volumes`). Cap decline between 5% and 35%/yr for sanity.

### 3.3 Cash flow (per boe, per year)
```
revenue  = oil·P_oil + cond·P_cond + gas_GJ·AECO + NGL·(%WTI)    (P_oil: WCS for heavy/bitumen, WTI−diff for light)
royalty  = revenue × royalty_rate          (operator-specific from ROYALTY rows, fallback 15%)
opex     = boe × opex_$/boe                 (gas-weighted ≈ $8, light oil ≈ $14, heavy/thermal ≈ $18; editable)
transport= boe × transport_$/boe            (baseline; synergies reduce this, §3.5)
OCF      = revenue − royalty − opex − transport
NOPAT    = OCF × (1 − tax 23%)
```

### 3.4 Accretion & ROCE
- **Acquisition price (capital employed)** = flowing boe/d × $/boe/d multiple (default **$45,000**, editable) *or* NPV@10% (seller's PV10). Decision Q1.
- **NPV@15%** = Σ NOPAT_t (declined, 10-yr) / 1.15^t.
- **Accretion ($)** = NPV@15% + PV(synergies) − price. Positive means value-accretive at CNRL's hurdle.
- **ROCE** = year-1 NOPAT (+ synergies) / price. A candidate is accretive if ROCE > 15%.
- **Rank**: primary on accretion (or ROCE, Q1); secondary on proximity score.

### 3.5 Proximity & transport savings
- For each competitor facility: distance to the nearest CNRL facility of a *compatible* type (gas → nearest CNRL gas plant / gathering system; oil → nearest CNRL battery / injection facility). Use Databricks H3 (`h3_longlatash3`, `h3_kring`) to prune pairs, then haversine.
- **Proximity score** per operator = production-weighted share within 10 / 25 / 50 km, plus production-weighted mean distance.
- **Transport savings** per facility:
  `today_km` = distance to its actual `DISP` destination(s), volume-weighted.
  `cnrl_km` = distance to the nearest compatible CNRL facility.
  `savings = max(0, today_km − cnrl_km) × volume × $/m³/km` (trucking default 0.12 $/m³/km for liquids; pipeline $/e³m³/km for gas, editable).
  Roll up per operator, then present the top 3 as $/yr, $/boe and PV@15%.

## 4. Data pipeline (Databricks → Lakebase)

New schema **`shm_hack.acq`** (we need CREATE SCHEMA permission on `shm_hack`; verify first).

| Layer | Table | Contents |
|---|---|---|
| silver | `prod_monthly` | facility × month × product (oil, gas, cond, ngl, water), PROD only, typed |
| silver | `facility_geo` | facilities + H3 res 7 cell + is_cnrl flag + primary product |
| silver | `flows_disp` | facility → destination edges from DISP with volume + km |
| gold | `facility_summary` | per facility: 2025 avg oil bbl/d, gas MMcf/d, NGL bbl/d, boe/d, nearest CNRL facility + km |
| gold | `operator_metrics` | per operator: production, decline, royalty rate, mix, proximity score, transport savings |
| gold | `assumptions` | default price deck / cost parameters (one row per key) |

Scoring math (§3.3–3.4) runs **in the app** on `operator_metrics` (about 300 rows), so sliders re-rank instantly. Gold tables are the only heavy SQL.

**Lakebase**: instance `lakebase-postgres` (AVAILABLE). Create a new database `acq` so we don't touch preet's `petrinex` DB. Load gold tables via **synced tables** (UC → Lakebase, snapshot) or a COPY loader as in preet's app. Indexes: `(lat, lon)` btree + `h3` for neighbor lookup; PostGIS GIST if the extension is available (check `pg_available_extensions`).

## 5. App (Databricks App)

**Stack: Dash + Plotly**, matching preet's `petrinex-databricks-app` (same psycopg pool + OAuth-token `db.py` pattern, `app.yaml` with a Lakebase `database` resource). `plotly` `scatter_map` gives WebGL points for 25k facilities and **built-in lasso/box select** (`selectedData`), with no extra map library or token.

**Layout**
1. **Map tab**: CNRL assets (one hue) vs competitors (second hue, sized by boe/d), top-3 candidates outlined. Filters row: facility type, product, radius (km), operator search.
   - Lasso CNRL points → server receives facility ids → Lakebase query: competitor facilities within R km (or k nearest) of any selected CNRL asset.
   - **Result table**: competitor facility, operator, nearest CNRL asset, km, oil bbl/d, gas MMcf/d, NGL bbl/d, boe/d. Plus an operator rollup and CSV export.
2. **Ranking tab**: candidates table (ROCE, NPV@15%, accretion, boe/d, decline, proximity score, transport savings), sortable, top 3 highlighted. Assumptions panel on the side.
3. **Top-3 tab**: side-by-side cards plus a transport-savings bar chart, with a sensitivity on $/boe/d multiple and oil price.

**Lasso query sketch** (no PostGIS):
```sql
WITH sel AS (SELECT lat, lon FROM facility_summary WHERE facility_id = ANY(%(ids)s))
SELECT c.*, min(6371*2*asin(sqrt(sin(radians(c.lat-s.lat)/2)^2 +
       cos(radians(s.lat))*cos(radians(c.lat))*sin(radians(c.lon-s.lon)/2)^2))) AS km
FROM facility_summary c CROSS JOIN sel s
WHERE NOT c.is_cnrl
  AND c.lat BETWEEN s.lat - %(r)s/111.0 AND s.lat + %(r)s/111.0
  AND c.lon BETWEEN s.lon - %(r)s/(111.0*cos(radians(s.lat))) AND s.lon + %(r)s/(111.0*cos(radians(s.lat)))
GROUP BY c.facility_id  -- (all c.* cols)
HAVING min(...) <= %(r)s ORDER BY km;
```

## 6. Build order

| Step | What | Done when |
|---|---|---|
| 0 | Verify: CREATE SCHEMA on `shm_hack`, create DB on `lakebase-postgres`, PostGIS availability, app create permission | all four confirmed |
| 1 | Silver + gold tables (SQL in `pipelines/`), spot-check CNRL totals against EDA | `facility_summary`, `operator_metrics` populated |
| 2 | Sync gold → Lakebase `acq` | `SELECT count(*)` works from local psycopg |
| 3 | **App v1: map + lasso + table** (D1, the core requirement) | deployed, lasso returns rows |
| 4 | Scoring + ranking tab + assumptions (D2, D4) | top 3 stable under default deck |
| 5 | Transport savings + top-3 tab (D3) | $/yr per candidate shown |
| 6 | Polish, narrative, demo script | |

Steps 1→3 are the critical path. Scoring (step 4) can run in parallel once `operator_metrics` exists.

## 7. Open decisions (what the "perfect prompt" would pin down)

| # | Question | Default if unanswered |
|---|---|---|
| Q1 | Acquisition price basis: $/flowing boe/d multiple or seller PV10? Rank primarily on ROCE or on NPV accretion? | $45k/boe/d; rank on NPV@15% accretion, show ROCE alongside |
| Q2 | Candidate = whole operator (corporate) or asset package near CNRL? | Operator, with an "assets within 25 km" view |
| Q3 | Minimum size / exclusions (majors like Cenovus, Suncor, Imperial are not realistic targets) | ≥1,000 boe/d, exclude top-5 producers |
| Q4 | Pipeline proxy: which CNRL facility types count as tie-in points for oil vs gas? | Gas → gas plants + gathering systems; oil → batteries + injection |
| Q5 | Cost assumptions: opex $/boe by mix, trucking $/m³/km, tax rate, forward price deck | As in §3.3–3.5, editable in the app |
| Q6 | Lasso result: radius (km) or k-nearest? Production window (2025 avg vs last 3 months)? | 25 km radius, 2025 average |
| Q7 | Catalog: confirm `shm_hack.petrinex` (the brief says `sbx_petrinex_app`) | `shm_hack.petrinex` |
| Q8 | App name and who needs access | `cnrl-acquisition-explorer`, hackathon team |
