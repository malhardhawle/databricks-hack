# EDA findings (run 2026-10-28)

## Coverage
- 24 production months, 2024-01 → 2025-12, Alberta only. No months are missing in any time-series table.
- Volumetrics: 530k–570k rows per month; reporting facilities slowly decline from 21,123 (2024-01) to 20,769 (2025-12).
- NGL: about 106k–109k well-rows per month, also declining slowly.
- No `_rescued_data` populated, so the ingest was clean. PROD rows have no duplicate keys.

## Provincial PROD totals (volumetrics, ActivityID='PROD')
| | Typical month | ≈ daily |
|---|---|---|
| Oil | 11.0–12.5M m³ | ~2.4–2.6M bbl/d (excludes mined oil sands) |
| Gas | 10.3–13.8M e³m³ | ~12–16 Bcf/d (raw) |
| Condensate | 340k–520k m³ | ~70–105k bbl/d, trending **up** (341k → 487k) |
| Water | 50–56M m³ | water cut ≈ 4.5× oil by volume |

- Gas is seasonal: troughs in Jun/Sep, peaks Dec/Jan (2025-12 high 13.8M e³m³).
- Oil is gently rising: 2025-H2 runs about 12.3–12.5M m³ vs 2024-H1 about 11.4M.
- 2024-09 is a dip across all products, possibly maintenance or a fire season effect, which is worth checking.

Visual version: [ref/eda-report.html](../../ref/eda-report.html).

## Trends worth a look
- Oil drops sharply in **Sep 2024** (~2.22M bbl/d vs ~2.4M either side), and fuel gas drops that month too.
- Vented gas fell **~40%** in 2025 vs 2024; flaring fell only slightly.
- Shut-in wells rose from 13.2k (Jan 2024) to 16.2k (Dec 2025), **+23%**.
- Dec 2025 gas ≈ 15.7 Bcf/d, +7.9% YoY. Condensate +43% over the two years.

## Top operators by PROD (avg over 731 days)
- Oil: Cenovus ~503k bbl/d, CNRL ~431k, Suncor ~272k, Imperial ~153k, ConocoPhillips ~134k, MEG ~99k.
- Gas: Tourmaline ≈ CNRL ~1,725 MMcf/d, Cenovus ~797, Peyto ~728, ARC ~664, Whitecap, Ovintiv, Advantage, Birchcliff, NuVista.

## Facilities and operators
- 25,316 facilities: 20,496 batteries, 2,519 gathering systems, 1,815 injection facilities, 486 gas plants.
- Central Alberta holds 43% of facilities.
- In-situ oil sands operators dominate oil output with very few facilities (Suncor has 8, MEG has 4).
- Ranked by the `operators` table, midstream firms (Pembina, Plains, Keyera, Inter Pipeline) look like top gas producers.
  That is an artifact of its all-activity totals; ranked by PROD, they drop out (see above).

## Emissions (facility_emissions, 2024-2025 total)
- Fuel 50.0M e³m³ ≫ Flare 2.89M ≫ Vent 0.77M.
- Facility-level values reconcile exactly with volumetrics FLARE/VENT/FUEL GAS.

## Data quality flags
- All volumetrics and ngl columns are strings; 56 bad `Volume` values.
- `wells.formation` mapping is unreliable (pool 0950160 → "Montney" for 44.8k wells).
- `field_codes` covers 84 of 574 field codes.
- `wells` covers about 68% of WI ids seen in volumetrics.
- `market_prices` covers only 2025 for production overlap, and the values look approximate.
- `facility_emissions.production_volume` adds together units that differ.

## Ideas this data supports
- Flaring/venting intensity league table by operator or region, mapped with facility lat/lon.
- Decline curves and well-level type curves from `ngl_volumes` (24 months per well).
- Shut-in tracking: SHUTIN rows per well per month, to show assets going dormant.
- Revenue estimate for 2025: oil × WCS CAD + gas energy (GJ) × AECO.
- NGL yield (C2–C5 per e³m³ gas) by field/area to rank liquids-rich plays.
- Condensate growth story (+40% over 2 years).
