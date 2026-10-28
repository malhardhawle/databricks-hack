"""Build the acquisition tables from pipelines/*.sql.

    python scripts/run_pipeline.py                      # create/replace every table in {catalog}.acq
    python scripts/run_pipeline.py --dry-run -q "SELECT count(*) FROM {acq}.cnrl_footprint"
    python scripts/run_pipeline.py --dry-run -q "SELECT * FROM {acq}.operator_metrics" --csv out.csv

--dry-run creates nothing: each CREATE ... AS SELECT becomes a CTE, and the query runs on top of the chain.
Catalog comes from ACQ_CATALOG (default shm_hack); source tables are {catalog}.petrinex.
"""
import argparse
import csv
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from sql import query, show  # noqa: E402

CATALOG = os.environ.get("ACQ_CATALOG", "shm_hack")
PIPELINES = Path(__file__).resolve().parent.parent / "pipelines"
CREATE = re.compile(r"^\s*CREATE OR REPLACE TABLE \{acq\}\.(\w+) AS\s*(.*)$", re.S)


def statements():
    """(table_name, select_body) for every CREATE statement, in file order."""
    out = []
    for path in sorted(PIPELINES.glob("*.sql")):
        text = "\n".join(l for l in path.read_text().splitlines() if not l.lstrip().startswith("--"))
        for stmt in re.split(r";\s*(?:\n|$)", text):
            if stmt.strip():
                m = CREATE.match(stmt)
                if not m:
                    raise ValueError(f"{path.name}: expected CREATE OR REPLACE TABLE {{acq}}.<name> AS ...")
                out.append((m.group(1), m.group(2).strip()))
    return out


def fill(sql, acq):
    return sql.replace("{src}", f"{CATALOG}.petrinex").replace("{acq}", acq)


def dry_run_sql(q):
    """One read-only statement: every pipeline table as a CTE, then `q` on top."""
    chain = ",\n".join(f"{name} AS (\n{fill(body, '_acq')}\n)" for name, body in statements())
    return "WITH " + chain.replace("_acq.", "") + "\n" + fill(q, "_acq").replace("_acq.", "")


def dry_run(q, csv_path):
    cols, rows = query(dry_run_sql(q))
    if csv_path:
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            csv.writer(f).writerows([cols, *rows])
        print(f"{len(rows)} rows -> {csv_path}")
    else:
        show(cols, rows)


def build():
    acq = f"{CATALOG}.acq"
    query(f"CREATE SCHEMA IF NOT EXISTS {acq} COMMENT 'CNRL acquisition app: derived tables'")
    for name, body in statements():
        print(f"building {acq}.{name} ...", flush=True)
        query(f"CREATE OR REPLACE TABLE {acq}.{name} AS\n{fill(body, acq)}")
        print("  rows:", query(f"SELECT count(*) FROM {acq}.{name}")[1][0][0])


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("-q", "--query", help="query to run on top of the CTE chain (dry run)")
    ap.add_argument("--csv", help="write the dry-run result to this CSV instead of printing")
    a = ap.parse_args()
    if a.dry_run:
        dry_run(a.query or "SELECT 'ok'", a.csv)
    else:
        build()
