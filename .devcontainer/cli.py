"""
Command-line runner:  python cli.py --lat 41.6 --lon -93.6 --prev maize,soybean --horizon 4 --eco 0.5
Add --offline for synthetic demo climate (no internet). Use --inputs file.json for the full parameter set
(any key from engine.DEFAULTS), --json out.json to save the results.
"""
import argparse
import json
import sys

import pandas as pd

import engine


def parse():
    p = argparse.ArgumentParser(description="Crop rotation recommender")
    p.add_argument("--inputs", help="JSON file with any engine input keys")
    p.add_argument("--lat", type=float)
    p.add_argument("--lon", type=float)
    p.add_argument("--field-ha", type=float)
    p.add_argument("--prev", help="previous crops, oldest to most recent, comma separated (crop keys from data/crops.csv)")
    p.add_argument("--horizon", type=int)
    p.add_argument("--eco", type=float, help="0 = max profit ... 1 = max eco")
    p.add_argument("--risk", choices=["low", "medium", "high"])
    p.add_argument("--irrigation", choices=["rainfed", "limited", "full"])
    p.add_argument("--irrigation-mm", type=float)
    p.add_argument("--crops", help="available crops, comma separated")
    p.add_argument("--exclude", help="crops to exclude, comma separated")
    p.add_argument("--organic", action="store_true")
    p.add_argument("--ndvi-csv", help="CSV with date,ndvi for the field")
    p.add_argument("--fetch-ndvi", action="store_true", help="download MODIS NDVI from NASA ORNL DAAC (slow, cached)")
    p.add_argument("--offline", action="store_true", help="synthetic demo climate instead of NASA POWER")
    p.add_argument("--top", type=int)
    p.add_argument("--json", help="write full results to this JSON file")
    return p.parse_args()


def main():
    a = parse()
    inp = json.load(open(a.inputs)) if a.inputs else {}
    m = {"lat": a.lat, "lon": a.lon, "field_ha": a.field_ha, "horizon": a.horizon, "eco_weight": a.eco, "risk": a.risk,
         "irrigation": a.irrigation, "irrigation_mm": a.irrigation_mm, "ndvi_csv": a.ndvi_csv, "top_n": a.top}
    inp.update({k: v for k, v in m.items() if v is not None})
    if a.prev: inp["prev_crops"] = a.prev.split(",")
    if a.crops: inp["available_crops"] = a.crops.split(",")
    if a.exclude: inp["exclude_crops"] = a.exclude.split(",")
    if a.organic: inp["certification"] = "organic"
    if a.fetch_ndvi: inp["fetch_ndvi"] = True
    if a.offline: inp["climate_source"] = "synthetic"
    try:
        res = engine.recommend(inp, progress=lambda msg, f: print(f"  [{int(f * 100):3d}%] {msg}", file=sys.stderr))
    except engine.RecommendError as e:
        sys.exit(f"Error: {e}")

    meta, clim = res["meta"], res["climate"]
    print(f"\nClimate : {clim['source']}  (trend {clim['trend']['temp_c_per_decade']:+.2f} C/decade, "
          f"{clim['trend']['precip_pct_per_decade']:+.1f}% precip/decade, {clim['years_used']} weather years)")
    print(f"Model   : {meta['model']}")
    print(f"Crops   : {', '.join(meta['candidates'])}")
    if len(res["excluded_crops"]):
        print("Dropped : " + "; ".join(f"{r.crop} ({r.reason})" for r in res["excluded_crops"].itertuples()))
    print(f"Search  : {meta['n_rotations']:,} rotations evaluated, {meta['n_pareto']} on the profit/eco frontier")
    for w in meta["warnings"]:
        print(f"WARNING : {w}")
    pd.set_option("display.width", 200)
    for r, d in zip(res["rotations"].itertuples(), res["details"]):
        print(f"\n#{r.rank}  {r.rotation}")
        print(f"    profit ${r.profit_usd_ha_yr:,.0f}/ha/yr (poor-year avg ${r.downside_profit_usd_ha_yr:,.0f}) | "
              f"eco {r.eco_score:.2f} | N {r.fert_n_kg_ha_yr:.0f} kg/ha/yr | irrigation {r.irrigation_mm_yr:.0f} mm/yr")
        for n in r.why:
            print(f"    - {n}")
        print(d.round(1).to_string(index=False))
    if a.json:
        out = {"rotations": res["rotations"].to_dict("records"), "details": [d.to_dict("records") for d in res["details"]],
               "frontier": res["frontier"].to_dict("records"), "excluded": res["excluded_crops"].to_dict("records"),
               "meta": meta, "climate_source": clim["source"]}
        json.dump(out, open(a.json, "w"), indent=2, default=float)
        print(f"\nSaved {a.json}")


if __name__ == "__main__":
    main()
