"""Acquisition scoring: valuation (NPV, ROCE), proximity, precedent fit, final rank and back-test.

Inputs are the gold tables from pipelines/ as DataFrames:
  operator_metrics  one row per non-CNRL operator (2025 rates, proximity, transport-savings basis)
  deal_precedents   one row per historical seller to CNRL (pre-deal profile)
  assumptions       key/value rows (all values are strings in the table)

Money is CAD. boe = oil + cond + raw gas / 6 (NGLs sit inside raw gas, so they add revenue but not boe).
"""
import math

import numpy as np
import pandas as pd

CNRL_BAID = "0HE9"
MCF_PER_E3M3 = 35.3147


def parse_assumptions(rows):
    """{key: value} from the assumptions table; numbers become floats, exclude_baids a list."""
    out = {}
    for key, value in (rows.items() if isinstance(rows, dict) else zip(rows["key"], rows["value"])):
        if key == "exclude_baids":
            out[key] = [b.strip() for b in str(value).split(",") if b.strip()]
            continue
        try:
            out[key] = float(value)
        except (TypeError, ValueError):
            out[key] = value
    return out


def unit_prices(a):
    """Realised CAD prices per unit: oil/cond/NGL per bbl, gas per MMcf."""
    fx = a["fx_usd_cad"]
    return {
        "light_oil": (a["wti_usd_bbl"] - a["light_oil_diff_usd"]) * fx,
        "heavy_oil": a["wcs_usd_bbl"] * fx,
        "cond": a["wti_usd_bbl"] * fx * a["cond_pct_wti"],
        "ngl": a["wti_usd_bbl"] * fx * a["ngl_pct_wti"],
        "gas_mmcf": a["aeco_cad_gj"] * a["gas_gj_per_e3m3"] / MCF_PER_E3M3 * 1000,
    }


def _clamp(x, lo, hi):
    return min(max(x, lo), hi)


def precedent_baseline(prec, a):
    """Size-weighted profile of CNRL's material deals (falls back to all deals if none are material)."""
    prec = prec.dropna(subset=["pre_boe_d"])
    material = prec[prec["pre_boe_d"] >= a["material_deal_boe_d"]]
    deals = material if len(material) else prec
    w = deals["pre_boe_d"]

    def wmean(col):
        vals = deals[col]
        ok = vals.notna()
        return float((vals[ok] * w[ok]).sum() / w[ok].sum()) if ok.any() else float("nan")

    raw_decline = wmean("pre_annual_decline")
    return {
        "deals": list(deals["seller_name"]),
        "boe_d": wmean("pre_boe_d"),
        "gas_share": wmean("gas_share"),
        "median_km": wmean("median_km_to_legacy"),
        "share_within_25km": wmean("share_within_25km"),
        "raw_decline": raw_decline,
        "decline": _clamp(raw_decline, a["min_decline"], a["max_decline"]),
        "retention": _clamp(wmean("post_retention"), 0.0, 1.0),
    }


def annuity_factor(rate, decline, years):
    """PV of 1/yr in year 1, declining at `decline` per year, discounted at `rate`, end-of-year flows."""
    return sum((1 - decline) ** (t - 1) / (1 + rate) ** t for t in range(1, int(years) + 1))


def price_paid(df, a):
    """Acquisition price: flat $/flowing boe/d, or 'mix' with separate gas and liquids multiples."""
    if a.get("price_basis", "flat") == "mix":
        gas_boe = df["gas_mmcf_d"] * 1000 / 6
        return gas_boe * a["price_per_flowing_boe_gas"] + (df["boe_d"] - gas_boe) * a["price_per_flowing_boe_liquids"]
    return df["boe_d"] * a["price_per_flowing_boe"]


def value(df, a, baseline, decline_source=None):
    """Add revenue, NOPAT, synergies, NPV, price paid, accretion and ROCE columns."""
    df = df.copy()
    p = unit_prices(a)
    heavy = df["heavy_oil_share"].fillna(0)
    oil_price = heavy * p["heavy_oil"] + (1 - heavy) * p["light_oil"]
    daily_rev = (df["oil_bbl_d"] * oil_price + df["cond_bbl_d"] * p["cond"]
                 + df["ngl_bbl_d"] * p["ngl"] + df["gas_mmcf_d"] * p["gas_mmcf"])
    df["revenue"] = 365 * daily_rev
    df["royalty"] = df["revenue"] * a["royalty_rate"]

    gas_boe = df["gas_mmcf_d"] * 1000 / 6
    heavy_boe = df["oil_bbl_d"] * heavy
    light_boe = df["oil_bbl_d"] + df["cond_bbl_d"] - heavy_boe
    df["opex"] = 365 * (gas_boe * a["opex_gas_per_boe"] + heavy_boe * a["opex_heavy_per_boe"]
                        + light_boe * a["opex_light_per_boe"])
    df["ocf"] = df["revenue"] - df["royalty"] - df["opex"]
    df["nopat"] = df["ocf"] * (1 - a["tax_rate"])

    df["transport_savings"] = (df["liq_m3km_saved"].fillna(0) * a["liq_tariff_per_m3_km"]
                               + df["gas_e3m3km_saved"].fillna(0) * a["gas_tariff_per_e3m3_km"])
    df["synergies"] = df["transport_savings"] * (1 - a["tax_rate"])

    source = decline_source or a.get("decline_source", "precedent")
    if source == "fitted":
        df["decline"] = df["fitted_annual_decline"].fillna(baseline["decline"]).clip(a["min_decline"], a["max_decline"])
    else:
        df["decline"] = baseline["decline"]
    df["retention"] = baseline["retention"]

    df["cash_flow_y1"] = df["nopat"] * df["retention"] + df["synergies"]
    factors = [annuity_factor(a["discount_rate"], d, a["npv_years"]) for d in df["decline"]]
    df["npv"] = df["cash_flow_y1"] * np.array(factors)
    df["price_paid"] = price_paid(df, a)
    df["accretion"] = df["npv"] - df["price_paid"]
    df["accretion_ratio"] = df["npv"] / df["price_paid"]
    df["roce"] = df["cash_flow_y1"] / df["price_paid"]
    df["accretive"] = (df["roce"] > a["roce_hurdle"]) & (df["accretion"] > 0)
    return df


def proximity_score(df):
    """0-1: production-weighted share near CNRL (10/25/50 km) plus a small mean-distance term."""
    shares = df[["share_within_10km", "share_within_25km", "share_within_50km"]].mean(axis=1)
    closeness = (1 - df["mean_km_to_cnrl"] / 50).clip(0, 1)
    return 0.8 * shares + 0.2 * closeness


def precedent_fit(df, baseline):
    """0-1 similarity to CNRL's deal baseline on size, gas share, median km and share within 25 km."""
    size = (np.log10(df["boe_d"].clip(lower=1) / baseline["boe_d"]).abs()).clip(upper=1)
    gas = (df["gas_share"] - baseline["gas_share"]).abs().clip(upper=1)
    km = ((df["median_km_to_cnrl"] - baseline["median_km"]).abs() / 25).clip(upper=1)
    near = (df["share_within_25km"] - baseline["share_within_25km"]).abs().clip(upper=1)
    return 1 - (size + gas + km + near) / 4


def universe(om, a):
    """Candidates: producing non-CNRL operators above the size floor, minus the exclusion list."""
    keep = (om["boe_d"] >= a["min_candidate_boe_d"]) & ~om["operator_baid"].isin(a["exclude_baids"] + [CNRL_BAID])
    return om[keep].copy()


def score(cands, a, baseline, decline_source=None):
    """Value, proximity, precedent fit and weighted final score; sorted best first with a 1-based rank."""
    df = value(cands, a, baseline, decline_source)
    df["proximity_score"] = proximity_score(df)
    df["precedent_fit"] = precedent_fit(df, baseline)
    df["accretion_score"] = df["accretion_ratio"].rank(pct=True)
    df["final_score"] = (a["weight_accretion"] * df["accretion_score"]
                         + a["weight_proximity"] * df["proximity_score"]
                         + a["weight_precedent_fit"] * df["precedent_fit"])
    df = df.sort_values("final_score", ascending=False).reset_index(drop=True)
    df["rank"] = np.arange(1, len(df) + 1)
    return df


def rank_candidates(om, prec, a, decline_source=None):
    baseline = precedent_baseline(prec, a)
    return score(universe(om, a), a, baseline, decline_source), baseline


def seller_as_candidate(row):
    """A historical seller's pre-deal profile in operator_metrics shape (no transport-savings basis)."""
    return {
        "operator_baid": row["seller_baid"], "operator_name": row["seller_name"],
        "oil_bbl_d": row["pre_oil_bbl_d"], "gas_mmcf_d": row["pre_gas_mmcf_d"],
        "cond_bbl_d": row["pre_cond_bbl_d"], "ngl_bbl_d": row["pre_ngl_bbl_d"], "boe_d": row["pre_boe_d"],
        "gas_share": row["gas_share"], "heavy_oil_share": 0.0,
        "mean_km_to_cnrl": row["median_km_to_legacy"], "median_km_to_cnrl": row["median_km_to_legacy"],
        "share_within_10km": row["share_within_10km"], "share_within_25km": row["share_within_25km"],
        "share_within_50km": row["share_within_50km"],
        "liq_m3km_saved": 0.0, "gas_e3m3km_saved": 0.0, "fitted_annual_decline": row["pre_annual_decline"],
    }


def backtest(om, prec, a):
    """Score each material historical seller, as if pre-deal, against today's candidates.

    Leave-one-out: each seller's baseline is built from the OTHER deals, so it can't fit itself.
    """
    cands = universe(om, a)
    out = []
    material = prec[prec["pre_boe_d"] >= a["material_deal_boe_d"]]
    for _, seller in material.iterrows():
        others = prec[prec["seller_baid"] != seller["seller_baid"]]
        baseline = precedent_baseline(others, a)
        pool = pd.concat([cands, pd.DataFrame([seller_as_candidate(seller)])], ignore_index=True)
        ranked = score(pool, a, baseline)
        hit = ranked[ranked["operator_baid"] == seller["seller_baid"]].iloc[0]
        out.append({
            "seller_name": seller["seller_name"], "deal_month": seller["deal_month"],
            "rank": int(hit["rank"]), "of": len(ranked),
            "percentile": 1 - (hit["rank"] - 1) / len(ranked),
            "top_decile": hit["rank"] <= math.ceil(0.1 * len(ranked)),
            "final_score": hit["final_score"], "accretive": bool(hit["accretive"]),
        })
    return pd.DataFrame(out)


TEXT_SUFFIXES = ("_baid", "_id", "_name", "_month")


def numeric(df):
    """Convert string columns from the SQL API to numbers where possible; IDs, names and months stay text."""
    df = df.copy()
    for c in df.columns:
        if c.endswith(TEXT_SUFFIXES) or c in ("key", "value"):
            continue
        converted = pd.to_numeric(df[c], errors="coerce")
        if converted.notna().sum() == df[c].notna().sum():
            df[c] = converted
    return df
