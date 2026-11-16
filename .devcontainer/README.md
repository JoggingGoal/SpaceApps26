# Crop Rotation Planner (prototype)

Enter a field location and a few simple parameters; get ranked multi-year crop rotations balancing
**profit, bad-year risk and an auditable eco score**, driven by NASA POWER climate history (and optionally NDVI).

## Quick start (VS Code)

```bash
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python cli.py --lat 41.6 --lon -93.6 --prev maize,soybean --horizon 4 --eco 0.5 --offline   # no internet, synthetic demo climate
python cli.py --lat 41.6 --lon -93.6 --prev maize,soybean --horizon 4 --eco 0.5             # real NASA POWER data (cached in data/cache)
streamlit run app.py                                                                          # the UI: map, simple + advanced inputs
```

`--offline` / "Demo mode" uses fake weather purely to test the software. Never use those results for decisions.

## How it works

1. **Inputs** (`engine.DEFAULTS` lists every parameter): location, field size, last crops, water, horizon, profit-vs-eco slider, risk;
   advanced: crops available, soil, tillage, organic, cover crops, known pest problems, prices/costs, climate scenario, eco weights, NDVI.
2. **Crop availability**: `data/regions.csv` (crops commonly grown by region) minus your exclusions, then a **climate feasibility filter**
   drops crops the weather can't support (reasons are shown, e.g. "season too short: 1100 of 1500 growing degree days").
3. **NASA POWER** daily weather (20 years) is trend-adjusted to each future season; every crop is simulated in every historical weather year
   (`features.py`): frost-delayed planting, growing degree days to maturity, autumn frost before maturity, winterkill, vernalisation,
   heat at flowering, water balance with irrigation.
4. **Yield model** (`yield_model.py`) turns those features into relative yield: transparent rules by default, calibrated rules or a trained ML model once you tune.
5. **Rotation optimiser** (`rotation.py`) scores every valid sequence: legume N credits, family/disease-break rules, profit across 300 bootstrapped
   weather sequences (mean and worst-10% average), eco score, then keeps the Pareto frontier and picks by your slider.

## Where to adjust the model (no code changes needed)

| To change | Edit |
|---|---|
| Crop parameters (GDD, frost tolerance, water need, yield, price, cost, N, disease breaks, eco traits) | `data/crops.csv` |
| Add a crop | add a row to `data/crops.csv` (and to `data/regions.csv` lists) |
| Which crops are common where | `data/regions.csv` (bounding boxes + crop lists; starter data, replace with FAOSTAT/USDA-derived lists) |
| Eco weights, references, GHG factor | `config.py` section 6 (also sliders in the app) |
| Rotation rules, N response, disease behaviour | `config.py` section 4 |
| Frost/heat/water/soil response, NDVI effect | `config.py` sections 2-3 |
| Risk attitude, scenario count | `config.py` section 5 |
| Tillage / organic / cover-crop / pest-problem effects | `config.py` section 7 |
| The yield model itself | `yield_model.py` (implement `.predict(F)` and return it from `load_yield_model`) |

## Using NASA data to improve the model (`tuning/`)

NASA gives climate and vegetation, **not yields**. Improving the model needs real yield records (field records, USDA NASS / national
statistics, yield monitors, long-term trials) in `site_id, lat, lon, year, crop, yield_t_ha` format (see `data/my_yields_TEMPLATE.csv`).

```bash
# 1. join your yields with NASA climate features (+ NDVI per site from data/ndvi/<site_id>.csv, or --fetch-ndvi)
python tuning/build_training_table.py --yields data/my_yields.csv --ndvi-dir data/ndvi
# 2a. small dataset: calibrate the rules (per-crop scale + NDVI trend coefficient) -> data/calibration.json
python tuning/calibrate_rules.py
# 2b. 300+ records: train gradient boosting, cross-validated by SITE -> models/yield_model.joblib
python tuning/train_model.py
```

The app and CLI load whichever exist automatically; delete the file to go back. `train_model.py` compares against the rules and naive
baselines on unseen sites and warns if ML does not win. NDVI is used as a **lagged field productivity level/trend** (only seasons before the
yield year, so no leakage), never converted directly into yield.

Try the whole pipeline on fake data first: `python tuning/make_demo_data.py --out demo`, then run step 1 with `--ndvi-dir demo/ndvi --yields demo/yields.csv --offline-demo --out demo/table.csv`.
Point tuning outputs elsewhere with `--out`, and use `CROPROT_MODEL_DIR` / `CROPROT_CALIBRATION` env vars to test them without touching your real files.

NDVI sources: your own CSV (`date,ndvi`; NASA AppEEARS exports work), or `--fetch-ndvi` / the app checkbox, which pulls MODIS MOD13Q1 for the pixel
from NASA's ORNL DAAC REST service (no login; 10 dates per request, so the first call is slow, then cached).

CMIP6 projections: set `CLIMATE_TREND["mode"] = "manual"` (or use the app's extra-warming slider) and plug in warming/precip deltas from NASA NEX-GDDP-CMIP6 for your location.

## Known limitations (read before trusting numbers)

- **Starter values.** Everything in `crops.csv`, `regions.csv`, prices and costs comes from general agronomy knowledge, not local calibration. Verify with extension data; tune with your yields.
- **Not yet tested against real NASA responses.** The build environment blocked NASA's servers, so the POWER and NDVI downloaders follow the documented APIs but were never run live. If the first real call fails or looks odd, check `data/cache/` and the response format first.
- NASA POWER is a ~50 km grid and MODIS NDVI is 250 m (mixed pixels): regional signal, not field-level truth.
- Simplified agronomy: bucket water balance (no waterlogging, hail, pests beyond disease-break rules), simple N model, alfalfa treated as an annual hay crop, "winter wheat" means true winter type (spring-sown-in-autumn systems are not modelled).
- Previous-crop effects are rule-based (config), not learned. Calibrate them from long-term rotation trials when you have them.
- The Streamlit UI was smoke-tested with a stubbed `streamlit` module; the map-click widget has not been exercised.
- Decision support only. Have a local agronomist review recommendations.
