"""
engine.py - one function, recommend(inputs) -> results. The CLI and the Streamlit app both call it.

Pipeline:
  1. normalise farmer inputs, build the field-adjusted crop table, decide which crops are available
  2. pull NASA POWER climate (+ optional NDVI), estimate trends, project weather to each future season
  3. simulate every candidate crop in every historical weather year -> features -> yield model
  4. drop crops that climate makes non-viable (reasons are reported)
  5. enumerate rotations, score profit / downside risk / eco score, keep the Pareto frontier
  6. pick the best rotations for the farmer's profit<->eco slider, with per-year detail and reasons
"""
from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd

import climate
import config
import features
import ndvi as ndvi_mod
import rotation as rot
from yield_model import load_yield_model

DEFAULTS = dict(
    lat=None, lon=None, field_ha=40.0,
    prev_crops=[], horizon=4, eco_weight=0.5, risk="medium",
    irrigation="rainfed", irrigation_mm=0.0,
    available_crops=None, exclude_crops=[], must_include=[],
    soil_texture="loam", om_pct=3.0, ph=6.5, slope_pct=2.0,
    tillage="reduced", cover_crops=False, certification="conventional", known_problems=[],
    price_overrides={}, cost_overrides={},
    fert_usd_per_kg_n=config.FERTILIZER_USD_PER_KG_N, irrigation_usd_per_mm_ha=config.IRRIGATION_USD_PER_MM_HA,
    climate_scenario=None, extra_warming_c_per_decade=0.0,
    climate_source="nasa", climate_csv=None,
    ndvi_csv=None, ndvi_df=None, fetch_ndvi=False,
    eco_weights=None, start_year=None, top_n=config.TOP_N_DEFAULT,
)


class RecommendError(RuntimeError):
    pass


# ----------------------------------------------------------------------------
def load_crops() -> pd.DataFrame:
    df = pd.read_csv(config.CROPS_FILE)
    for c in ("legume", "needs_opt_in"):
        df[c] = df[c].astype(int)
    return df.reset_index(drop=True)


def region_crops(lat: float, lon: float) -> tuple[set | None, list]:
    """Crops commonly grown where the field is (union of matching regions in data/regions.csv)."""
    try:
        reg = pd.read_csv(config.REGIONS_FILE)
    except FileNotFoundError:
        return None, []
    hit = reg[(reg.lat_min <= lat) & (lat <= reg.lat_max) & (reg.lon_min <= lon) & (lon <= reg.lon_max)]
    if hit.empty:
        return None, []
    crops = set()
    for s in hit["crops"]:
        crops |= set(str(s).split(";"))
    return crops, list(hit["region"])


def default_available(crops: pd.DataFrame, lat: float, lon: float) -> list[str]:
    reg, _ = region_crops(lat, lon)
    ok = crops[crops["needs_opt_in"] == 0]["crop"]
    return [c for c in ok if reg is None or c in reg]


def effective_crops(crops: pd.DataFrame, inp: dict) -> pd.DataFrame:
    c = crops.copy()
    til = config.TILLAGE[inp["tillage"]]
    organic = inp["certification"] == "organic"
    cc = bool(inp["cover_crops"])
    slope_mult = min(config.SLOPE_EROSION_CAP, 1 + inp["slope_pct"] * config.SLOPE_EROSION_PER_PCT)
    base_cost = c["cost_usd_ha"].astype(float)
    for k, v in inp["cost_overrides"].items():
        base_cost[c["crop"] == k] = v
    price = c["price_usd_t"].astype(float) * (config.ORGANIC["price_mult"] if organic else 1.0)
    for k, v in inp["price_overrides"].items():
        price[c["crop"] == k] = v
    c["price_eff"] = price
    c["cost_eff"] = base_cost + til["cost_adj"] + (config.COVER_CROP["cost_ha"] if cc else 0.0)
    c["erosion_eff"] = np.clip(c["erosion_risk"] * til["erosion_mult"] * slope_mult
                               * (config.COVER_CROP["erosion_mult"] if cc else 1.0), 0, 1)
    cover = c["soil_cover"].astype(float)
    if cc:
        cover = cover + config.COVER_CROP["cover_bonus_fraction"] * (1 - cover)
    c["cover_eff"] = np.clip(cover + til["cover_bonus"], 0, 1)
    c["pest_eff"] = c["pesticide_intensity"] * (0.0 if organic else 1.0)
    brk = c["disease_break_years"].astype(int).copy()
    pen = c["repeat_penalty_max"].astype(float).copy()
    for prob in inp["known_problems"]:
        for crop_key, eff in config.PROBLEM_EFFECTS.get(prob, {}).items():
            m = c["crop"] == crop_key
            brk[m] = np.minimum(brk[m] + eff["extra_break"], config.DISEASE_MAX_LAG)
            pen[m] = np.minimum(pen[m] * eff["penalty_mult"], 0.6)
    c["brk_eff"], c["pen_eff"] = brk.clip(lower=1), pen
    return c


def _normalise(inp: dict) -> dict:
    d = {**DEFAULTS, **{k: v for k, v in inp.items() if v is not None or k in ("climate_scenario",)}}
    if d["lat"] is None or d["lon"] is None:
        raise RecommendError("Field location (lat/lon) is required.")
    if not (-60 <= d["lat"] <= 72):
        raise RecommendError("Latitude outside the range this prototype supports (-60 to 72).")
    d["horizon"] = int(d["horizon"])
    if not (2 <= d["horizon"] <= 6):
        raise RecommendError("Planning horizon must be 2-6 years.")
    for k in ("prev_crops", "exclude_crops", "must_include", "known_problems"):
        d[k] = list(d[k] or [])
    if d["start_year"] is None:
        today = date.today()
        d["start_year"] = today.year + (1 if today.month >= 9 else 0)
    return d


def _fail_reason(rows: pd.DataFrame, crop) -> str:
    n = max(1, len(rows))
    if rows["planted"].mean() < 0.6:
        return "frost persists too long to plant within the usual window"
    if rows["frost_killed"].mean() > 0.4:
        return f"autumn frost ends the season before maturity in {100 * rows['frost_killed'].mean():.0f}% of years"
    if crop["season_type"] == "winter" and rows["winterkill"].mean() > 0.4:
        return f"winterkill risk in {100 * rows['winterkill'].mean():.0f}% of years (hardiness {crop['winter_hardiness_c']:.0f} C)"
    if crop["season_type"] == "winter" and (rows["vernal_days"] < crop["vernal_days_needed"]).mean() > 0.4:
        return "not enough cool days for vernalisation"
    if rows["matured"].mean() < 0.5:
        return f"season too short: median {rows['gdd_total'].median():.0f} of {crop['gdd_to_maturity']:.0f} growing degree days"
    return "yield too low from heat or water stress"


# ----------------------------------------------------------------------------
def recommend(inputs: dict, progress=None) -> dict:
    def tick(msg, frac):
        if progress:
            progress(msg, frac)

    inp = _normalise(inputs)
    lat, lon, H = float(inp["lat"]), float(inp["lon"]), inp["horizon"]
    warnings: list[str] = []
    crops_all = load_crops()
    crops = effective_crops(crops_all, inp)
    key2id = {k: i for i, k in enumerate(crops["crop"])}
    organic = inp["certification"] == "organic"

    # ---- which crops are on the table
    names = inp["available_crops"] or default_available(crops_all, lat, lon)
    names = [n for n in names if n in key2id and n not in inp["exclude_crops"]]
    cand_all = np.array([key2id[n] for n in names], dtype=np.int16)
    if len(cand_all) < 2:
        raise RecommendError("Need at least 2 available crops to build a rotation (check the crops you selected).")
    _, region_names = region_crops(lat, lon)
    history = [key2id[c] for c in inp["prev_crops"] if c in key2id][-config.DISEASE_MAX_LAG:]
    for c in inp["prev_crops"]:
        if c not in key2id:
            warnings.append(f"Previous crop '{c}' is not in data/crops.csv and was ignored.")

    # ---- climate
    tick("Fetching NASA POWER climate", 0.05)
    try:
        wx, source_label = climate.get_climate(lat, lon, inp["climate_source"], inp["climate_csv"])
    except climate.ClimateError as e:
        raise RecommendError(f"Could not get climate data: {e}") from e
    trends = climate.estimate_trends(wx)
    scen = inp["climate_scenario"] or config.CLIMATE_TREND["mode"]
    old_mode = config.CLIMATE_TREND["mode"]
    config.CLIMATE_TREND["mode"] = scen
    try:
        tr = climate.trend_used(trends, inp["extra_warming_c_per_decade"])
    finally:
        config.CLIMATE_TREND["mode"] = old_mode
    clim_summary, clim_table = climate.climate_summary(wx)
    if "SYNTHETIC" in source_label:
        warnings.append("DEMO MODE: climate is synthetic, not NASA data. Results are for testing the software only.")

    # ---- NDVI
    nd_df, nd_label = None, "none"
    try:
        if inp["ndvi_df"] is not None:
            nd_df, nd_label = ndvi_mod.load_ndvi_csv(inp["ndvi_df"]), "uploaded NDVI"
        elif inp["ndvi_csv"]:
            nd_df, nd_label = ndvi_mod.load_ndvi_csv(inp["ndvi_csv"]), f"NDVI file {inp['ndvi_csv']}"
        elif inp["fetch_ndvi"]:
            tick("Fetching MODIS NDVI (NASA ORNL DAAC)", 0.12)
            y1 = date.today().year - 1
            nd_df, nd_label = ndvi_mod.fetch_ndvi_ornl(lat, lon, y1 - 11, y1), "NASA MODIS MOD13Q1 NDVI"
    except Exception as e:
        warnings.append(f"NDVI could not be loaded ({e}); continuing without it.")
    nd = ndvi_mod.summarize(nd_df, lat)
    if nd_df is not None and not nd["usable"]:
        warnings.append(f"NDVI has only {nd['n_years']} usable years (need {config.NDVI_MIN_YEARS}); trend not used.")
    nd_trend = nd["trend_pct_per_year"] if nd["usable"] else np.nan
    nd_peak = nd["mean_peak"] if nd["usable"] else np.nan

    # ---- soil / irrigation
    awc = config.SOIL_AWC_MM_PER_M.get(inp["soil_texture"], 150) * config.ROOTING_DEPTH_M
    irr_limit = {"rainfed": 0.0, "full": 5000.0}.get(inp["irrigation"], float(inp["irrigation_mm"]))

    # ---- simulate every candidate crop x season x historical weather year
    tick("Simulating crop seasons", 0.2)
    model = load_yield_model(crops)
    rows, meta_rows = [], []
    years = sorted(set(wx.index.year))
    for k in range(H):
        wxk = climate.project_weather(wx, inp["start_year"] + k, tr)
        for c in cand_all:
            crop = crops.iloc[int(c)]
            for y in years:
                f = features.season_features(wxk, y, crop, awc, irr_limit)
                if not f["valid"]:
                    continue
                r = features.assemble(f, int(c), inp["ph"], inp["om_pct"], awc, nd_trend, nd_peak)
                r.update(k=k, year=y)
                rows.append(r)
        tick("Simulating crop seasons", 0.2 + 0.4 * (k + 1) / H)
    F = pd.DataFrame(rows)
    if F.empty:
        raise RecommendError("No complete weather years available for the chosen location.")
    # only weather years valid for every candidate crop and season
    counts = F.groupby("year").size()
    good_years = counts[counts == counts.max()].index.to_numpy()
    F = F[F["year"].isin(good_years)].reset_index(drop=True)
    Y = len(good_years)
    if Y < 8:
        warnings.append(f"Only {Y} complete weather years available; risk estimates are rough.")
    yidx = {y: i for i, y in enumerate(good_years)}

    tick("Predicting yields", 0.65)
    rel = model.predict(F)
    base = crops["base_yield_t_ha"].to_numpy(float)
    A = len(crops)
    Wy, IRR, REL = np.zeros((A, H, Y)), np.zeros((A, H, Y)), np.zeros((A, H, Y))
    ci, ki = F["crop_id"].to_numpy(int), F["k"].to_numpy(int)
    yi = F["year"].map(yidx).to_numpy(int)
    org_mult = config.ORGANIC["yield_mult"] if organic else 1.0
    Wy[ci, ki, yi] = base[ci] * rel * org_mult
    REL[ci, ki, yi] = rel
    IRR[ci, ki, yi] = F["irrigation_mm"].to_numpy(float)

    # ---- feasibility filter
    keep, excluded = [], []
    for c in cand_all:
        sub = REL[c]                                   # (H, Y)
        med, fail = float(np.median(sub)), float((sub < config.FAIL_REL_YIELD).mean())
        if med < config.MIN_MEDIAN_REL_YIELD or fail > config.MAX_FAIL_FRACTION:
            crop = crops.iloc[int(c)]
            excluded.append({"crop": crop["label"], "reason": _fail_reason(F[(F["crop_id"] == c) & (F["k"] == 0)], crop)})
        else:
            keep.append(int(c))
    if len(keep) < 2:
        raise RecommendError("Fewer than 2 crops are climatically viable here with the selected crop list. "
                             "Excluded: " + "; ".join(f"{e['crop']} ({e['reason']})" for e in excluded))
    fail_frac = (REL < config.FAIL_REL_YIELD).mean(axis=2)

    # ---- optimise
    tick("Evaluating rotations", 0.72)
    w = dict(config.ECO_WEIGHTS)
    if inp["eco_weights"]:
        w.update(inp["eco_weights"])
    extra_n = (max(0.0, inp["om_pct"] - 2.0) * config.OM_N_CREDIT_PER_PCT
               + (config.COVER_CROP["n_credit_kg_ha"] if inp["cover_crops"] else 0.0)
               + (config.ORGANIC["manure_n_kg_ha"] if organic else 0.0))
    P = rot.Problem(crops=crops, Wy=Wy, IRR=IRR, fail_frac=fail_frac, candidates=np.array(keep, dtype=np.int16),
                    history=history, horizon=H, organic=organic, extra_n_credit=extra_n,
                    fert_price=inp["fert_usd_per_kg_n"], irr_cost=inp["irrigation_usd_per_mm_ha"],
                    eco_weights=w, risk_lambda=config.RISK_LAMBDA[inp["risk"]],
                    must_include=[key2id[c] for c in inp["must_include"] if c in key2id])
    rng = np.random.default_rng(config.RANDOM_SEED)
    R, sampled = rot.enumerate_rotations(P, rng)
    R = R[rot.rule_mask(R, P)]
    if len(R) == 0:
        raise RecommendError("No rotations satisfy the rules (e.g. organic legume requirement or must-include crops).")
    if sampled:
        warnings.append(f"Search space is large; evaluated a random sample of {len(R):,} rotations.")
    tables = rot.build_tables(P)
    idx = rng.integers(0, Y, size=(config.N_SCENARIOS, H))
    ev = rot.evaluate_all(R, P, tables, idx)

    tick("Ranking", 0.92)
    pareto = rot.pareto_mask(ev["risk_adj_profit"], ev["eco"])
    w_eco = float(np.clip(inp["eco_weight"], 0, 1))
    utility = (1 - w_eco) * rot.minmax(ev["risk_adj_profit"]) + w_eco * rot.minmax(ev["eco"])
    top = rot.pick_top(R, utility, pareto, int(inp["top_n"]))
    det = rot.evaluate(R[top], P, tables, idx, detail=True)

    labels = crops["label"].to_numpy()
    startY = inp["start_year"]
    out_rows, details = [], []
    for j, i in enumerate(top):
        seq = R[i]
        d = _detail_table(seq, j, det, P, crops, startY, history)
        details.append(d)
        out_rows.append({
            "rank": j + 1,
            "rotation": " → ".join(labels[c] for c in seq),
            "crops": [crops["crop"].iloc[int(c)] for c in seq],
            "profit_usd_ha_yr": float(ev["mean_profit"][i]),
            "downside_profit_usd_ha_yr": float(ev["cvar_profit"][i]),
            "profit_total_usd": float(ev["mean_profit"][i] * H * inp["field_ha"]),
            "eco_score": float(ev["eco"][i]),
            **{f"eco_{k}": float(v[i]) for k, v in ev["comp"].items()},
            "fert_n_kg_ha_yr": float(ev["fert_n"][i]),
            "ghg_kg_co2e_ha_yr": float(ev["ghg"][i]),
            "irrigation_mm_yr": float(ev["irrigation_mm"][i]),
            "utility": float(utility[i]),
            "why": _why(seq, d, ev, i, P, crops, history),
        })
    frontier = pd.DataFrame({
        "profit_usd_ha_yr": ev["risk_adj_profit"][pareto], "eco_score": ev["eco"][pareto],
        "rotation": [" → ".join(labels[c] for c in r) for r in R[pareto]],
    }).sort_values("eco_score").reset_index(drop=True)
    tick("Done", 1.0)

    return {
        "rotations": pd.DataFrame(out_rows), "details": details, "frontier": frontier,
        "excluded_crops": pd.DataFrame(excluded, columns=["crop", "reason"]),
        "climate": {"source": source_label, "trend": tr, "trends_raw": trends, "summary": clim_summary,
                    "table": clim_table, "years_used": Y},
        "ndvi": {**nd, "label": nd_label, "df": nd_df},
        "meta": {"model": model.describe(), "n_rotations": int(len(R)), "n_pareto": int(pareto.sum()),
                 "candidates": [crops["label"].iloc[c] for c in keep], "regions": region_names,
                 "start_year": startY, "horizon": H, "warnings": warnings,
                 "extra_n_credit_kg_ha": extra_n},
    }


# ----------------------------------------------------------------------------
def _detail_table(seq, j, det, P, crops, start_year, history) -> pd.DataFrame:
    H = len(seq)
    rows = []
    for k in range(H):
        c = int(seq[k])
        y = det["pos_yield"][j, k]
        rows.append({
            "year": start_year + k, "crop": crops["label"].iloc[c],
            "expected_yield_t_ha": float(y.mean()),
            "poor_year_yield_t_ha": float(np.percentile(y, 10)),
            "profit_usd_ha": float(det["pos_profit"][j, k].mean()),
            "profit_poor_year_usd_ha": float(np.percentile(det["pos_profit"][j, k], 10)),
            "fert_n_kg_ha": float(det["pos_fert"][j, k]),
            "irrigation_mm": float(det["pos_irr"][j, k]),
            "weather_failure_risk_pct": float(100 * P.fail_frac[c, k]),
        })
    return pd.DataFrame(rows)


def _why(seq, d: pd.DataFrame, ev, i, P: Problem, crops, history) -> list[str]:
    notes = []
    H = len(seq)
    leg = [k for k, c in enumerate(seq) if crops["legume"].iloc[int(c)]]
    if leg:
        yrs = ", ".join(str(d["year"].iloc[k]) for k in leg)
        notes.append(f"Legume in {yrs} fixes nitrogen for the following crop, cutting fertiliser to "
                     f"{ev['fert_n'][i]:.0f} kg N/ha/yr on average.")
    prev = [crops["crop"].iloc[c] for c in history[-1:]]
    for k in range(1, H):
        a, b = crops.iloc[int(seq[k - 1])], crops.iloc[int(seq[k])]
        if b["family"] == "Poaceae" and a["family"] != "Poaceae":
            notes.append(f"{b['label']} follows a broadleaf break crop ({a['label']}) in {d['year'].iloc[k]}.")
            break
    fams = len({crops["family"].iloc[int(c)] for c in seq})
    notes.append(f"{len(set(seq.tolist()))} different crops from {fams} plant families over {H} years.")
    worst = int(np.argmax(d["weather_failure_risk_pct"]))
    if d["weather_failure_risk_pct"].iloc[worst] >= 10:
        notes.append(f"Weakest season: {d['crop'].iloc[worst]} in {d['year'].iloc[worst]} fails (yield below 30% of potential) in "
                     f"about {d['weather_failure_risk_pct'].iloc[worst]:.0f}% of weather years (frost, heat or drought).")
    if ev["disease_loss"][i] > 0.02:
        notes.append(f"Returns to a crop sooner than its disease-break interval cost about {100 * ev['disease_loss'][i]:.0f}% yield on average.")
    comp = {k: v[i] for k, v in ev["comp"].items()}
    best = max(comp, key=comp.get)
    weak = min(comp, key=comp.get)
    notes.append(f"Eco strongest on {best.replace('_', ' ')} ({comp[best]:.2f}), weakest on {weak.replace('_', ' ')} ({comp[weak]:.2f}).")
    return notes
