"""
config.py - every number you may want to tune lives in this one file.

Edit values here (or in data/crops.csv) and re-run; nothing else needs to change.
Sections:
  1. Paths
  2. Climate handling (NASA POWER history, trends)
  3. Crop-season simulation (frost, heat, water, soil)
  4. Rotation rules (previous-crop effects)
  5. Economics / risk
  6. Eco score
  7. Field modifiers (tillage, organic, cover crops, known pest problems)

All defaults are STARTER values from general agronomy knowledge. They are meant to be
replaced with local numbers (extension service data, your own yield records, tuning/ scripts).
"""
import os
from pathlib import Path

# ----------------------------------------------------------------------------
# 1. Paths
# ----------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
CACHE_DIR = DATA_DIR / "cache"
CROPS_FILE = DATA_DIR / "crops.csv"
REGIONS_FILE = DATA_DIR / "regions.csv"
# Overridable by environment variable (used by tests; handy if you keep models elsewhere)
MODEL_DIR = Path(os.environ.get("CROPROT_MODEL_DIR", ROOT / "models"))
CALIBRATION_FILE = Path(os.environ.get("CROPROT_CALIBRATION", DATA_DIR / "calibration.json"))

# ----------------------------------------------------------------------------
# 2. Climate
# ----------------------------------------------------------------------------
HISTORY_YEARS = 20                 # years of NASA POWER daily weather used as the weather "pool"
CLIMATE_TREND = {
    # "historical": project each past year to the target year using the linear trend in the record
    # "none":       use past weather as-is (assumes stationary climate)
    # "manual":     use manual_warming_c_per_decade below (plug in CMIP6 / NEX-GDDP deltas here)
    "mode": "historical",
    "manual_warming_c_per_decade": 0.3,
    "manual_precip_pct_per_decade": 0.0,
    "max_abs_warming_c_per_decade": 0.6,    # a 20-yr record is noisy, so cap the fitted trend
    "max_abs_precip_pct_per_decade": 5.0,
}

# ----------------------------------------------------------------------------
# 3. Crop-season simulation
# ----------------------------------------------------------------------------
GDD_TMAX_CAP_C = 30.0              # daily max temperature cap in growing-degree-day calc
FROST_PLANTING_MARGIN_C = 0.0      # spring crops wait until 3 days in a row are above frost_kill_c + margin
IMMATURE_RESPONSE = (0.55, 1.00)   # yield 0 when only 55% of required GDD reached before frost; 100% at full
HEAT_PENALTY_PER_DAY = 0.025       # yield loss per flowering-window day above the crop's heat threshold
HEAT_PENALTY_CAP = 0.50
WINTERKILL_MULT = 0.25             # yield multiplier if winter minimum falls below crop hardiness
VERNALIZATION_FAIL_MULT = 0.50     # winter crops that never get enough cool days
RAIN_EFFICIENCY = 0.85             # share of season rain that is usable by the crop
SOIL_WATER_CARRYOVER = 0.50        # share of soil available water assumed full at planting
ROOTING_DEPTH_M = 1.2
SOIL_AWC_MM_PER_M = {              # available water capacity by texture
    "sand": 70, "loamy_sand": 90, "sandy_loam": 110, "loam": 150,
    "silt_loam": 180, "clay_loam": 160, "silty_clay": 150, "clay": 140,
}
YIELD_SENSITIVITY_TO_DROUGHT = (1.6, 0.8)   # ky = a - b * drought_tolerance  -> yield loss per unit relative water deficit
PH_PENALTY_PER_UNIT = 0.12         # yield loss per pH unit outside the crop's optimum range
PH_MULT_FLOOR = 0.60
OM_N_CREDIT_PER_PCT = 10.0         # kg N/ha mineralised per % soil organic matter above 2%
NDVI_TREND_K = 0.5                 # yield trend = K * field NDVI trend (NDVI saturates, so K < 1). Tune with tuning/
NDVI_MULT_CLIP = (0.90, 1.10)
NDVI_REFERENCE_PEAK = None         # optional regional reference peak NDVI; if set, adds a level effect
NDVI_LEVEL_K = 0.5
NDVI_MIN_YEARS = 5                 # minimum NDVI years before trust the trend

# Crops are dropped from the candidate set if climate makes them non-viable
MIN_MEDIAN_REL_YIELD = 0.35
MAX_FAIL_FRACTION = 0.50           # share of past weather years with relative yield < FAIL_REL_YIELD
FAIL_REL_YIELD = 0.30

# ----------------------------------------------------------------------------
# 4. Rotation rules (previous-crop effects on yield)
# ----------------------------------------------------------------------------
ROTATION_RULES = {
    "allow_same_crop_consecutive": False,   # hard rule
    "repeat_same_crop_mult": 0.85,          # only used if the hard rule is switched off
    "same_family_consecutive_mult": 0.93,   # e.g. wheat after barley (shared diseases)
    "cereal_after_broadleaf_mult": 1.04,    # break-crop benefit
    "cereal_after_legume_extra_mult": 1.02, # on top of the N credit
    "n_credit_second_year_fraction": 0.25,  # share of a legume's N credit that carries to year 2
    "n_response_exponent": 0.5,             # yield ~ (N supply / N demand) ^ exponent when N-limited
    "n_factor_floor": 0.40,
}
DISEASE_MAX_LAG = 5                          # years looked back for disease break rules
MAX_CROP_SHARE = 0.5                         # no crop may take more than this share of the seasons (rounded up)
ORGANIC_REQUIRE_LEGUME_WINDOW = 3            # organic: at least one legume in every N consecutive years

# ----------------------------------------------------------------------------
# 5. Economics / risk
# ----------------------------------------------------------------------------
FERTILIZER_USD_PER_KG_N = 1.00
IRRIGATION_USD_PER_MM_HA = 0.80
RISK_LAMBDA = {"low": 0.50, "medium": 0.25, "high": 0.0}   # weight on downside average vs mean profit
CVAR_LEVEL = 0.10                                          # downside = worst 10% of simulated outcomes
N_SCENARIOS = 300                                          # bootstrap weather sequences per evaluation
RANDOM_SEED = 42
TOP_N_DEFAULT = 5
MAX_ROTATIONS = 300_000                                    # exhaustive up to here, random sample above
CHUNK_SIZE = 4000

# ----------------------------------------------------------------------------
# 6. Eco score  (each component 0..1, higher = better; weights are relative)
# ----------------------------------------------------------------------------
ECO_WEIGHTS = {
    "fertilizer_n": 0.25,    # lower synthetic N need (legume credits help)
    "soil_cover":   0.15,    # living cover / residue through the year
    "diversity":    0.15,    # distinct crops and plant families
    "erosion":      0.15,
    "water":        0.15,    # irrigation volume + crop water demand
    "pesticide":    0.15,
}
ECO_REFERENCES = {"fert_n_kg_ha": 200.0, "irrigation_mm": 400.0, "crop_water_need_mm": 800.0}
ECO_WATER_MIX = (0.7, 0.3)          # share of water score from irrigation vs crop water demand
GHG_KG_CO2E_PER_KG_N = 8.0          # ~4.3 field N2O (IPCC 1% EF, GWP100 273) + ~4 manufacturing; rough, tune

# ----------------------------------------------------------------------------
# 7. Field modifiers
# ----------------------------------------------------------------------------
TILLAGE = {  # erosion multiplier, extra cost USD/ha, extra residue cover (0..1)
    "no_till":      {"erosion_mult": 0.50, "cost_adj": -30.0, "cover_bonus": 0.10},
    "reduced":      {"erosion_mult": 0.75, "cost_adj":   0.0, "cover_bonus": 0.05},
    "conventional": {"erosion_mult": 1.00, "cost_adj":  40.0, "cover_bonus": 0.00},
}
SLOPE_EROSION_PER_PCT = 0.10        # erosion multiplier = 1 + slope% * this (capped)
SLOPE_EROSION_CAP = 2.5
COVER_CROP = {"cost_ha": 60.0, "cover_bonus_fraction": 0.5, "erosion_mult": 0.80, "n_credit_kg_ha": 10.0}
ORGANIC = {"yield_mult": 0.90, "price_mult": 1.40,    # placeholder organic premium: replace with your market
           "manure_n_kg_ha": 50.0}                    # compost/manure N assumed available (no synthetic N allowed)
# Known problem fields lengthen disease breaks / raise penalties for named crops
PROBLEM_EFFECTS = {
    "clubroot":                {"canola": {"extra_break": 3, "penalty_mult": 1.5}},
    "soybean_cyst_nematode":   {"soybean": {"extra_break": 2, "penalty_mult": 1.5}},
    "sclerotinia":             {"canola": {"extra_break": 1, "penalty_mult": 1.3},
                                "sunflower": {"extra_break": 2, "penalty_mult": 1.5},
                                "soybean": {"extra_break": 1, "penalty_mult": 1.2},
                                "field_pea": {"extra_break": 1, "penalty_mult": 1.2}},
    "fusarium_head_blight":    {"winter_wheat": {"extra_break": 1, "penalty_mult": 1.3},
                                "spring_wheat": {"extra_break": 1, "penalty_mult": 1.3},
                                "barley": {"extra_break": 1, "penalty_mult": 1.3},
                                "maize": {"extra_break": 1, "penalty_mult": 1.2}},
    "aphanomyces_root_rot":    {"field_pea": {"extra_break": 3, "penalty_mult": 1.5}},
    "herbicide_resistant_weeds": {},   # placeholder: handled via pesticide score in your own extension
}

# ----------------------------------------------------------------------------
# ML yield model (used automatically if tuning/train_model.py has produced one)
# ----------------------------------------------------------------------------
USE_ML_MODEL_IF_AVAILABLE = True
ML_MIN_ROWS_PER_CROP = 30           # crops with fewer training rows fall back to the rule model
