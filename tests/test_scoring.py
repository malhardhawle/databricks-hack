import math
import re
from pathlib import Path

import pandas as pd
import pytest

import scoring as sc

ASSUMPTIONS_SQL = Path(__file__).resolve().parent.parent / "pipelines" / "06_assumptions.sql"


@pytest.fixture
def a():
    """Round-number assumptions so expected values can be worked by hand."""
    return {
        "wti_usd_bbl": 70.0, "wcs_usd_bbl": 56.0, "fx_usd_cad": 1.4, "light_oil_diff_usd": 5.0,
        "cond_pct_wti": 1.0, "ngl_pct_wti": 0.5, "aeco_cad_gj": 2.0, "gas_gj_per_e3m3": sc.MCF_PER_E3M3,
        "royalty_rate": 0.10, "opex_gas_per_boe": 10.0, "opex_light_per_boe": 10.0, "opex_heavy_per_boe": 10.0,
        "tax_rate": 0.20, "liq_tariff_per_m3_km": 0.1, "gas_tariff_per_e3m3_km": 0.1,
        "discount_rate": 0.15, "npv_years": 1, "min_decline": 0.0, "max_decline": 1.0,
        "decline_source": "precedent", "price_basis": "flat", "price_per_flowing_boe": 10000.0,
        "price_per_flowing_boe_gas": 5000.0, "price_per_flowing_boe_liquids": 20000.0,
        "roce_hurdle": 0.15, "min_candidate_boe_d": 1000.0, "exclude_baids": ["XBIG"],
        "material_deal_boe_d": 5000.0,
        "weight_accretion": 0.6, "weight_proximity": 0.25, "weight_precedent_fit": 0.15,
    }


def candidate(**kw):
    row = {
        "operator_baid": "A001", "operator_name": "Test Co", "oil_bbl_d": 100.0, "gas_mmcf_d": 0.0,
        "cond_bbl_d": 0.0, "ngl_bbl_d": 0.0, "boe_d": 100.0, "gas_share": 0.0, "heavy_oil_share": 0.0,
        "mean_km_to_cnrl": 5.0, "median_km_to_cnrl": 5.0, "share_within_10km": 1.0, "share_within_25km": 1.0,
        "share_within_50km": 1.0, "liq_m3km_saved": 1000.0, "gas_e3m3km_saved": 0.0, "fitted_annual_decline": 0.2,
    }
    row.update(kw)
    return row


def precedent(**kw):
    row = {
        "seller_baid": "S001", "seller_name": "Seller", "deal_month": "2025-07", "pre_oil_bbl_d": 0.0,
        "pre_gas_mmcf_d": 60.0, "pre_cond_bbl_d": 0.0, "pre_ngl_bbl_d": 0.0, "pre_boe_d": 10000.0,
        "gas_share": 1.0, "pre_annual_decline": 0.1, "post_retention": 0.9, "median_km_to_legacy": 5.0,
        "share_within_10km": 1.0, "share_within_25km": 1.0, "share_within_50km": 1.0,
    }
    row.update(kw)
    return row


BASELINE = {"boe_d": 100.0, "gas_share": 0.0, "median_km": 5.0, "share_within_25km": 1.0,
            "decline": 0.0, "retention": 1.0}


# --- prices & valuation ------------------------------------------------------------------------

def test_unit_prices(a):
    p = sc.unit_prices(a)
    assert p["light_oil"] == pytest.approx(65 * 1.4)
    assert p["heavy_oil"] == pytest.approx(56 * 1.4)
    assert p["cond"] == pytest.approx(70 * 1.4)
    assert p["ngl"] == pytest.approx(35 * 1.4)
    assert p["gas_mmcf"] == pytest.approx(2000.0)  # 2 $/GJ x 35.3147 GJ/e3m3 = $2 per Mcf


def test_annuity_factor():
    assert sc.annuity_factor(0.15, 0.0, 10) == pytest.approx(5.018769, rel=1e-6)
    assert sc.annuity_factor(0.15, 0.1, 2) == pytest.approx(1 / 1.15 + 0.9 / 1.15 ** 2)


def test_value_matches_hand_calculation(a):
    out = sc.value(pd.DataFrame([candidate()]), a, BASELINE).iloc[0]
    revenue = 365 * 100 * 91.0
    nopat = (revenue - 0.1 * revenue - 365 * 100 * 10) * 0.8
    synergies = 1000 * 0.1 * 0.8
    assert out["revenue"] == pytest.approx(revenue)
    assert out["nopat"] == pytest.approx(nopat)
    assert out["synergies"] == pytest.approx(synergies)
    assert out["npv"] == pytest.approx((nopat + synergies) / 1.15)
    assert out["price_paid"] == pytest.approx(1_000_000)
    assert out["roce"] == pytest.approx((nopat + synergies) / 1_000_000)
    assert out["accretion"] == pytest.approx(out["npv"] - 1_000_000)
    assert bool(out["accretive"])


def test_heavy_oil_priced_at_wcs(a):
    light = sc.value(pd.DataFrame([candidate(heavy_oil_share=0.0)]), a, BASELINE).iloc[0]
    heavy = sc.value(pd.DataFrame([candidate(heavy_oil_share=1.0)]), a, BASELINE).iloc[0]
    assert heavy["revenue"] == pytest.approx(365 * 100 * 56 * 1.4)
    assert heavy["revenue"] < light["revenue"]


def test_ngl_adds_revenue_but_not_price_paid(a):
    base = sc.value(pd.DataFrame([candidate()]), a, BASELINE).iloc[0]
    ngl = sc.value(pd.DataFrame([candidate(ngl_bbl_d=50.0)]), a, BASELINE).iloc[0]
    assert ngl["revenue"] - base["revenue"] == pytest.approx(365 * 50 * 49.0)
    assert ngl["price_paid"] == base["price_paid"]


def test_not_accretive_when_overpaying(a):
    a["price_per_flowing_boe"] = 1e9
    out = sc.value(pd.DataFrame([candidate()]), a, BASELINE).iloc[0]
    assert out["accretion"] < 0
    assert not bool(out["accretive"])


def test_retention_haircut_scales_nopat_not_synergies(a):
    full = sc.value(pd.DataFrame([candidate()]), a, BASELINE).iloc[0]
    cut = sc.value(pd.DataFrame([candidate()]), a, {**BASELINE, "retention": 0.5}).iloc[0]
    assert cut["cash_flow_y1"] == pytest.approx(full["nopat"] * 0.5 + full["synergies"])


def test_decline_source_fitted_uses_operator_fit_clamped(a):
    a.update(min_decline=0.05, max_decline=0.35)
    df = pd.DataFrame([candidate(fitted_annual_decline=0.2), candidate(fitted_annual_decline=0.9),
                       candidate(fitted_annual_decline=-0.5)])
    out = sc.value(df, a, BASELINE, decline_source="fitted")
    assert list(out["decline"]) == pytest.approx([0.2, 0.35, 0.05])
    assert set(sc.value(df, a, BASELINE)["decline"]) == {BASELINE["decline"]}


def test_price_basis_mix(a):
    a["price_basis"] = "mix"
    row = candidate(oil_bbl_d=400.0, gas_mmcf_d=3.6, boe_d=1000.0)  # 600 gas boe + 400 liquids boe
    out = sc.value(pd.DataFrame([row]), a, BASELINE).iloc[0]
    assert out["price_paid"] == pytest.approx(600 * 5000 + 400 * 20000)


# --- baseline, proximity, fit -----------------------------------------------------------------

def test_precedent_baseline_weights_material_deals_only(a):
    prec = pd.DataFrame([
        precedent(seller_name="Big", pre_boe_d=30000, gas_share=1.0, post_retention=0.9),
        precedent(seller_name="Mid", pre_boe_d=10000, gas_share=0.0, post_retention=0.5),
        precedent(seller_name="Tiny", pre_boe_d=500, gas_share=0.5, post_retention=0.1),
    ])
    b = sc.precedent_baseline(prec, a)
    assert b["deals"] == ["Big", "Mid"]
    assert b["gas_share"] == pytest.approx(0.75)
    assert b["boe_d"] == pytest.approx((30000 ** 2 + 10000 ** 2) / 40000)
    assert b["retention"] == pytest.approx(0.8)


def test_precedent_baseline_falls_back_and_clamps(a):
    a.update(min_decline=0.05, max_decline=0.35)
    prec = pd.DataFrame([precedent(pre_boe_d=100, pre_annual_decline=-0.6, post_retention=1.4)])
    b = sc.precedent_baseline(prec, a)
    assert len(b["deals"]) == 1
    assert b["raw_decline"] == pytest.approx(-0.6)
    assert b["decline"] == 0.05
    assert b["retention"] == 1.0


def test_proximity_score_bounds():
    near = pd.DataFrame([candidate(mean_km_to_cnrl=0.0)])
    far = pd.DataFrame([candidate(mean_km_to_cnrl=80.0, share_within_10km=0.0, share_within_25km=0.0,
                                  share_within_50km=0.0)])
    assert sc.proximity_score(near).iloc[0] == pytest.approx(1.0)
    assert sc.proximity_score(far).iloc[0] == pytest.approx(0.0)


def test_precedent_fit_identical_is_one_and_drops_with_distance():
    same = sc.precedent_fit(pd.DataFrame([candidate()]), BASELINE).iloc[0]
    other = sc.precedent_fit(pd.DataFrame([candidate(boe_d=10000.0, gas_share=1.0)]), BASELINE).iloc[0]
    assert same == pytest.approx(1.0)
    assert other == pytest.approx(0.5)  # size and gas terms both maxed out


# --- universe, ranking, back-test ---------------------------------------------------------------

def operators():
    # A001 and A002 have identical per-boe economics (no synergies); only proximity differs.
    return pd.DataFrame([
        candidate(operator_baid="A001", boe_d=5000.0, oil_bbl_d=5000.0, liq_m3km_saved=0.0),
        candidate(operator_baid="A002", boe_d=2000.0, oil_bbl_d=2000.0, liq_m3km_saved=0.0, mean_km_to_cnrl=40.0,
                  share_within_10km=0.0, share_within_25km=0.2),
        candidate(operator_baid="XBIG", boe_d=90000.0, oil_bbl_d=90000.0),
        candidate(operator_baid=sc.CNRL_BAID, boe_d=90000.0, oil_bbl_d=90000.0),
        candidate(operator_baid="A003", boe_d=500.0, oil_bbl_d=500.0),
    ])


def test_universe_filters_size_exclusions_and_cnrl(a):
    assert set(sc.universe(operators(), a)["operator_baid"]) == {"A001", "A002"}


def test_score_sorted_and_ranked(a):
    ranked = sc.score(sc.universe(operators(), a), a, BASELINE)
    assert list(ranked["rank"]) == [1, 2]
    assert ranked["final_score"].is_monotonic_decreasing
    assert ranked["final_score"].between(0, 1).all()
    assert ranked.iloc[0]["operator_baid"] == "A001"  # same economics, closer to CNRL


def test_backtest_is_leave_one_out(a, monkeypatch):
    prec = pd.DataFrame([precedent(seller_baid="S1", seller_name="One"),
                         precedent(seller_baid="S2", seller_name="Two", pre_boe_d=20000),
                         precedent(seller_baid="S3", seller_name="Small", pre_boe_d=100)])
    seen = []
    real = sc.precedent_baseline

    def spy(p, a_):
        seen.append(set(p["seller_baid"]))
        return real(p, a_)

    monkeypatch.setattr(sc, "precedent_baseline", spy)
    bt = sc.backtest(operators(), prec, a)
    assert list(bt["seller_name"]) == ["One", "Two"]  # only material deals are back-tested
    assert seen == [{"S2", "S3"}, {"S1", "S3"}]
    assert (bt["of"] == 3).all()  # 2 candidates + the seller
    assert bt["rank"].between(1, 3).all()


# --- parsing ----------------------------------------------------------------------------------

def test_parse_assumptions_types():
    a = sc.parse_assumptions(pd.DataFrame({"key": ["discount_rate", "decline_source", "exclude_baids"],
                                           "value": ["0.15", "precedent", "A5D4, 0054"]}))
    assert a == {"discount_rate": 0.15, "decline_source": "precedent", "exclude_baids": ["A5D4", "0054"]}


def test_numeric_keeps_ids_as_text():
    df = sc.numeric(pd.DataFrame({"operator_baid": ["0007"], "deal_month": ["2025-07"], "boe_d": ["12.5"]}))
    assert df["operator_baid"][0] == "0007"
    assert df["deal_month"][0] == "2025-07"
    assert df["boe_d"][0] == 12.5


def test_assumptions_sql_defines_every_key_scoring_reads(a):
    sql = ASSUMPTIONS_SQL.read_text()
    defined = set(re.findall(r"\(\s*'(\w+)',", sql)) | set(re.findall(r"SELECT '(\w+)',", sql))
    assert set(a) <= defined, f"missing in 06_assumptions.sql: {sorted(set(a) - defined)}"
    assert len(re.findall(r"\(\s*'(\w+)',", sql)) == len(set(re.findall(r"\(\s*'(\w+)',", sql))), "duplicate keys"
    assert math.isclose(0.60 + 0.25 + 0.15, 1.0)
