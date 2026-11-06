"""Build data/tas.json from the public CMIP6 archive on Google Cloud.

Model: NOAA-GFDL GFDL-ESM4, member r1i1p1f1, monthly near-surface air temperature (Amon/tas).
Experiments: historical (1850-2014) and three future scenarios (2015-2100):
  ssp126 (strong mitigation), ssp245 (middle of the road), ssp585 (fossil-fuelled growth).

Transformations (also described on the page):
  1. Monthly -> annual mean per grid cell.
  2. Native 1 x 1.25 degree grid -> 5 x 5 degree cells (plain block mean of 5 x 4 native cells).
  3. Anomaly = annual mean minus that cell's own 1850-1900 average (pre-industrial baseline).
  4. Global mean = cos(latitude)-weighted average over all cells.
  5. Values stored as integers in tenths of a degree C to keep the file small.

Run:  uv run --with xarray --with zarr --with gcsfs --with numpy --with cftime --with dask python scripts/prepare_data.py
"""

import json
from pathlib import Path

import numpy as np
import xarray as xr

ROOT = "gs://cmip6/CMIP6"
STORES = {
    "historical": f"{ROOT}/CMIP/NOAA-GFDL/GFDL-ESM4/historical/r1i1p1f1/Amon/tas/gr1/v20190726/",
    "ssp126": f"{ROOT}/ScenarioMIP/NOAA-GFDL/GFDL-ESM4/ssp126/r1i1p1f1/Amon/tas/gr1/v20180701/",
    "ssp245": f"{ROOT}/ScenarioMIP/NOAA-GFDL/GFDL-ESM4/ssp245/r1i1p1f1/Amon/tas/gr1/v20180701/",
    "ssp585": f"{ROOT}/ScenarioMIP/NOAA-GFDL/GFDL-ESM4/ssp585/r1i1p1f1/Amon/tas/gr1/v20180701/",
}
OUT = Path(__file__).resolve().parent.parent / "data" / "tas.json"


def annual_5deg(url):
    ds = xr.open_zarr(url, consolidated=True, storage_options={"token": "anon"})
    tas = ds["tas"] - 273.15  # Kelvin -> Celsius
    annual = tas.groupby("time.year").mean("time")
    nlat, nlon = annual.sizes["lat"], annual.sizes["lon"]
    # native cells per 5-degree block (180 x 288 grid -> 5 lat x 4 lon)
    coarse = annual.coarsen(lat=nlat // 36, lon=nlon // 72).mean()
    return coarse.load()


def main():
    runs = {name: annual_5deg(url) for name, url in STORES.items()}
    hist = runs["historical"]
    lat = hist["lat"].values
    lon = hist["lon"].values
    lon = np.where(lon > 180, lon - 360, lon)  # 0..360 -> -180..180 for the map

    baseline = hist.sel(year=slice(1850, 1900)).mean("year")
    weights = np.cos(np.deg2rad(lat))[:, None] * np.ones((1, len(lon)))
    weights = weights / weights.sum()

    def pack(da):
        anom = (da - baseline).values  # (year, lat, lon)
        glob = (anom * weights).sum(axis=(1, 2))
        cells = np.round(anom.reshape(anom.shape[0], -1) * 10).astype(int)
        return {
            "years": [int(y) for y in da["year"].values],
            "global": [round(float(g), 2) for g in glob],
            "cells": cells.tolist(),  # [year][cell], tenths of a degree C
        }

    out = {
        "source": "CMIP6 GFDL-ESM4 r1i1p1f1 Amon tas (NOAA-GFDL), Google Cloud public archive",
        "baseline": "1850-1900",
        "lat": [round(float(v), 2) for v in lat],
        "lon": [round(float(v), 2) for v in lon],
        "baselineTemp": np.round(baseline.values.reshape(-1), 1).tolist(),
        "runs": {name: pack(da) for name, da in runs.items()},
    }
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    for name, r in out["runs"].items():
        print(name, r["years"][0], r["years"][-1], "global end", r["global"][-1])
    print("cells", len(out["baselineTemp"]), "bytes", OUT.stat().st_size)


if __name__ == "__main__":
    main()
