"""Exploratory (static) charts from data/tas.json, saved to exploration/.

Run: uv run --with numpy --with matplotlib --with cartopy python scripts/explore.py
"""

import json
from pathlib import Path

import cartopy.crs as ccrs
import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "exploration"
OUT.mkdir(exist_ok=True)
d = json.loads((ROOT / "data" / "tas.json").read_text())
lat, lon = np.array(d["lat"]), np.array(d["lon"])
NLAT, NLON = len(lat), len(lon)
order = np.argsort(lon)
SCEN = {"ssp126": ("SSP1-2.6", "#2c7bb6"), "ssp245": ("SSP2-4.5", "#e6a100"), "ssp585": ("SSP5-8.5", "#c0392b")}


def grid(run, y0, y1):
    r = d["runs"][run]
    yrs = np.array(r["years"])
    cells = np.array(r["cells"])[(yrs >= y0) & (yrs <= y1)] / 10
    return cells.mean(0).reshape(NLAT, NLON)[:, order]


def save_map(field, title, fname, cmap="RdBu_r", vmin=-8, vmax=8, label="°C vs 1850-1900"):
    fig = plt.figure(figsize=(10, 5.2))
    ax = plt.axes(projection=ccrs.Robinson())
    m = ax.pcolormesh(lon[order], lat, field, transform=ccrs.PlateCarree(), cmap=cmap, vmin=vmin, vmax=vmax, shading="nearest")
    ax.coastlines(linewidth=0.5)
    plt.colorbar(m, orientation="horizontal", pad=0.04, shrink=0.6, label=label)
    ax.set_title(title)
    fig.savefig(OUT / fname, dpi=130, bbox_inches="tight")
    plt.close(fig)


# 1. Global mean, all scenarios
fig, ax = plt.subplots(figsize=(10, 4.5))
h = d["runs"]["historical"]
ax.plot(h["years"], h["global"], color="#444", label="Historical")
for k, (name, c) in SCEN.items():
    ax.plot(d["runs"][k]["years"], d["runs"][k]["global"], color=c, label=name)
ax.axhline(1.5, ls="--", color="#999", lw=0.8)
ax.axhline(2.0, ls="--", color="#999", lw=0.8)
ax.set(title="1. Global mean temperature anomaly (GFDL-ESM4)", ylabel="°C vs 1850-1900")
ax.legend()
fig.savefig(OUT / "1-global-mean.png", dpi=130, bbox_inches="tight")
plt.close(fig)

# 2. End-of-century warming map
save_map(grid("ssp585", 2081, 2100), "2. Warming by 2081-2100 under SSP5-8.5", "2-map-ssp585-2081-2100.png", vmin=-12, vmax=12)

# 3. Zonal mean warming by latitude
fig, ax = plt.subplots(figsize=(7, 5))
for k, (name, c) in SCEN.items():
    ax.plot(grid(k, 2081, 2100).mean(1), lat, color=c, label=name)
ax.set(title="3. Warming by latitude, 2081-2100", xlabel="°C vs 1850-1900", ylabel="Latitude")
ax.legend()
fig.savefig(OUT / "3-zonal-mean.png", dpi=130, bbox_inches="tight")
plt.close(fig)

# 4. Local warming per degree of global warming (pattern)
g585 = np.array(d["runs"]["ssp585"]["global"])[-20:].mean()
save_map(grid("ssp585", 2081, 2100) / g585, "4. Local warming per 1 °C of global warming", "4-amplification.png", cmap="PuOr_r", vmin=0, vmax=4, label="× global mean")

# 5. Baseline climate
base = np.array(d["baselineTemp"]).reshape(NLAT, NLON)[:, order]
save_map(base, "5. Pre-industrial (1850-1900) annual mean temperature", "5-baseline.png", cmap="RdYlBu_r", vmin=-40, vmax=35, label="°C")

# 6. Year each cell first stays above +2 °C (10-year running mean) under SSP2-4.5
years = np.array(h["years"] + d["runs"]["ssp245"]["years"])
series = np.vstack([np.array(h["cells"]), np.array(d["runs"]["ssp245"]["cells"])]) / 10
kernel = np.ones(10) / 10
smooth = np.apply_along_axis(lambda s: np.convolve(s, kernel, mode="same"), 0, series)
cross = np.full(series.shape[1], np.nan)
for i in range(series.shape[1]):
    above = smooth[:, i] > 2
    for t in range(len(years) - 5):
        if above[t:-5].all():
            cross[i] = years[t]
            break
save_map(cross.reshape(NLAT, NLON)[:, order], "6. Year local warming passes +2 °C for good (SSP2-4.5)", "6-crossing-2C.png", cmap="magma", vmin=1980, vmax=2100, label="year")
print(sorted(p.name for p in OUT.glob("*.png")))
