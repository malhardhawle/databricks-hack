-- Candidate metrics: one row per non-CNRL operator, from the facilities it operates today.
-- Size / exclusion filters are applied in the app from the assumptions table, so all producers are kept here.
CREATE OR REPLACE TABLE {acq}.operator_metrics AS
WITH fac AS (
  SELECT * FROM {acq}.facility_summary WHERE NOT is_cnrl AND boe_d > 0
),
op AS (
  SELECT
    operator_baid,
    max(operator_name) AS operator_name,
    count(*) AS producing_facilities,
    sum(oil_bbl_d) AS oil_bbl_d,
    sum(gas_mmcf_d) AS gas_mmcf_d,
    sum(cond_bbl_d) AS cond_bbl_d,
    sum(ngl_bbl_d) AS ngl_bbl_d,
    sum(boe_d) AS boe_d,
    sum(boe_d_last3) AS boe_d_last3,
    sum(gas_mmcf_d) * 1000 / 6 / sum(boe_d) AS gas_share,
    coalesce(sum(CASE WHEN is_heavy THEN oil_bbl_d END) / nullif(sum(oil_bbl_d), 0), 0) AS heavy_oil_share,
    sum(boe_d * coalesce(nearest_cnrl_km, 60)) / sum(boe_d) AS mean_km_to_cnrl,
    percentile(coalesce(nearest_cnrl_km, 60), 0.5) AS median_km_to_cnrl,
    coalesce(sum(CASE WHEN nearest_cnrl_km <= 10 THEN boe_d END), 0) / sum(boe_d) AS share_within_10km,
    coalesce(sum(CASE WHEN nearest_cnrl_km <= 25 THEN boe_d END), 0) / sum(boe_d) AS share_within_25km,
    coalesce(sum(CASE WHEN nearest_cnrl_km <= 50 THEN boe_d END), 0) / sum(boe_d) AS share_within_50km,
    sum(boe_d * coalesce(disp_share_to_cnrl, 0)) / sum(boe_d) AS disp_share_to_cnrl,
    sum(liq_m3_2025) AS liq_m3_2025,
    sum(gas_e3m3_2025) AS gas_e3m3_2025,
    sum(liq_m3km_saved) AS liq_m3km_saved,
    sum(gas_e3m3km_saved) AS gas_e3m3km_saved
  FROM fac
  GROUP BY operator_baid
),
-- Decline from the 24-month history of the facilities each operator runs today.
monthly AS (
  SELECT
    f.operator_baid,
    CAST(months_between(to_date(m.month || '-01'), DATE'2024-01-01') AS INT) AS t,
    sum((coalesce(m.oil_m3, 0) + coalesce(m.cond_m3, 0)) * 6.2898
        + coalesce(m.gas_e3m3, 0) * 35.3147 / 6) / max(m.days) AS boe_d
  FROM {acq}.facility_month m
  JOIN {acq}.facility_current f ON m.facility_id = f.facility_id
  WHERE f.operator_baid <> '0HE9'
  GROUP BY f.operator_baid, m.month
),
decl AS (
  SELECT
    operator_baid,
    regr_slope(CASE WHEN boe_d > 0 THEN ln(boe_d) END, CASE WHEN boe_d > 0 THEN t END) AS ln_slope,
    count_if(boe_d > 0) AS months_with_production
  FROM monthly
  GROUP BY operator_baid
)
SELECT
  op.*,
  1 - exp(12 * d.ln_slope) AS fitted_annual_decline,
  d.months_with_production
FROM op
LEFT JOIN decl d ON op.operator_baid = d.operator_baid;
