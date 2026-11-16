# The Green Revolution | Final Crop Rotation Simulator

## Install in your existing SpaceApps26 Codespace (recommended)

1. Commit or back up your current changes, especially `app.py`.
2. Upload **Green_Revolution_Crop_Rotation_Simulator_Upgrade.zip** into `/workspaces/SpaceApps26`.
3. Stop the old Python server using **Ctrl+C**.
4. Run:

```bash
unzip -o Green_Revolution_Crop_Rotation_Simulator_Upgrade.zip
python3 app.py
```

5. In Codespaces, open forwarded port **8000** and visit `/SIMULATIONS/simulations.html`.
6. Hard refresh (Ctrl+Shift+R) if the browser has cached old CSS or JavaScript.

This upgrade replaces `SIMULATIONS/simulations.html` and `app.py`, adds `assets/css/farm-planner.css`, `assets/js/farm-planner.js`, `farmwise_backend.py`, and a backend test. It does **not** replace the homepage, Explore the Land, or science pages.

## How it works

- Search for a city by typing 3+ letters. Suggestions use the **existing** `/api/geocode` endpoint. Select a suggestion to fill its latitude/longitude. Manual coordinates also work.
- Choose an existing cropping pattern, soil texture, water availability, crops you can access, current practices, and your main priority.
- Click **Analyze farm & recommend rotations**. The server requests NASA POWER daily historical weather for **2016–2025** and fills the growing-season rainfall, rainfall trend and heat exposure. The page displays actual growing-season rainfall history.
- The **original uploaded crop-family scoring** forms the basis of five comparisons: your existing system, balanced soil builder, water-wise, ecosystem-first and broadleaf break. The user-selected priority changes relative scores.
- The winning option is a **prototype screening preference**, not a validated crop recommendation, forecast yield, expected profit, or verified carbon-sequestration result.
- The results include an explanation, supporting NASA weather context, soil-health actions, warnings, and a farm-budget arithmetic example **only if you enter both extra-revenue and cost estimates**.
- Optional buttons call `/api/farm-normals` (1991–2020 NASA monthly baseline) or `/api/farm-ndvi` (quality-screened MODIS NDVI), using the supplied `server.py` logic now included as `farmwise_backend.py`. They are *not* required for core recommendations and may take longer or be unavailable.

## Scientific scope and caveats

- NASA POWER is **regional gridded meteorology**, not a field-level sensor.
- The MODIS NDVI optional value is a **~250 m point pixel**, not a soil-health score, field-mean, or direct measurement of nitrogen. To prevent a misleading conclusion, NDVI is shown as context, not used to automatically change the ranking.
- Rainfall from NASA POWER is Apr–Sep growing-season totals in the main simulator. There are **no universal annual rain cutoffs** applied to these seasonal values.
- The uploaded model uses **illustrative crop-family suitability ratings**. It is not calibrated to the many individual crops in the selection list, the local market, irrigation requirements, or a worldwide planting calendar.
- Before acting, check local extension guidance, soil testing, crop timing, varieties, disease breaks, cost and market access.
- The *optional* 1991–2020 climate normal and 2016–2025 daily climate series refer to **different periods** and are labeled separately.
- Data retrieval uses live remote APIs with successful responses cached by the Python server. There is no NASA key required for public endpoints. Real network connections must be tested in your Codespace.

## Developer files

- `SIMULATIONS/simulations.html`: original uploaded farm profile, now integrated into shared Green Revolution navigation.
- `assets/css/farm-planner.css`: scoped styles based on uploaded `home (1).html`, extended to match the rest of the site.
- `assets/js/farm-planner.js`: original uploaded crop-family scores, city suggestions, NASA data integration, and transparent result explanations.
- `app.py`: the existing multi-page web server, enhanced with *optional* `/api/farm-normals` and `/api/farm-ndvi` endpoints.
- `farmwise_backend.py`: original uploaded Python monthly climate and MODIS logic, imported by `app.py`. **Do not start this file as a second server.**
- `tests/test_farmwise_integration.py`: regression tests for the optional backend.

## Diagnostics

Run `python3 -m unittest discover -s tests -v`. If the city dropdown is empty, try `/api/geocode?q=Hyderabad`. If daily NASA weather fails, try `/api/climate?lat=17.385&lon=78.487` from the Codespaces port 8000 URL. Optional endpoints can take longer. The main simulation works without them.

## Privacy

The city's approximate coordinates are sent to public weather/geocoding services. The app does not require personal contact information. It is a prototype, not a private farm record management system.
