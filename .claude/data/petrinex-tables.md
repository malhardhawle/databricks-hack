# `shm_hack.petrinex`: table reference

Source: Petrinex Public Data (Alberta), production months **2024-01 → 2025-12** (24 months), Alberta only.
Raw parquet: `/Volumes/shm_hack/petrinex/dataset/parquet/`
Workspace: `adb-7808899982160538.18.azuredatabricks.net` (CLI profile `hack`).

| Table | Rows | Grain | Notes |
|---|---|---|---|
| `volumetrics` | 13,202,205 | facility × month × activity × product × from/to | Raw Petrinex volumetric submissions. **All columns are STRING.** |
| `ngl_volumes` | 2,577,956 | well × month | Well-level gas/oil/cond/water + NGL components. **All STRING.** |
| `facilities` | 25,316 | facility | Dimension with lat/lon + region. 1:1 with volumetrics facilities. |
| `wells` | 118,600 | well | Dimension **derived from `ngl_volumes`**, with lifetime totals. |
| `operators` | 523 | operator (BAID) | Dimension with lifetime totals (derived from volumetrics PROD). |
| `field_codes` | 84 | field code | Partial lookup: only 84 of the 574 field codes used in `wells`. |
| `facility_emissions` | 366,801 | facility × month | Pre-aggregated FLARE/VENT/FUEL gas from volumetrics. |
| `market_prices` | 14 | month | WTI/WCS/AECO/FX for **2025-01 → 2026-02 only** (not from Petrinex). |

Every table also has an empty `_rescued_data` column (Auto Loader artifact), which you can ignore.

---

## volumetrics (the core fact table)
Columns (all string): `ProductionMonth` (YYYY-MM), `OperatorBAID`, `OperatorName`,
`ReportingFacilityID` (e.g. `ABBT0051211` = AB + type + 7-digit id), `ReportingFacilityProvinceState`,
`ReportingFacilityType` (BT/GS/IF/GP), `ReportingFacilityIdentifier`, `ReportingFacilityName`,
`ReportingFacilitySubType` (code), `ReportingFacilitySubTypeDesc`, `ReportingFacilityLocation` (DLS),
`FacilityLegalSubdivision`, `FacilitySection`, `FacilityTownship`, `FacilityRange`, `FacilityMeridian`,
`SubmissionDate`, `ActivityID`, `ProductID`, `FromToID`, `FromToIDProvinceState`, `FromToIDType`,
`FromToIDIdentifier`, `Volume`, `Energy`, `Hours`, `CCICode`, `ProrationProduct`, `ProrationFactor`, `Heat`.

**Row types mixed together:**
- Normal activity rows: `ActivityID` + `ProductID` + `Volume`.
- Proration-factor rows (193,705): `ActivityID IS NULL`, only `ProrationProduct`/`ProrationFactor` set.
- SHUTIN rows: `ActivityID='SHUTIN'`, `ProductID` null, one per shut-in well (`FromToIDType='WI'`).
- 595,907 rows have null `Volume`; 56 non-null `Volume` values fail to cast, so use `try_cast`.

**ActivityID** (rows): PROD 5.87M, DISP 1.15M, REC 816k, DIFF 742k, FUEL 692k, VENT 669k, ROYALTY 460k,
INVOP/INVCL ~413k each, SHUTIN 402k, IMBAL 300k, INJ 272k, LD* (load fluid) REC/INVCL/INVOP/INJ/INVADJ,
FLARE 78k, SHR (shrinkage) 54k, PROC 53k, PURREC/PURDISP 11k, INVADJ, FRAC, PLTUSE, UTIL, EMIS, RECYC.

**ProductID**: GAS, WATER, OIL, COND, STEAM, SAND, NGL components (`C2/C3/C4/C5` with `-MX` mix or `-SP` spec,
`IC4/NC4/IC5/NC5/C6-MX`, `LITEMX`), `FSHWTR`/`BRKWTR` (fresh/brackish water), `ACGAS`, `ENTGAS`, `SUL`, `CO2`, `WASTE`.

**ReportingFacilityType**: BT Battery (20,496 facs), GS Gas Gathering System (2,519), IF Injection Facility (1,815), GP Gas Plant (486).
Top subtypes: crude oil single-well battery, gas single-well battery, gas multiwell group battery, gas gathering system, ...

**FromToIDType**: WI well (8.6M rows, the well-level link), BT, GS, IF, GP, CS, MC, WC, MS, PL, TM, ... (null for 2.6M rows).

Units (Petrinex standard): oil/cond/water/NGL **m³**, gas **e³m³** (thousand m³), energy **GJ**, hours **h**.

## ngl_volumes
`ReportingFacilityID`, `ReportingFacilityName`, `OperatorBAID`, `OperatorName`, `ProductionMonth`, `WellID`,
`WellLicenseNumber`, `Field`, `Pool`, `Area`, `Hours`, `GasProduction`, `OilProduction`, `CondensateProduction`,
`WaterProduction`, `ResidueGasVolume`, `Energy`, `Ethane/Propane/Butane/Pentane` `Mix`/`Spec` `Volume`, `LiteMixVolume`. All string.
- WellID prefixes: `ABWI` (well identifier, 98%), `ABUN` (unit), `ABWG` (well group).
- 43,371 rows (1.7%) have null facility/operator, mostly ABUN/ABWG rows.

## facilities
`facility_id`, `facility_name`, `facility_type_code`, `facility_subtype` (description text), `operator_baid`, `operator_name`,
`township`, `range_num`, `meridian`, `section`, `lsd`, `dls_location`, `latitude` (decimal), `longitude` (double),
`region`, `facility_type`.
- No null lat/lon. Bounding box is lat 49.0–59.5, lon −120.1 to −110.1 (Alberta).
- `region`: Central Alberta 10,831 · Peace Country 3,316 · West-Central 3,227 · Southeast 3,140 · Athabasca 2,739 · Foothills 2,063.

## wells
`well_id`, `facility_id`, `facility_name`, `operator_baid`, `operator_name`, `field_name` (actually a **4-digit field code**),
`pool_name` (actually a **7-digit pool code**), `area_name` (95% null), `well_license`, `active_months`,
`total_*` lifetime sums (gas, oil, cond, water, residue gas, energy, NGL components, hours),
`first_production_month`, `last_production_month`, `formation` (derived), `field_display_name` (lookup name, or the code when unmatched).

## operators
`operator_baid`, `operator_name`, `facility_count`, `active_months`, `total_oil_m3`, `total_gas_e3m3`, `total_condensate_m3`,
`total_water_m3`, `total_hours`, `first_production_month`, `last_production_month`.
Its totals (oil 744.5M m³, gas 2.67B e³m³) match volumetrics `ProductID` sums across all activities, not just PROD, so double-counting is possible (see gotchas).

## facility_emissions
`facility_id`, `facility_name`, `operator_baid`, `operator_name`, `production_month`, `flare_volume`, `vent_volume`, `fuel_volume`,
`total_emissions_volume` (= flare + vent + fuel), `production_volume`.
- Flare/vent/fuel match volumetrics `ActivityID IN ('FLARE','VENT','FUEL') AND ProductID='GAS'` exactly (e³m³).
- `production_volume` = **sum of all PROD volumes across products** (e.g. gas e³m³ + water m³), which **mixes units**.
- 19,119 facilities; 38,951 rows have `production_volume = 0`, so guard the division when computing intensity.

## market_prices
`price_month`, `wti_usd_bbl`, `wcs_usd_bbl`, `wcs_discount_usd`, `aeco_cad_gj`, `exchange_rate_usd_cad`, `wti_cad_bbl`, `wcs_cad_bbl` (decimals).
Covers 2025-01 → 2026-02, so it overlaps production only for **2025** (12 months). Values look rounded/approximate.

## field_codes
`field_code` (4-digit, zero-padded string), `field_name`. 84 rows (e.g. 0877 PEMBINA, 0601 KAYBOB, 0096 CAROLINE).
