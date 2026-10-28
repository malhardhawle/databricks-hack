"""FastAPI backend for the CNRL acquisition explorer: /api/* over Lakebase, plus the built React app."""
import json
from pathlib import Path
from typing import Any, Literal

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import queries
import scoring as sc

app = FastAPI(title="CNRL Acquisition Explorer")
app.add_middleware(GZipMiddleware, minimum_size=1000)

DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
_cache = {}


def tables():
    """Small tables used for scoring, loaded from Lakebase once per process."""
    if not _cache:
        _cache["om"] = queries.operator_metrics()
        _cache["prec"] = queries.deal_precedents()
        _cache["assumptions"] = queries.assumptions()
    return _cache


def records(df):
    """DataFrame -> JSON-safe records (NaN -> null, numpy -> Python)."""
    return json.loads(df.to_json(orient="records"))


def assumptions_with(overrides):
    a = sc.parse_assumptions(tables()["assumptions"])
    for key, value in (overrides or {}).items():
        if key not in a:
            raise HTTPException(400, f"unknown assumption: {key}")
        if key == "exclude_baids":
            a[key] = value if isinstance(value, list) else [b.strip() for b in str(value).split(",") if b.strip()]
        elif isinstance(a[key], float):
            a[key] = float(value)
        else:
            a[key] = value
    return a


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/facilities")
def facilities():
    df = queries.facilities()
    return {"columns": list(df.columns), "rows": json.loads(df.to_json(orient="values"))}


@app.get("/api/facility/{facility_id}")
def facility(facility_id: str):
    row = queries.facility(facility_id)
    if row is None:
        raise HTTPException(404, f"unknown facility: {facility_id}")
    return records(row.to_frame().T)[0]


class NearbyRequest(BaseModel):
    cnrl_ids: list[str] = Field(..., min_length=1, max_length=6000)
    radius_km: float = Field(25, gt=0, le=200)
    mode: Literal["radius", "knn"] = "radius"
    k: int = Field(5, ge=1, le=50)
    window: Literal["2025", "last3"] = "2025"


@app.post("/api/nearby")
def nearby(req: NearbyRequest):
    df = queries.nearby(req.cnrl_ids, req.radius_km, req.mode, req.k, req.window)
    rollup = pd.DataFrame(columns=["operator_baid", "operator_name", "facilities", "oil_bbl_d", "gas_mmcf_d",
                                   "cond_bbl_d", "ngl_bbl_d", "boe_d", "mean_km"])
    if len(df):
        rollup = (df.groupby(["operator_baid", "operator_name"], as_index=False)
                    .agg(facilities=("facility_id", "count"), oil_bbl_d=("oil_bbl_d", "sum"),
                         gas_mmcf_d=("gas_mmcf_d", "sum"), cond_bbl_d=("cond_bbl_d", "sum"),
                         ngl_bbl_d=("ngl_bbl_d", "sum"), boe_d=("boe_d", "sum"), mean_km=("km", "mean"))
                    .sort_values("boe_d", ascending=False))
    return {"facilities": records(df), "operators": records(rollup)}


@app.get("/api/assumptions")
def assumptions():
    return records(tables()["assumptions"])


@app.get("/api/precedents")
def precedents():
    return records(tables()["prec"])


class RankRequest(BaseModel):
    overrides: dict[str, Any] = {}


RANK_COLUMNS = ["rank", "operator_baid", "operator_name", "boe_d", "oil_bbl_d", "gas_mmcf_d", "cond_bbl_d",
                "ngl_bbl_d", "gas_share", "producing_facilities", "decline", "revenue", "nopat", "npv",
                "price_paid", "accretion", "accretion_ratio", "roce", "accretive", "proximity_score",
                "precedent_fit", "accretion_score", "final_score", "transport_savings", "median_km_to_cnrl",
                "share_within_10km", "share_within_25km", "share_within_50km"]


def top3_detail(ranked, a, baseline):
    """Transport-savings breakdown and sensitivities for the top three candidates."""
    top = ranked.head(3).copy()
    factor = [sc.annuity_factor(a["discount_rate"], d, a["npv_years"]) for d in top["decline"]]
    top["savings_liq"] = top["liq_m3km_saved"].fillna(0) * a["liq_tariff_per_m3_km"]
    top["savings_gas"] = top["gas_e3m3km_saved"].fillna(0) * a["gas_tariff_per_e3m3_km"]
    top["savings_per_boe"] = top["transport_savings"] / (top["boe_d"] * 365)
    top["savings_pv"] = top["transport_savings"] * (1 - a["tax_rate"]) * pd.Series(factor, index=top.index)

    cases = {
        "multiple_low": {"price_per_flowing_boe": a["price_per_flowing_boe_low"],
                         "price_per_flowing_boe_gas": a["price_per_flowing_boe_gas"] * a["price_per_flowing_boe_low"] / a["price_per_flowing_boe"],
                         "price_per_flowing_boe_liquids": a["price_per_flowing_boe_liquids"] * a["price_per_flowing_boe_low"] / a["price_per_flowing_boe"]},
        "base": {},
        "multiple_high": {"price_per_flowing_boe": a["price_per_flowing_boe_high"],
                          "price_per_flowing_boe_gas": a["price_per_flowing_boe_gas"] * a["price_per_flowing_boe_high"] / a["price_per_flowing_boe"],
                          "price_per_flowing_boe_liquids": a["price_per_flowing_boe_liquids"] * a["price_per_flowing_boe_high"] / a["price_per_flowing_boe"]},
        "oil_minus_20pct": {"wti_usd_bbl": a["wti_usd_bbl"] * 0.8, "wcs_usd_bbl": a["wcs_usd_bbl"] * 0.8},
        "oil_plus_20pct": {"wti_usd_bbl": a["wti_usd_bbl"] * 1.2, "wcs_usd_bbl": a["wcs_usd_bbl"] * 1.2},
    }
    sens = {}
    for name, change in cases.items():
        valued = sc.value(top, {**a, **change}, baseline)
        sens[name] = dict(zip(top["operator_baid"], valued["accretion"]))
    cols = ["rank", "operator_baid", "operator_name", "boe_d", "transport_savings", "savings_liq", "savings_gas",
            "savings_per_boe", "savings_pv", "liq_m3km_saved", "gas_e3m3km_saved", "accretion", "roce", "npv",
            "price_paid", "median_km_to_cnrl", "share_within_25km"]
    return {"candidates": records(top[cols]),
            "sensitivity": [{"case": k, **{b: v for b, v in s.items()}} for k, s in sens.items()]}


@app.post("/api/rank")
def rank(req: RankRequest):
    t = tables()
    a = assumptions_with(req.overrides)
    ranked, baseline = sc.rank_candidates(t["om"], t["prec"], a)
    return {
        "assumptions": {k: v for k, v in a.items()},
        "baseline": baseline,
        "candidates": records(ranked[[c for c in RANK_COLUMNS if c in ranked.columns]]),
        "backtest": records(sc.backtest(t["om"], t["prec"], a)),
        "top3": top3_detail(ranked, a, baseline),
    }


if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        file = DIST / path
        return FileResponse(file if path and file.is_file() else DIST / "index.html")
