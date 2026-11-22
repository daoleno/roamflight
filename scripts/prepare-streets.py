"""Rebuild Chengdu street tiles. uv run --script scripts/prepare-streets.py CACHE"""

# /// script
# requires-python = ">=3.12"
# dependencies = ["overturemaps==2.1.1","pyarrow==26.0.1","numpy==2.5.5","shapely==2.2.0","osmium==4.3.2","orjson==3.13.0","requests==2.34.2","rasterio==1.5.2","pyproj==3.8.0"]
# ///
import sys, math, gzip, tempfile, hashlib, re, subprocess
from pathlib import Path
from collections import defaultdict, Counter
import osmium, shapely as sh, numpy as np, pyarrow.parquet as pq, orjson, requests
from shapely.geometry import Polygon, LineString, Point, box
from overturemaps.core import record_batch_reader
from street_heights import BuildingHeights, REASONS

cache = Path(sys.argv[1])
cache.mkdir(exist_ok=True, parents=True)
root = Path(__file__).resolve().parents[1]
out = root / "public/assets/streets-v1"
out.mkdir(exist_ok=True)
atlas = orjson.loads((root / "public/assets/chengdu/atlas.json").read_bytes())
release = "2026-11-18.0"
pbf = cache / "sichuan-261101.osm.pbf"
url = "https://download.geofabrik.de/asia/china/sichuan/" + pbf.name
if not pbf.exists():
    with requests.get(url, stream=True, timeout=120) as r, pbf.open("wb") as f:
        r.raise_for_status()
        for data in r.iter_content(1 << 20):
            f.write(data)
assert (
    hashlib.sha256(pbf.read_bytes()).hexdigest()
    == "81e69e480c753e8cd253b09015b13707e09eb61ed24dac7b66ec1bf0f991ea2c"
)
subprocess.run(
    [sys.executable, str(root / "scripts/prepare-street-districts.py"), str(cache)],
    check=True,
)
for kind in ("building", "place"):
    path = cache / (kind + ".parquet")
    if path.exists():
        continue
    reader = record_batch_reader(
        kind, bbox=(102.98, 30.08, 104.91, 31.45), release=release
    )
    writer = None
    for b in reader:
        b = b.select(
            [
                c
                for c in (
                    "geometry",
                    "names",
                    "bbox",
                    "height",
                    "num_floors",
                    "sources",
                    "basic_category",
                    "confidence",
                    "operating_status",
                )
                if c in b.schema.names
            ]
        )
        if writer is None:
            writer = pq.ParquetWriter(path, b.schema, compression="zstd")
        writer.write_batch(b)
    writer.close()

M = 6371000 * math.pi / 180
E = M * math.cos(math.radians(30.7))
SIZE = 1200


def project(x, y):
    return ((x - 104) * E, (30.7 - y) * M)


def unproject(x, y):
    return (104 + x / E, 30.7 - y / M)


areas = [
    sh.union_all([Polygon(r[0], r[1:]) for r in a["polygons"]])
    for a in orjson.loads((out / "districts.json").read_bytes())
]
tree = sh.STRtree(areas)
names = [a["zh"] for a in atlas["areas"][1:]]
stats = [Counter() for _ in areas]


def district(x, y):
    hits = tree.query(Point(x, y), predicate="intersects")
    return int(hits[0]) if len(hits) else -1


def tile(x):
    return math.floor(x / SIZE)


tmp = tempfile.TemporaryDirectory(dir=cache)
work = Path(tmp.name)
# Write compact records to a disk spool. A full municipal building inventory exceeds a mobile heap.
files = {}


def write(key, data):
    if key not in files:
        if len(files) > 96:
            files.pop(next(iter(files))).close()
        files[key] = (work / f"{key[0]}_{key[1]}").open("ab")
    files[key].write(orjson.dumps(data) + b"\n")


def localpath(coords, i, j):
    return [v for x, y in coords for v in (round(x - i * SIZE), round(y - j * SIZE))]


search = {}
sources = Counter()
compare = defaultdict(Counter)
sample = {
    "central": (104.073, 30.654),
    "wuhou": (104.043, 30.642),
    "jianyang": (104.553, 30.392),
}


def addpoi(name, category, x, y, d, source):
    if not name or d < 0:
        return
    px, pz = project(x, y)
    key = (name, category, round(px / 180), round(pz / 180))
    if key in search:
        return
    entry = [name, category, round(px), round(pz), d, source]
    search[key] = entry
    write(
        (tile(px), tile(pz)),
        [
            "p",
            name,
            [category, d, source],
            [[round(px - tile(px) * SIZE), round(pz - tile(pz) * SIZE)]],
        ],
    )
    stats[d]["places"] += 1


heights = BuildingHeights(cache)
validation = []
# Overture conflates imagery-derived roofprints with OSM once. Use that inventory exclusively for ordinary buildings.
for batch in pq.ParquetFile(cache / "building.parquet").iter_batches(batch_size=8000):
    geoms = sh.from_wkb(batch["geometry"].to_pylist())
    bounds = sh.bounds(geoms)
    x = (bounds[:, 0] + bounds[:, 2]) / 2
    y = (bounds[:, 1] + bounds[:, 3]) / 2
    indexes, ds = tree.query(sh.points(x, y), predicate="intersects")
    remote, reason, valid_cells = heights.sample(geoms)
    hs = batch["height"].to_pylist()
    floors = batch["num_floors"].to_pylist()
    for label, (cx, cy) in sample.items():
        compare[label]["Overture buildings"] += int(
            np.sum((np.abs(x - cx) < 0.018) & (np.abs(y - cy) < 0.012))
        )
    # Transfer coordinates in a vectorised pass. Keep courtyard holes and multipart buildings.
    simple = (sh.get_type_id(geoms) == 3) & (sh.get_num_interior_rings(geoms) == 0)
    arr, ids = sh.get_coordinates(geoms, return_index=True)
    arr[:, 0] = (arr[:, 0] - 104) * E
    arr[:, 1] = (30.7 - arr[:, 1]) * M
    arr = np.rint(arr).astype("int32")
    starts = np.searchsorted(ids, np.arange(len(geoms) + 1))
    for k, d in zip(indexes, ds):
        px, pz = project(x[k], y[k])
        i, j = tile(px), tile(pz)
        h = hs[k]
        f = floors[k]
        mode = 1 if h and 1 <= h < 650 else 2 if f and 0 < f < 170 else 0
        high = round(h) if mode == 1 else round(f * 3.2) if mode == 2 else 8
        if mode and remote[k]:
            validation.append(
                [
                    round(x[k], 6),
                    round(y[k], 6),
                    names[d],
                    mode,
                    high,
                    int(remote[k]),
                    int(valid_cells[k]),
                ]
            )
        if mode == 0:
            outcome = "below_20m" if 0 < remote[k] < 20 else REASONS[reason[k]]
            stats[d]["cnbh_" + outcome] += 1
            if remote[k] >= 20:
                mode = 3
                high = int(remote[k])
        stats[d]["buildings"] += 1
        stats[d][
            ["height_default", "height_source", "height_floors", "height_remote"][mode]
        ] += 1
        if simple[k]:
            coords = arr[starts[k] : starts[k + 1] - 1] - [i * SIZE, j * SIZE]
            write((i, j), ["b", "", [high, mode], [coords.ravel().tolist()]])
        else:
            for poly in sh.get_parts(geoms[k]):
                if poly.geom_type != "Polygon":
                    continue
                rings = [
                    localpath([project(a, b) for a, b in r.coords[:-1]], i, j)
                    for r in [poly.exterior, *poly.interiors]
                ]
                write((i, j), ["b", "", [high, mode], rings])
    for dsources in batch["sources"].to_pylist():
        for s in dsources:
            sources[(s["dataset"], s["license"])] += 1
(cache / "cnbh-validation.json").write_bytes(
    orjson.dumps(validation, option=orjson.OPT_SERIALIZE_NUMPY)
)
print("buildings done", sum(s["buildings"] for s in stats), flush=True)

categories = {
    "museum": "博物馆",
    "school": "学校",
    "university": "大学",
    "hospital": "医院",
    "restaurant": "餐饮",
    "cafe": "咖啡馆",
    "hotel": "酒店",
    "subway_entrance": "地铁入口",
    "station": "车站",
    "place_of_worship": "宗教场所",
    "attraction": "景点",
    "park": "公园",
    "mall": "购物中心",
    "theatre": "剧院",
    "memorial": "纪念地",
    "library": "图书馆",
}


def category(t):
    if t.get("highway") == "bus_stop":
        return "公交站"
    if t.get("building") == "pavilion" and t.get("name") == "合江亭":
        return "历史建筑"
    if t.get("landuse") in ("commercial", "retail"):
        return "商业街区"
    for k, default in [
        ("tourism", "游览地"),
        ("historic", "历史地点"),
        ("shop", "商店"),
        ("amenity", "公共设施"),
        ("leisure", "休闲场所"),
        ("railway", "铁路设施"),
        ("place", "地名"),
        ("office", "办公场所"),
    ]:
        if t.get(k):
            return categories.get(t[k], default)
    return ""


def width(t, default):
    try:
        return max(1, min(100, float(t.get("width", "").split(" ")[0])))
    except ValueError:
        return default


def classify(t, area):
    if area:
        if t.get("man_made") == "bridge":
            return ("deck", 1)
        if t.get("natural") == "water" or t.get("waterway") == "riverbank":
            return ("water", 1)
        if (
            t.get("leisure") in ("park", "garden", "pitch", "golf_course")
            or t.get("landuse")
            in ("forest", "grass", "meadow", "recreation_ground", "farmland", "orchard")
            or t.get("natural") in ("wood", "grassland")
        ):
            return ("green", 1)
        if t.get("place") == "square" or t.get("highway") == "pedestrian":
            return ("plaza", 1)
        return None
    h = t.get("highway")
    if (
        h
        and h not in ("construction", "proposed", "abandoned", "platform", "elevator")
        and t.get("tunnel") not in ("yes", "building_passage")
    ):
        key = (
            "motor"
            if h in ("motorway", "trunk", "primary")
            else "main"
            if h
            in ("secondary", "tertiary", "motorway_link", "trunk_link", "primary_link")
            else "path"
            if h in ("pedestrian", "footway", "path", "cycleway", "steps", "track")
            else "street"
        )
        return (
            "bridge" if t.get("bridge") not in (None, "no") else key,
            width(t, {"motor": 13, "main": 10, "street": 5.5, "path": 2.8}[key]),
        )
    if t.get("waterway") in ("stream", "river", "canal", "drain", "ditch"):
        return ("river", width(t, 8 if t["waterway"] == "river" else 2.5))
    return None


def emit(geom, kind, attr, name, d):
    ispoly = geom.geom_type == "Polygon"
    a, b, c, e = geom.bounds
    for i in range(tile(a), tile(c) + 1):
        for j in range(tile(b), tile(e) + 1):
            part = sh.clip_by_rect(
                geom, i * SIZE, j * SIZE, (i + 1) * SIZE, (j + 1) * SIZE
            )
            for g in sh.get_parts(part):
                if g.is_empty:
                    continue
                if g.geom_type == "Polygon" and ispoly:
                    rings = [
                        localpath(r.coords[:-1], i, j)
                        for r in (g.exterior, *g.interiors)
                    ]
                elif g.geom_type == "LineString" and not ispoly:
                    rings = [localpath(g.coords, i, j)]
                else:
                    continue
                write((i, j), [kind, name, attr, rings])
    stats[d][kind] += 1


factory = osmium.geom.WKBFactory()
for o in osmium.FileProcessor(pbf).with_locations().with_areas():
    t = o.tags
    name = t.get("name:zh") or t.get("name") or ""
    if o.is_node():
        if not name:
            continue
        cat = category(t)
        if cat:
            addpoi(name, cat, o.lon, o.lat, district(o.lon, o.lat), "OSM")
        continue
    if not (o.is_way() or o.is_area()):
        continue
    typ = classify(t, o.is_area())
    if not typ and not (name and category(t) and o.is_area()):
        continue
    if o.is_way():
        if not o.nodes:
            continue
        n = o.nodes[len(o.nodes) // 2]
        x, y = n.lon, n.lat
        if not 102.95 < x < 104.93 or not 30.06 < y < 31.46:
            continue
        coords = [project(n.lon, n.lat) for n in o.nodes]
        if len(coords) < 2:
            continue
        geoms = [LineString(coords)]
    else:
        try:
            geo = sh.from_wkb(factory.create_multipolygon(o))
        except (RuntimeError, ValueError):
            continue
        p = geo.representative_point()
        x, y = p.x, p.y
        if not 102.95 < x < 104.93 or not 30.06 < y < 31.46:
            continue
        geo = sh.transform(geo, lambda xs, ys: project(xs, ys), interleaved=False)
        geoms = sh.get_parts(geo)
    d = district(x, y)
    if d < 0:
        continue
    if typ:
        kind, attr = typ
        for geom in geoms:
            emit(geom.simplify(0.65), kind, attr, name, d)
        cat = {
            "bridge": "桥梁",
            "deck": "桥梁",
            "green": "绿地",
            "river": "水系",
            "water": "水域",
            "plaza": "广场",
        }.get(kind, "街道")
    else:
        cat = category(t)
    if name:
        addpoi(name, category(t) or cat, x, y, d, "OSM")
print("OSM done", len(search), flush=True)
# Use Chinese-language supplementary places carrying the permissive CDLA license only.
for batch in pq.ParquetFile(cache / "place.parquet").iter_batches():
    for r in batch.to_pylist():
        p = sh.from_wkb(r["geometry"])
        x, y = p.x, p.y
        for label, (cx, cy) in sample.items():
            if abs(x - cx) < 0.018 and abs(y - cy) < 0.012:
                compare[label]["Overture places"] += 1
        if (
            r["operating_status"] in ("permanently_closed", "closed")
            or (r["confidence"] or 0) < 0.8
        ):
            continue
        if not all(s["license"] == "CDLA-Permissive-2.0" for s in r["sources"]):
            continue
        n = (r["names"] or {}).get("primary", "")
        if not n or not re.search(r"[\u4e00-\u9fff]", n):
            continue
        # This Overture historic-site point is on the opposite bank, 278 m from the documented pavilion (OSM relation 20275315).
        if (
            n == "合江亭"
            and r["basic_category"] == "historic_site"
            and math.dist(project(x, y), (7666, 6339)) < 3
        ):
            continue
        d = district(x, y)
        # Keep the original source category for the information card.
        addpoi(
            n,
            categories.get(r["basic_category"], r["basic_category"] or "地点"),
            x,
            y,
            d,
            "Overture",
        )
for f in files.values():
    f.close()
files.clear()
packs = defaultdict(list)
for f in work.iterdir():
    i, j = map(int, f.name.split("_"))
    packs[(i // 8, j // 8)].append((i, j, f))
index = {}
for (a, b), items in sorted(packs.items()):
    with (out / f"{a}_{b}.pack").open("wb") as target:
        for i, j, f in sorted(items):
            compressed = gzip.compress(
                b"[" + b",".join(f.read_bytes().splitlines()) + b"]",
                compresslevel=6,
                mtime=0,
            )
            index[f"{i},{j}"] = [target.tell(), len(compressed)]
            target.write(compressed)
(out / "index.json").write_bytes(
    orjson.dumps({"size": SIZE, "tiles": index, "districts": names})
)
(out / "places.gzdata").write_bytes(
    gzip.compress(orjson.dumps(list(search.values())), mtime=0)
)
(out / "coverage.json").write_bytes(
    orjson.dumps(
        {
            "districts": dict(zip(names, stats)),
            "samples": dict(compare),
            "cnbhTiles": heights.tiles,
            "buildingSources": [[*k, v] for k, v in sources.items()],
            "osm": url,
            "overture": release,
            "tiles": len(index),
            "search": len(search),
        },
        option=orjson.OPT_INDENT_2,
    )
)
print("completed", len(index), "tiles;", len(search), "search entries", flush=True)
