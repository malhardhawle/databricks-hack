"""Backend endpoint tests with Lakebase stubbed out (no network)."""
import sys
import types

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from test_scoring import candidate, precedent

# main imports db, which opens a Lakebase pool at import time; replace it before importing.
sys.modules["db"] = types.SimpleNamespace(query=lambda *a, **k: pytest.fail("unexpected Lakebase query"))
import main  # noqa: E402
import queries  # noqa: E402

ASSUMPTIONS = {
    "discount_rate": "0.15", "roce_hurdle": "0.15", "price_per_flowing_boe": "45000",
    "price_per_flowing_boe_low": "35000", "price_per_flowing_boe_high": "55000", "price_basis": "flat",
    "price_per_flowing_boe_gas": "15000", "price_per_flowing_boe_liquids": "50000", "npv_years": "10",
    "tax_rate": "0.23", "royalty_rate": "0.15", "opex_gas_per_boe": "8", "opex_light_per_boe": "14",
    "opex_heavy_per_boe": "18", "light_oil_diff_usd": "5", "cond_pct_wti": "1.0", "ngl_pct_wti": "0.5",
    "liq_tariff_per_m3_km": "0.12", "gas_tariff_per_e3m3_km": "0.10", "min_decline": "0.05",
    "max_decline": "0.35", "decline_source": "precedent", "min_candidate_boe_d": "1000",
    "exclude_baids": "A5D4", "material_deal_boe_d": "5000", "weight_accretion": "0.60",
    "weight_proximity": "0.25", "weight_precedent_fit": "0.15", "lasso_radius_km": "25",
    "wti_usd_bbl": "69.78", "wcs_usd_bbl": "56.33", "aeco_cad_gj": "2.117", "fx_usd_cad": "1.3933",
    "gas_gj_per_e3m3": "34.6",
}


@pytest.fixture
def client(monkeypatch):
    om = pd.DataFrame([candidate(operator_baid=f"A00{i}", operator_name=f"Op {i}", boe_d=2000.0 * i,
                                 oil_bbl_d=2000.0 * i, producing_facilities=i) for i in range(1, 5)]
                      + [candidate(operator_baid="A5D4", boe_d=90000.0, oil_bbl_d=90000.0, producing_facilities=9)])
    prec = pd.DataFrame([precedent(seller_baid="S1", seller_name="Big gas"),
                         precedent(seller_baid="S2", seller_name="Oil", pre_boe_d=20000, gas_share=0.2)])
    a = pd.DataFrame({"key": list(ASSUMPTIONS), "value": list(ASSUMPTIONS.values()), "unit": "", "category": "",
                      "source": "assumption", "description": ""})
    main._cache.clear()
    monkeypatch.setattr(queries, "operator_metrics", lambda: om)
    monkeypatch.setattr(queries, "deal_precedents", lambda: prec)
    monkeypatch.setattr(queries, "assumptions", lambda: a)
    return TestClient(main.app)


def test_rank_defaults(client):
    body = client.post("/api/rank", json={}).json()
    baids = [c["operator_baid"] for c in body["candidates"]]
    assert "A5D4" not in baids  # excluded
    assert [c["rank"] for c in body["candidates"]] == list(range(1, len(baids) + 1))
    assert len(body["top3"]["candidates"]) == 3
    assert {s["case"] for s in body["top3"]["sensitivity"]} == {
        "multiple_low", "base", "multiple_high", "oil_minus_20pct", "oil_plus_20pct"}
    assert [b["seller_name"] for b in body["backtest"]] == ["Big gas", "Oil"]


def test_rank_overrides_change_result(client):
    base = client.post("/api/rank", json={}).json()
    cheap = client.post("/api/rank", json={"overrides": {"price_per_flowing_boe": "1000"}}).json()
    assert cheap["candidates"][0]["accretion"] > base["candidates"][0]["accretion"]
    small = client.post("/api/rank", json={"overrides": {"min_candidate_boe_d": 7000}}).json()
    assert [c["operator_baid"] for c in small["candidates"]] == ["A004"]


def test_rank_rejects_unknown_assumption(client):
    assert client.post("/api/rank", json={"overrides": {"nope": 1}}).status_code == 400


def test_sensitivity_moves_the_right_way(client):
    sens = {s["case"]: s for s in client.post("/api/rank", json={}).json()["top3"]["sensitivity"]}
    for baid in [k for k in sens["base"] if k != "case"]:
        assert sens["multiple_low"][baid] > sens["base"][baid] > sens["multiple_high"][baid]
        assert sens["oil_plus_20pct"][baid] > sens["base"][baid] > sens["oil_minus_20pct"][baid]


def test_nearby_rolls_up_by_operator(client, monkeypatch):
    rows = pd.DataFrame([
        {"facility_id": "F1", "operator_baid": "A001", "operator_name": "Op 1", "km": 2.0, "oil_bbl_d": 10.0,
         "gas_mmcf_d": 1.0, "cond_bbl_d": 0.0, "ngl_bbl_d": 5.0, "boe_d": 176.7},
        {"facility_id": "F2", "operator_baid": "A001", "operator_name": "Op 1", "km": 4.0, "oil_bbl_d": 20.0,
         "gas_mmcf_d": 0.0, "cond_bbl_d": 0.0, "ngl_bbl_d": 0.0, "boe_d": 20.0},
    ])
    seen = {}

    def fake_nearby(*args):
        seen["args"] = args
        return rows

    monkeypatch.setattr(queries, "nearby", fake_nearby)
    body = client.post("/api/nearby", json={"cnrl_ids": ["C1"], "radius_km": 10, "window": "last3"}).json()
    assert seen["args"] == (["C1"], 10.0, "radius", 5, "last3")
    assert body["operators"] == [{"operator_baid": "A001", "operator_name": "Op 1", "facilities": 2, "oil_bbl_d": 30.0,
                                  "gas_mmcf_d": 1.0, "cond_bbl_d": 0.0, "ngl_bbl_d": 5.0, "boe_d": 196.7, "mean_km": 3.0}]


def test_facility_details(client, monkeypatch):
    row = pd.Series({"facility_id": "F1", "facility_name": "Pad 1", "boe_d": 12.5, "nearest_cnrl_km": None})
    monkeypatch.setattr(queries, "facility", lambda fid: row if fid == "F1" else None)
    assert client.get("/api/facility/F1").json() == {"facility_id": "F1", "facility_name": "Pad 1", "boe_d": 12.5,
                                                    "nearest_cnrl_km": None}
    assert client.get("/api/facility/NOPE").status_code == 404


def test_facility_wells(client, monkeypatch):
    rows = pd.DataFrame([{"well_id": "ABWI1", "total_gas_e3m3": 10.0}])
    monkeypatch.setattr(queries, "wells_at", lambda fid: rows if fid == "F1" else rows.iloc[0:0])
    assert client.get("/api/facility/F1/wells").json() == [{"well_id": "ABWI1", "total_gas_e3m3": 10.0}]
    assert client.get("/api/facility/F2/wells").json() == []


def test_genie_ask_passes_context(client, monkeypatch):
    seen = {}

    def fake_ask(question, conversation_id, ctx):
        seen.update(question=question, conversation_id=conversation_id, ctx=ctx)
        return {"text": "ok", "sent": main.genie.compose(question, ctx)}

    monkeypatch.setattr(main.genie, "SPACE_ID", "space1")
    monkeypatch.setattr(main.genie, "ask", fake_ask)
    body = client.post("/api/genie/ask", json={
        "question": "Who is nearby?", "conversation_id": "c1",
        "context": {"cnrl_facility_ids": ["ABGP1"], "well_ids": ["ABWI1"],
                    "focused_facility": {"id": "ABBT1", "name": "Pad"}},
    }).json()
    assert seen["conversation_id"] == "c1"
    assert seen["ctx"].cnrl_facility_ids == ["ABGP1"]
    assert body["sent"].startswith("Map context")
    assert body["sent"].endswith("Question: Who is nearby?")


def test_genie_ask_without_space(client, monkeypatch):
    monkeypatch.setattr(main.genie, "SPACE_ID", None)
    assert client.post("/api/genie/ask", json={"question": "hi"}).status_code == 503


@pytest.mark.parametrize("payload", [
    {"cnrl_ids": []},
    {"cnrl_ids": ["C1"], "window": "2024"},
    {"cnrl_ids": ["C1"], "mode": "everything"},
    {"cnrl_ids": ["C1"], "radius_km": 0},
])
def test_nearby_validates_input(client, payload):
    assert client.post("/api/nearby", json=payload).status_code == 422
