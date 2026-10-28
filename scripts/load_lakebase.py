"""Copy the app's gold tables from {catalog}.acq (Unity Catalog) into Lakebase.

    .venv/Scripts/python scripts/load_lakebase.py               # load tables, then grant the app read access
    .venv/Scripts/python scripts/load_lakebase.py --grant-only  # just (re)grant the deployed app

Creates the database if missing, then drops/recreates each table and COPYs the rows in. Recreated tables lose
their grants, so the deployed app's service principal is granted SELECT again (skipped if the app doesn't exist).
Env: ACQ_CATALOG (shm_hack), LAKEBASE_INSTANCE (cnrl-acq), LAKEBASE_DB (acq), DATABRICKS_CONFIG_PROFILE (hack),
APP_NAME (cnrl-acquisition-explorer).
"""
import argparse
import os
import sys
import uuid
from pathlib import Path

import psycopg
from databricks.sdk import WorkspaceClient

sys.path.insert(0, str(Path(__file__).parent))
from sql import query  # noqa: E402

CATALOG = os.environ.get("ACQ_CATALOG", "shm_hack")
INSTANCE = os.environ.get("LAKEBASE_INSTANCE", "cnrl-acq")
DATABASE = os.environ.get("LAKEBASE_DB", "acq")
PROFILE = os.environ.get("DATABRICKS_CONFIG_PROFILE", "hack")
APP_NAME = os.environ.get("APP_NAME", "cnrl-acquisition-explorer")

# table -> (UC schema, primary key, columns to copy; None = all)
TABLES = {
    "facility_summary": ("acq", ["facility_id"], None),
    "operator_metrics": ("acq", ["operator_baid"], None),
    "cnrl_footprint": ("acq", ["facility_id"], None),
    "deal_precedents": ("acq", ["seller_baid"], None),
    "assumptions": ("acq", ["key"], None),
    # Wells per facility for the details panel (and to hand well IDs to Genie).
    "wells": ("petrinex", ["well_id"], [
        "well_id", "facility_id", "operator_baid", "operator_name", "field_display_name", "formation",
        "active_months", "total_oil_m3", "total_gas_e3m3", "total_condensate_m3", "total_water_m3",
        "first_production_month", "last_production_month",
    ]),
}
INDEXES = [
    "CREATE INDEX ON facility_summary (is_cnrl)",
    "CREATE INDEX ON facility_summary (lat, lon)",
    "CREATE INDEX ON facility_summary (operator_baid)",
    "CREATE INDEX ON wells (facility_id)",
]
PG_TYPES = {"STRING": "text", "DOUBLE": "double precision", "FLOAT": "real", "BIGINT": "bigint",
            "INT": "integer", "BOOLEAN": "boolean", "DATE": "date"}


def pg_type(uc_type):
    uc_type = uc_type.upper()
    return "numeric" if uc_type.startswith("DECIMAL") else PG_TYPES.get(uc_type, "text")


def connect(dbname):
    w = WorkspaceClient(profile=PROFILE)
    inst = w.database.get_database_instance(INSTANCE)
    token = w.database.generate_database_credential(request_id=str(uuid.uuid4()), instance_names=[INSTANCE]).token
    return psycopg.connect(host=inst.read_write_dns, dbname=dbname, user=w.current_user.me().user_name,
                           password=token, sslmode="require", autocommit=True)


def grant_app(conn):
    """Give the deployed app's service principal read access to every table in the database."""
    try:
        role = WorkspaceClient(profile=PROFILE).apps.get(APP_NAME).service_principal_client_id
    except Exception as e:  # app not deployed yet
        print(f"skipping grant: app {APP_NAME} not found ({type(e).__name__})")
        return
    conn.execute(f'GRANT USAGE ON SCHEMA public TO "{role}"')
    conn.execute(f'GRANT SELECT ON ALL TABLES IN SCHEMA public TO "{role}"')
    print(f"granted SELECT on all tables to app {APP_NAME} ({role})")


def load():
    with connect("databricks_postgres") as conn:
        if not conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (DATABASE,)).fetchone():
            conn.execute(f'CREATE DATABASE "{DATABASE}"')
            print(f"created database {DATABASE}")

    with connect(DATABASE) as conn:
        for table, (schema, pk, keep) in TABLES.items():
            _, cols = query(f"""SELECT column_name, data_type FROM {CATALOG}.information_schema.columns
                               WHERE table_schema = '{schema}' AND table_name = '{table}' ORDER BY ordinal_position""")
            cols = [(c, t) for c, t in cols if (keep is None and c != "_rescued_data") or (keep and c in keep)]
            names, rows = query(f"SELECT {', '.join(c for c, _ in cols)} FROM {CATALOG}.{schema}.{table}")
            ddl = ", ".join(f'"{c}" {pg_type(t)}' for c, t in cols)
            conn.execute(f'DROP TABLE IF EXISTS "{table}"')
            conn.execute(f'CREATE TABLE "{table}" ({ddl}, PRIMARY KEY ({", ".join(pk)}))')
            with conn.cursor().copy(f'COPY "{table}" ({", ".join(chr(34) + n + chr(34) for n in names)}) FROM STDIN') as cp:
                for row in rows:
                    cp.write_row(row)
            n = conn.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]
            print(f"{table}: {n} rows (UC {len(rows)})")
        for ddl in INDEXES:
            conn.execute(ddl)
        conn.execute("ANALYZE")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--grant-only", action="store_true", help="skip loading; only grant the app read access")
    if not ap.parse_args().grant_only:
        load()
    with connect(DATABASE) as conn:
        grant_app(conn)
