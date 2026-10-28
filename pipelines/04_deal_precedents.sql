-- CNRL's revealed acquisition preferences: one row per seller whose facilities moved to BAID 0HE9.
-- Pre-deal window = the 6 months before CNRL's first month; decline = exponential fit over all pre-deal months.
CREATE OR REPLACE TABLE {acq}.deal_precedents AS
WITH deals AS (
  SELECT seller_baid, max(seller_name) AS seller_name, min(deal_month) AS deal_month, count(*) AS facilities
  FROM {acq}.cnrl_footprint
  WHERE is_acquired
  GROUP BY seller_baid
),
monthly AS (
  SELECT
    c.seller_baid,
    m.month,
    sum(coalesce(m.oil_m3, 0)) * 6.2898 / max(m.days) AS oil_bbl_d,
    sum(coalesce(m.gas_e3m3, 0)) * 35.3147 / 1000 / max(m.days) AS gas_mmcf_d,
    sum(coalesce(m.cond_m3, 0)) * 6.2898 / max(m.days) AS cond_bbl_d,
    sum(m.ngl_m3) * 6.2898 / max(m.days) AS ngl_bbl_d,
    count_if(coalesce(m.oil_m3, 0) + coalesce(m.gas_e3m3, 0) + coalesce(m.cond_m3, 0) > 0) AS producing_facilities
  FROM {acq}.facility_month m
  JOIN {acq}.cnrl_footprint c ON m.facility_id = c.facility_id
  WHERE c.is_acquired
  GROUP BY c.seller_baid, m.month
),
rel AS (
  SELECT
    mo.*,
    oil_bbl_d + cond_bbl_d + gas_mmcf_d * 1000 / 6 AS boe_d,  -- NGLs sit inside raw gas; not added
    CAST(months_between(to_date(mo.month || '-01'), to_date(d.deal_month || '-01')) AS INT) AS rel_month
  FROM monthly mo
  JOIN deals d ON mo.seller_baid = d.seller_baid
),
pre AS (
  SELECT
    seller_baid,
    avg(CASE WHEN rel_month BETWEEN -6 AND -1 THEN oil_bbl_d END) AS pre_oil_bbl_d,
    avg(CASE WHEN rel_month BETWEEN -6 AND -1 THEN gas_mmcf_d END) AS pre_gas_mmcf_d,
    avg(CASE WHEN rel_month BETWEEN -6 AND -1 THEN cond_bbl_d END) AS pre_cond_bbl_d,
    avg(CASE WHEN rel_month BETWEEN -6 AND -1 THEN ngl_bbl_d END) AS pre_ngl_bbl_d,
    avg(CASE WHEN rel_month BETWEEN -6 AND -1 THEN boe_d END) AS pre_boe_d,
    max(CASE WHEN rel_month BETWEEN -6 AND -1 THEN producing_facilities END) AS producing_facilities,
    regr_slope(CASE WHEN rel_month < 0 AND boe_d > 0 THEN ln(boe_d) END,
               CASE WHEN rel_month < 0 AND boe_d > 0 THEN rel_month END) AS pre_ln_slope,
    count_if(rel_month < 0) AS pre_months,
    avg(CASE WHEN rel_month >= 0 THEN boe_d END) AS post_boe_d,
    count_if(rel_month >= 0) AS post_months
  FROM rel
  GROUP BY seller_baid
),
dist AS (
  SELECT
    c.seller_baid,
    percentile(coalesce(s.nearest_legacy_km, 60), 0.5) AS median_km_to_legacy,
    percentile(coalesce(s.nearest_legacy_km, 60), 0.9) AS p90_km_to_legacy,
    avg(CASE WHEN s.nearest_legacy_km <= 10 THEN 1.0 ELSE 0.0 END) AS share_within_10km,
    avg(CASE WHEN s.nearest_legacy_km <= 25 THEN 1.0 ELSE 0.0 END) AS share_within_25km,
    avg(CASE WHEN s.nearest_legacy_km <= 50 THEN 1.0 ELSE 0.0 END) AS share_within_50km
  FROM {acq}.cnrl_footprint c
  JOIN {acq}.facility_summary s ON c.facility_id = s.facility_id
  WHERE c.is_acquired
  GROUP BY c.seller_baid
),
-- Share of the seller's pre-deal DISP volume (boe) that already went to a CNRL-operated facility that month.
pre_disp AS (
  SELECT
    c.seller_baid,
    coalesce(sum(CASE WHEN dm.operator_baid = '0HE9' THEN boe END), 0) / sum(boe) AS pre_disp_share_to_cnrl
  FROM (
    SELECT ReportingFacilityID, ProductionMonth, FromToID,
           try_cast(Volume AS DOUBLE) * CASE WHEN ProductID = 'GAS' THEN 35.3147 / 6 ELSE 6.2898 END AS boe
    FROM {src}.volumetrics
    WHERE ActivityID = 'DISP' AND ProductID IN ('OIL', 'COND', 'GAS') AND try_cast(Volume AS DOUBLE) > 0
  ) v
  JOIN {acq}.cnrl_footprint c ON v.ReportingFacilityID = c.facility_id AND v.ProductionMonth < c.deal_month
  LEFT JOIN {acq}.facility_month dm ON v.FromToID = dm.facility_id AND v.ProductionMonth = dm.month
  WHERE c.is_acquired
  GROUP BY c.seller_baid
)
SELECT
  d.seller_baid,
  d.seller_name,
  d.deal_month,
  d.facilities AS facilities_transferred,
  p.producing_facilities,
  p.pre_oil_bbl_d,
  p.pre_gas_mmcf_d,
  p.pre_cond_bbl_d,
  p.pre_ngl_bbl_d,
  p.pre_boe_d,
  p.pre_gas_mmcf_d * 1000 / 6 / nullif(p.pre_boe_d, 0) AS gas_share,
  p.pre_months,
  1 - exp(12 * p.pre_ln_slope) AS pre_annual_decline,
  p.post_months,
  p.post_boe_d / nullif(p.pre_boe_d, 0) AS post_retention,
  t.median_km_to_legacy,
  t.p90_km_to_legacy,
  t.share_within_10km,
  t.share_within_25km,
  t.share_within_50km,
  pd.pre_disp_share_to_cnrl
FROM deals d
LEFT JOIN pre p ON d.seller_baid = p.seller_baid
LEFT JOIN dist t ON d.seller_baid = t.seller_baid
LEFT JOIN pre_disp pd ON d.seller_baid = pd.seller_baid;
