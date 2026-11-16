CITY AUTOCOMPLETE UPGRADE — THE GREEN REVOLUTION

WHAT THIS CHANGES
- MAP/map.html: adds autocomplete accessibility hooks and loads the standalone script.
- assets/js/city-autocomplete.js: live city suggestions, dropdown, keyboard controls, no reload.
- assets/js/map.js: listens for city selection; only recenters map, does NOT request NASA data.
- assets/css/land-explorer.css: dropdown appearance matching the site.

INSTALL (in Codespaces /workspaces/SpaceApps26):
1. Stop python3 app.py with Ctrl+C.
2. Upload Green_Revolution_City_Autocomplete_Upgrade.zip to SpaceApps26.
3. Optional safety: cp MAP/map.html MAP/map-before-autocomplete.html
4. unzip -o Green_Revolution_City_Autocomplete_Upgrade.zip
5. python3 app.py
6. Open Port 8000 → MAP/map.html; Ctrl+Shift+R to bypass cache.

TEST
- Type 'lon' → matching cities appear (after a short pause).
- Type 'springfield' → multiple states appear.
- Arrow keys and Enter choose an option; Escape closes the list.
- Clicking a suggestion updates the location panel and centers the map.
- It does NOT automatically load NASA weather, intentionally; click Analyze this location later.

SOURCE
Existing Python app.py already provides /api/geocode?q=... using Open-Meteo geocoding service. No new API key needed.
If you get 'City suggestions unavailable', test /api/geocode?q=London while the Python server runs and inspect terminal errors.
