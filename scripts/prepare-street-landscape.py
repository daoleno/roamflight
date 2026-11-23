"""Derive mapped trees, rows, basins and sports grounds within the central imagery extent."""

# /// script
# requires-python = ">=3.11"
# dependencies = ["osmium==4.3.2"]
# ///
import collections
import gzip
import hashlib
import json
import math
import sys
from pathlib import Path

import osmium

source = Path(sys.argv[1])
assert (
    hashlib.file_digest(source.open("rb"), "sha256").hexdigest()
    == "81e69e480c753e8cd253b09015b13707e09eb61ed24dac7b66ec1bf0f991ea2c"
)
out = Path(__file__).resolve().parents[1] / "public/assets/streets-v1"
M = math.pi / 180 * 6371000
tiles = collections.defaultdict(list)


def position(location):
    return (
        round((location.lon - 104) * M * math.cos(math.radians(30.7))),
        round((30.7 - location.lat) * M),
    )


def add(kind, points):
    xs, zs = zip(*points)
    for i in range(max(0, min(xs) // 1200), min(9, max(xs) // 1200) + 1):
        for j in range(max(-1, min(zs) // 1200), min(8, max(zs) // 1200) + 1):
            tiles[f"{i},{j}"].append(
                [kind, [v for x, z in points for v in (x - i * 1200, z - j * 1200)]]
            )


for obj in osmium.FileProcessor(source).with_locations():
    tags = obj.tags
    if isinstance(obj, osmium.osm.Node):
        if tags.get("natural") == "tree":
            add("tree", [position(obj.location)])
    elif isinstance(obj, osmium.osm.Way) and len(obj.nodes) > 1:
        kind = next(
            (
                val
                for key, val in [
                    ("natural", "tree_row"),
                    ("barrier", "hedge"),
                    ("leisure", "pitch"),
                    ("leisure", "track"),
                    ("amenity", "fountain"),
                    ("leisure", "swimming_pool"),
                    ("landuse", "grass"),
                    ("landuse", "flowerbed"),
                ]
                if tags.get(key) == val
            ),
            None,
        )
        if kind and (obj.is_closed() or kind in ("tree_row", "hedge", "track")):
            if not (
                103.98 < obj.nodes[0].lon < 104.15 and 30.58 < obj.nodes[0].lat < 30.74
            ):
                continue
            add(kind, [position(n.location) for n in obj.nodes])
payload = json.dumps(tiles, separators=(",", ":")).encode()
(out / "landscape.gzdata").write_bytes(gzip.compress(payload, mtime=0))
print(collections.Counter(r[0] for rows in tiles.values() for r in rows))
