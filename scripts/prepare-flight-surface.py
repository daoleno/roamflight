"""Build the regional flight texture from ESA WorldCover 2021 median RGB reflectance."""

# /// script
# requires-python = ">=3.11"
# dependencies = ["rasterio==1.5.2", "pillow>=11,<14"]
# ///
import json
import math
from pathlib import Path
import numpy as np
import rasterio
from rasterio.windows import from_bounds
from rasterio.enums import Resampling
from PIL import Image

root = Path(__file__).resolve().parents[1] / "public/assets/chengdu"
west, south, east, north = json.loads((root / "atlas.json").read_text())["bounds"]
width, height = 4096, 3456
canvas = Image.new("RGB", (width, height))
for lat in range(math.floor(south), math.ceil(north)):
    for lon in range(math.floor(west), math.ceil(east)):
        tile = f"N{lat:02d}E{lon:03d}"
        url = f"https://esa-worldcover-s2.s3.eu-central-1.amazonaws.com/rgbnir/2021/N{lat}/ESA_WorldCover_10m_2021_v200_{tile}_S2RGBNIR.tif"
        w, s, e, n = (
            max(west, lon),
            max(south, lat),
            min(east, lon + 1),
            min(north, lat + 1),
        )
        x, y = (
            round((w - west) / (east - west) * width),
            round((north - n) / (north - south) * height),
        )
        x2, y2 = (
            round((e - west) / (east - west) * width),
            round((north - s) / (north - south) * height),
        )
        with (
            rasterio.Env(
                GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MAX_RETRY=3
            ),
            rasterio.open(url) as src,
        ):
            samples = src.read(
                [1, 2, 3],
                window=from_bounds(w, s, e, n, src.transform),
                out_shape=(3, y2 - y, x2 - x),
                resampling=Resampling.bilinear,
            )
        # Display stretch is common to all nine tiles. Preserve relative field/forest colours.
        reflectance = np.moveaxis(samples, 0, -1).astype("float32") * 0.0001
        rgb = np.clip((reflectance - [0.017, 0.023, 0.024]) / 0.34, 0, 1) ** 0.60
        canvas.paste(Image.fromarray(np.uint8(rgb * 255)), (x, y))
        print(tile, flush=True)
canvas.save(root / "flight-rgb.webp", quality=85, method=6)
