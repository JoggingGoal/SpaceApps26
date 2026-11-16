"""
ndvi.py - NDVI (vegetation greenness) history for a field, and the trend metrics the model uses.

Three ways to get NDVI for a field:
  1. CSV you already have  -> load_ndvi_csv(path)         (works with NASA AppEEARS exports,
                                                            Google Earth Engine exports, or any date,ndvi file)
  2. NASA/ORNL DAAC MODIS web service, no login needed -> fetch_ndvi_ornl(lat, lon, ...)
     (MOD13Q1, 250 m, 16-day composites, 2000-present). Slow for long ranges (10 dates/request), so cached.
  3. Anything else you build: just return a DataFrame with columns [date, ndvi].

What the model does with NDVI:
  - annual_metrics():  per-year peak NDVI, day of peak, seasonal integral
  - summarize():       mean peak and linear TREND (% per year) -> a field productivity trend
  - prior_summary():   same, but using only years BEFORE a given year (no leakage; used when training)

NDVI is a greenness index, not a yield. We never convert it to yield directly; it is used as
a field-level productivity trend/level signal and as ML features calibrated against real yields.
"""
from __future__ import annotations

import time
from pathlib import Path

import numpy as np
import pandas as pd
import requests

import config

ORNL_BASE = "https://modis.ornl.gov/rst/api/v1"


def load_ndvi_csv(src) -> pd.DataFrame:
    """Load a date,ndvi file (path or DataFrame). Handles MODIS scaling (x0.0001) and fill values."""
    df = src.copy() if isinstance(src, pd.DataFrame) else pd.read_csv(src)
    cols = {c.lower().strip(): c for c in df.columns}
    date_col = next((c for k, c in cols.items() if k in ("date", "calendar_date", "datetime") or k.endswith("date")), None)
    if date_col is None:
        raise ValueError("NDVI file needs a date column")
    ndvi_col = next((c for k, c in cols.items() if "ndvi" in k and "qual" not in k and "reliab" not in k), None)
    if ndvi_col is None:
        others = [c for c in df.columns if c != date_col]
        if not others:
            raise ValueError("NDVI file needs an ndvi column")
        ndvi_col = others[0]
    out = pd.DataFrame({"date": pd.to_datetime(df[date_col], errors="coerce"),
                        "ndvi": pd.to_numeric(df[ndvi_col], errors="coerce")}).dropna()
    if len(out) and out["ndvi"].abs().max() > 2:      # MODIS integer scale
        out["ndvi"] = out["ndvi"] * 0.0001
    out = out[(out["ndvi"] > -0.2) & (out["ndvi"] <= 1.0)]     # drops fill values (-0.3 after scaling)
    return out.sort_values("date").reset_index(drop=True)


def _modis_dates(lat, lon, start_year, end_year, product):
    """Composite dates (AYYYYDDD). Uses the service's list; falls back to the 16-day grid."""
    try:
        r = requests.get(f"{ORNL_BASE}/{product}/dates", params={"latitude": lat, "longitude": lon},
                         headers={"Accept": "application/json"}, timeout=60)
        r.raise_for_status()
        js = r.json()
        items = js.get("dates", js) if isinstance(js, dict) else js
        dates = [d["modis_date"] for d in items if start_year <= int(d["modis_date"][1:5]) <= end_year]
        if dates:
            return dates
    except Exception:
        pass
    return [f"A{y}{d:03d}" for y in range(start_year, end_year + 1) for d in range(1, 366, 16)]


def fetch_ndvi_ornl(lat: float, lon: float, start_year: int, end_year: int,
                    product: str = "MOD13Q1", band: str = "250m_16_days_NDVI",
                    use_cache: bool = True, progress=None) -> pd.DataFrame:
    """NDVI time series for the single MODIS pixel at lat/lon from the NASA ORNL DAAC web service.
    Requests are limited to 10 composite dates, so long ranges take a while (cached afterwards)."""
    config.CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = config.CACHE_DIR / f"ndvi_{product}_{lat:.4f}_{lon:.4f}_{start_year}_{end_year}.csv"
    if use_cache and path.exists():
        return pd.read_csv(path, parse_dates=["date"])
    dates = _modis_dates(lat, lon, start_year, end_year, product)
    rows = []
    chunks = [dates[i:i + 10] for i in range(0, len(dates), 10)]
    for ci, ch in enumerate(chunks):
        params = {"latitude": lat, "longitude": lon, "startDate": ch[0], "endDate": ch[-1],
                  "kmAboveBelow": 0, "kmLeftRight": 0}
        for attempt in range(3):
            try:
                r = requests.get(f"{ORNL_BASE}/{product}/subset", params=params,
                                 headers={"Accept": "application/json"}, timeout=90)
                r.raise_for_status()
                for item in r.json().get("subset", []):
                    if item.get("band") != band or not item.get("data"):
                        continue
                    md = item["modis_date"]
                    day = pd.Timestamp(int(md[1:5]), 1, 1) + pd.Timedelta(days=int(md[5:]) - 1)
                    rows.append((day, float(np.mean(item["data"])) * 0.0001))
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(2 * (attempt + 1))
        if progress:
            progress((ci + 1) / len(chunks))
    out = pd.DataFrame(rows, columns=["date", "ndvi"])
    out = out[(out["ndvi"] > -0.2) & (out["ndvi"] <= 1.0)].sort_values("date").reset_index(drop=True)
    out.to_csv(path, index=False)
    return out


def annual_metrics(df: pd.DataFrame, lat: float = 1.0) -> pd.DataFrame:
    """Per season-year peak NDVI, day of peak and integral above 0.2. Southern hemisphere dates are
    shifted 6 months so the growing season sits inside one 'year'."""
    d = df.copy()
    if lat < 0:
        d["date"] = d["date"] + pd.Timedelta(days=182)
    s = d.set_index("date")["ndvi"]
    sm = s.rolling(3, center=True, min_periods=1).median()      # knocks out cloud-contaminated dips/spikes
    rows = []
    for y, g in sm.groupby(sm.index.year):
        if len(g) < 12:
            continue
        days = (g.index - g.index[0]).days.to_numpy().astype(float)
        v = np.clip(g.to_numpy() - 0.2, 0, None)
        integral = float((0.5 * (v[1:] + v[:-1]) * np.diff(days)).sum()) if len(g) > 1 else 0.0
        rows.append({"year": int(y), "peak": float(g.max()), "peak_doy": int(g.idxmax().dayofyear), "integral": integral})
    return pd.DataFrame(rows)


def _trend(m: pd.DataFrame, min_years: int) -> dict:
    if len(m) < min_years:
        return {"n_years": int(len(m)), "mean_peak": float(m["peak"].mean()) if len(m) else np.nan,
                "trend_pct_per_year": 0.0, "usable": False}
    slope = float(np.polyfit(m["year"], m["peak"], 1)[0])
    mean = float(m["peak"].mean())
    return {"n_years": int(len(m)), "mean_peak": mean, "trend_pct_per_year": 100 * slope / mean, "usable": True}


def summarize(df: pd.DataFrame | None, lat: float = 1.0) -> dict:
    if df is None or len(df) == 0:
        return {"n_years": 0, "mean_peak": np.nan, "trend_pct_per_year": 0.0, "usable": False}
    return _trend(annual_metrics(df, lat), config.NDVI_MIN_YEARS)


def prior_summary(df: pd.DataFrame | None, year: int, lat: float = 1.0, min_years: int = 4) -> dict:
    """NDVI summary using only seasons strictly before `year` (what a planner would have known)."""
    if df is None or len(df) == 0:
        return {"n_years": 0, "mean_peak": np.nan, "trend_pct_per_year": np.nan, "usable": False}
    m = annual_metrics(df, lat)
    m = m[m["year"] < year]
    t = _trend(m, min_years)
    if not t["usable"]:
        t["trend_pct_per_year"] = np.nan
    return t
