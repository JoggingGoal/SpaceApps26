# SpaceApps26

## Run the Fieldwise planner

From the repository root, start the app and its same-origin NASA POWER proxy:

```sh
python3 server.py
```

Open [http://localhost:8000/home.html](http://localhost:8000/home.html). In a Codespace, open forwarded port 8000 from the **Ports** tab.

Latitude and longitude are required. Submitting the form automatically sends those coordinates to NASA POWER and the NASA ORNL DAAC MODIS service to load climate and vegetation data before generating rotation ideas. Loading the historical MODIS observations may take around a minute. POWER supplies the monthly Agroclimatology parameters `PRECTOTCORR`, `T2M`, and `T2M_MAX` for 1991–2020. Rain rates (mm/day) are converted to monthly totals and averaged as annual rainfall; the rainfall-pattern indicator compares the first and last 15 years.

NDVI comes from MODIS `MOD13Q1`, a 250 m, 16-day vegetation-index product. The server applies the `0.0001` NDVI scale factor, keeps pixels with reliability ranks 0–1, averages valid composites by year over the five latest complete years, then calculates a linear NDVI/year trend. At least three years with five or more valid composites per year are needed. This is a point-pixel estimate, not a farm-boundary average.

NASA POWER does not provide field slope. Enter slope, erosion, and drainage observations under **Advanced: terrain & field details**. Water availability, soil texture, and other field observations remain farmer-entered model parameters. The searchable crop picker contains 342 crop-name options grouped into broad rotation families; it is a candidate list, not a crop-specific agronomy or market-availability database.