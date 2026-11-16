"""
yield_model.py - THE replaceable heart of the system.

Contract: given a DataFrame of feature rows (see features.ML_FEATURES, plus an integer column `k`
= how many seasons ahead), return RELATIVE yield (fraction of the crop's base_yield_t_ha) per row.

Two implementations:
  RuleYieldModel : transparent agronomic rules + optional calibration (data/calibration.json)
  MLYieldModel   : gradient-boosting model trained by tuning/train_model.py on real yields;
                   falls back to the rules for crops it has too little data for.

load_yield_model() returns the ML model automatically when models/yield_model.joblib exists,
otherwise the rules. To plug in your own model, write a class with .predict(F) and .describe()
and return it from load_yield_model().

Rotation effects (previous crop, N credits, disease breaks) are NOT in here; they are rule-based
and live in config.ROTATION_RULES / rotation.py, so the yield model only has to learn
weather + soil + NDVI effects.
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

import config


def load_calibration() -> dict:
    p = config.CALIBRATION_FILE
    if p.exists():
        try:
            return json.loads(p.read_text())
        except Exception:
            return {}
    return {}


class RuleYieldModel:
    def __init__(self, crops: pd.DataFrame, calibration: dict | None = None):
        self.crops = crops.reset_index(drop=True)
        self.cal = load_calibration() if calibration is None else calibration

    def describe(self) -> str:
        if self.cal.get("yield_scale") or "ndvi_trend_k" in self.cal:
            return f"rule-based model, calibrated ({self.cal.get('meta', {}).get('n_rows', '?')} yield records)"
        return "rule-based model (uncalibrated starter values)"

    def _ndvi_mult(self, trend_pct, mean_peak, years_ahead) -> float:
        k = self.cal.get("ndvi_trend_k", config.NDVI_TREND_K)
        m = 1.0
        if trend_pct == trend_pct:                       # not NaN
            m *= 1.0 + k * (trend_pct / 100.0) * years_ahead
        ref = config.NDVI_REFERENCE_PEAK
        if ref and mean_peak == mean_peak:
            m *= 1.0 + config.NDVI_LEVEL_K * (mean_peak / ref - 1.0)
        lo, hi = config.NDVI_MULT_CLIP
        return float(np.clip(m, lo, hi))

    def predict(self, F: pd.DataFrame) -> np.ndarray:
        scale = self.cal.get("yield_scale", {})
        lo, hi = config.IMMATURE_RESPONSE
        a, b = config.YIELD_SENSITIVITY_TO_DROUGHT
        out = np.zeros(len(F))
        for i, r in enumerate(F.itertuples(index=False)):
            if not r.planted:
                continue
            crop = self.crops.iloc[int(r.crop_id)]
            rel = 1.0 if r.matured else float(np.clip((r.gdd_frac - lo) / (hi - lo), 0, 1))
            rel *= 1.0 - min(config.HEAT_PENALTY_CAP, config.HEAT_PENALTY_PER_DAY * r.heat_days_flower)
            ky = a - b * crop["drought_tolerance"]
            rel *= max(0.05, 1.0 - ky * r.resid_deficit_frac)
            if crop["season_type"] == "winter":
                if r.winterkill:
                    rel *= config.WINTERKILL_MULT
                if r.vernal_days < crop["vernal_days_needed"]:
                    rel *= config.VERNALIZATION_FAIL_MULT
            if r.ph == r.ph:
                dist = max(crop["ph_min"] - r.ph, 0.0, r.ph - crop["ph_max"])
                rel *= max(config.PH_MULT_FLOOR, 1.0 - config.PH_PENALTY_PER_UNIT * dist)
            rel *= self._ndvi_mult(r.ndvi_trend_pct, r.ndvi_mean_peak, getattr(r, "k", 0) + 1)
            out[i] = rel * scale.get(crop["crop"], 1.0)
        return out


class MLYieldModel:
    def __init__(self, bundle: dict, rules: RuleYieldModel):
        self.model, self.features, self.meta = bundle["model"], bundle["features"], bundle["meta"]
        self.rules = rules

    def describe(self) -> str:
        m = self.meta
        return (f"ML model (gradient boosting, {m.get('n_rows', '?')} yield records, "
                f"spatial-CV RMSE {m.get('cv_rmse_model', float('nan')):.3f} vs rules {m.get('cv_rmse_rules', float('nan')):.3f}; "
                f"crops without enough data use the rules)")

    def predict(self, F: pd.DataFrame) -> np.ndarray:
        rule = self.rules.predict(F)
        ml = np.clip(self.model.predict(F[self.features]), 0.0, 1.3)
        rows = self.meta.get("rows_per_crop", {})
        covered = F["crop_id"].astype(int).map(lambda c: rows.get(str(c), 0) >= config.ML_MIN_ROWS_PER_CROP).to_numpy()
        use_ml = covered & (F["planted"].to_numpy() == 1)
        return np.where(use_ml, ml, rule)


def load_yield_model(crops: pd.DataFrame):
    rules = RuleYieldModel(crops)
    path = config.MODEL_DIR / "yield_model.joblib"
    if config.USE_ML_MODEL_IF_AVAILABLE and path.exists():
        try:
            import joblib
            return MLYieldModel(joblib.load(path), rules)
        except Exception as e:  # corrupted file, version mismatch...
            print(f"[yield_model] could not load {path}: {e}; using rule model")
    return rules
