"""Genie space definition for the CNRL Acquisition Explorer.

Built from ref/Genie.md (instructions, joins, snippets, examples, benchmarks) and ref/sbx_prompts.txt (purpose),
repointed at the shm_hack catalog and extended with the acquisition tables, the data caveats verified while
building the pipeline, and the "Map context" convention the app uses to pass lassoed assets to Genie.
scripts/genie_space.py turns this into Genie's serialized format and creates/updates the space.
"""
import os

C = os.environ.get("ACQ_CATALOG", "shm_hack")
P = f"{C}.petrinex"
A = f"{C}.acq"

TITLE = "CNRL Acquisition Explorer - Petrinex Genie"
DESCRIPTION = (
    "Ask about Alberta Petrinex production (2024-01 to 2025-12) by operator, facility, well and field; flaring, "
    "venting and fuel; NGLs; benchmark prices; and CNRL acquisition analysis (candidate metrics, CNRL's 2024-25 "
    f"deals, proximity to CNRL assets). Data: {P} and {A}."
)

TABLES = [
    f"{P}.volumetrics", f"{P}.ngl_volumes", f"{P}.facilities", f"{P}.wells", f"{P}.operators",
    f"{P}.field_codes", f"{P}.facility_emissions", f"{P}.market_prices",
    f"{A}.facility_summary", f"{A}.operator_metrics", f"{A}.deal_precedents", f"{A}.cnrl_footprint",
]

# Columns whose values users type by name (operator, facility, field names): let Genie match entities.
ENTITY_COLUMNS = {
    f"{P}.volumetrics": ["OperatorName", "ReportingFacilityName"],
    f"{P}.wells": ["operator_name", "field_display_name"],
    f"{A}.facility_summary": ["operator_name", "facility_name"],
    f"{A}.operator_metrics": ["operator_name"],
}

TEXT_INSTRUCTIONS = f"""
## Purpose
This agent supports CNRL executives looking for their next acquisition. It answers questions about Alberta upstream
oil and gas activity reported to Petrinex: production by operator, facility, well, field and formation; flaring,
venting and fuel use; NGL yields; production value using benchmark prices; and which competitors sit near CNRL's
assets. Production months run 2024-01 through 2025-12. Market prices cover 2025-01 through 2026-02 only.

## Map context from the app
Messages may start with a block headed "Map context" listing what the user selected on the app's map: CNRL facility
IDs, nearby competitor operators (BA IDs), a focused facility and well IDs. Treat these as filters whenever the question
says "these", "selected", "this facility", "nearby", "the lassoed assets" or similar:
- Facility IDs match volumetrics.ReportingFacilityID, facilities.facility_id and acq.facility_summary.facility_id.
- Well IDs match ngl_volumes.WellID and wells.well_id.
- Operator BA IDs match volumetrics.OperatorBAID and operator_baid columns elsewhere.
If the question doesn't refer to the selection, answer it normally and ignore the context.

## Which table to use
- Facility-level production, disposition and other volume flows: {P}.volumetrics. Source of truth for production by
  operator, facility and facility type.
- Well-level monthly production and NGL components (ethane, propane, butane, pentane, lite mix, residue gas):
  {P}.ngl_volumes. Lifetime well totals and attributes (field, pool, formation): {P}.wells.
- Flaring, venting and fuel gas by facility and month: {P}.facility_emissions, or the Flared/Vented gas measures.
- Facility attributes (type, subtype, DLS location, coordinates): {P}.facilities.
- Benchmark prices (WTI, WCS, WCS discount, AECO, USD/CAD): {P}.market_prices.
- Acquisition analysis (prefer these for CNRL and candidate questions; they are typed and pre-computed):
  - {A}.facility_summary: one row per facility with its CURRENT operator, is_cnrl, 2025 average rates
    (oil_bbl_d, gas_mmcf_d, cond_bbl_d, ngl_bbl_d, boe_d), Oct-Dec 2025 rates (*_last3), lat/lon, nearest CNRL facility
    and distance (km), distances to CNRL gas/liquids tie-ins, today's haul distance and transport-savings basis.
  - {A}.operator_metrics: one row per non-CNRL producing operator: 2025 rates, gas share, share of production within
    10/25/50 km of CNRL, median km to CNRL, fitted annual decline.
  - {A}.deal_precedents: CNRL's 2024-25 acquisitions (facilities whose operator changed to CNRL), pre-deal size,
    mix, decline, post-deal retention and distance to CNRL.
  - {A}.cnrl_footprint: every CNRL facility today, legacy vs acquired, with seller and deal month.

## CNRL
- CNRL is operator BA ID '0HE9' (CANADIAN NATURAL RESOURCES LIMITED). Always filter on the BA ID, never the name.
- facilities.operator_baid is out of date for transferred facilities (Torxen's facilities still show Torxen).
  For who operates a facility today use acq.facility_summary.operator_baid or the latest month in volumetrics.
- In 2024-25 CNRL bought facilities from Torxen (2025-07), Chevron (2024-12) and Strathcona (2025-07), plus small
  tuck-ins. See acq.deal_precedents.

## Production rules
- "Production" means the PROD activity only. Apply the "Production activity only" filter. Other activity codes
  (disposition, receipts, inventory, royalty, fuel, injection, load fluid) describe movements of product and must not
  be added to production.
- Do not use the total volume columns in operators for production; they add up every activity and overstate production
  several times over. Use operators only for names, facility counts and first/last month.
- wells totals are lifetime sums (2024-01 to 2025-12) of that well's monthly ngl_volumes rows.
- In facility_emissions, total_emissions_volume = flare + vent + fuel. Its production_volume column mixes gas and liquid
  units, so never use it as production.
- Volume, energy, hours and proration values in volumetrics and ngl_volumes are text. Always TRY_CAST them to DOUBLE.
- Production months are text 'YYYY-MM'. Compare them as strings for ranges.
- boe uses 6:1: boe = oil + condensate (bbl) + gas (Mcf) / 6. NGLs are already inside raw gas, so report them alongside
  but do not add them to boe.

## Units and conversions
- Oil, condensate, water and NGL volumes are m3; gas (including flare, vent, fuel, residue) is e3m3; energy is GJ.
- Report native units by default. For barrels use x 6.28981; for Mcf use x 35.3147 (MMcf = Mcf / 1000). For daily
  rates divide by the days in the month or period (2025 has 365 days).
- Oil prices are per barrel (USD or CAD columns). AECO is CAD per GJ. The WCS discount is WCS below WTI in USD.

## Value estimates
- Total volumes by month first, then attach that month's price. Convert oil to barrels before applying a per-barrel
  price. Use WCS for heavy/oil sands oil and WTI for light oil. Gas value at AECO needs energy in GJ.
- Label value figures as estimates at benchmark prices, not realized revenue. If a month has no price, say so.

## Known data caveats (mention them when relevant)
- facilities.region is a coarse latitude/longitude band, not a real region: everything north of 55N is "Peace Country",
  including the Fort McMurray oil sands. Say so whenever region appears in an answer.
- wells.formation is derived from pool codes and is unreliable (pool 0950160 labels 44,800 wells across many fields as
  "Montney"). "Other" and "Miscellaneous" are catch-all groupings. Flag this when ranking by formation.
- In wells, field_name holds a numeric field code; use field_display_name for readable names.
- wells covers only the 118,600 wells in ngl_volumes, about 68% of the wells that appear in volumetrics.

## Names and identifiers
- Group by BA ID when accuracy matters and show the name for readability.
- Facility IDs combine province, facility type and number (ABBT = battery, ABGS = gathering system, ABGP = gas plant,
  ABIF = injection facility). Well IDs are Petrinex UWIs (ABWI...).

## Answer style
- State the production month range and units in every answer. When ranking, show the native unit and, if rates are
  asked for, a daily rate. If the latest month looks low, mention that recent Petrinex months may still be revised.
- Keep answers short and executive-friendly: lead with the answer, then the supporting table.

## Joins
- volumetrics.ReportingFacilityID = facilities.facility_id (many-to-one)
- facility_emissions.facility_id = facilities.facility_id (many-to-one)
- volumetrics.ProductionMonth = market_prices.price_month (many-to-one; prices only from 2025-01, use LEFT JOIN)
- ngl_volumes.WellID = wells.well_id (many-to-one)
- wells.field_name = field_codes.field_code (only when field_display_name is missing)
- wells.facility_id = acq.facility_summary.facility_id (wells at a facility)
- acq.facility_summary.operator_baid = acq.operator_metrics.operator_baid
- acq.cnrl_footprint.facility_id = acq.facility_summary.facility_id
"""

FILTERS = [
    {"display_name": "Production activity only", "sql": f"{P}.volumetrics.ActivityID = 'PROD'",
     "instruction": "Default for any production question on volumetrics."},
    {"display_name": "Calendar 2025", "sql": f"{P}.volumetrics.ProductionMonth BETWEEN '2025-01' AND '2025-12'",
     "instruction": "Use for 'in 2025', 'last year' or 'latest full year'."},
    {"display_name": "CNRL only", "sql": f"{P}.volumetrics.OperatorBAID = '0HE9'",
     "instruction": "Use when the question is about CNRL / Canadian Natural's own volumes."},
]


def _vol(activity, product):
    return (f"SUM(CASE WHEN {P}.volumetrics.ActivityID = '{activity}' AND {P}.volumetrics.ProductID = '{product}' "
            f"THEN TRY_CAST({P}.volumetrics.Volume AS DOUBLE) END)")


MEASURES = [
    {"alias": "oil_production_m3", "display_name": "Oil production (m3)", "sql": _vol("PROD", "OIL"),
     "instruction": "Oil production in m3. Multiply by 6.28981 for barrels."},
    {"alias": "gas_production_e3m3", "display_name": "Gas production (e3m3)", "sql": _vol("PROD", "GAS"),
     "instruction": "Raw gas production in e3m3. Multiply by 35.3147 for Mcf."},
    {"alias": "condensate_production_m3", "display_name": "Condensate production (m3)", "sql": _vol("PROD", "COND"),
     "instruction": "Condensate production in m3."},
    {"alias": "water_production_m3", "display_name": "Water production (m3)", "sql": _vol("PROD", "WATER"),
     "instruction": "Produced water in m3."},
    {"alias": "flared_gas_e3m3", "display_name": "Flared gas (e3m3)", "sql": _vol("FLARE", "GAS"),
     "instruction": "Gas flared, e3m3."},
    {"alias": "vented_gas_e3m3", "display_name": "Vented gas (e3m3)", "sql": _vol("VENT", "GAS"),
     "instruction": "Gas vented, e3m3."},
]

HAVERSINE_KM = ("2 * 6371 * ASIN(SQRT(POW(SIN(RADIANS(c.lat - s.lat) / 2), 2) + COS(RADIANS(s.lat)) * "
                "COS(RADIANS(c.lat)) * POW(SIN(RADIANS(c.lon - s.lon) / 2), 2)))")

EXAMPLES = [
    ("What was monthly Alberta oil production in barrels per day in 2025, and its estimated value at WCS in CAD?", f"""
WITH monthly AS (
  SELECT v.ProductionMonth, SUM(CASE WHEN v.ProductID = 'OIL' THEN TRY_CAST(v.Volume AS DOUBLE) END) AS oil_m3
  FROM {P}.volumetrics v
  WHERE v.ActivityID = 'PROD' AND v.ProductionMonth BETWEEN '2025-01' AND '2025-12'
  GROUP BY v.ProductionMonth
)
SELECT m.ProductionMonth,
       ROUND(m.oil_m3, 1) AS oil_m3,
       ROUND(m.oil_m3 * 6.28981 / DAY(LAST_DAY(TO_DATE(m.ProductionMonth, 'yyyy-MM'))), 0) AS oil_bbl_per_day,
       p.wcs_cad_bbl,
       ROUND(m.oil_m3 * 6.28981 * p.wcs_cad_bbl / 1e6, 1) AS est_oil_value_mm_cad
FROM monthly m
LEFT JOIN {P}.market_prices p ON p.price_month = m.ProductionMonth
ORDER BY m.ProductionMonth"""),
    ("Which 10 operators produced the most oil in 2025?", f"""
SELECT v.OperatorBAID, MAX(v.OperatorName) AS operator_name,
       ROUND(SUM(TRY_CAST(v.Volume AS DOUBLE)), 1) AS oil_m3,
       ROUND(SUM(TRY_CAST(v.Volume AS DOUBLE)) * 6.28981 / 365, 0) AS avg_oil_bbl_per_day
FROM {P}.volumetrics v
WHERE v.ActivityID = 'PROD' AND v.ProductID = 'OIL' AND v.ProductionMonth BETWEEN '2025-01' AND '2025-12'
GROUP BY v.OperatorBAID
ORDER BY oil_m3 DESC
LIMIT 10"""),
    ("Which operators have the most production within 25 km of CNRL facilities?", f"""
SELECT operator_baid, operator_name,
       ROUND(boe_d) AS boe_per_day_2025,
       ROUND(boe_d * share_within_25km) AS boe_per_day_within_25km,
       ROUND(share_within_25km * 100, 1) AS pct_within_25km,
       ROUND(median_km_to_cnrl, 1) AS median_km_to_cnrl
FROM {A}.operator_metrics
WHERE boe_d >= 1000
ORDER BY boe_per_day_within_25km DESC
LIMIT 15"""),
    ("What did CNRL acquire in 2024 and 2025, and how big were those deals?", f"""
SELECT seller_name, deal_month, facilities_transferred,
       ROUND(pre_oil_bbl_d) AS oil_bbl_d, ROUND(pre_gas_mmcf_d, 1) AS gas_mmcf_d, ROUND(pre_boe_d) AS boe_d,
       ROUND(gas_share * 100) AS gas_pct, ROUND(median_km_to_legacy, 1) AS median_km_to_existing_cnrl
FROM {A}.deal_precedents
ORDER BY pre_boe_d DESC"""),
    ("Map context: CNRL facilities ABGP0001184, ABGP0001379. Which competitors produce within 25 km of these assets?", f"""
WITH sel AS (
  SELECT facility_id, lat, lon FROM {A}.facility_summary WHERE facility_id IN ('ABGP0001184', 'ABGP0001379')
)
SELECT c.operator_baid, c.operator_name, COUNT(*) AS facilities,
       ROUND(SUM(c.oil_bbl_d)) AS oil_bbl_d, ROUND(SUM(c.gas_mmcf_d), 1) AS gas_mmcf_d,
       ROUND(SUM(c.ngl_bbl_d)) AS ngl_bbl_d, ROUND(SUM(c.boe_d)) AS boe_d
FROM {A}.facility_summary c
WHERE NOT c.is_cnrl AND c.boe_d > 0
  AND EXISTS (SELECT 1 FROM sel s WHERE {HAVERSINE_KM} <= 25)
GROUP BY c.operator_baid, c.operator_name
ORDER BY boe_d DESC"""),
    ("Map context: focused facility ABBT0056526. Which wells feed this facility and what have they produced?", f"""
SELECT well_id, field_display_name, active_months,
       ROUND(total_gas_e3m3, 1) AS gas_e3m3, ROUND(total_oil_m3, 1) AS oil_m3,
       ROUND(total_condensate_m3, 1) AS condensate_m3, ROUND(total_water_m3, 1) AS water_m3,
       first_production_month, last_production_month
FROM {P}.wells
WHERE facility_id = 'ABBT0056526'
ORDER BY gas_e3m3 DESC"""),
    ("Show monthly gas and NGL production for the wells at facility ABBT0056526 in 2025.", f"""
SELECT n.ProductionMonth,
       ROUND(SUM(TRY_CAST(n.GasProduction AS DOUBLE)), 1) AS gas_e3m3,
       ROUND(SUM(COALESCE(TRY_CAST(n.PropaneMixVolume AS DOUBLE), 0) + COALESCE(TRY_CAST(n.PropaneSpecVolume AS DOUBLE), 0)
               + COALESCE(TRY_CAST(n.ButaneMixVolume AS DOUBLE), 0) + COALESCE(TRY_CAST(n.ButaneSpecVolume AS DOUBLE), 0)
               + COALESCE(TRY_CAST(n.PentaneMixVolume AS DOUBLE), 0) + COALESCE(TRY_CAST(n.PentaneSpecVolume AS DOUBLE), 0)), 1)
         AS c3_plus_ngl_m3
FROM {P}.ngl_volumes n
JOIN {P}.wells w ON n.WellID = w.well_id
WHERE w.facility_id = 'ABBT0056526' AND n.ProductionMonth BETWEEN '2025-01' AND '2025-12'
GROUP BY n.ProductionMonth
ORDER BY n.ProductionMonth"""),
]

BENCHMARKS = [
    ("Which 5 formations have produced the most oil?", f"""
SELECT formation, ROUND(SUM(total_oil_m3), 1) AS oil_m3, COUNT(*) AS wells
FROM {P}.wells
GROUP BY formation
ORDER BY oil_m3 DESC
LIMIT 5"""),
    ("How much gas was flared and vented in each region in 2025?", f"""
SELECT f.region, ROUND(SUM(e.flare_volume), 1) AS flare_e3m3, ROUND(SUM(e.vent_volume), 1) AS vent_e3m3
FROM {P}.facility_emissions e
JOIN {P}.facilities f ON f.facility_id = e.facility_id
WHERE e.production_month BETWEEN '2025-01' AND '2025-12'
GROUP BY f.region
ORDER BY flare_e3m3 DESC"""),
    ("Who were the top 5 gas producers in 2025?", f"""
SELECT v.OperatorBAID, MAX(v.OperatorName) AS operator_name, ROUND(SUM(TRY_CAST(v.Volume AS DOUBLE)), 1) AS gas_e3m3
FROM {P}.volumetrics v
WHERE v.ActivityID = 'PROD' AND v.ProductID = 'GAS' AND v.ProductionMonth BETWEEN '2025-01' AND '2025-12'
GROUP BY v.OperatorBAID
ORDER BY gas_e3m3 DESC
LIMIT 5"""),
    ("What was CNRL's average oil production in barrels per day in 2025?", f"""
SELECT ROUND(SUM(TRY_CAST(v.Volume AS DOUBLE)) * 6.28981 / 365, 0) AS cnrl_oil_bbl_per_day_2025
FROM {P}.volumetrics v
WHERE v.ActivityID = 'PROD' AND v.ProductID = 'OIL' AND v.OperatorBAID = '0HE9'
  AND v.ProductionMonth BETWEEN '2025-01' AND '2025-12'"""),
]

SAMPLE_QUESTIONS = [
    "Which operators have the most production within 25 km of CNRL facilities?",
    "What did CNRL acquire in 2024 and 2025, and how big were those deals?",
    "Which 10 operators produced the most oil in 2025, in barrels per day?",
    "What was monthly Alberta gas production in 2025 in MMcf/d?",
    "Which operators flared the most gas in 2025?",
]
