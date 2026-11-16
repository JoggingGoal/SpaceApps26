# The Green Revolution: Explore the Land (v3)

This is the working **Explore the Land** update for the existing Green Revolution website. The homepage, science page, and Crop Rotation Simulator are unchanged.

## What changed

- Removed fixed-date NDVI and SMAP imagery buttons from the main explorer. Those overlays were not location-specific enough to be useful for this workflow.
- Added **OpenFreeMap**'s labeled, zoomable map (OpenStreetMap data), displayed with MapLibre GL JS. Country, region, city, and street labels depend on zoom. This is a public internet service; if it or WebGL is unavailable, the page falls back to bundled Natural Earth country geometry.
- Added worldwide **city search** using the Open-Meteo geocoding API (GeoNames). This is an *address-to-coordinate* lookup, not a weather source.
- NASA POWER supplies all numerical rainfall, dry-spell, hot-day, and growing-degree-day charts for the selected city/coordinates. 2016–2025 is the fixed comparison period. These are regional gridded estimates, not field measurements.
- Moved the three metric explanations **directly below the map**. They compare the latest complete growing season to the same location's historical average. No universal crop targets are asserted.
- Added chart fallback (plain SVG) if Chart.js is unavailable.
- Changed the GSAP animations to avoid hiding text when scrolling upward. Reduced-motion mode remains supported.

## Install ONLY this upgrade in GitHub Codespaces

1. Backup your current project or make a Git commit.
2. Upload `The_Green_Revolution_Explore_Land_V3_Upgrade.zip` to `/workspaces/SpaceApps26`.
3. Stop the running server with `Ctrl+C`.
4. Extract in the root of the repository:

```bash
unzip -o The_Green_Revolution_Explore_Land_V3_Upgrade.zip
python3 app.py
```

5. Open the forwarded port 8000, go to `/MAP/map.html`, and hard-refresh (`Ctrl+Shift+R`).

## Test

1. Select **Ames, Iowa** and see a map zoom + NASA POWER observations.
2. Click **Heat exposure**, **Dry spells**, **Growing degree days**, **Monthly averages** and observe the chart title and values change.
3. Search **Paris, France**, choose a result, and check the displayed city and coordinates change. Search requires the Open-Meteo service.
4. Scroll down then back up. Headers should remain visible.
5. Scroll to **Soil characteristics** and change the texture selector.

If you see only bundled country outlines, the online map style or MapLibre could not load; the city search and NASA data are independent of map tiles.

## Data acknowledgments

- Map: OpenFreeMap / OpenStreetMap contributors / OpenMapTiles. Attribution in the map itself when vector tiles load.
- Offline countries: Natural Earth (public-domain geography).
- City search: Open-Meteo Geocoding API, location data from GeoNames.
- Weather: NASA POWER Daily Point API, `PRECTOTCORR`, `T2M_MAX`, `T2M_MIN`.

No user data is sent to a third-party map service apart from tile requests and geocoding queries; search queries are sent to Open-Meteo via the server. NASA requests send selected coordinates to NASA POWER.

## Development checks

```bash
python3 -m unittest discover -s tests
node --test tests/model.test.mjs
node --check assets/js/map.js
```

A live browser inspection in your Codespace is still required, especially to verify external map styles and NASA API access.
