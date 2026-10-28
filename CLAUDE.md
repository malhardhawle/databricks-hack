# databricks-hack

Databricks Calgary hackathon project on Alberta oil & gas data from Petrinex public data (2024-01 → 2025-12).

## Data
- Catalog/schema: **`shm_hack.petrinex`**, with 8 tables: `volumetrics`, `ngl_volumes`, `facilities`, `wells`, `operators`, `field_codes`, `facility_emissions`, `market_prices`.
- Raw parquet: `/Volumes/shm_hack/petrinex/dataset/parquet/`
- Workspace `adb-7808899982160538.18.azuredatabricks.net`, CLI profile **`hack`**.

Read these before writing queries:
- [.claude/data/petrinex-tables.md](.claude/data/petrinex-tables.md): schemas, grain, codes, units
- [.claude/data/joins-and-gotchas.md](.claude/data/joins-and-gotchas.md): join keys, traps, canonical SQL
- [.claude/data/eda-findings.md](.claude/data/eda-findings.md): what the data looks like and analysis ideas

## Must-know rules
- **All data must come from the `shm_hack` catalog.** Don't read or pull in data from other catalogs or external sources. Write derived tables to `shm_hack` (e.g. `shm_hack.acq`). Values Petrinex lacks (costs, acquisition multiples) are explicit assumptions, stored in a table in `shm_hack`.
- `volumetrics` and `ngl_volumes` are **all STRING**. Wrap numerics in `try_cast(... AS DOUBLE)`.
- Production = `ActivityID = 'PROD'`. Never sum `Volume` across activities, because that double-counts.
- Units: liquids m³, gas e³m³, energy GJ.
- `wells.formation` and `facilities.region` are unreliable, `operators` totals are inflated, and `market_prices` only overlaps 2025.

## Reference material
`ref/` holds reference data and docs we add; see [ref/README.md](ref/README.md). The visual EDA is [ref/eda-report.html](ref/eda-report.html).

## Running SQL
`echo "SELECT ..." | python scripts/sql.py` (separate multiple statements with `;;`). It uses CLI profile `hack` and warehouse `42b00ac711df45f6`, which auto-starts.
