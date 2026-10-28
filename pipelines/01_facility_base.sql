-- Facility x month: operator for that month plus PROD volumes (Petrinex units) and NGLs.
-- Every facility-month has exactly one operator (verified), so max() just picks it.
CREATE OR REPLACE TABLE {acq}.facility_month AS
WITH vol AS (
  SELECT
    ProductionMonth AS month,
    ReportingFacilityID AS facility_id,
    max(OperatorBAID) AS operator_baid,
    max(OperatorName) AS operator_name,
    sum(CASE WHEN ActivityID = 'PROD' AND ProductID = 'OIL'   THEN try_cast(Volume AS DOUBLE) END) AS oil_m3,
    sum(CASE WHEN ActivityID = 'PROD' AND ProductID = 'GAS'   THEN try_cast(Volume AS DOUBLE) END) AS gas_e3m3,
    sum(CASE WHEN ActivityID = 'PROD' AND ProductID = 'COND'  THEN try_cast(Volume AS DOUBLE) END) AS cond_m3,
    sum(CASE WHEN ActivityID = 'PROD' AND ProductID = 'WATER' THEN try_cast(Volume AS DOUBLE) END) AS water_m3
  FROM {src}.volumetrics
  GROUP BY ProductionMonth, ReportingFacilityID
),
-- NGLs come from ngl_volumes only (never also from volumetrics NGL products): C2-C5 mix + spec + lite mix.
ngl AS (
  SELECT
    n.ProductionMonth AS month,
    coalesce(n.ReportingFacilityID, w.facility_id) AS facility_id,
    sum(coalesce(try_cast(n.EthaneMixVolume AS DOUBLE), 0) + coalesce(try_cast(n.EthaneSpecVolume AS DOUBLE), 0)
      + coalesce(try_cast(n.PropaneMixVolume AS DOUBLE), 0) + coalesce(try_cast(n.PropaneSpecVolume AS DOUBLE), 0)
      + coalesce(try_cast(n.ButaneMixVolume AS DOUBLE), 0) + coalesce(try_cast(n.ButaneSpecVolume AS DOUBLE), 0)
      + coalesce(try_cast(n.PentaneMixVolume AS DOUBLE), 0) + coalesce(try_cast(n.PentaneSpecVolume AS DOUBLE), 0)
      + coalesce(try_cast(n.LiteMixVolume AS DOUBLE), 0)) AS ngl_m3
  FROM {src}.ngl_volumes n
  LEFT JOIN {src}.wells w ON n.WellID = w.well_id
  GROUP BY 1, 2
)
SELECT
  v.*,
  coalesce(n.ngl_m3, 0) AS ngl_m3,
  day(last_day(to_date(v.month || '-01'))) AS days
FROM vol v
LEFT JOIN ngl n ON v.facility_id = n.facility_id AND v.month = n.month;

-- One row per facility with its CURRENT operator (latest reporting month), location and type.
-- facilities.operator_baid is stale (Torxen's 776 facilities still show Torxen), so it is not used.
CREATE OR REPLACE TABLE {acq}.facility_current AS
WITH cur AS (
  SELECT
    facility_id,
    max_by(operator_baid, month) AS operator_baid,
    max_by(operator_name, month) AS operator_name,
    min(month) AS first_month,
    max(month) AS last_month
  FROM {acq}.facility_month
  GROUP BY facility_id
)
SELECT
  c.*,
  f.facility_name,
  f.facility_type_code,
  f.facility_type,
  f.facility_subtype,
  CAST(f.latitude AS DOUBLE) AS lat,
  f.longitude AS lon,
  coalesce(f.facility_subtype RLIKE '(?i)BITUMEN|OIL SANDS|HEAVY', false) AS is_heavy,
  h3_longlatash3(f.longitude, CAST(f.latitude AS DOUBLE), 5) AS h3_r5
FROM cur c
JOIN {src}.facilities f ON c.facility_id = f.facility_id;
