"""Data checks against the SQL warehouse (read-only dry runs). Opt in: RUN_DATABRICKS_TESTS=1 pytest -m databricks"""
import pytest

import run_pipeline as rp
from sql import query

pytestmark = pytest.mark.databricks
SRC = f"{rp.CATALOG}.petrinex"


def dry(q):
    cols, rows = query(rp.dry_run_sql(q))
    return [dict(zip(cols, r)) for r in rows]


def test_one_operator_per_facility_month():
    _, rows = query(f"""SELECT count(*) FROM (SELECT ReportingFacilityID, ProductionMonth FROM {SRC}.volumetrics
                       GROUP BY 1, 2 HAVING count(DISTINCT OperatorBAID) > 1)""")
    assert rows[0][0] == "0"


def test_footprint_reproduces_cnrl_deals():
    rows = dry("SELECT seller_baid, min(deal_month) m, count(*) n FROM {acq}.cnrl_footprint "
               "WHERE is_acquired GROUP BY 1")
    deals = {r["seller_baid"]: (r["m"], int(r["n"])) for r in rows}
    assert deals["A7NW"] == ("2025-07", 653)  # Torxen
    assert deals["0045"] == ("2024-12", 64)   # Chevron
    assert deals["A8FG"] == ("2025-07", 15)   # Strathcona
    assert "0YK4" not in deals                # Surge's facility went via Archer, so Archer is the seller


def test_facility_summary_reconciles_to_volumetrics():
    summary = dry("SELECT count(*) n, count(DISTINCT facility_id) d, count_if(lat IS NULL OR lon IS NULL) no_loc, "
                  "sum(oil_bbl_d) oil FROM {acq}.facility_summary")[0]
    _, rows = query(f"""SELECT sum(try_cast(Volume AS DOUBLE)) * 6.2898 / 365 FROM {SRC}.volumetrics
                       WHERE ActivityID = 'PROD' AND ProductID = 'OIL' AND ProductionMonth LIKE '2025-%'""")
    assert summary["n"] == summary["d"]
    assert summary["no_loc"] == "0"
    assert float(summary["oil"]) == pytest.approx(float(rows[0][0]), rel=1e-6)


def test_cnrl_facility_count_by_current_operator():
    rows = dry("SELECT count(*) n FROM {acq}.cnrl_footprint")
    assert int(rows[0]["n"]) == 4698


def test_material_precedents_present():
    rows = dry("SELECT seller_baid, pre_boe_d FROM {acq}.deal_precedents")
    big = {r["seller_baid"] for r in rows if float(r["pre_boe_d"] or 0) >= 5000}
    assert big == {"A7NW", "0045", "A8FG"}


def test_assumption_keys_unique():
    rows = dry("SELECT count(*) n, count(DISTINCT key) k FROM {acq}.assumptions")
    assert rows[0]["n"] == rows[0]["k"]
