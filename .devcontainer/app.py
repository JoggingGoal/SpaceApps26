"""
Streamlit app:  streamlit run app.py

Simple inputs are always visible; everything else is under "Advanced inputs". All the work is done by
engine.recommend(), the same function the command-line tool uses.
"""
import io
import json
from datetime import timedelta

import numpy as np
import pandas as pd
import streamlit as st

import config
import engine

try:
    import folium
    from streamlit_folium import st_folium
    HAVE_MAP = True
except Exception:          # map is optional: falls back to latitude/longitude boxes
    HAVE_MAP = False

st.set_page_config(page_title="Crop Rotation Planner", layout="wide")

CROPS = engine.load_crops()
LABEL = dict(zip(CROPS["crop"], CROPS["label"]))
NONE = "(none / unknown)"


def doy_text(doy):
    if doy is None or doy != doy:
        return "none"
    return (pd.Timestamp(2001, 1, 1) + timedelta(days=int(doy) - 1)).strftime("%b %d")


# ---------------------------------------------------------------------------------------------
st.title("🌾 Crop Rotation Planner")
st.caption("Suggests profitable, eco-friendly rotations from NASA climate (and optionally NDVI) history for your field. "
           "Decision support only: check suggestions with a local agronomist or extension service.")

for k, v in (("lat", 41.6), ("lon", -93.6)):
    st.session_state.setdefault(k, v)

# ---------------------------------------------------------------------------------------------
# Key inputs
# ---------------------------------------------------------------------------------------------
left, right = st.columns([3, 2])
with left:
    st.subheader("1. Where is the field?")
    if HAVE_MAP:
        m = folium.Map(location=[st.session_state["lat"], st.session_state["lon"]], zoom_start=5)
        folium.Marker([st.session_state["lat"], st.session_state["lon"]]).add_to(m)
        out = st_folium(m, height=360, use_container_width=True, returned_objects=["last_clicked"])
        clicked = (out or {}).get("last_clicked")
        if clicked and (abs(clicked["lat"] - st.session_state["lat"]) > 1e-6 or abs(clicked["lng"] - st.session_state["lon"]) > 1e-6):
            st.session_state["lat"], st.session_state["lon"] = round(clicked["lat"], 4), round(clicked["lng"], 4)
        st.caption("Click the map to move the pin.")
    else:
        st.map(pd.DataFrame({"lat": [st.session_state["lat"]], "lon": [st.session_state["lon"]]}))
        st.caption("Install folium and streamlit-folium to pick the location by clicking the map.")

with right:
    st.subheader("2. Your field")
    c1, c2 = st.columns(2)
    lat = c1.number_input("Latitude", min_value=-60.0, max_value=72.0, step=0.01, format="%.4f", key="lat")
    lon = c2.number_input("Longitude", min_value=-180.0, max_value=180.0, step=0.01, format="%.4f", key="lon")
    field_ha = st.number_input("Field size (hectares)", min_value=0.1, value=40.0, step=1.0)
    opts = [NONE] + list(CROPS["crop"])
    p1, p2, p3 = st.columns(3)
    prev3 = p1.selectbox("3 seasons ago", opts, format_func=lambda c: c if c == NONE else LABEL[c])
    prev2 = p2.selectbox("2 seasons ago", opts, format_func=lambda c: c if c == NONE else LABEL[c])
    prev1 = p3.selectbox("Last season", opts, format_func=lambda c: c if c == NONE else LABEL[c])
    water = st.selectbox("Water", ["Rain-fed (no irrigation)", "Limited irrigation", "Full irrigation"])
    irr_mm = 0.0
    if water == "Limited irrigation":
        irr_mm = st.number_input("Irrigation available (mm per season)", min_value=0.0, value=150.0, step=25.0)
    horizon = st.selectbox("Planning horizon (years)", [3, 4, 5], index=1)
    eco_w = st.slider("Goal: maximum profit  ←→  maximum eco-friendliness", 0, 100, 50)
    risk = st.select_slider("How much bad-year risk can you accept?", options=["low", "medium", "high"], value="medium")

# ---------------------------------------------------------------------------------------------
# Advanced inputs
# ---------------------------------------------------------------------------------------------
with st.expander("Advanced inputs (optional)"):
    t_crops, t_soil, t_water, t_econ, t_prac, t_ndvi = st.tabs(
        ["Crops", "Soil & land", "Water & climate", "Economics", "Practices & rules", "NDVI (NASA)"])

    with t_crops:
        default_list = engine.default_available(CROPS, lat, lon)
        _, region_names = engine.region_crops(lat, lon)
        st.caption("Crops commonly grown here: " + (", ".join(region_names) if region_names else "no region match, showing all non-contract crops")
                   + ". Add contract/forage crops (potato, alfalfa) if you can really grow and sell them.")
        avail = st.multiselect("Crops you can grow", list(CROPS["crop"]), default=default_list,
                               format_func=lambda c: LABEL[c], key="avail_" + "_".join(region_names))
        must = st.multiselect("Crops that must appear in the rotation", avail, format_func=lambda c: LABEL[c])

    with t_soil:
        s1, s2 = st.columns(2)
        texture = s1.selectbox("Soil texture", list(config.SOIL_AWC_MM_PER_M), index=list(config.SOIL_AWC_MM_PER_M).index("loam"))
        om = s2.number_input("Soil organic matter (%)", min_value=0.0, max_value=15.0, value=3.0, step=0.1)
        ph = s1.number_input("Soil pH", min_value=3.5, max_value=9.5, value=6.5, step=0.1)
        slope = s2.number_input("Slope (%)", min_value=0.0, max_value=40.0, value=2.0, step=0.5)

    with t_water:
        irr_cost = st.number_input("Irrigation cost (USD per mm per ha)", min_value=0.0, value=config.IRRIGATION_USD_PER_MM_HA, step=0.1)
        scen_label = st.selectbox("Climate projection", ["Continue the historical trend", "No trend (future = past)", "Add extra warming"])
        extra_warm = 0.0
        if scen_label == "Add extra warming":
            extra_warm = st.slider("Extra warming (°C per decade, on top of the historical trend)", 0.0, 1.0, 0.3, 0.05)
        demo = st.checkbox("Demo mode: synthetic climate, no internet (results are NOT real)", value=False)

    with t_econ:
        fert = st.number_input("Nitrogen fertiliser price (USD per kg N)", min_value=0.0, value=config.FERTILIZER_USD_PER_KG_N, step=0.1)
        st.caption("Prices and costs are placeholders. Edit them to your local numbers (cost excludes fertiliser and irrigation).")
        edited = st.data_editor(CROPS[["crop", "label", "price_usd_t", "cost_usd_ha"]], hide_index=True,
                                disabled=["crop", "label"], key="price_editor")
        base = CROPS.set_index("crop")
        price_over = {r.crop: float(r.price_usd_t) for r in edited.itertuples() if abs(r.price_usd_t - base.loc[r.crop, "price_usd_t"]) > 1e-9}
        cost_over = {r.crop: float(r.cost_usd_ha) for r in edited.itertuples() if abs(r.cost_usd_ha - base.loc[r.crop, "cost_usd_ha"]) > 1e-9}

    with t_prac:
        a1, a2 = st.columns(2)
        tillage = a1.selectbox("Tillage", list(config.TILLAGE), index=1)
        cert = a2.selectbox("Certification", ["conventional", "organic"])
        cover = st.checkbox("Willing to use cover crops", value=False)
        problems = st.multiselect("Known problems in this field", [k for k, v in config.PROBLEM_EFFECTS.items() if v],
                                  format_func=lambda s: s.replace("_", " "))
        st.markdown("**Eco score weights** (relative importance of each component)")
        eco_w_cfg = {}
        cols = st.columns(3)
        for i, (k, v) in enumerate(config.ECO_WEIGHTS.items()):
            eco_w_cfg[k] = cols[i % 3].slider(k.replace("_", " "), 0.0, 1.0, float(v), 0.05)

    with t_ndvi:
        st.caption("NDVI (greenness) history gives a field productivity trend. Upload a CSV with date and ndvi columns "
                   "(NASA AppEEARS exports work), or let the app download MODIS NDVI for the pin from NASA's ORNL DAAC (slow the first time).")
        up = st.file_uploader("NDVI CSV", type=["csv"])
        fetch = st.checkbox("Download MODIS NDVI for this location from NASA (experimental)", value=False)

# ---------------------------------------------------------------------------------------------
run = st.button("Find rotations", type="primary")

if run:
    inp = dict(
        lat=float(lat), lon=float(lon), field_ha=float(field_ha),
        prev_crops=[c for c in (prev3, prev2, prev1) if c != NONE],
        irrigation={"Rain-fed (no irrigation)": "rainfed", "Limited irrigation": "limited", "Full irrigation": "full"}[water],
        irrigation_mm=float(irr_mm), horizon=int(horizon), eco_weight=eco_w / 100.0, risk=risk,
        available_crops=avail, must_include=must,
        soil_texture=texture, om_pct=float(om), ph=float(ph), slope_pct=float(slope),
        irrigation_usd_per_mm_ha=float(irr_cost), fert_usd_per_kg_n=float(fert),
        price_overrides=price_over, cost_overrides=cost_over,
        climate_scenario={"Continue the historical trend": "historical", "No trend (future = past)": "none",
                          "Add extra warming": "historical"}[scen_label],
        extra_warming_c_per_decade=float(extra_warm),
        climate_source="synthetic" if demo else "nasa",
        tillage=tillage, certification=cert, cover_crops=bool(cover), known_problems=problems, eco_weights=eco_w_cfg,
        fetch_ndvi=bool(fetch),
    )
    if up is not None:
        try:
            inp["ndvi_df"] = pd.read_csv(io.BytesIO(up.getvalue()))
        except Exception as e:
            st.warning(f"Could not read the NDVI file: {e}")
    bar = st.progress(0.0, text="Starting")
    try:
        res = engine.recommend(inp, progress=lambda msg, f: bar.progress(min(1.0, f), text=msg))
        st.session_state["result"] = res
        st.session_state["inputs"] = {k: v for k, v in inp.items() if k != "ndvi_df"}
    except engine.RecommendError as e:
        st.session_state.pop("result", None)
        st.error(str(e))
    bar.empty()

# ---------------------------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------------------------
res = st.session_state.get("result")
if res:
    meta, clim = res["meta"], res["climate"]
    for w in meta["warnings"]:
        st.warning(w)
    st.success(f"{meta['n_rotations']:,} possible {meta['horizon']}-year rotations evaluated for {meta['start_year']}-"
               f"{meta['start_year'] + meta['horizon'] - 1} using: {', '.join(meta['candidates'])}.")
    tab_rec, tab_trade, tab_clim, tab_model = st.tabs(
        ["Recommended rotations", "Profit vs eco trade-off", "NASA climate & NDVI", "Model & tuning"])

    with tab_rec:
        for r, d in zip(res["rotations"].itertuples(), res["details"]):
            st.subheader(f"#{r.rank}  {r.rotation}")
            c = st.columns(5)
            c[0].metric("Profit / ha / yr", f"${r.profit_usd_ha_yr:,.0f}")
            c[1].metric("Bad-year profit / ha", f"${r.downside_profit_usd_ha_yr:,.0f}")
            c[2].metric("Eco score (0-1)", f"{r.eco_score:.2f}")
            c[3].metric("Fertiliser N (kg/ha/yr)", f"{r.fert_n_kg_ha_yr:.0f}")
            c[4].metric("Field profit over horizon", f"${r.profit_total_usd:,.0f}")
            for n in r.why:
                st.markdown(f"- {n}")
            with st.expander("Year by year"):
                st.dataframe(d.round(1), hide_index=True)
            with st.expander("Eco score breakdown"):
                comp = pd.DataFrame({"component": [k[4:].replace("_", " ") for k in res["rotations"].columns if k.startswith("eco_") and k != "eco_score"],
                                     "score": [getattr(r, k) for k in res["rotations"].columns if k.startswith("eco_") and k != "eco_score"]})
                st.bar_chart(comp.set_index("component"))
                st.caption(f"Estimated nitrogen-related emissions: {r.ghg_kg_co2e_ha_yr:.0f} kg CO2e/ha/yr; irrigation {r.irrigation_mm_yr:.0f} mm/yr.")
        st.download_button("Download recommendations (CSV)",
                           res["rotations"].drop(columns=["crops", "why"]).to_csv(index=False), "rotations.csv", "text/csv")

    with tab_trade:
        st.caption("Each dot is a rotation that no other rotation beats on both risk-adjusted profit and eco score. "
                   "Your slider chose where on this curve the recommendations sit.")
        st.scatter_chart(res["frontier"], x="eco_score", y="profit_usd_ha_yr")
        st.dataframe(res["frontier"].round(2), hide_index=True)

    with tab_clim:
        st.markdown(f"**Climate source:** {clim['source']}  ·  {clim['years_used']} weather years used")
        s = clim["summary"]
        if s:
            c = st.columns(4)
            c[0].metric("Typical last spring frost", doy_text(s["median_last_spring_frost_doy"]))
            c[1].metric("Typical first fall frost", doy_text(s["median_first_fall_frost_doy"]))
            c[2].metric("Growing degree days (May-Sep, base 10 °C)", f"{s['median_gdd10_may_sep']:.0f}")
            c[3].metric("Annual precipitation", f"{s['median_annual_precip_mm']:.0f} mm")
            st.caption("For southern-hemisphere locations the calendar is shifted by 6 months internally; dates above are on that shifted calendar.")
        t = clim["trend"]
        st.markdown(f"**Trend used for projection ({t['mode']}):** {t['temp_c_per_decade']:+.2f} °C per decade, "
                    f"{t['precip_pct_per_decade']:+.1f}% precipitation per decade "
                    f"(raw fit {clim['trends_raw']['temp_c_per_decade']:+.2f} °C and {clim['trends_raw']['precip_pct_per_decade']:+.1f}% per decade).")
        if len(clim["table"]):
            tb = clim["table"].set_index("year")
            st.line_chart(tb[["tmean_c"]])
            st.line_chart(tb[["precip_mm"]])
        nd = res["ndvi"]
        if nd.get("df") is not None:
            st.markdown(f"**NDVI:** {nd['label']} · {nd['n_years']} usable seasons · mean peak {nd['mean_peak']:.2f} · "
                        f"trend {nd['trend_pct_per_year']:+.2f}% per year" + ("" if nd["usable"] else " (not enough years, trend not used)"))
            st.line_chart(nd["df"].set_index("date")["ndvi"])
        else:
            st.info("No NDVI loaded. Add it under Advanced inputs > NDVI (NASA) to include the field's productivity trend.")

    with tab_model:
        st.markdown(f"**Yield model in use:** {meta['model']}")
        st.markdown(f"**Extra nitrogen credit assumed (organic matter, cover crop, manure):** {meta['extra_n_credit_kg_ha']:.0f} kg N/ha")
        if len(res["excluded_crops"]):
            st.markdown("**Crops dropped because the climate does not support them here:**")
            st.dataframe(res["excluded_crops"], hide_index=True)
        st.markdown(f"""
### Make the model better with your data
1. **Tune the numbers**: `config.py` (weights, rules, thresholds) and `data/crops.csv` (one row per crop). No code changes needed.
2. **Collect real yields** (field records, USDA NASS / national statistics, trials) in `site_id, lat, lon, year, crop, yield_t_ha` format.
3. **Join with NASA data**: `python tuning/build_training_table.py --yields data/my_yields.csv --ndvi-dir data/ndvi`
4. **Calibrate the rules** (small data): `python tuning/calibrate_rules.py`  ·  **or train ML** (300+ records): `python tuning/train_model.py`
5. Restart the app. It picks up `data/calibration.json` / `models/yield_model.joblib` automatically.

Current status: calibration file {'**found**' if config.CALIBRATION_FILE.exists() else 'not present'} ·
ML model {'**found**' if (config.MODEL_DIR / 'yield_model.joblib').exists() else 'not present'}.
""")
        st.download_button("Download the inputs used (JSON)", json.dumps(st.session_state.get("inputs", {}), indent=2, default=str),
                           "inputs.json", "application/json")
