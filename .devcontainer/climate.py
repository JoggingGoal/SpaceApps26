"""
climate.py - NASA POWER daily weather, trend estimation and projection.

NASA POWER (https://power.larc.nasa.gov) needs no API key. We request daily
T2M_MIN, T2M_MAX (deg C) and PRECTOTCORR (mm/day) for a lat/lon, cache the response
on disk, and derive everything else (GDD, frost dates, season rainfall) from it.

POWER is a coarse grid (~50 km). Treat results as regional climate, not field weather.
For a field weather station you can instead pass a CSV (date,tmin,tmax,precip).

Southern hemisphere: the daily series is shifted by 182 days so that the model's
"season year" (Jan..Dec) always runs through the local growing season in the middle.
"""
from __future__ import annotations

import time
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import requests

import config

POWER_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"


class ClimateError(RuntimeError):
    pass


# ----------------------------------------------------------------------------
# Loading
# ----------------------------------------------------------------------------
def _cache_path(lat, lon, y0, y1) -> Path:
    config.CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return config.CACHE_DIR / f"power_{lat:.2f}_{lon:.2f}_{y0}_{y1}.csv"


def fetch_power(lat: float, lon: float, start_year: int, end_year: int,
                use_cache: bool = True, retries: int = 3) -> pd.DataFrame:
    """Daily tmin/tmax/precip from NASA POWER. Cached in data/cache/."""
    path = _cache_path(lat, lon, start_year, end_year)
    if use_cache and path.exists():
        return pd.read_csv(path, index_col=0, parse_dates=True)
    params = {
        "parameters": "T2M_MIN,T2M_MAX,PRECTOTCORR",
        "community": "AG",
        "latitude": round(lat, 4), "longitude": round(lon, 4),
        "start": f"{start_year}0101", "end": f"{end_year}1231",
        "format": "JSON",
    }
    last = None
    par = None
    for attempt in range(retries):
        try:
            r = requests.get(POWER_URL, params=params, timeout=120)
            r.raise_for_status()
            par = r.json()["properties"]["parameter"]
            break
        except Exception as e:  # network, HTTP or JSON problems
            last = e
            time.sleep(2 * (attempt + 1))
    if par is None:
        raise ClimateError(f"NASA POWER request failed after {retries} tries: {last}")
    df = pd.DataFrame({"tmin": par["T2M_MIN"], "tmax": par["T2M_MAX"], "precip": par["PRECTOTCORR"]})
    df.index = pd.to_datetime(df.index, format="%Y%m%d")
    df.index.name = "date"
    df = df.astype(float)
    df = df.where(df > -900)               # POWER uses -999 for missing
    df.to_csv(path)
    return df


def load_climate_csv(path: str | Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    cols = {c.lower().strip(): c for c in df.columns}
    need = {"date": None, "tmin": None, "tmax": None, "precip": None}
    for k in need:
        if k not in cols:
            raise ClimateError(f"{path}: missing column '{k}' (need date,tmin,tmax,precip)")
        need[k] = cols[k]
    out = pd.DataFrame({
        "tmin": pd.to_numeric(df[need["tmin"]], errors="coerce"),
        "tmax": pd.to_numeric(df[need["tmax"]], errors="coerce"),
        "precip": pd.to_numeric(df[need["precip"]], errors="coerce"),
    })
    out.index = pd.to_datetime(df[need["date"]])
    out.index.name = "date"
    return out


def synthetic_climate(lat: float, lon: float, start_year: int, end_year: int,
                      seed: int | None = None) -> pd.DataFrame:
    """DEMO ONLY: plausible-looking fake daily weather so the code runs without internet.
    Do not use these numbers for decisions."""
    rng = np.random.default_rng(seed if seed is not None else abs(int(lat * 1000 + lon * 10)) + 7)
    idx = pd.date_range(f"{start_year}-01-01", f"{end_year}-12-31", freq="D")
    n = len(idx)
    doy = idx.dayofyear.to_numpy()
    yrs = idx.year.to_numpy()
    mean_annual = 28.0 - 0.45 * abs(lat)
    amp = 0.36 * abs(lat)
    peak = 200 if lat >= 0 else 17
    seasonal = mean_annual + amp * np.cos(2 * np.pi * (doy - peak) / 365.25)
    # yearly anomaly + slow warming + AR(1) daily noise
    uy = np.unique(yrs)
    yr_anom = dict(zip(uy, rng.normal(0, 0.8, len(uy)) + 0.03 * (uy - uy[0])))
    anom = np.array([yr_anom[y] for y in yrs])
    noise = np.zeros(n)
    e = rng.normal(0, 3.0, n)
    for i in range(1, n):
        noise[i] = 0.7 * noise[i - 1] + e[i]
    tmean = seasonal + anom + noise
    dr = np.clip(10 + rng.normal(0, 2, n), 4, 18)
    tmin, tmax = tmean - dr / 2, tmean + dr / 2
    wphase = np.cos(2 * np.pi * (doy - (170 if lat >= 0 else 352)) / 365.25)    # summer-wet continental pattern
    wet = rng.random(n) < 0.27 + 0.10 * wphase
    amt = rng.gamma(0.8, 9.5 + 5.0 * wphase, n)
    ysc = dict(zip(uy, np.exp(rng.normal(0, 0.15, len(uy)))))
    precip = np.where(wet, amt, 0.0) * np.array([ysc[y] for y in yrs])
    return pd.DataFrame({"tmin": tmin, "tmax": tmax, "precip": precip}, index=pd.DatetimeIndex(idx, name="date"))


def clean(df: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_index()
    df = df[~df.index.duplicated()].asfreq("D")
    df = df.interpolate(limit=7, limit_direction="both")
    if df.isna().any().any():
        doy = df.index.dayofyear
        for col in df.columns:
            df[col] = df[col].fillna(df.groupby(doy)[col].transform("median"))
    df = df.dropna()
    bad = df["tmin"] > df["tmax"]
    if bad.any():
        df.loc[bad, ["tmin", "tmax"]] = df.loc[bad, ["tmax", "tmin"]].to_numpy()
    df["precip"] = df["precip"].clip(lower=0)
    return df


def get_climate(lat: float, lon: float, source: str = "nasa", csv_path: str | None = None,
                years: int | None = None, end_year: int | None = None) -> tuple[pd.DataFrame, str]:
    """Return (daily dataframe tmin/tmax/precip, human-readable source label)."""
    end_year = end_year or (date.today().year - 1)
    years = years or config.HISTORY_YEARS
    start_year = end_year - years + 1
    if source == "synthetic":
        df = synthetic_climate(lat, lon, start_year - 1, end_year)
        label = "SYNTHETIC demo climate (not real data)"
    elif source == "csv":
        if not csv_path:
            raise ClimateError("climate source 'csv' needs csv_path")
        df = load_climate_csv(csv_path)
        label = f"user CSV ({Path(csv_path).name})"
    else:
        df = fetch_power(lat, lon, start_year - 1, end_year)
        label = f"NASA POWER daily, {start_year - 1}-{end_year}"
    df = clean(df)
    if lat < 0:
        df = df.copy()
        df.index = df.index + pd.Timedelta(days=182)
        label += " (southern hemisphere: seasons shifted 6 months)"
    return df, label


# ----------------------------------------------------------------------------
# Trends and projection
# ----------------------------------------------------------------------------
def annual_table(wx: pd.DataFrame) -> pd.DataFrame:
    g = wx.assign(tmean=(wx["tmin"] + wx["tmax"]) / 2).groupby(wx.index.year)
    ann = g.agg(tmean=("tmean", "mean"), precip=("precip", "sum"), n=("precip", "size"))
    return ann[ann["n"] >= 360]


def estimate_trends(wx: pd.DataFrame) -> dict:
    """Linear trend in annual mean temperature (C/yr) and annual precipitation (fraction/yr)."""
    ann = annual_table(wx)
    out = {"n_years": int(len(ann)), "temp_c_per_decade": 0.0, "precip_pct_per_decade": 0.0}
    if len(ann) >= 8:
        out["temp_c_per_decade"] = float(np.polyfit(ann.index, ann["tmean"], 1)[0] * 10)
        out["precip_pct_per_decade"] = float(100 * np.polyfit(ann.index, ann["precip"], 1)[0] / ann["precip"].mean() * 10)
    return out


def trend_used(trends: dict, extra_warming_c_per_decade: float = 0.0) -> dict:
    """Decide which warming/precip trend (per YEAR) the projection applies."""
    c = config.CLIMATE_TREND
    mode = c["mode"]
    if mode == "none":
        t, p = 0.0, 0.0
    elif mode == "manual":
        t, p = c["manual_warming_c_per_decade"], c["manual_precip_pct_per_decade"]
    else:
        t = float(np.clip(trends["temp_c_per_decade"], -c["max_abs_warming_c_per_decade"], c["max_abs_warming_c_per_decade"]))
        p = float(np.clip(trends["precip_pct_per_decade"], -c["max_abs_precip_pct_per_decade"], c["max_abs_precip_pct_per_decade"]))
    t += extra_warming_c_per_decade
    return {"temp_c_per_year": t / 10.0, "precip_frac_per_year": p / 100.0 / 10.0,
            "temp_c_per_decade": t, "precip_pct_per_decade": p, "mode": mode}


def project_weather(wx: pd.DataFrame, target_year: int, tr: dict) -> pd.DataFrame:
    """Shift every historical day to what it might look like in target_year (trend-adjusted).
    Day-to-day and year-to-year variability is preserved; only the mean moves."""
    out = wx.copy()
    dy = target_year - wx.index.year.to_numpy()
    out["tmin"] = wx["tmin"].to_numpy() + tr["temp_c_per_year"] * dy
    out["tmax"] = wx["tmax"].to_numpy() + tr["temp_c_per_year"] * dy
    out["precip"] = wx["precip"].to_numpy() * np.clip(1 + tr["precip_frac_per_year"] * dy, 0.7, 1.3)
    return out


def climate_summary(wx: pd.DataFrame) -> tuple[dict, pd.DataFrame]:
    """Human-friendly climate facts for display (frost dates, GDD, precipitation)."""
    rows = []
    for y, g in wx.groupby(wx.index.year):
        if len(g) < 360:
            continue
        frost = g["tmin"] <= 0
        h1, h2 = g[g.index.month <= 6], g[g.index.month >= 7]
        last = h1.index[(h1["tmin"] <= 0).to_numpy()]
        first = h2.index[(h2["tmin"] <= 0).to_numpy()]
        sea = g[(g.index.month >= 5) & (g.index.month <= 9)]
        gdd10 = np.maximum(0, (np.minimum(sea["tmax"], 30).clip(lower=10) + sea["tmin"].clip(lower=10)) / 2 - 10).sum()
        rows.append({
            "year": y,
            "tmean_c": float(((g["tmin"] + g["tmax"]) / 2).mean()),
            "precip_mm": float(g["precip"].sum()),
            "last_spring_frost_doy": float(last[-1].dayofyear) if len(last) else np.nan,
            "first_fall_frost_doy": float(first[0].dayofyear) if len(first) else np.nan,
            "frost_days": int(frost.sum()),
            "gdd10_may_sep": float(gdd10),
        })
    tab = pd.DataFrame(rows)
    summ = {}
    if len(tab):
        summ = {
            "median_last_spring_frost_doy": float(tab["last_spring_frost_doy"].median()),
            "median_first_fall_frost_doy": float(tab["first_fall_frost_doy"].median()),
            "median_gdd10_may_sep": float(tab["gdd10_may_sep"].median()),
            "median_annual_precip_mm": float(tab["precip_mm"].median()),
            "median_frost_days": float(tab["frost_days"].median()),
        }
    return summ, tab
