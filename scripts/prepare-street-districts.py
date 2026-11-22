"""Rebuild street-scale boundaries from the same pinned Sichuan snapshot as the streets."""

# /// script
# requires-python = ">=3.12"
# dependencies = ["shapely==2.2.0","osmium==4.3.2"]
# ///
import hashlib, json, sys
from pathlib import Path
import shapely as sh
import osmium

root = Path(__file__).resolve().parents[1] / "public/assets"
areas = json.loads((root / "chengdu/atlas.json").read_text())["areas"][1:]
ids = {a["id"] for a in areas}
pbf = Path(sys.argv[1]) / "sichuan-261101.osm.pbf"
with pbf.open("rb") as f:
    assert (
        hashlib.file_digest(f, "sha256").hexdigest()
        == "81e69e480c753e8cd253b09015b13707e09eb61ed24dac7b66ec1bf0f991ea2c"
    )
factory = osmium.geom.WKBFactory()
result = {}
for a in (
    osmium.FileProcessor(pbf)
    .with_locations()
    .with_areas()
    .with_filter(osmium.filter.EntityFilter(osmium.osm.AREA))
):
    if a.from_way() or a.orig_id() not in ids:
        continue
    geom = sh.from_wkb(factory.create_multipolygon(a)).simplify(
        0.000015, preserve_topology=True
    )
    polys = [
        [
            [[round(x, 6), round(y, 6)] for x, y in r.coords]
            for r in (p.exterior, *p.interiors)
        ]
        for p in sh.get_parts(geom)
    ]
    result[a.orig_id()] = {
        "zh": a.tags.get("name:zh") or a.tags["name"],
        "bounds": list(geom.bounds),
        "polygons": polys,
    }
assert set(result) == ids
(root / "streets-v1/districts.json").write_text(
    json.dumps(
        [result[a["id"]] for a in areas], ensure_ascii=False, separators=(",", ":")
    )
)
