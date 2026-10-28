-- CNRL footprint: facilities currently reported by BAID 0HE9, split into legacy vs acquired.
-- Acquired = the facility reported under another operator before CNRL's first month on it.
-- Key on BAID / facility_id only; seller names linger on wells after transfers.
CREATE OR REPLACE TABLE {acq}.cnrl_footprint AS
WITH cnrl AS (
  SELECT facility_id, min(month) AS cnrl_first_month
  FROM {acq}.facility_month
  WHERE operator_baid = '0HE9'
  GROUP BY facility_id
),
prior AS (
  SELECT
    fm.facility_id,
    max_by(fm.operator_baid, fm.month) AS seller_baid,
    max_by(fm.operator_name, fm.month) AS seller_name
  FROM {acq}.facility_month fm
  JOIN cnrl c ON fm.facility_id = c.facility_id
  WHERE fm.operator_baid <> '0HE9' AND fm.month < c.cnrl_first_month
  GROUP BY fm.facility_id
)
SELECT
  fc.facility_id,
  fc.facility_name,
  fc.facility_type_code,
  fc.lat,
  fc.lon,
  fc.h3_r5,
  p.seller_baid IS NOT NULL AS is_acquired,
  p.seller_baid,
  p.seller_name,
  CASE WHEN p.seller_baid IS NOT NULL THEN c.cnrl_first_month END AS deal_month
FROM {acq}.facility_current fc
JOIN cnrl c ON fc.facility_id = c.facility_id
LEFT JOIN prior p ON fc.facility_id = p.facility_id
WHERE fc.operator_baid = '0HE9';
