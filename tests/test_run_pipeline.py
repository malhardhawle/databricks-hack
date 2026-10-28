import pytest

import run_pipeline as rp

TABLES = ["facility_month", "facility_current", "cnrl_footprint", "facility_summary",
          "deal_precedents", "operator_metrics", "assumptions"]


def test_statements_in_dependency_order():
    assert [name for name, _ in rp.statements()] == TABLES


def test_every_upstream_reference_is_defined_earlier():
    defined = []
    for name, body in rp.statements():
        for other in TABLES:
            if f"{{acq}}.{other}" in body:
                assert other in defined, f"{name} uses {other} before it is built"
        defined.append(name)


def test_fill_uses_catalog(monkeypatch):
    monkeypatch.setattr(rp, "CATALOG", "sbx_petrinex_app")
    assert rp.fill("{src}.wells / {acq}.x", "sbx_petrinex_app.acq") == "sbx_petrinex_app.petrinex.wells / sbx_petrinex_app.acq.x"


def test_dry_run_sql_is_a_single_read_only_statement():
    sql = rp.dry_run_sql("SELECT count(*) FROM {acq}.cnrl_footprint")
    assert sql.startswith("WITH facility_month AS (")
    assert sql.rstrip().endswith("SELECT count(*) FROM cnrl_footprint")
    assert "{acq}" not in sql
    assert "{src}" not in sql
    assert "_acq." not in sql
    assert "CREATE" not in sql.upper().replace("CREATE OR REPLACE", "")  # no DDL survives
    for name in TABLES:
        assert f"{name} AS (" in sql


def test_rejects_non_create_statements(tmp_path, monkeypatch):
    (tmp_path / "01_bad.sql").write_text("DROP TABLE {acq}.x;\n")
    monkeypatch.setattr(rp, "PIPELINES", tmp_path)
    with pytest.raises(ValueError):
        rp.statements()
