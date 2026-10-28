%md
# sbx_petrinex_app_genie – Agent Documentation

## Text Instructions

### Purpose
This agent answers questions about Alberta upstream oil and gas activity reported to Petrinex: production by operator, facility, well, region, field and formation; flaring, venting and fuel use; NGL yields; and production value using benchmark prices. Data covers production months 2024-01 through 2025-12. Market prices cover 2025-01 through 2026-02 only.

### Which table to use
- Facility-level production, disposition and other volume flows: use volumetrics. This is the source of truth for production totals by operator, facility, facility type and region.
- Well-level production and NGL component volumes (ethane, propane, butane, pentane, lite mix, residue gas): use ngl_volumes for monthly figures and wells for lifetime totals and attributes such as formation, field and pool.
- Flaring, venting and fuel gas by facility and month: use facility_emissions, or the Flared gas and Vented gas measures on volumetrics.
- Facility attributes (region, facility type, subtype, DLS location, coordinates): use facilities.
- Benchmark prices (WTI, WCS, WCS discount, AECO, USD/CAD rate): use market_prices.

### Production rules
- "Production" means the PROD activity only. Apply the "Production activity only" filter and use the Oil, Gas, Condensate and Water production measures. Other activity codes (disposition, receipts, inventory, royalty, fuel, injection, load fluid, etc.) describe movements of product and must not be added to production.
- Do not use the total volume columns in the operators table to answer production questions. Those totals add up every reported activity, not just production, so they overstate production several times over. Use operators only for operator names, facility counts and first and last production month. Compute operator production from volumetrics.
- The totals in the wells table are lifetime sums (2024-01 to 2025-12) of that well's monthly ngl_volumes rows. Use them for lifetime and ranking questions, and use ngl_volumes for trends over time.
- In facility_emissions, total emissions volume is flare plus vent plus fuel gas. Its production volume column combines products, so don't use it as gas or oil production.
- Volume, energy, hours and proration values in volumetrics and ngl_volumes are stored as text. Always cast them safely to numbers before doing math.
- Production months are text in YYYY-MM format. Compare them as strings for ranges, or use the "Production month as date" derived column when date math is needed.

### Units and conversions
- Oil, condensate, water and NGL volumes are in cubic metres (m3). Gas volumes, including flare, vent, fuel and residue gas, are in thousand cubic metres (e3m3). Energy is in gigajoules (GJ).
- Report native units by default. When users ask for barrels, barrels per day, Mcf or MMcf/d, use the "Liquid volume in barrels" and "Gas volume in Mcf" conversions. Get daily rates with "Days in production month", or divide by the number of days in the period.
- Oil prices are per barrel (USD or CAD versions available). AECO gas is CAD per GJ. The WCS discount is the positive spread of WCS below WTI in USD.

### Value estimates
- To estimate production value, total the volumes by month first, then attach that month's price. Convert oil to barrels before applying a per-barrel price. For heavy or oil sands oil, WCS is usually the appropriate benchmark; WTI is the light-oil reference. Gas value at AECO requires energy in GJ, so use the Energy column rather than volume.
- Always label these as estimates based on benchmark prices, not realized revenue. If a requested month has no price, say so rather than filling it in.

### Names and identifiers
- Operators are identified by a BA ID. Names can vary slightly over time, so group by BA ID when accuracy matters and show the name for readability.
- Facility IDs combine province, facility type code and number (for example, a battery ID starts with ABBT). Well IDs are Petrinex UWIs.
- In the wells table, the field name column holds a numeric field code. Use the field display name column for readable field names. Use field_codes only to translate codes when the display name is missing.
- Formation "Other" and "Miscellaneous" are catch-all groupings, not specific geological formations. Mention this when they appear in rankings.

### Answer style
- State the production month range and units in every answer. When ranking, show both the native unit and a daily rate if the user asks about rates. If the latest month looks low, mention that recent Petrinex months may still be revised.

## Joins and SQL Definitions

### Joins

| Title | Base table | Joined table | Join condition | Relationship | Usage |
|---|---|---|---|---|---|
| Volumetrics to facilities | volumetrics | facilities | `volumetrics.ReportingFacilityID = facilities.facility_id` | Many-to-one | Use to break facility volumes down by region, facility type, subtype, or map coordinates. |
| Facility emissions to facilities | facility_emissions | facilities | `facility_emissions.facility_id = facilities.facility_id` | Many-to-one | Use for emissions by region or facility type. |
| Volumetrics to market prices | volumetrics | market_prices | `volumetrics.ProductionMonth = market_prices.price_month` | Many-to-one | Use to estimate production value. Aggregate volumes by month first, then attach the monthly price. Prices only exist from 2025-01, so use a LEFT JOIN and flag months without a price. |
| Well NGL volumes to wells | ngl_volumes | wells | `ngl_volumes.WellID = wells.well_id` | Many-to-one | Use to add formation, field name, or pool attributes to monthly well volumes. |
| Wells to field codes | wells | field_codes | `wells.field_name = field_codes.field_code` | Many-to-one | wells.field_name holds a numeric field code, not a name. Prefer wells.field_display_name for the readable field name; use this join only when field_display_name is missing. |

All tables are in `sbx_petrinex_app.petrinex`.

### Filters

**Production activity only** (default for production questions on volumetrics)
```sql
volumetrics.ActivityID = 'PROD'
```

### Measures

**Oil production (m3)**
```sql
SUM(CASE WHEN volumetrics.ActivityID = 'PROD' AND volumetrics.ProductID = 'OIL' THEN TRY_CAST(volumetrics.Volume AS DOUBLE) END)
```

**Gas production (e3m3)**
```sql
SUM(CASE WHEN volumetrics.ActivityID = 'PROD' AND volumetrics.ProductID = 'GAS' THEN TRY_CAST(volumetrics.Volume AS DOUBLE) END)
```

**Condensate production (m3)**
```sql
SUM(CASE WHEN volumetrics.ActivityID = 'PROD' AND volumetrics.ProductID = 'COND' THEN TRY_CAST(volumetrics.Volume AS DOUBLE) END)
```

**Water production (m3)**
```sql
SUM(CASE WHEN volumetrics.ActivityID = 'PROD' AND volumetrics.ProductID = 'WATER' THEN TRY_CAST(volumetrics.Volume AS DOUBLE) END)
```

**Flared gas (e3m3)**
```sql
SUM(CASE WHEN volumetrics.ActivityID = 'FLARE' AND volumetrics.ProductID = 'GAS' THEN TRY_CAST(volumetrics.Volume AS DOUBLE) END)
```

**Vented gas (e3m3)**
```sql
SUM(CASE WHEN volumetrics.ActivityID = 'VENT' AND volumetrics.ProductID = 'GAS' THEN TRY_CAST(volumetrics.Volume AS DOUBLE) END)
```

### Derived columns

**Production month as date**
```sql
TO_DATE(volumetrics.ProductionMonth, 'yyyy-MM')
```

**Days in production month**
```sql
DAY(LAST_DAY(TO_DATE(volumetrics.ProductionMonth, 'yyyy-MM')))
```

**Liquid volume in barrels (from m3)**
```sql
TRY_CAST(volumetrics.Volume AS DOUBLE) * 6.28981
```

**Gas volume in Mcf (from e3m3)**
```sql
TRY_CAST(volumetrics.Volume AS DOUBLE) * 35.3147
```

## SQL Examples

### 1. What was monthly Alberta oil production in barrels per day in 2025, and its estimated value at WCS in CAD?

```sql
WITH monthly AS (
  SELECT v.ProductionMonth,
         SUM(CASE WHEN v.ProductID = 'OIL' THEN TRY_CAST(v.Volume AS DOUBLE) END) AS oil_m3
  FROM sbx_petrinex_app.petrinex.volumetrics v
  WHERE v.ActivityID = 'PROD'
    AND v.ProductionMonth BETWEEN '2025-01' AND '2025-12'
  GROUP BY v.ProductionMonth
)
SELECT m.ProductionMonth,
       ROUND(m.oil_m3, 1) AS oil_m3,
       ROUND(m.oil_m3 * 6.28981 / DAY(LAST_DAY(TO_DATE(m.ProductionMonth, 'yyyy-MM'))), 0) AS oil_bbl_per_day,
       p.wcs_cad_bbl,
       ROUND(m.oil_m3 * 6.28981 * p.wcs_cad_bbl / 1e6, 1) AS est_oil_value_mm_cad
FROM monthly m
LEFT JOIN sbx_petrinex_app.petrinex.market_prices p ON p.price_month = m.ProductionMonth
ORDER BY m.ProductionMonth
```

### 2. Which 10 operators produced the most oil in 2025?

```sql
SELECT v.OperatorName,
       ROUND(SUM(TRY_CAST(v.Volume AS DOUBLE)), 1) AS oil_m3,
       ROUND(SUM(TRY_CAST(v.Volume AS DOUBLE)) * 6.28981 / 365, 0) AS avg_oil_bbl_per_day
FROM sbx_petrinex_app.petrinex.volumetrics v
WHERE v.ActivityID = 'PROD' AND v.ProductID = 'OIL'
  AND v.ProductionMonth BETWEEN '2025-01' AND '2025-12'
GROUP BY v.OperatorName
ORDER BY oil_m3 DESC
LIMIT 10
```

## Benchmarks

### 1. Which 5 formations have produced the most oil?

**Evaluation note:** Should note that 'Other' is a catch-all grouping rather than a specific formation.

```sql
SELECT formation, ROUND(SUM(total_oil_m3), 1) AS oil_m3, COUNT(*) AS wells
FROM sbx_petrinex_app.petrinex.wells
GROUP BY formation
ORDER BY oil_m3 DESC
LIMIT 5
```

### 2. How much gas was flared and vented in each region in 2025?

```sql
SELECT f.region, ROUND(SUM(e.flare_volume), 1) AS flare_e3m3, ROUND(SUM(e.vent_volume), 1) AS vent_e3m3
FROM sbx_petrinex_app.petrinex.facility_emissions e
JOIN sbx_petrinex_app.petrinex.facilities f ON f.facility_id = e.facility_id
WHERE e.production_month BETWEEN '2025-01' AND '2025-12'
GROUP BY f.region
ORDER BY flare_e3m3 DESC
```

### 3. Who were the top 5 gas producers in 2025?

```sql
SELECT v.OperatorBAID, MAX(v.OperatorName) AS operator_name, ROUND(SUM(TRY_CAST(v.Volume AS DOUBLE)), 1) AS gas_e3m3
FROM sbx_petrinex_app.petrinex.volumetrics v
WHERE v.ActivityID = 'PROD' AND v.ProductID = 'GAS'
  AND v.ProductionMonth BETWEEN '2025-01' AND '2025-12'
GROUP BY v.OperatorBAID
ORDER BY gas_e3m3 DESC
LIMIT 5
```