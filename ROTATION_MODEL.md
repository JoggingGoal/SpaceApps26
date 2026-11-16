# Green Revolution: rotation recommendation model (v5)

This prototype provides **transparent, reproducible screening comparisons**, not agronomic prescriptions or a validated optimization engine. It uses NASA POWER regional daily weather returned by the existing `/api/climate` route. There is no new API key, dependency, or server route. The numerical scoring code lives in `assets/js/rotation-engine.mjs` and is unit-tested with Node.

## Required input and constraints

- Select **2–8 distinct named cash crops** from the 342-item searchable list. The picker retains multiple selections as you search. Optional cover crops can also be chosen, but **never become invented cash-crop years**.
- Each candidate cash-crop year uses **exactly one of those named choices**. The engine creates distinct two-, three- and four-year cyclic plans; equivalent cyclic re-orderings are deduplicated.
- Optionally enter your real current crop(s) as a comparison baseline. A reported baseline is never presented again as a new alternative.
- To generate scores, at least **three sufficiently complete NASA growing seasons** are required. Missing NASA data does not trigger invented results.
- Season choices: April–September, October–March or full calendar year. Users must select a relevant agricultural calendar. The app does not know exact planting dates or crop-specific phenology.

## Historical weather measurements

Daily regional gridded NASA POWER data (`PRECTOTCORR`, `T2M_MAX`, `T2M_MIN`) are grouped into selected-season years. A seasonal year is included only if at least 90% of days contain all three measurements. The website displays:
- total seasonal precipitation (mm)
- days with Tmax >= 32 °C (a *screening threshold*, not a universal damage threshold)
- longest run of days with precipitation < 1 mm (screening convention)
- thermal time and frost days (available in the pure engine, though crop-by-crop growth simulation is not implemented)

For October–March, each season spans two calendar years; incomplete start/end periods are excluded.

## The exact screening mathematics

For season `y`, define:

- `R_y = clip((median(P) - P_y) / median(P), 0, 1)`, a within-period precipitation shortfall;
- `L_y = clip((drySpell_y - median(drySpell)) / max(7, median(drySpell)), 0, 1)`;
- `H_y = clip((hotDays_y - median(hotDays)) / max(12, median(hotDays)), 0, 1)`;
- `D_y = 0.7 R_y + 0.3 L_y`.

Each crop has explicit qualitative parameters `waterNeed`, `droughtTolerance`, and `heatTolerance` in [0,1]. For familiar named crops, the file contains an explicit *screening assumption*. For other crops, it uses a broader category default, **flagged as lower-confidence**. These are **not** FAO crop coefficients, measured crop tolerance, or yield-response coefficients.

`WeatherFit(crop,y) = clip(86 - I × waterNeed - 42 D_y × (1 - droughtTolerance) - 29 H_y × (1 - heatTolerance), 0,100)`

Where `I` is a *heuristic* irrigation-availability penalty (0 for ample supply; 5 for adequate, 7 unknown, 14 for limited). Soil compatibility similarly uses explicit **heuristic texture matrix ratings**, not the USDA Web Soil Survey or laboratory tests. Soil pH, organic matter and slope are used for management cautions rather than arbitrary numerical crop-fit penalties.

Crop family diversity is computed using botanical families when known. The engine calculates:

- `Simpson D = 1 - sum(p_family^2)`
- `breakRate = share of adjacent crop-year transitions crossing to a different family`, including the loop from the last year back to the first
- `diversityIndex = 100 × [0.6 × (D / (1 − 1/n)) + 0.4 × breakRate]`, for n≥2
- `soilStewardshipScreen = clip(0.86 × diversityIndex + (legume present ? 14 : 0))`

This is a **diversity screening score**, not an observed soil-health index, carbon-stock change, erosion estimate or validated pest-risk predictor.

The model gives adoption simplicity a separately visible rating based on the number of years, generic profiles and likely perennial complexity. Weighting by farmer priority:

| Priority | Weather | Soil | Diversity/soil stewardship | Adoption |
|---|---:|---:|---:|---:|
| Balanced | 32% | 19% | 29% | 20% |
| Soil | 16% | 25% | 45% | 14% |
| Water | 52% | 17% | 20% | 11% |
| Ease of adoption | 19% | 13% | 17% | 51% |

`Score_y` is the weighted mean of these four screening ratings. Final `Score = 80% × mean(Score_y) + 20% × mean(lowest-scoring quarter of years)`.

The last term gives extra influence to difficult historical seasons, **not** projected future weather probabilities. Changing crops, priorities, soil texture, water availability or seasonal calendar can change results. The model compares top rotations with any *reported* existing sequence and explicitly recommends retaining the current sequence if it ranks higher.

## Scientific and operational limitations

1. **No crop-specific regional planting-calendar validation**. An assumed frost-free period is only advisory. The model cannot tell you that rice is appropriate in Iowa, or that winter wheat fits a particular monsoon planting window.
2. **No simulated crop yields, profitability, nitrogen fixation amounts, soil organic carbon change, erosion tonnes, or direct SMAP soil moisture**. The optional NASA MODIS request is for context only; NDVI is not interpreted as field soil health.
3. **Not every named crop has a species-specific profile**. Generic scores have lower confidence. Crops from the same botanical family may not provide a suitable pathogen break, and some apparent crop families contain diverse phenotypes.
4. **No actual root-zone water balance**. The weather model uses within-record anomalies and qualitative traits, not FAO-56 ETc, real irrigation supply, soil hydraulic measurements or calibrated crop response.
5. Scores are preference indices. **“87/100” never means an 87% chance of success**. Small differences should not drive planting decisions. Always verify locally.

## Sources for background principles and data provenance

- NASA POWER Daily Point API: https://power.larc.nasa.gov/docs/services/api/temporal/daily/
- USDA NRCS soil-health principles: https://www.farmers.gov/soilhealth
- NRCS Soil Health on Cropland: https://www.nrcs.usda.gov/conservation-basics/soil/soil-health/soil-health-on-cropland
- FAO-56 reference crop evapotranspiration: https://www.fao.org/4/X0490E/x0490e0b.htm

These references support the importance of weather, crop families, plant diversity and cover practices. **They do not validate our invented screening coefficients**. The coefficients are fully exposed so the model can be replaced with agronomically calibrated data in future work.

## Run tests

```bash
node --test tests/rotation-engine.test.mjs
python3 -m unittest discover -s tests
```

## Installation

Extract the update ZIP at the `SpaceApps26` root, overwriting `SIMULATIONS/simulations.html`, `assets/css/farm-planner.css` and `assets/js/farm-planner.js`; it adds `assets/js/rotation-engine.mjs`, `tests/rotation-engine.test.mjs`, and this document. The existing `app.py`, map, homepage, and science hub are **not changed**. Start with `python3 app.py` and open port 8000.
