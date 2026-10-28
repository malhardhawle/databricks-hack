-- Every number Petrinex can't provide, one row per key. The app reads these as defaults and lets users edit them.
-- source: 'market_prices' (derived from the catalog), 'calibrated' (derived from Petrinex), 'assumption' (agreed default).
CREATE OR REPLACE TABLE {acq}.assumptions AS
WITH px AS (
  SELECT avg(wti_usd_bbl) AS wti, avg(wcs_usd_bbl) AS wcs, avg(aeco_cad_gj) AS aeco, avg(exchange_rate_usd_cad) AS fx
  FROM {src}.market_prices
  WHERE price_month BETWEEN '2025-01' AND '2025-12'
),
gas_heat AS (
  SELECT sum(try_cast(Energy AS DOUBLE)) / sum(try_cast(GasProduction AS DOUBLE)) AS gj_per_e3m3
  FROM {src}.ngl_volumes
)
SELECT * FROM VALUES
  ('discount_rate',          '0.15',  'fraction',     'valuation', 'assumption', 'CNRL hurdle / discount rate for NPV'),
  ('roce_hurdle',            '0.15',  'fraction',     'valuation', 'assumption', 'Accretive if ROCE exceeds this'),
  ('price_per_flowing_boe',  '45000', 'CAD per boe/d','valuation', 'assumption', 'Acquisition price multiple'),
  ('price_per_flowing_boe_low',  '35000', 'CAD per boe/d', 'valuation', 'assumption', 'Sensitivity low'),
  ('price_per_flowing_boe_high', '55000', 'CAD per boe/d', 'valuation', 'assumption', 'Sensitivity high'),
  ('price_basis',            'flat',  'enum',         'valuation', 'assumption', 'flat = one multiple for all boe; mix = separate gas and liquids multiples below'),
  ('price_per_flowing_boe_gas',     '15000', 'CAD per boe/d', 'valuation', 'assumption', 'Gas multiple when price_basis = mix'),
  ('price_per_flowing_boe_liquids', '50000', 'CAD per boe/d', 'valuation', 'assumption', 'Liquids multiple when price_basis = mix'),
  ('npv_years',              '10',    'years',        'valuation', 'assumption', 'NPV horizon'),
  ('tax_rate',               '0.23',  'fraction',     'valuation', 'assumption', 'Corporate tax rate'),
  ('royalty_rate',           '0.15',  'fraction',     'costs',     'assumption', 'Flat royalty; Petrinex ROYALTY rows are oil-in-kind only (~2.6% of oil), so not usable per operator'),
  ('opex_gas_per_boe',       '8',     'CAD/boe',      'costs',     'assumption', 'Opex for gas boe'),
  ('opex_light_per_boe',     '14',    'CAD/boe',      'costs',     'assumption', 'Opex for light oil / condensate / NGL boe'),
  ('opex_heavy_per_boe',     '18',    'CAD/boe',      'costs',     'assumption', 'Opex for heavy oil / thermal boe'),
  ('light_oil_diff_usd',     '5',     'USD/bbl',      'price',     'assumption', 'Light oil price = WTI minus this'),
  ('cond_pct_wti',           '1.0',   'fraction',     'price',     'assumption', 'Condensate price as share of WTI'),
  ('ngl_pct_wti',            '0.5',   'fraction',     'price',     'assumption', 'NGL price as share of WTI'),
  ('liq_tariff_per_m3_km',   '0.12',  'CAD/m3/km',    'transport', 'assumption', 'Liquids trucking tariff'),
  ('gas_tariff_per_e3m3_km', '0.10',  'CAD/e3m3/km',  'transport', 'assumption', 'PLACEHOLDER gas gathering tariff; no number agreed yet'),
  ('min_decline',            '0.05',  'fraction/yr',  'decline',   'assumption', 'Floor on annual decline'),
  ('max_decline',            '0.35',  'fraction/yr',  'decline',   'assumption', 'Cap on annual decline'),
  ('decline_source',         'precedent', 'enum',     'decline',   'assumption', 'precedent = baseline from CNRL deals; fitted = each operator''s own 24-month fit'),
  ('min_candidate_boe_d',    '1000',  'boe/d',        'universe',  'assumption', 'Minimum 2025 production for a candidate'),
  ('exclude_baids',          'A5D4,0054,0007,A5G3,A573', 'list', 'universe', 'assumption', 'Cenovus, Suncor, Imperial, ConocoPhillips, Tourmaline'),
  ('material_deal_boe_d',    '5000',  'boe/d',        'precedent', 'assumption', 'Past deals at or above this size form the baseline'),
  ('weight_accretion',       '0.60',  'fraction',     'ranking',   'assumption', 'Final rank weight'),
  ('weight_proximity',       '0.25',  'fraction',     'ranking',   'assumption', 'Final rank weight'),
  ('weight_precedent_fit',   '0.15',  'fraction',     'ranking',   'assumption', 'Final rank weight'),
  ('lasso_radius_km',        '25',    'km',           'app',       'assumption', 'Default lasso search radius')
  AS t(key, value, unit, category, source, description)
UNION ALL SELECT 'wti_usd_bbl', CAST(round(wti, 2) AS STRING), 'USD/bbl', 'price', 'market_prices', 'WTI, 2025 average' FROM px
UNION ALL SELECT 'wcs_usd_bbl', CAST(round(wcs, 2) AS STRING), 'USD/bbl', 'price', 'market_prices', 'WCS (heavy), 2025 average' FROM px
UNION ALL SELECT 'aeco_cad_gj', CAST(round(aeco, 3) AS STRING), 'CAD/GJ', 'price', 'market_prices', 'AECO gas, 2025 average' FROM px
UNION ALL SELECT 'fx_usd_cad', CAST(round(fx, 4) AS STRING), 'CAD per USD', 'price', 'market_prices', 'Exchange rate, 2025 average' FROM px
UNION ALL SELECT 'gas_gj_per_e3m3', CAST(round(gj_per_e3m3, 2) AS STRING), 'GJ/e3m3', 'price', 'calibrated', 'Heat content of raw gas, from ngl_volumes Energy / GasProduction' FROM gas_heat;
