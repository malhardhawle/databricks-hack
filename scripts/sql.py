"""Run SQL against the hack workspace via the Databricks CLI (profile `hack`).

Usage:
    echo "SELECT 1" | python scripts/sql.py
    python scripts/sql.py < queries.sql        # separate statements with ';;'

Env overrides: DBX_PROFILE (default hack), DBX_WAREHOUSE (default dataloader-dogfood).
"""
import json
import os
import subprocess
import sys
import time

PROFILE = os.environ.get("DBX_PROFILE", "hack")
WAREHOUSE = os.environ.get("DBX_WAREHOUSE", "42b00ac711df45f6")
MAX_COL = 40


def api(method, path, body=None):
    cmd = ["databricks", "-p", PROFILE, "api", method, path]
    if body is not None:
        cmd += ["--json", json.dumps(body)]
    return json.loads(subprocess.run(cmd, capture_output=True, text=True).stdout)


def run(sql):
    r = api("post", "/api/2.0/sql/statements", {
        "warehouse_id": WAREHOUSE, "statement": sql, "wait_timeout": "50s",
        "on_wait_timeout": "CONTINUE", "format": "JSON_ARRAY", "disposition": "INLINE",
    })
    while r["status"]["state"] in ("PENDING", "RUNNING"):
        time.sleep(3)
        r = api("get", f"/api/2.0/sql/statements/{r['statement_id']}")
    if r["status"]["state"] != "SUCCEEDED":
        print("ERROR:", r["status"])
        return
    cols = [c["name"] for c in r["manifest"]["schema"]["columns"]]
    rows = r.get("result", {}).get("data_array") or []
    widths = [min(MAX_COL, max([len(c)] + [len(str(row[i])) for row in rows])) for i, c in enumerate(cols)]
    print(" | ".join(c.ljust(w) for c, w in zip(cols, widths)))
    print("-+-".join("-" * w for w in widths))
    for row in rows:
        print(" | ".join(str(v)[:MAX_COL].ljust(w) for v, w in zip(row, widths)))


if __name__ == "__main__":
    for stmt in sys.stdin.read().split(";;"):
        if stmt.strip():
            print(f"\n### {stmt.strip()[:120]}")
            run(stmt.strip())
