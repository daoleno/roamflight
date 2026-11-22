"""Footprint-interior sampling of the original, aligned CNBH 10 m UTM cells."""

import hashlib
import math
from pathlib import Path

import numpy as np
import rasterio
import requests
import shapely as sh
from pyproj import Transformer
from rasterio.windows import Window
from rasterio.warp import transform_bounds

SOURCES = {
    "CNBH10m_X103Y31.tif": "b3544ac9e92104bc4c559f51f72cd170",
    "CNBH10m_X105Y31.tif": "f4ffe49f7650da81e11fa03bef306f95",
}
REASONS = ["small_or_narrow", "insufficient_valid_pixels", "mixed_heights", "eligible"]


class BuildingHeights:
    def __init__(self, cache: Path):
        self.project = Transformer.from_crs(4326, 32648, always_xy=True)
        west, south, east, north = transform_bounds(
            4326, 32648, 102.96, 30.05, 104.94, 31.47
        )
        self.left = int(west // 10) * 10
        self.top = math.ceil(north / 10) * 10
        width = math.ceil((east - self.left) / 10)
        height = math.ceil((self.top - south) / 10)
        # Decimetres, zero for no height. A disk-backed crop bounds peak process memory.
        self.cells = np.memmap(
            cache / "cnbh-crop.dm", dtype="uint16", mode="w+", shape=(height, width)
        )
        self.tiles = {}
        for name, md5 in SOURCES.items():
            path = cache / name
            if not path.exists():
                with (
                    requests.get(
                        "https://zenodo.org/api/records/7923866/files/"
                        + name
                        + "/content",
                        stream=True,
                        timeout=180,
                    ) as r,
                    path.open("wb") as f,
                ):
                    r.raise_for_status()
                    for b in r.iter_content(1 << 20):
                        f.write(b)
            with path.open("rb") as f:
                assert hashlib.file_digest(f, "md5").hexdigest() == md5
            with rasterio.open(path) as src:
                t = src.transform
                assert (
                    src.crs.to_epsg() == 32648
                    and (t.a, t.b, t.d, t.e) == (10, 0, 0, -10)
                    and t.c % 10 == 0
                    and t.f % 10 == 0
                )
                self.tiles[name] = {
                    "crs": "EPSG:32648",
                    "utmBounds": list(src.bounds),
                    "wgs84Envelope": transform_bounds(src.crs, 4326, *src.bounds),
                    "md5": md5,
                }
                dx = int((t.c - self.left) / 10)
                dy = int((self.top - t.f) / 10)
                x0 = max(0, -dx)
                x1 = min(src.width, width - dx)
                y0 = max(0, -dy)
                y1 = min(src.height, height - dy)
                for y in range(y0, y1, 128):
                    h = min(128, y1 - y)
                    vals = src.read(1, window=Window(x0, y, x1 - x0, h))
                    good = np.isfinite(vals) & (vals >= 1) & (vals <= 650)
                    out = self.cells[dy + y : dy + y + h, dx + x0 : dx + x1]
                    out[good] = np.rint(vals[good] * 10).astype("uint16")

    def sample(self, wgs):
        utm = sh.transform(wgs, self.project.transform, interleaved=False)
        reasons = np.zeros(len(utm), dtype="uint8")
        result = np.zeros(len(utm), dtype="int16")
        counts = np.zeros(len(utm), dtype="int32")
        # Half a pixel diagonal protects all four corners from neighbouring roofs or water.
        ids = np.flatnonzero(sh.area(utm) >= 600)
        core = sh.buffer(utm[ids], -math.sqrt(50), quad_segs=2)
        use = ~sh.is_empty(core)
        ids = ids[use]
        core = core[use]
        if not len(ids):
            return result, reasons, counts
        lowx, lowy, highx, highy = sh.bounds(core).T
        left = np.ceil((lowx - self.left) / 10 - 0.5).astype(int)
        top = np.ceil((self.top - highy) / 10 - 0.5).astype(int)
        width = np.maximum(
            0, np.floor((highx - self.left) / 10 - 0.5).astype(int) - left + 1
        )
        height = np.maximum(
            0, np.floor((self.top - lowy) / 10 - 0.5).astype(int) - top + 1
        )
        # On very large roofs sample a regular subset of native cells (at most 32 × 32).
        sx = np.maximum(1, (width + 31) // 32)
        sy = np.maximum(1, (height + 31) // 32)
        cols = (width + sx - 1) // sx
        rows = (height + sy - 1) // sy
        n = cols * rows
        owner = np.repeat(np.arange(len(core)), n)
        offset = np.arange(n.sum()) - np.repeat(np.cumsum(n) - n, n)
        x = left[owner] + (offset % cols[owner]) * sx[owner]
        y = top[owner] + (offset // cols[owner]) * sy[owner]
        take = sh.contains_xy(
            core[owner], self.left + (x + 0.5) * 10, self.top - (y + 0.5) * 10
        )
        owner = owner[take]
        x = x[take]
        y = y[take]
        valid = (
            (x >= 0) & (y >= 0) & (x < self.cells.shape[1]) & (y < self.cells.shape[0])
        )
        v = np.zeros(len(x), dtype="uint16")
        v[valid] = self.cells[y[valid], x[valid]]
        core_count = np.bincount(owner, minlength=len(core))
        good = v > 0
        key = owner[good]
        val = v[good]
        count = np.bincount(key, minlength=len(core))
        counts[ids] = count
        reasons[ids[core_count >= 4]] = 1
        keep = np.flatnonzero((count >= 4) & (count >= 0.75 * core_count))
        if not len(keep):
            return result, reasons, counts
        sorted_values = val[np.lexsort((val, key))]
        start = np.cumsum(count) - count

        def quantile(q):
            at = (count[keep] - 1) * q
            l = np.floor(at).astype(int)
            h = np.ceil(at).astype(int)
            return (
                sorted_values[start[keep] + l] * (1 - (at - l))
                + sorted_values[start[keep] + h] * (at - l)
            ) / 10

        mid = quantile(0.5)
        consistent = quantile(0.75) - quantile(0.25) <= np.maximum(6, 0.35 * mid)
        reasons[ids[keep]] = 2
        accepted = ids[keep[consistent]]
        result[accepted] = np.rint(mid[consistent]).astype("int16")
        reasons[accepted] = 3
        return result, reasons, counts
