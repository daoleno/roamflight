"""Build the north-up, 10 m ground-colour texture covering the central 12 × 12 km."""

# /// script
# requires-python = ">=3.12"
# dependencies = ["rasterio==1.5.2", "pillow>=11,<13"]
# ///
import math
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.transform import from_bounds
from rasterio.vrt import WarpedVRT
from rasterio.enums import Resampling

scene = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/48/R/VU/2026/9/S2B_48RVU_20260905_0_L2A/TCI.tif"
north_m = math.radians(1) * 6371000
east_m = north_m * math.cos(math.radians(30.7))
# Atlas east/south metres: (0, -1200) to (12000, 10800).
bounds = (104, 30.7 - 10800 / north_m, 104 + 12000 / east_m, 30.7 + 1200 / north_m)
with (
    rasterio.open(scene) as src,
    WarpedVRT(
        src,
        crs="EPSG:4326",
        transform=from_bounds(*bounds, 1200, 1200),
        width=1200,
        height=1200,
        resampling=Resampling.bilinear,
    ) as vrt,
):
    rgb = np.moveaxis(vrt.read([1, 2, 3]), 0, -1)
out = Path(__file__).resolve().parents[1] / "public/assets/streets-v1"
Image.fromarray(rgb).save(out / "chengdu-rgb.webp", quality=83, method=6)
