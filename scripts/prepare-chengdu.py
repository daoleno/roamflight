"""Rebuild the offline Chengdu atlas. Run with uv run --script (see docs/CHENGDU.md)."""

# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy==2.5.5", "rasterio==1.5.2", "shapely==2.2.0", "osmium==4.3.2", "pillow==13.0.0", "requests==2.34.2"]
# ///
from collections import defaultdict
from hashlib import sha256
from pathlib import Path
import json
import sys
import numpy as np
import osmium
import rasterio
from rasterio.transform import from_bounds
from rasterio.warp import reproject, Resampling
from shapely.geometry import LineString, box
from shapely.ops import polygonize, unary_union
from PIL import Image, ImageDraw
import requests

out = Path(__file__).resolve().parents[1] / "public/assets/chengdu"
out.mkdir(parents=True, exist_ok=True)
cache = Path(sys.argv[1])
cache.mkdir(parents=True, exist_ok=True)
manifest = out / "sources.json"
hashes = json.loads(manifest.read_text()) if manifest.exists() else {}
bounds = (102.9, 29.98, 104.96, 31.48)
west, south, east, north = bounds
clip = box(*bounds)
W, H = 3072, 2592
grid = (241, 193)


def source(url):
    path = cache / url.split("/")[-1]
    if not path.exists():
        with requests.get(url, stream=True, timeout=120) as response:
            response.raise_for_status()
            with path.with_suffix(".part").open("wb") as f:
                for chunk in response.iter_content(1 << 20):
                    f.write(chunk)
        path.with_suffix(".part").replace(path)
    digest = sha256(path.read_bytes()).hexdigest()
    if url in hashes and digest != hashes[url]:
        raise ValueError(f"Source changed: {url}")
    hashes[url] = digest
    return path


def raster(paths, width, height, extent, dtype, method):
    result = np.zeros((height, width), dtype=dtype)
    transform = from_bounds(*extent, width, height)
    for path in paths:
        with rasterio.open(path) as ds:
            reproject(
                rasterio.band(ds, 1),
                result,
                dst_transform=transform,
                dst_crs="EPSG:4326",
                resampling=method,
                init_dest_nodata=False,
            )
    assert result.min() > 0
    return result


dem_paths = []
for x in range(102, 105):
    for y in range(29, 32):
        stem = f"Copernicus_DSM_COG_30_N{y}_00_E{x}_00_DEM"
        dem_paths.append(
            source(
                f"https://copernicus-dem-90m.s3.eu-central-1.amazonaws.com/{stem}/{stem}.tif"
            )
        )
land_paths = [
    source(
        f"https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N{y}E102_Map.tif"
    )
    for y in (27, 30)
]
# DEM samples lie on mesh vertices, including both outer edges.
dx, dy = (east - west) / (grid[0] - 1) / 2, (north - south) / (grid[1] - 1) / 2
dem = raster(
    dem_paths,
    *grid,
    (west - dx, south - dy, east + dx, north + dy),
    "int16",
    Resampling.average,
)
dem.astype("<i2").tofile(out / "height.bin")
cover = raster(land_paths, W, H, bounds, "uint8", Resampling.nearest)
palette = np.zeros((256, 3), dtype="uint8")
for key, rgb in {
    10: (68, 119, 93),
    20: (126, 152, 107),
    30: (153, 173, 112),
    40: (170, 185, 124),
    50: (177, 178, 166),
    60: (169, 157, 137),
    70: (235, 236, 222),
    80: (53, 140, 158),
    90: (103, 152, 134),
    95: (71, 126, 115),
    100: (143, 155, 133),
}.items():
    palette[key] = rgb
surface = Image.fromarray(palette[cover])
draw = ImageDraw.Draw(surface)
# Preserve the urban mask separately for deterministic building placement.
mask = Image.fromarray(np.uint8(cover == 50) * 255).resize(
    (768, 648), Image.Resampling.BOX
)
mask_draw = ImageDraw.Draw(mask)
pbf = source("https://download.geofabrik.de/asia/china/sichuan/sichuan-260101.osm.pbf")
terminal_parts = {}
relations = {}
for r in osmium.FileProcessor(pbf, osmium.osm.RELATION):
    if r.id in (18562218, 18562220):
        terminal_parts[r.id] = [m.ref for m in r.members if m.role == "outer"]
    if (
        r.tags.get("admin_level") in ("5", "6")
        and r.tags.get("boundary") == "administrative"
    ):
        relations[r.id] = (
            r.tags.get("name"),
            r.tags.get("name:en"),
            [(m.ref, m.role) for m in r.members if m.type == "w"],
            [m.ref for m in r.members if m.role == "subarea"],
        )
city = 2110264
selected = [city] + [k for k in relations[city][3] if k in relations]
assert len(selected) == 21
needed = {wid for k in selected for wid, role in relations[k][2]}
needed.update(ref for members in terminal_parts.values() for ref in members)
ways = {}
lines = defaultdict(list)
runways = []
for w in (
    osmium.FileProcessor(pbf)
    .with_locations()
    .with_filter(osmium.filter.EntityFilter(osmium.osm.WAY))
):
    tags = w.tags
    kind = tags.get("aeroway") or tags.get("waterway") or tags.get("highway")
    if w.id not in needed and kind not in (
        "river",
        "canal",
        "motorway",
        "trunk",
        "primary",
        "secondary",
        "runway",
        "taxiway",
        "apron",
        "terminal",
    ):
        continue
    if w.id not in needed and not (
        west - 0.1 < w.nodes[0].lon < east + 0.1
        and south - 0.1 < w.nodes[0].lat < north + 0.1
    ):
        continue
    coords = [(n.lon, n.lat) for n in w.nodes]
    if w.id in needed:
        ways[w.id] = coords
    if len(coords) < 2 or kind is None:
        continue
    if kind in ("terminal", "apron"):
        if coords[0] == coords[-1]:
            lines[kind].append(coords)
    elif kind in (
        "river",
        "canal",
        "motorway",
        "trunk",
        "primary",
        "secondary",
        "runway",
        "taxiway",
    ):
        lines[kind].append(list(LineString(coords).simplify(0.00015).coords))
        if (
            kind == "runway"
            and coords[0] != coords[-1]
            and LineString(coords).length > 0.018
        ):
            runways.append([coords[0], coords[-1]])


for members in terminal_parts.values():
    for footprint in polygonize([LineString(ways[wid]) for wid in members]):
        lines["terminal"].append(list(footprint.exterior.coords))
terminals = []
for ring in lines["terminal"]:
    x, y = ring[0]
    if (103.93 < x < 103.97 and 30.54 < y < 30.60) or (
        104.42 < x < 104.47 and 30.28 < y < 30.33
    ):
        terminals.append(
            [
                [round(px, 6), round(py, 6)]
                for px, py in LineString(ring).simplify(0.000045).coords
            ]
        )


def pixel(coord):
    return (
        (coord[0] - west) / (east - west) * W,
        (north - coord[1]) / (north - south) * H,
    )


for kind, color, width in [
    ("secondary", "#c9c5af", 1),
    ("primary", "#e1d3b0", 2),
    ("trunk", "#eed3a0", 2),
    ("motorway", "#e5bc87", 3),
    ("canal", "#579eab", 2),
    ("river", "#368bab", 4),
    ("apron", "#a0a197", 1),
    ("taxiway", "#b5ad94", 2),
    ("terminal", "#d8d8c6", 1),
    ("runway", "#616c70", 5),
]:
    for coords in lines[kind]:
        pts = [pixel(p) for p in coords]
        if kind in ("apron", "terminal"):
            draw.polygon(pts, fill=color)
        else:
            draw.line(pts, fill=color, width=width)
        if kind in ("river", "canal", "motorway", "trunk", "runway", "apron"):
            mp = [(x * mask.width / W, y * mask.height / H) for x, y in pts]
            if kind == "apron":
                mask_draw.polygon(mp, fill=0)
            else:
                mask_draw.line(mp, fill=0, width=2 if kind == "river" else 1)
        if kind == "runway":
            draw.line(pts, fill="#e8e6d5", width=1)
surface.save(out / "surface.webp", lossless=True, method=6)
mask.save(out / "urban.png", optimize=True)
areas = []
for k in selected:
    zh, en, members, _ = relations[k]

    def polygons(role):
        return unary_union(
            list(polygonize([LineString(ways[wid]) for wid, r in members if r == role]))
        )

    poly = polygons("outer").difference(polygons("inner"))
    assert not poly.is_empty and clip.covers(poly), (zh, poly.bounds)
    poly = poly.simplify(0.0008, preserve_topology=True)
    parts = poly.geoms if poly.geom_type == "MultiPolygon" else [poly]

    def ring(r):
        return [[round(x, 5), round(y, 5)] for x, y in r.coords]

    areas.append(
        dict(
            id=k,
            zh=zh,
            en=en or zh,
            polygons=[
                [ring(p.exterior), *[ring(h) for h in p.interiors]] for p in parts
            ],
        )
    )
data = dict(bounds=bounds, grid=grid, areas=areas, runways=runways, terminals=terminals)
(out / "atlas.json").write_text(
    json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n"
)
manifest.write_text(json.dumps(hashes, indent=2, sort_keys=True) + "\n")
print(
    "DEM",
    dem.min(),
    dem.max(),
    "OSM ways",
    {k: len(v) for k, v in lines.items()},
    "runways",
    len(runways),
)
