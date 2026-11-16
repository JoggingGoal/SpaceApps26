"""
features.py - turns daily weather into stage-aware crop-season features.

THIS FILE IS SHARED by the rule model, the ML model and the tuning pipeline, so the
features used for prediction and for training are always computed identically.

For one crop in one season-year we simulate:
  * planting date    : spring crops wait until 3 consecutive days are above the crop's frost-kill temp
  * phenology        : accumulate growing degree days (GDD) from planting until the crop's GDD need is met
  * frost impact     : an autumn frost before maturity ends the season early (partial/zero yield)
  * winter crops     : winterkill (extreme cold) and vernalisation (enough cool days)
  * flowering window : heat days above the crop's threshold, rain around flowering
  * water balance    : season rain + stored soil water vs crop water need, minus irrigation (up to the limit)
"""
from __future__ import annotations

import numpy as np
import pandas as pd

import config

ML_FEATURES = [
    "crop_id", "planted", "matured", "frost_killed", "winterkill",
    "gdd_frac", "gdd_total", "season_days", "precip_season", "precip_flower",
    "heat_days_flower", "tmax_flower", "frost_days_season", "tmin_min", "vernal_days",
    "frost_free_days", "deficit_frac", "resid_deficit_frac", "irrigation_mm",
    "ph", "om_pct", "awc_mm", "ndvi_trend_pct", "ndvi_mean_peak",
]


def daily_gdd(tmin, tmax, tbase, cap=None):
    cap = config.GDD_TMAX_CAP_C if cap is None else cap
    hi = np.maximum(np.minimum(tmax, cap), tbase)
    lo = np.maximum(tmin, tbase)
    return np.maximum(0.0, (hi + lo) / 2.0 - tbase)


def _first(mask):
    idx = np.flatnonzero(mask)
    return int(idx[0]) if idx.size else None


def _blank(valid=True):
    return {"valid": valid, "planted": 0, "plant_doy": np.nan, "season_days": 0, "gdd_total": 0.0,
            "gdd_frac": 0.0, "matured": 0, "frost_killed": 0, "winterkill": 0, "vernal_days": 0,
            "precip_season": 0.0, "precip_flower": 0.0, "heat_days_flower": 0, "tmax_flower": np.nan,
            "frost_days_season": 0, "tmin_min": np.nan, "frost_free_days": np.nan}


def simulate_season(wx: pd.DataFrame, year: int, crop) -> dict:
    """Weather -> phenology/stress features for one crop in one season-year. `crop` is a row of crops.csv."""
    winter = crop["season_type"] == "winter"
    base = pd.Timestamp(year - 1 if winter else year, 1, 1) + pd.Timedelta(days=int(crop["plant_doy"]) - 1)
    end = base + pd.Timedelta(days=int(crop["max_season_days"]))
    seg = wx.loc[base:end]
    if len(seg) < 0.97 * ((end - base).days + 1):
        return _blank(valid=False)
    tmin, tmax, pr = seg["tmin"].to_numpy(), seg["tmax"].to_numpy(), seg["precip"].to_numpy()
    n = len(seg)
    out = _blank()

    # calendar-year frost facts (generic 0 C), independent of the crop
    cal = wx.loc[f"{year}-01-01":f"{year}-12-31"]
    if len(cal):
        fr = (cal["tmin"] <= 0).to_numpy()
        half = cal.index.month.to_numpy() <= 6
        last = np.flatnonzero(fr & half)
        first = np.flatnonzero(fr & ~half)
        out["frost_free_days"] = float((first[0] if first.size else len(cal)) - (last[-1] if last.size else 0))

    # planting
    if winter:
        p = 0
    else:
        m3 = np.minimum.reduce([tmin[:-2], tmin[1:-1], tmin[2:]])
        p = _first(m3[:75] > crop["frost_kill_c"] + config.FROST_PLANTING_MARGIN_C)
        if p is None:
            return out  # frost never lets up inside the planting window -> not planted
    out["planted"] = 1
    out["plant_doy"] = float(seg.index[p].dayofyear)

    # phenology
    req = float(crop["gdd_to_maturity"])
    cum = np.cumsum(daily_gdd(tmin[p:], tmax[p:], float(crop["tbase_c"])))
    m = _first(cum >= req)
    matured = m is not None
    end_rel = m if matured else len(cum) - 1
    killed = False
    if not winter:
        kc = np.flatnonzero(tmin[p + 10:] <= crop["frost_kill_c"])
        if kc.size:
            k_rel = 10 + int(kc[0])
            if (not matured) or k_rel < m:
                killed, matured, end_rel = True, False, k_rel
    s = p + end_rel
    out.update(matured=int(matured), frost_killed=int(killed), season_days=int(end_rel + 1),
               gdd_total=float(cum[end_rel]), gdd_frac=float(min(1.0, cum[end_rel] / req)))

    # flowering window (50-62% of GDD requirement)
    cw = cum[:end_rel + 1]
    fl = np.flatnonzero((cw >= 0.50 * req) & (cw <= 0.62 * req))
    if fl.size == 0:
        fl = np.array([int(0.6 * end_rel)])
    fl_abs = p + fl
    out["heat_days_flower"] = int((tmax[fl_abs] > crop["heat_thresh_c"]).sum())
    out["tmax_flower"] = float(tmax[fl_abs].mean())
    lo, hi = max(p, fl_abs[0] - 10), min(s, fl_abs[-1] + 10)
    out["precip_flower"] = float(pr[lo:hi + 1].sum())

    # season rain (winter crops: count from 1 March of harvest year)
    ws = p
    if winter:
        ws = max(p, int(seg.index.searchsorted(pd.Timestamp(year, 3, 1))))
    out["precip_season"] = float(pr[ws:s + 1].sum())
    out["frost_days_season"] = int((tmin[p:s + 1] <= 0).sum())
    out["tmin_min"] = float(tmin[p:s + 1].min())
    if winter:
        tmean = (tmin[p:s + 1] + tmax[p:s + 1]) / 2
        out["vernal_days"] = int(((tmean >= 0) & (tmean <= 8)).sum())
        out["winterkill"] = int(out["tmin_min"] < crop["winter_hardiness_c"])
    return out


def season_features(wx, year, crop, awc_mm=150.0, irrigation_limit_mm=0.0) -> dict:
    """simulate_season + water balance (rain + stored soil water vs crop need, with irrigation)."""
    f = simulate_season(wx, year, crop)
    f.update(deficit_frac=0.0, resid_deficit_frac=0.0, irrigation_mm=0.0)
    if not f["valid"] or not f["planted"]:
        return f
    need = float(crop["water_need_mm"]) * max(f["gdd_frac"], 0.3)       # shorter season -> less water needed
    supply = config.RAIN_EFFICIENCY * f["precip_season"] + config.SOIL_WATER_CARRYOVER * awc_mm
    deficit = max(0.0, need - supply)
    irr = min(deficit, max(0.0, irrigation_limit_mm))
    f.update(deficit_frac=deficit / need, resid_deficit_frac=(deficit - irr) / need, irrigation_mm=irr)
    return f


def assemble(feat: dict, crop_id: int, ph: float, om_pct: float, awc_mm: float,
             ndvi_trend_pct: float = np.nan, ndvi_mean_peak: float = np.nan) -> dict:
    """Feature row for the models (same columns in prediction and in training)."""
    row = {k: feat.get(k, np.nan) for k in ML_FEATURES}
    row.update(crop_id=crop_id, ph=ph, om_pct=om_pct, awc_mm=awc_mm,
               ndvi_trend_pct=ndvi_trend_pct, ndvi_mean_peak=ndvi_mean_peak)
    return row
