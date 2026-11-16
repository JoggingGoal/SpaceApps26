"""
rotation.py - enumerate crop sequences, score them for profit / risk / eco, find the Pareto frontier.

Everything is vectorised with numpy. A rotation is a row of crop ids. Weather uncertainty comes from
bootstrapping the historical (trend-adjusted) weather years: each scenario draws an independent
weather year for every season of the rotation, and the same draws are reused for every rotation
(common random numbers), so rotations are compared fairly.

Previous-crop effects handled here (all tunable in config.ROTATION_RULES):
  * nitrogen credit from legumes (and a smaller 2nd-year credit) -> less fertiliser, or N-limited yield if organic
  * same-family-in-a-row penalty, cereal-after-broadleaf / cereal-after-legume bonuses
  * disease-break rules: returning to a crop sooner than its break interval reduces yield
  * hard rule: no same crop two seasons in a row (switch in config)
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

import config

HL = config.DISEASE_MAX_LAG


@dataclass
class Problem:
    crops: pd.DataFrame          # effective crop table, indexed 0..A-1
    Wy: np.ndarray               # (A, H, Y) climate/soil-limited yield t/ha for each crop, season, weather year
    IRR: np.ndarray              # (A, H, Y) irrigation applied, mm
    fail_frac: np.ndarray        # (A, H) share of weather years with relative yield < FAIL_REL_YIELD
    candidates: np.ndarray       # crop ids allowed
    history: list                # crop ids, oldest -> most recent
    horizon: int
    organic: bool = False
    extra_n_credit: float = 0.0  # om + cover crop + manure N credit, kg/ha
    fert_price: float = config.FERTILIZER_USD_PER_KG_N
    irr_cost: float = config.IRRIGATION_USD_PER_MM_HA
    eco_weights: dict = field(default_factory=lambda: dict(config.ECO_WEIGHTS))
    risk_lambda: float = 0.25
    must_include: list = field(default_factory=list)


# ----------------------------------------------------------------------------
def build_tables(P: Problem):
    """Previous-crop effect tables, indexed [crop, prev1, prev2]; index A means 'none/unknown'."""
    cr, r = P.crops, config.ROTATION_RULES
    A = len(cr)
    fam = np.append(cr["family"].to_numpy(), "__none__")
    legume = np.append(cr["legume"].to_numpy().astype(bool), False)
    credit = np.append(cr["n_credit_kg_ha"].to_numpy(float), 0.0)
    cereal = fam == "Poaceae"
    demand = cr["n_demand_kg_ha"].to_numpy(float)
    M = np.ones((A, A + 1, A + 1))
    FERT = np.zeros((A, A + 1, A + 1))
    for c in range(A):
        for p1 in range(A + 1):
            for p2 in range(A + 1):
                cred = credit[p1] + r["n_credit_second_year_fraction"] * credit[p2] + P.extra_n_credit
                need = demand[c]
                fert = 0.0 if P.organic else max(0.0, need - cred)
                nf = 1.0 if need <= 0 else float(np.clip(((cred + fert) / need) ** r["n_response_exponent"],
                                                         r["n_factor_floor"], 1.0))
                rot = 1.0
                if p1 == c:
                    rot *= r["repeat_same_crop_mult"]
                elif p1 != A and fam[p1] == fam[c]:
                    rot *= r["same_family_consecutive_mult"]
                if cereal[c] and p1 != A and not cereal[p1]:
                    rot *= r["cereal_after_broadleaf_mult"]
                    if legume[p1]:
                        rot *= r["cereal_after_legume_extra_mult"]
                M[c, p1, p2] = nf * rot
                FERT[c, p1, p2] = fert
    return M, FERT


def _build_X(R: np.ndarray, P: Problem) -> np.ndarray:
    A = len(P.crops)
    hist = np.full(HL, A, dtype=np.int16)
    h = list(P.history)[-HL:]
    if h:
        hist[HL - len(h):] = h
    return np.concatenate([np.tile(hist, (len(R), 1)), R.astype(np.int16)], axis=1)


def enumerate_rotations(P: Problem, rng) -> tuple[np.ndarray, bool]:
    """All valid sequences (or a random sample if there are too many). Returns (array, was_sampled)."""
    cand = np.asarray(P.candidates, dtype=np.int16)
    C, H = len(cand), P.horizon
    allow_same = config.ROTATION_RULES["allow_same_crop_consecutive"]
    last = P.history[-1] if P.history else None
    n_first = C - (0 if (allow_same or last is None or last not in cand) else 1)
    total = n_first * ((C if allow_same else C - 1) ** (H - 1))
    if total <= config.MAX_ROTATIONS:
        seqs = cand[:, None]
        if last is not None and not allow_same:
            seqs = seqs[cand != last]
        for _ in range(1, H):
            new = np.repeat(seqs, C, axis=0)
            add = np.tile(cand, len(seqs))
            keep = np.ones(len(add), bool) if allow_same else add != new[:, -1]
            seqs = np.concatenate([new, add[:, None]], axis=1)[keep]
        return seqs, False
    # random sample in candidate-position space (no consecutive repeats)
    N = config.MAX_ROTATIONS
    pos = np.zeros((N, H), dtype=np.int16)
    prev = -1 if last is None or last not in cand else int(np.flatnonzero(cand == last)[0])
    for k in range(H):
        if allow_same:
            nxt = rng.integers(0, C, N)
        else:
            r = rng.integers(0, C - 1, N)
            nxt = r + (r >= prev)
        pos[:, k] = nxt
        prev = nxt
    return np.unique(cand[pos], axis=0), True


def rule_mask(R: np.ndarray, P: Problem) -> np.ndarray:
    mask = np.ones(len(R), bool)
    cap = int(np.ceil(config.MAX_CROP_SHARE * P.horizon))
    if cap < P.horizon:
        for c in np.unique(R):
            mask &= (R == c).sum(axis=1) <= cap
    for c in P.must_include:
        mask &= (R == c).any(axis=1)
    if P.organic:
        A = len(P.crops)
        X = _build_X(R, P)
        leg = np.append(P.crops["legume"].to_numpy().astype(bool), True)   # unknown history counts as OK
        L = leg[X]
        w = config.ORGANIC_REQUIRE_LEGUME_WINDOW
        for col in range(HL, HL + P.horizon):
            if col - w + 1 >= 0:
                mask &= L[:, col - w + 1:col + 1].any(axis=1)
    return mask


def disease_mult(X, col, brk, pen):
    c = X[:, col].astype(np.int64)
    b, p = brk[c], pen[c]
    mult = np.ones(len(X))
    for lag in range(1, HL + 1):
        if col - lag < 0:
            break
        same = (X[:, col - lag] == c) & (lag <= b)
        sev = (b - lag + 1) / b
        mult = np.where(same, np.minimum(mult, 1 - p * sev), mult)
    return mult


def evaluate(R: np.ndarray, P: Problem, tables, idx: np.ndarray, detail: bool = False) -> dict:
    """Score rotations R (n, H). idx (S, H) are the bootstrap weather-year draws."""
    M, FERT = tables
    cr = P.crops
    H, S, n = P.horizon, idx.shape[0], len(R)
    price, cost = cr["price_eff"].to_numpy(float), cr["cost_eff"].to_numpy(float)
    brk, pen = cr["brk_eff"].to_numpy(int), cr["pen_eff"].to_numpy(float)
    cover, eros, pest = (cr[c].to_numpy(float) for c in ("cover_eff", "erosion_eff", "pest_eff"))
    need = cr["water_need_mm"].to_numpy(float)
    irr_mean = P.IRR.mean(axis=2)                                   # (A, H)
    X = _build_X(R, P)

    total = np.zeros((n, S))
    sums = {k: np.zeros(n) for k in ("fert", "irr", "need", "cover", "eros", "pest", "disease_loss")}
    pos_yield, pos_profit, pos_fert, pos_irr = [], [], [], []
    for k in range(H):
        col = HL + k
        ck = X[:, col].astype(np.int64)
        p1, p2 = X[:, col - 1].astype(np.int64), X[:, col - 2].astype(np.int64)
        m, fert = M[ck, p1, p2], FERT[ck, p1, p2]
        dis = disease_mult(X, col, brk, pen)
        yld = P.Wy[:, k, :][ck][:, idx[:, k]] * (m * dis)[:, None]      # t/ha in each scenario
        irrk = P.IRR[:, k, :][ck][:, idx[:, k]]
        profit = yld * price[ck][:, None] - (cost[ck] + fert * P.fert_price)[:, None] - irrk * P.irr_cost
        total += profit
        sums["fert"] += fert
        sums["irr"] += irr_mean[ck, k]
        sums["need"] += need[ck]
        sums["cover"] += cover[ck]
        sums["eros"] += eros[ck]
        sums["pest"] += pest[ck]
        sums["disease_loss"] += 1 - dis
        if detail:
            pos_yield.append(yld); pos_profit.append(profit); pos_fert.append(fert); pos_irr.append(irrk.mean(1))

    mean_profit = total.mean(1) / H
    kq = max(1, int(config.CVAR_LEVEL * S))
    cvar = np.partition(total, kq - 1, axis=1)[:, :kq].mean(1) / H
    risk_adj = (1 - P.risk_lambda) * mean_profit + P.risk_lambda * cvar

    # ---- eco components (0..1, higher is better)
    refs = config.ECO_REFERENCES
    famid = pd.factorize(cr["family"])[0]
    srt_c = np.sort(R, axis=1)
    n_crops = 1 + (np.diff(srt_c, axis=1) != 0).sum(1)
    srt_f = np.sort(famid[R], axis=1)
    n_fam = 1 + (np.diff(srt_f, axis=1) != 0).sum(1)
    denom = max(1, H - 1)
    comp = {
        "fertilizer_n": 1 - np.clip(sums["fert"] / H / refs["fert_n_kg_ha"], 0, 1),
        "soil_cover": np.clip(sums["cover"] / H, 0, 1),
        "diversity": np.clip(0.5 * (n_crops - 1) / denom + 0.5 * (n_fam - 1) / denom, 0, 1),
        "erosion": 1 - np.clip(sums["eros"] / H, 0, 1),
        "water": 1 - np.clip(config.ECO_WATER_MIX[0] * sums["irr"] / H / refs["irrigation_mm"]
                             + config.ECO_WATER_MIX[1] * sums["need"] / H / refs["crop_water_need_mm"], 0, 1),
        "pesticide": 1 - np.clip(sums["pest"] / H, 0, 1),
    }
    w = P.eco_weights
    wsum = sum(w.values()) or 1.0
    eco = sum(w.get(k, 0.0) * v for k, v in comp.items()) / wsum
    out = {"mean_profit": mean_profit, "cvar_profit": cvar, "risk_adj_profit": risk_adj, "eco": eco,
           "fert_n": sums["fert"] / H, "irrigation_mm": sums["irr"] / H,
           "ghg": sums["fert"] / H * config.GHG_KG_CO2E_PER_KG_N,
           "disease_loss": sums["disease_loss"] / H, "comp": comp}
    if detail:
        out.update(pos_yield=np.stack(pos_yield, 1), pos_profit=np.stack(pos_profit, 1),
                   pos_fert=np.stack(pos_fert, 1), pos_irr=np.stack(pos_irr, 1))
    return out


def evaluate_all(R: np.ndarray, P: Problem, tables, idx) -> dict:
    parts = [evaluate(R[i:i + config.CHUNK_SIZE], P, tables, idx) for i in range(0, len(R), config.CHUNK_SIZE)]
    out = {}
    for key in parts[0]:
        if key == "comp":
            out["comp"] = {c: np.concatenate([p["comp"][c] for p in parts]) for c in parts[0]["comp"]}
        else:
            out[key] = np.concatenate([p[key] for p in parts])
    return out


def pareto_mask(profit: np.ndarray, eco: np.ndarray) -> np.ndarray:
    """True for rotations that no other rotation beats on both profit and eco."""
    order = np.lexsort((-eco, -profit))
    e = eco[order]
    cm = np.maximum.accumulate(e)
    keep_sorted = np.r_[True, e[1:] > cm[:-1] + 1e-12]
    keep = np.zeros(len(profit), bool)
    keep[order[keep_sorted]] = True
    return keep


def minmax(x):
    lo, hi = float(np.min(x)), float(np.max(x))
    return (x - lo) / (hi - lo) if hi - lo > 1e-12 else np.zeros_like(x)


def pick_top(R, utility, candidates_mask, n_top):
    """Best-utility rotations, skipping near-duplicates (differing in only one season) when possible."""
    order = np.flatnonzero(candidates_mask)
    order = order[np.argsort(-utility[order])]
    H = R.shape[1]
    chosen = []
    for i in order:
        if all((R[i] != R[j]).sum() >= 2 for j in chosen) or H < 2:
            chosen.append(i)
        if len(chosen) == n_top:
            return chosen
    for i in order:                       # not enough diverse ones: fill with the next best
        if i not in chosen:
            chosen.append(i)
        if len(chosen) == n_top:
            break
    return chosen
