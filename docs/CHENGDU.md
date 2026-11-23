# 成都全域 · Chengdu

## 街区慢飞

HUD 或暂停菜单的「飞往成都」与 `/?region=chengdu` 从天府广场上空进入街区。左右转向，E/Q 升降，W/S 调节油门，Shift 加速；手机用屏幕上的方向、升降和加速键。开「找地点」或 M 暂停在当前位置，航图可拖动、缩放、搜索中文。选择「导航到这里」保留机位，「从这里起飞」则在所选地点开始。暂停菜单可在当前机位切换到全域巡航，或返回世界。

街区模式的米制坐标与区域 WGS84 投影一致。飞机翼展 10.8 m，水平、垂直位移与地形均为 1:1。空速和秒表按模拟秒计算，遇长帧限制步长。最低地面净空 14 m，楼顶至少 9 m；接近屋顶时向前探测并抬升。实景表面来自较粗的区域高程格网，街区斜坡和桥下空间简化。街区模式独立使用实际建筑外轮廓。城区核心范围附有 10 m 分辨率地表色，其余按真实道路、水系、绿地和屋顶几何着色。

街区数据可按以下步骤重制。脚本下载锁定的四川 PBF 与 Overture 发布版、裁至 20 个区县（跨界要素按代表点归属），生成 `public/assets/streets-v1`。道路和水岸按 0.65 m 简化，坐标量化为米，保留庭院孔洞。缺道路宽度时按道路类别示意。补充地点资料有地域和日期差异，名称索引按位置及类别去重。

```sh
uv run --script scripts/prepare-streets.py "$TMPDIR/chengdu-streets"
uv run --script scripts/prepare-street-imagery.py
uv run --script scripts/prepare-street-landscape.py "$TMPDIR/chengdu-streets/sichuan-261101.osm.pbf"
node scripts/prepare-skyline.mjs
```

`index.json` 包含逻辑瓦片边长、区县名称和 `i,j → [字节偏移, 长度]`。每块 1200 m，`floor(i/8)_floor(j/8).pack` 内每个范围是一段独立 gzip JSON。建筑记录为种类、名称、[米高, 高度来源]、各环交替的局部 x/z；高度来源 0 表示缺资料示意，1 表示来源高度，2 表示层数估高，3 表示 CNBH-10m 2020 遥感估高。街区索引和数据可直接下载，查找地点时才读取 `places.gzdata`。驾驶时保留周边九块，放大或缩小航图时按范围加载并释放旧图块。数据版本、许可、各区计数及高度覆盖见游戏署名页。

## Regional cruise

Choose **Chengdu regional cruise** on the flight HUD, the loading screen, or the pause menu. The regional entry is `/?region=chengdu&mode=region`. The plane starts over Tianfu Square facing the Dujiangyan irrigation headworks. The yellow **Flight routes** button opens the route selector. Changing a route keeps the aircraft in place. Restarting a flight returns to the square and aligns the nose with the first waypoint. Fly within 1.65 km to register a visit. The pause menu links back to the globe.

The globe's steering, throttle, boost, pitch, camera, sound, day/night and touch controls also operate here. A/D or ←/→ steer, W/S change throttle, Shift boosts, E/Q climb and descend. M toggles the north-up chart. The orange arrow is the aircraft, the yellow dashed line leads through the remaining waypoints. The bottom instrument reports metres above local terrain. Flight speed is stylized, with approximately 25× time compression relative to the indicated airspeed.

## Geography

- The atlas covers 102.90–104.96° E, 29.98–31.48° N. This buffered rectangle contains all of OSM Chengdu relation 2110264 and its twenty level-six subareas. The HUD distinguishes the neighbouring area outside the city. At the edge of the buffered chart the aircraft turns back towards Chengdu.
- The Copernicus GLO-90 surface model uses WGS84 horizontal coordinates and EGM2008 metre heights. Nine one-degree tiles are area-averaged to 241 × 193 vertex samples (roughly 820 × 870 metres). Terrain triangles and ground-clearance interpolation share those samples and diagonal. The renderer exaggerates relief 2.2×. Mountain summits and narrow valleys are smoothed.
- The chart uses the 3072 × 2592 WorldCover class map with OSM overlays. Flight uses nine 2021 ESA WorldCover Sentinel-2 median RGB tiles resampled to 4096 × 3456 (about 48 m per texel), with the central 12 × 12 km September 2026 scene blended in at 10 m. The street tiles use the same regional backdrop beyond the central image. The skyline contains the 4,107 street footprints whose recorded or estimated height reaches 30 m. The two airports use OSM terminal footprints and runway axes. Roof finishes, facades, the covered gallery, the TV tower and tree crowns are illustrative.
- Central street landscape details use mapped OSM tree nodes, tree rows, fountains, sports areas and planted areas. Spacing along a mapped row and crown dimensions are illustrative. River shading combines the original wave texture, distance to a mapped bank and viewing angle. No bathymetric observations are available. Directional shadows follow the building geometry.
- The 2026-01-01 Geofabrik Sichuan OSM snapshot supplies city and county polygons, river and canal axes, arterial roads, expressways, runway and airport features. Widths are exaggerated for legibility. Regional names and waypoint coordinates are in `src/chengdu-geo.js`. West, east, north, south and lake routes can be flown freely in either direction.
- All layers use WGS84 longitude/latitude. The local plane uses kilometres east and south about 104° E, 30.7° N, with longitude scale fixed at 30.7° N. Geographic distance readouts use spherical great-circle distance. No GCJ-02 or BD-09 offset is applied. The world globe keeps its original Unity-axis reflection.

## Rebuilding

Run from the repository root with a scratch directory large enough for the pinned inputs:

```sh
uv run --script scripts/prepare-chengdu.py "$TMPDIR/chengdu-data"
uv run --script scripts/prepare-flight-surface.py
```

The script checks the SHA-256 of each input against `public/assets/chengdu/sources.json`. It writes the packaged assets to the same directory as the manifest. The world entry loads its own globe assets. Input sources, modification notices and licences are linked from the in-game credits. The map and flight use the same elevation mesh. Scene diagnosis is available read-only through `window.__flight.state`.

### 遥感估高的适用范围

已有建筑高度、已有层数依次优先。仅在缺两者时使用 CNBH-10m。直接将建筑环投影至 EPSG:32648，在源 10 m 格网上取样。屋顶至少 600 m²，采样中心须在向内缩约 7.07 m 的轮廓内，使整个方格留在轮廓中。至少四个有效像元，有效比例至少 75%，四分位间距至多为 6 m 或中位数的 35%（取较大者）。成都 2,008 个交叉样本中，遥感结果低于 20 m 的组与统一 8 m 相比未改善平均绝对误差。因此仅在上述条件成立且中位数取整达到 20 m 时采用遥感值，超大范围规则抽样至每轴最多 32 点。门槛处理了小屋顶、院落、无值和高度混杂。2020 年之后的新建改建、遥感模型对高楼的低估仍会影响结果。逐区计数与两个输入的真实坐标范围可下载。重制脚本把有楼高或层数记录的重合样本写到缓存 cnbh-validation.json，列依次为经度、纬度、区县、参考来源、参考米高、遥感米高和有效像元数。[CNBH 版本与许可](https://doi.org/10.5281/zenodo.7923866)

街区区界由同一批 OSM 关系独立生成，简化容差 0.000015°，坐标保留六位小数；用于街区归属和低飞仪表。合江亭导航点位于 OSM relation 20275315 双亭轮廓内，第 315 项历史建筑名录列属锦江区。跨锦江的安顺廊桥同时列出两岸区名。
