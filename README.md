# When does your part of the world cross +2 °C?

DSC 106 Project 3: an interactive D3 map of CMIP6 (GFDL-ESM4) temperature change, 1850-2100, under three emissions paths.

- `index.html`, `main.js`, `style.css`: the visualization (D3 v7 + topojson-client only)
- `data/tas.json`: annual temperature anomalies on a 5° grid, built by `scripts/prepare_data.py`
- `scripts/explore.py` and `exploration/`: the static exploratory charts

Rebuild the data:

    uv run --with xarray --with zarr --with gcsfs --with numpy --with cftime --with dask python scripts/prepare_data.py
