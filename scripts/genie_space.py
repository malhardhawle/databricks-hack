"""Create or update the Genie space defined in genie/spec.py.

    python scripts/genie_space.py --validate   # run every example + benchmark SQL on the warehouse (read-only)
    python scripts/genie_space.py --print      # print the serialized space JSON
    python scripts/genie_space.py              # create the space (or update it if app/genie_space.json has an id)

The space id is written to app/genie_space.json so the backend (and the deployed app) can find it.
Env: DATABRICKS_CONFIG_PROFILE (hack), DBX_WAREHOUSE (warehouse for the space and validation).
"""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ROOT / "scripts"), str(ROOT / "genie")]
import spec  # noqa: E402
from sql import WAREHOUSE, query  # noqa: E402

PROFILE = os.environ.get("DATABRICKS_CONFIG_PROFILE", "hack")
ID_FILE = ROOT / "app" / "genie_space.json"


def sid(*parts):
    """Stable 32-hex id so re-publishing updates items instead of duplicating them."""
    return hashlib.md5(":".join(map(str, parts)).encode()).hexdigest()


def lines(text):
    return text.strip("\n").splitlines(keepends=True)


def by_id(items):
    return sorted(items, key=lambda x: x["id"])


def serialized_space():
    snippets = lambda kind, items: by_id([  # noqa: E731
        {"id": sid(kind, s["display_name"]), "display_name": s["display_name"], "sql": [s["sql"]],
         "instruction": [s["instruction"]], **({"alias": s["alias"]} if "alias" in s else {})}
        for s in items
    ])
    return {
        "version": 2,
        "config": {"sample_questions": by_id([{"id": sid("sample", q), "question": [q]} for q in spec.SAMPLE_QUESTIONS])},
        "data_sources": {"tables": sorted([
            {"identifier": t, **({"column_configs": [{"column_name": c, "enable_entity_matching": True}
                                                     for c in sorted(spec.ENTITY_COLUMNS[t])]}
                                 if t in spec.ENTITY_COLUMNS else {})}
            for t in spec.TABLES
        ], key=lambda t: t["identifier"])},
        "instructions": {
            "text_instructions": [{"id": sid("text", 1), "content": lines(spec.TEXT_INSTRUCTIONS)}],
            "example_question_sqls": by_id([{"id": sid("example", q), "question": [q], "sql": lines(s)}
                                            for q, s in spec.EXAMPLES]),
            "sql_snippets": {"filters": snippets("filter", spec.FILTERS), "measures": snippets("measure", spec.MEASURES)},
        },
        "benchmarks": {"questions": by_id([
            {"id": sid("bench", q), "question": [q], "answer": [{"format": "SQL", "content": lines(s)}]}
            for q, s in spec.BENCHMARKS
        ])},
    }


def validate():
    ok = True
    for kind, items in (("example", spec.EXAMPLES), ("benchmark", spec.BENCHMARKS)):
        for q, s in items:
            try:
                cols, rows = query(s)
                print(f"ok   {kind}: {q[:70]} -> {len(rows)} rows")
            except RuntimeError as e:
                ok = False
                print(f"FAIL {kind}: {q[:70]}\n     {e}")
    return ok


def publish():
    from databricks.sdk import WorkspaceClient
    w = WorkspaceClient(profile=PROFILE)
    body = {"title": spec.TITLE, "description": spec.DESCRIPTION, "warehouse_id": WAREHOUSE,
            "serialized_space": json.dumps(serialized_space())}
    existing = json.loads(ID_FILE.read_text())["space_id"] if ID_FILE.exists() else None
    if existing:
        w.api_client.do("PATCH", f"/api/2.0/genie/spaces/{existing}", body=body)
        space_id = existing
        print(f"updated Genie space {space_id}")
    else:
        space_id = w.api_client.do("POST", "/api/2.0/genie/spaces", body=body)["space_id"]
        print(f"created Genie space {space_id}")
    ID_FILE.write_text(json.dumps({"space_id": space_id, "title": spec.TITLE,
                                   "sample_questions": spec.SAMPLE_QUESTIONS}, indent=2) + "\n")
    print(f"open: {w.config.host.rstrip('/')}/genie/rooms/{space_id}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--validate", action="store_true")
    ap.add_argument("--print", action="store_true")
    a = ap.parse_args()
    if a.validate:
        sys.exit(0 if validate() else 1)
    elif a.print:
        print(json.dumps(serialized_space(), indent=2))
    else:
        publish()
