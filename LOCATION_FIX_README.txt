THE GREEN REVOLUTION | EXPLORE THE LAND LOCATION FIX (v4)
========================================================

What changed
------------
- Guaranteed-visible local world map, even when an online tile service fails.
- World map supports pan/zoom, a city marker, and a selected-city label.
- City autocomplete selection immediately updates the right-hand city name
  and coordinates, moves the marker, and requests NASA POWER climate history.
- Analyze this location now refreshes the same weather data.
- Four tiles: selected season rainfall, hot days, dry spell, and 10-year
  average rainfall. No redundant 'reference year' tile.
- Historical charts are drawn with built-in SVG, no Chart.js needed.
- Clear loading/error messages if NASA's server cannot be reached.
- Open detailed map link shows the selected coordinates on OpenStreetMap.

Install (GitHub Codespaces)
--------------------------
1. Save your current project changes (git commit or make a backup).
2. Upload The_Green_Revolution_Location_Map_Data_Fix.zip to /workspaces/SpaceApps26.
3. Stop python3 app.py with Ctrl+C.
4. Run:
      unzip -o The_Green_Revolution_Location_Map_Data_Fix.zip
      python3 app.py
5. Open Port 8000. Refresh with Ctrl+Shift+R.
6. Search for Hyderabad, select a dropdown result, and check that the map,
   heading, coordinates, climate tiles and graph all update.

Files in upgrade
----------------
MAP/map.html
assets/js/map.js
assets/js/city-autocomplete.js
assets/css/land-explorer.css
assets/maps/world-overview.svg
LOCATION_FIX_README.txt

Notes
-----
The built-in map displays world countries and selected cities, not roads or
state boundaries. For roads, use the Open detailed map link. This approach
avoids previous OpenStreetMap tile HTTP 403 failures and blank canvases.
No NASA weather values are hard-coded. Local browser tests used a clearly
isolated simulated API response to test the interaction; live data still
must be verified in your Codespace.

If data fails, test your local server:
  curl http://localhost:8000/api/health
  curl 'http://localhost:8000/api/geocode?q=Hyderabad'
  curl 'http://localhost:8000/api/climate?lat=17.385&lon=78.4867'
