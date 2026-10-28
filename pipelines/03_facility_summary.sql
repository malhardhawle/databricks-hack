-- One row per facility: 2025 production rates, nearest CNRL assets, and today's haul distances.
-- Rates: oil/cond/NGL bbl/d (m3 x 6.2898), gas MMcf/d (e3m3 x 35.3147 / 1000).
-- boe = oil + cond + raw gas / 6. NGLs are already inside raw gas, so they are reported separately and NOT added to boe.
-- Distances: haversine km, searched within an H3 res-5 k-ring of 4 (~59 km); NULL means "farther".
CREATE OR REPLACE TABLE {acq}.facility_summary AS
WITH prod AS (
  SELECT
    facility_id,
    sum(CASE WHEN month LIKE '2025-%' THEN oil_m3 END) * 6.2898 / 365 AS oil_bbl_d,
    sum(CASE WHEN month LIKE '2025-%' THEN gas_e3m3 END) * 35.3147 / 1000 / 365 AS gas_mmcf_d,
    sum(CASE WHEN month LIKE '2025-%' THEN cond_m3 END) * 6.2898 / 365 AS cond_bbl_d,
    sum(CASE WHEN month LIKE '2025-%' THEN ngl_m3 END) * 6.2898 / 365 AS ngl_bbl_d,
    sum(CASE WHEN month >= '2025-10' THEN oil_m3 END) * 6.2898 / 92 AS oil_bbl_d_last3,
    sum(CASE WHEN month >= '2025-10' THEN gas_e3m3 END) * 35.3147 / 1000 / 92 AS gas_mmcf_d_last3,
    sum(CASE WHEN month >= '2025-10' THEN cond_m3 END) * 6.2898 / 92 AS cond_bbl_d_last3,
    sum(CASE WHEN month >= '2025-10' THEN ngl_m3 END) * 6.2898 / 92 AS ngl_bbl_d_last3,
    sum(CASE WHEN month >= '2025-10' THEN (coalesce(oil_m3, 0) + coalesce(cond_m3, 0)) * 6.2898
                                          + coalesce(gas_e3m3, 0) * 35.3147 / 6 END) / 92 AS boe_d_last3,
    sum(CASE WHEN month LIKE '2025-%' THEN coalesce(oil_m3, 0) + coalesce(cond_m3, 0) END) AS liq_m3_2025,
    sum(CASE WHEN month LIKE '2025-%' THEN gas_e3m3 END) AS gas_e3m3_2025
  FROM {acq}.facility_month
  GROUP BY facility_id
),
rates AS (
  SELECT
    p.*,
    coalesce(oil_bbl_d, 0) + coalesce(cond_bbl_d, 0) + coalesce(gas_mmcf_d, 0) * 1000 / 6 AS boe_d
  FROM prod p
),
cnrl_cells AS (
  SELECT facility_id AS cnrl_id, facility_name AS cnrl_name, facility_type_code AS cnrl_type, is_acquired,
         lat AS clat, lon AS clon, explode(h3_kring(h3_r5, 4)) AS cell
  FROM {acq}.cnrl_footprint
),
pairs AS (
  SELECT
    f.facility_id, c.cnrl_id, c.cnrl_name, c.cnrl_type, c.is_acquired,
    2 * 6371 * asin(sqrt(pow(sin(radians(c.clat - f.lat) / 2), 2)
      + cos(radians(f.lat)) * cos(radians(c.clat)) * pow(sin(radians(c.clon - f.lon) / 2), 2))) AS km
  FROM {acq}.facility_current f
  JOIN cnrl_cells c ON f.h3_r5 = c.cell
  WHERE f.facility_id <> c.cnrl_id
),
near AS (
  SELECT
    facility_id,
    min_by(cnrl_id, km) AS nearest_cnrl_id,
    min_by(cnrl_name, km) AS nearest_cnrl_name,
    min(km) AS nearest_cnrl_km,
    min(CASE WHEN NOT is_acquired THEN km END) AS nearest_legacy_km,
    -- Pipeline proxy: gas ties into CNRL gas plants / gathering systems, liquids into batteries / injection.
    min_by(cnrl_id, CASE WHEN cnrl_type IN ('GP', 'GS') THEN km END) AS gas_tie_id,
    min(CASE WHEN cnrl_type IN ('GP', 'GS') THEN km END) AS gas_tie_km,
    min_by(cnrl_id, CASE WHEN cnrl_type IN ('BT', 'IF') THEN km END) AS liq_tie_id,
    min(CASE WHEN cnrl_type IN ('BT', 'IF') THEN km END) AS liq_tie_km
  FROM pairs
  GROUP BY facility_id
),
-- Today's haul: 2025 DISP volumes to destinations that have coordinates (BT/GS/GP/IF), volume-weighted.
disp AS (
  SELECT
    v.ReportingFacilityID AS facility_id,
    v.ProductID = 'GAS' AS is_gas,
    try_cast(v.Volume AS DOUBLE) * CASE WHEN v.ProductID = 'GAS' THEN 35.3147 / 6 ELSE 6.2898 END AS boe,
    d.operator_baid = '0HE9' AS to_cnrl,
    2 * 6371 * asin(sqrt(pow(sin(radians(d.lat - o.lat) / 2), 2)
      + cos(radians(o.lat)) * cos(radians(d.lat)) * pow(sin(radians(d.lon - o.lon) / 2), 2))) AS km
  FROM {src}.volumetrics v
  JOIN {acq}.facility_current o ON v.ReportingFacilityID = o.facility_id
  LEFT JOIN {acq}.facility_current d ON v.FromToID = d.facility_id
  WHERE v.ActivityID = 'DISP' AND v.ProductID IN ('OIL', 'COND', 'GAS')
    AND v.ProductionMonth LIKE '2025-%' AND try_cast(v.Volume AS DOUBLE) > 0
),
haul AS (
  SELECT
    facility_id,
    sum(CASE WHEN NOT is_gas AND km IS NOT NULL THEN boe * km END)
      / sum(CASE WHEN NOT is_gas AND km IS NOT NULL THEN boe END) AS today_km_liq,
    sum(CASE WHEN is_gas AND km IS NOT NULL THEN boe * km END)
      / sum(CASE WHEN is_gas AND km IS NOT NULL THEN boe END) AS today_km_gas,
    sum(CASE WHEN km IS NOT NULL THEN boe END) / sum(boe) AS disp_share_located,
    coalesce(sum(CASE WHEN to_cnrl THEN boe END), 0) / sum(boe) AS disp_share_to_cnrl
  FROM disp
  GROUP BY facility_id
)
SELECT
  f.facility_id,
  f.facility_name,
  f.facility_type_code,
  f.facility_type,
  f.facility_subtype,
  f.operator_baid,
  f.operator_name,
  f.operator_baid = '0HE9' AS is_cnrl,
  coalesce(cf.is_acquired, false) AS is_acquired,
  cf.seller_baid,
  cf.seller_name,
  cf.deal_month,
  f.lat,
  f.lon,
  f.is_heavy,
  f.last_month,
  coalesce(r.oil_bbl_d, 0) AS oil_bbl_d,
  coalesce(r.gas_mmcf_d, 0) AS gas_mmcf_d,
  coalesce(r.cond_bbl_d, 0) AS cond_bbl_d,
  coalesce(r.ngl_bbl_d, 0) AS ngl_bbl_d,
  coalesce(r.boe_d, 0) AS boe_d,
  coalesce(r.oil_bbl_d_last3, 0) AS oil_bbl_d_last3,
  coalesce(r.gas_mmcf_d_last3, 0) AS gas_mmcf_d_last3,
  coalesce(r.cond_bbl_d_last3, 0) AS cond_bbl_d_last3,
  coalesce(r.ngl_bbl_d_last3, 0) AS ngl_bbl_d_last3,
  coalesce(r.boe_d_last3, 0) AS boe_d_last3,
  CASE WHEN coalesce(r.boe_d, 0) <= 0 THEN 'none'
       WHEN r.gas_mmcf_d * 1000 / 6 >= 0.5 * r.boe_d THEN 'gas'
       ELSE 'liquids' END AS primary_product,
  n.nearest_cnrl_id,
  n.nearest_cnrl_name,
  n.nearest_cnrl_km,
  n.nearest_legacy_km,
  n.gas_tie_id,
  n.gas_tie_km,
  n.liq_tie_id,
  n.liq_tie_km,
  h.today_km_liq,
  h.today_km_gas,
  h.disp_share_located,
  h.disp_share_to_cnrl,
  coalesce(r.liq_m3_2025, 0) AS liq_m3_2025,
  coalesce(r.gas_e3m3_2025, 0) AS gas_e3m3_2025,
  -- Transport-savings basis (volume x km saved); the app applies $ tariffs from assumptions.
  coalesce(r.liq_m3_2025, 0) * greatest(0, h.today_km_liq - n.liq_tie_km) AS liq_m3km_saved,
  coalesce(r.gas_e3m3_2025, 0) * greatest(0, h.today_km_gas - n.gas_tie_km) AS gas_e3m3km_saved
FROM {acq}.facility_current f
LEFT JOIN rates r ON f.facility_id = r.facility_id
LEFT JOIN near n ON f.facility_id = n.facility_id
LEFT JOIN haul h ON f.facility_id = h.facility_id
LEFT JOIN {acq}.cnrl_footprint cf ON f.facility_id = cf.facility_id;
