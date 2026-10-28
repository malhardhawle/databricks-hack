# Joins, gotchas, and query patterns

## Join map
```
operators.operator_baid ──< facilities.operator_baid
facilities.facility_id  ──< volumetrics.ReportingFacilityID      (25,316 / 25,316 match)
facilities.facility_id  ──< facility_emissions.facility_id       (19,119 / 19,119 match)
facilities.facility_id  ──< wells.facility_id                    (11,375 / 11,393 match; 2,069 wells null)
wells.well_id           ──< ngl_volumes.WellID                   (118,600 / 118,600 match)
wells.well_id           ──< volumetrics.FromToID  WHERE FromToIDType='WI'   (116,496 / 171,529 match, ~68%)
wells.field_name        >── field_codes.field_code               (84 of 574 codes; 96,208 / 118,600 wells)
volumetrics.ProductionMonth = market_prices.price_month          (2025 only)
```
All month keys are `'YYYY-MM'` strings, so they join directly across tables.

## Gotchas (read before writing queries)
1. **Cast everything in `volumetrics` / `ngl_volumes`.** Every column is STRING. Use `try_cast(Volume AS DOUBLE)`, not `cast`, because 56 values are unparseable.
2. **Never sum `Volume` across all activities.** One barrel shows up as PROD, then DISP, REC at the next facility, INV, and so on. For production, filter `ActivityID = 'PROD'`. For emissions, use `FLARE`/`VENT`/`FUEL` with `ProductID = 'GAS'`.
3. **All PROD rows are well-level** (`FromToIDType='WI'`, verified), so summing PROD gives provincial production with no double-counting. Gas plants and other downstream facilities show up under REC/DISP/PROC, not PROD.
4. **Proration-factor rows** have null `ActivityID`. They are excluded automatically once you filter on `ActivityID`.
5. **`wells` ≠ all wells.** It is built from `ngl_volumes` (118.6k wells). Volumetrics references 171.5k distinct WI ids, so for full well coverage use `volumetrics` `FromToID`.
6. **`wells.formation` is suspect.** It is derived from pool code, and pool `0950160` (44.8k wells across Pembina, Provost, Kaybob, ...) is labelled "Montney". Those "Montney" wells only total 10.9M e³m³ of gas, which makes no sense for the biggest gas play. Treat `formation` as unreliable unless it is validated.
7. **`wells.field_name` / `pool_name` hold codes, not names.** Use `field_display_name`, or join `field_codes` (partial, 84 rows).
8. **`facility_emissions.production_volume` mixes units** (gas e³m³ + liquids m³). For emissions intensity, compute the denominator yourself from volumetrics PROD for a single product (usually GAS, or BOE).
9. **`market_prices` covers 2025 only** relative to production, so revenue or price analysis can only use 2025. Prices are in USD/bbl (WTI, WCS) and CAD/GJ (AECO).
10. **`operators` totals are inflated.** They match volumetrics product sums across all activities (oil ≈2.6×, gas ≈9.5× PROD), which is why midstream firms (Pembina, Plains, Keyera) look like top gas "producers". Recompute from `volumetrics` with `ActivityID='PROD'`.
11. **`facilities.region` is coarse lat/lon bands, not real regions.** Everything north of 55°N is "Peace Country", including Fort McMurray, Firebag and Christina Lake oil sands, so "Peace Country" shows the most oil (192M m³). The bands also overlap (Athabasca and West-Central share the 53.7–55° latitudes). Re-derive region from township/range or lat/lon if it matters.

## Unit conversions
- 1 m³ oil = 6.2898 bbl. Monthly m³ → bbl/d: `m3 * 6.2898 / days_in_month`.
- 1 e³m³ gas = 35.3147 Mcf. e³m³/month → MMcf/d: `e3m3 * 35.3147 / 1000 / days_in_month`.
- BOE (6:1): `oil_m3*6.2898 + gas_e3m3*35.3147/6`, which gives boe when gas is converted from Mcf.
- AECO is CAD/GJ, and volumetrics `Energy` is GJ.

## Canonical queries
```sql
-- Monthly provincial production (PROD)
SELECT ProductionMonth,
  sum(CASE WHEN ProductID='OIL'   THEN try_cast(Volume AS DOUBLE) END) oil_m3,
  sum(CASE WHEN ProductID='GAS'   THEN try_cast(Volume AS DOUBLE) END) gas_e3m3,
  sum(CASE WHEN ProductID='COND'  THEN try_cast(Volume AS DOUBLE) END) cond_m3,
  sum(CASE WHEN ProductID='WATER' THEN try_cast(Volume AS DOUBLE) END) water_m3
FROM shm_hack.petrinex.volumetrics
WHERE ActivityID = 'PROD'
GROUP BY 1 ORDER BY 1;

-- Well-level monthly production with location
SELECT n.ProductionMonth, n.WellID, w.operator_name, f.latitude, f.longitude, f.region,
       try_cast(n.GasProduction AS DOUBLE) gas_e3m3, try_cast(n.OilProduction AS DOUBLE) oil_m3
FROM shm_hack.petrinex.ngl_volumes n
JOIN shm_hack.petrinex.wells w ON n.WellID = w.well_id
LEFT JOIN shm_hack.petrinex.facilities f ON w.facility_id = f.facility_id;

-- Flaring/venting intensity by operator (gas-only denominator)
SELECT v.OperatorName,
  sum(CASE WHEN ActivityID IN ('FLARE','VENT') AND ProductID='GAS' THEN try_cast(Volume AS DOUBLE) END)
  / nullif(sum(CASE WHEN ActivityID='PROD' AND ProductID='GAS' THEN try_cast(Volume AS DOUBLE) END), 0) AS fv_intensity
FROM shm_hack.petrinex.volumetrics v
GROUP BY 1;
```
