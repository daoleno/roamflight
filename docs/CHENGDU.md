# 成都全域 · Chengdu

Enter from **Fly Chengdu** on the flight HUD, the loading screen, or the pause menu. The direct entry is `/?region=chengdu`. The plane starts over Tianfu Square facing the Dujiangyan irrigation headworks. The yellow **Flight routes** button opens the route selector. Changing a route keeps the aircraft in place. Restarting a flight returns to the square and aligns the nose with the first waypoint. Fly within 1.65 km to register a visit. The pause menu links back to the globe.

The globe's steering, throttle, boost, pitch, camera, sound, day/night and touch controls also operate here. A/D or ←/→ steer, W/S change throttle, Shift boosts, E/Q climb and descend. M toggles the north-up chart. The orange arrow is the aircraft, the yellow dashed line leads through the remaining waypoints. The bottom instrument reports metres above local terrain. Flight speed is stylized, with approximately 25× time compression relative to the indicated airspeed.

## Geography

- The atlas covers 102.90–104.96° E, 29.98–31.48° N. This buffered rectangle contains all of OSM Chengdu relation 2110264 and its twenty level-six subareas. The HUD distinguishes the neighbouring area outside the city. At the edge of the buffered chart the aircraft turns back towards Chengdu.
- The Copernicus GLO-90 surface model uses WGS84 horizontal coordinates and EGM2008 metre heights. Nine one-degree tiles are area-averaged to 241 × 193 vertex samples (roughly 820 × 870 metres). Terrain triangles and ground-clearance interpolation share those samples and diagonal. The renderer exaggerates relief 2.2×. Mountain summits and narrow valleys are smoothed.
- The 3072 × 2592 surface uses ESA WorldCover 2021 v200 classes, sampled from two 10 m source tiles (roughly 64 m per displayed texel). A separate 768 × 648 fractional built-up mask guides clustered buildings. Buildings, the bridge and tower are artistic. Both airports use OSM terminal footprints and runway axes with illustrative heights, widths and markings. The scene uses no photogrammetry or parcel footprints.
- The 2026-01-01 Geofabrik Sichuan OSM snapshot supplies city and county polygons, river and canal axes, arterial roads, expressways, runway and airport features. Widths are exaggerated for legibility. Regional names and waypoint coordinates are in `src/chengdu-geo.js`. West, east, north, south and lake routes can be flown freely in either direction.
- All layers use WGS84 longitude/latitude. The local plane uses kilometres east and south about 104° E, 30.7° N, with longitude scale fixed at 30.7° N. Geographic distance readouts use spherical great-circle distance. No GCJ-02 or BD-09 offset is applied. The world globe keeps its original Unity-axis reflection.

## Rebuilding

Run from the repository root with a scratch directory large enough for the pinned inputs:

```sh
uv run --script scripts/prepare-chengdu.py "$TMPDIR/chengdu-data"
```

The script checks the SHA-256 of each input against `public/assets/chengdu/sources.json`. It writes the packaged assets to the same directory as the manifest. The game only fetches these static derivatives in regional mode. Input sources, modification notices and licences are linked from the in-game credits. The map and flight use the same mesh and surface. Scene diagnosis is available read-only through `window.__flight.state`.
