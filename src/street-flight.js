import * as T from 'three';
import { loadAircraft } from './aircraft-model.js';
import { rotatePropeller } from './aircraft.js';
import { updateControlSurfaces } from './control-surfaces.js';
import { project, geographic, origin, contains, makeTerrain } from './chengdu-geo.js';
import { streetTiles, streetRoot, decodeGzip } from './street-tiles.js';
import { localSky } from './flight-sky.js';
import { loadSkyline } from './chengdu-skyline.js';
import { streetChart } from './street-chart.js';
import { guide, tour, distanceLabel } from './street-guide.js';
const $ = (id) => document.getElementById(id);
async function read(url, json = true) {
  const r = await fetch(url);
  if (!r.ok) throw Error(url);
  return json ? r.json() : r.arrayBuffer();
}
export async function createStreetFlight(renderer, scene, camera, state, notify, toggleMap) {
  document.body.classList.add('streets');
  const identity = document.querySelector('#identity .city-only');
  identity.dataset.i18n = 'street.slow';
  identity.textContent = document.documentElement.lang.startsWith('zh')
    ? '城区慢飞'
    : 'Street flight';
  const credit = document.querySelector('.city-credit');
  credit.href = '/credits.html#streets';
  credit.textContent = '© OpenStreetMap · Overture · Copernicus';
  const [index, atlas, buffer, model, districts, regionalImage, wave, landscape] =
    await Promise.all([
      read(streetRoot + 'index.json?districts=2'),
      read('/assets/chengdu/atlas.json'),
      read('/assets/chengdu/height.bin', false),
      loadAircraft(scene),
      read(streetRoot + 'districts.json'),
      new T.TextureLoader().loadAsync('/assets/chengdu/flight-rgb.webp'),
      new T.TextureLoader().loadAsync('/assets/wave.png'),
      read(streetRoot + 'landscape.gzdata', false).then(decodeGzip),
    ]);
  const heights = new Int16Array(buffer),
    terrain = makeTerrain(atlas, heights),
    ground = (x, z) => terrain.meters(x / 1000, z / 1000);
  const { aircraft, propeller, controls } = model;
  // Original FBX scale is authored for the miniature globe. Use a 10.8 m wingspan here.
  aircraft.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(aircraft);
  aircraft.scale.setScalar(10.8 / (box.max.x - box.min.x));
  regionalImage.colorSpace = T.SRGBColorSpace;
  regionalImage.anisotropy = 4;
  wave.wrapS = wave.wrapT = T.RepeatWrapping;
  const time = { value: 0 };
  const tiles = streetTiles(scene, index, ground, {
    terrain,
    regionalImage,
    wave,
    time,
    landscape,
  });
  const skyline = await loadSkyline(ground, 1, 1);
  scene.add(skyline.group);
  const floor = new T.PlaneGeometry(
    (terrain.right - terrain.left) * 1000,
    (terrain.bottom - terrain.top) * 1000,
    atlas.grid[0] - 1,
    atlas.grid[1] - 1,
  );
  floor.rotateX(-Math.PI / 2);
  floor.translate((terrain.left + terrain.right) * 500, 0, (terrain.top + terrain.bottom) * 500);
  for (let i = 0; i < heights.length; i++) floor.attributes.position.setY(i, heights[i] - 2);
  floor.computeVertexNormals();
  scene.add(new T.Mesh(floor, new T.MeshLambertMaterial({ map: regionalImage })));
  const sky = localSky(scene, true);
  const sun = new T.DirectionalLight(0xffedcd, 2.55),
    ambient = new T.HemisphereLight(0xd9edff, 0x646456, 1.15);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, {
    left: -360,
    right: 360,
    top: 360,
    bottom: -360,
    near: 1,
    far: 1900,
  });
  sun.shadow.camera.updateProjectionMatrix();
  // The 1.9 km light-depth range needs a metre-scale bias on thin double-sided roofs.
  sun.shadow.bias = -0.00092;
  sun.shadow.normalBias = 0.08;
  sun.shadow.autoUpdate = false;
  let shadowGeneration = -1;
  scene.add(sun, sun.target, ambient);
  scene.fog = new T.FogExp2(0xb6d6ed, 0.00028);
  const f = { x: 0, z: 0, y: 0, heading: 0, district: '', travelled: 0 },
    cameraPos = new T.Vector3(),
    look = new T.Vector3(),
    forward = new T.Vector3(),
    v = new T.Vector3();
  let target = tour[0],
    leg = 0,
    custom = false,
    arrived = false,
    smooth = false,
    wasMap = false,
    elapsedHud = 1,
    speed = 22,
    roof = 0,
    nearest = '',
    shown = [],
    lastNotice = '',
    airClear = 0;
  const dist = (p) => Math.hypot(f.x - p[2], f.z - p[3]);
  const az = (p) => ((Math.atan2(p[2] - f.x, f.z - p[3]) * 180) / Math.PI + 360) % 360;
  function navigate(p) {
    target = p;
    custom = true;
    arrived = false;
    elapsedHud = 1;
  }
  function spawn(x, z, hdg) {
    f.x = x;
    f.z = z;
    f.heading = hdg;
    f.y = ground(x, z) + 80;
    f.travelled = 0;
    smooth = false;
    state.pitch = state.bank = 0;
    state.speed = state.throttle;
    speed = 22;
    elapsedHud = 1;
  }
  function reset() {
    const start = project(origin).map((n) => 1000 * n);
    target = tour[0];
    leg = 0;
    custom = false;
    arrived = false;
    lastNotice = '';
    spawn(...start, 110);
  }
  reset();
  const params = new URLSearchParams(location.search);
  if (params.has('lon') && params.has('lat')) {
    const co = [Number(params.get('lon')), Number(params.get('lat'))];
    if (contains(atlas.areas[0], co)) {
      const [x, z] = project(co);
      spawn(x * 1000, z * 1000, Number(params.get('hdg')) || 0);
    }
  }
  function districtAt(x, z) {
    const co = geographic(x / 1000, z / 1000);
    return districts.findIndex(
      (a) =>
        co[0] >= a.bounds[0] &&
        co[1] >= a.bounds[1] &&
        co[0] <= a.bounds[2] &&
        co[1] <= a.bounds[3] &&
        contains(a, co),
    );
  }
  const chart = streetChart(
    tiles,
    index,
    f,
    navigate,
    (p) => {
      spawn(p[2], p[3], f.heading);
      navigate(p);
    },
    toggleMap,
    districtAt,
  );
  function hiddenFromPilot(x, y, z) {
    const eye = camera.position;
    const steps = Math.ceil(Math.hypot(x - eye.x, z - eye.z) / 34);
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      if (
        tiles.roof(eye.x + (x - eye.x) * t, eye.z + (z - eye.z) * t) >
        eye.y + (y - eye.y) * t + 1
      )
        return true;
    }
    return false;
  }
  function labels() {
    const candidates = [];
    for (const tile of tiles.tiles.values())
      for (const p of tile.labels) candidates.push([p.name, p.category, p.x, p.z]);
    const near = candidates
      .filter((p) => p[1] === '街道' || p[1] === '桥梁')
      .sort((a, b) => dist(a) - dist(b))[0];
    nearest = near && dist(near) < 500 ? near[0] : '';
    const ranked = candidates.sort((a, b) => dist(a) - dist(b));
    const visible = [
      target,
      ...guide,
      ...ranked.filter((p) => ['桥梁', '街道', '水系'].includes(p[1])),
      ...ranked,
    ];
    const taken = [],
      names = new Set(),
      items = [];
    for (const p of visible) {
      if (names.has(p[0]) || dist(p) > 1000) continue;
      const h = Math.max(ground(p[2], p[3]), tiles.roof(p[2], p[3])) + 8;
      v.set(p[2], h, p[3]).project(camera);
      if (v.z < 0 || v.z > 1 || Math.abs(v.x) > 0.85 || v.y < -0.57 || v.y > 0.64) continue;
      const x = ((v.x + 1) * innerWidth) / 2,
        y = ((1 - v.y) * innerHeight) / 2;
      if (
        Math.abs(x - innerWidth / 2) < innerWidth * 0.11 &&
        y > innerHeight * 0.44 &&
        y < innerHeight * 0.64
      )
        continue;
      if (taken.some(([a, b]) => Math.abs(x - a) < 108 && Math.abs(y - b) < 32)) continue;
      if (hiddenFromPilot(p[2], h, p[3])) continue;
      const el = document.createElement('span');
      el.textContent = p[0];
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      if (p === target) el.className = 'wayfinding';
      names.add(p[0]);
      taken.push([x, y]);
      items.push(el);
      if (items.length >= (innerWidth < 600 ? 3 : 6)) break;
    }
    shown = Array.from(names);
    $('street-labels').replaceChildren(...items);
  }
  function hud() {
    const coord = geographic(f.x / 1000, f.z / 1000);
    f.district = districts[districtAt(f.x, f.z)]?.zh || '成都市界外';
    $('country-name').textContent = tiles.readyAt(f.x, f.z)
      ? nearest || f.district
      : '正在载入街区…';
    $('city-coordinate').textContent =
      f.district + ' · ' + coord[1].toFixed(4) + '° N  ' + coord[0].toFixed(4) + '° E';
    $('destination').textContent = target[0];
    $('destination-country').textContent = custom ? '选定目的地' : '天府广场 → 春熙路 → 合江亭';
    $('distance').textContent = distanceLabel(dist(target));
    $('score').textContent = arrived ? '已抵达' : Math.round(az(target)) + '°';
    $('speed').textContent = Math.round(speed * 3.6);
    $('altitude').textContent = Math.round(f.y - ground(f.x, f.z));
    $('needle').style.transform = 'rotate(' + -f.heading + 'deg)';
    $('route-button').textContent = '找地点';
    $('regional-entry').href =
      '/?region=chengdu&mode=region&lon=' +
      coord[0].toFixed(6) +
      '&lat=' +
      coord[1].toFixed(6) +
      '&hdg=' +
      Math.round(f.heading);
  }
  function render(dt, input) {
    if (state.map) {
      if (!wasMap) chart.open(target);
      wasMap = true;
      chart.draw(target);
      return;
    }
    if (wasMap) {
      wasMap = false;
      smooth = false;
    }
    tiles.update(f.x, f.z);
    const rad = Math.PI / 180;
    if (!state.paused && tiles.readyAt(f.x, f.z)) {
      state.elapsed += dt;
      state.throttle = T.MathUtils.clamp(state.throttle + input.accelerate * dt * 0.32, 0.3, 1.7);
      speed = T.MathUtils.damp(speed, (12 + state.throttle * 15) * (input.boost ? 1.65 : 1), 2, dt);
      state.speed = speed / 28;
      f.heading = (f.heading + input.turn * dt * 30 + 360) % 360;
      state.bank = T.MathUtils.damp(state.bank, input.turn * 0.36, 5, dt);
      state.pitch = T.MathUtils.damp(state.pitch, input.climb * 0.23, 5, dt);
      const dx = Math.sin(f.heading * rad),
        dz = -Math.cos(f.heading * rad);
      f.x = T.MathUtils.clamp(f.x + dx * speed * dt, terrain.left * 1000, terrain.right * 1000);
      f.z = T.MathUtils.clamp(f.z + dz * speed * dt, terrain.top * 1000, terrain.bottom * 1000);
      f.travelled += speed * dt;
      roof = tiles.roof(f.x, f.z);
      const floor = Math.max(ground(f.x, f.z) + 14, roof + 9);
      const ahead = tiles.roof(f.x + dx * (18 + speed * 0.7), f.z + dz * (18 + speed * 0.7));
      f.y = Math.max(
        floor,
        Math.min(
          ground(f.x, f.z) + 650,
          f.y + input.climb * dt * 13 + Math.max(0, ahead + 12 - f.y) * Math.min(1, dt * 2.5),
        ),
      );
      airClear = f.y - Math.max(ground(f.x, f.z), roof);
      if (!arrived && dist(target) < 46) {
        lastNotice = target[0];
        notify('street.reached', { name: lastNotice });
        if (!custom && leg + 1 < tour.length) target = tour[++leg];
        else arrived = true;
      }
      rotatePropeller(propeller, dt, state.speed);
    }
    aircraft.position.set(f.x, f.y, f.z);
    aircraft.rotation.set(-state.pitch, Math.PI - f.heading * rad, state.bank, 'YXZ');
    updateControlSurfaces(controls, state.bank / 0.36, state.night ? 1 : 0, state.paused ? 0 : dt);
    forward.set(Math.sin(f.heading * rad), 0, -Math.cos(f.heading * rad));
    camera.near = 0.3;
    camera.far = 26000;
    camera.fov = innerWidth < 600 ? 62 : 53;
    camera.updateProjectionMatrix();
    const view = state.view;
    cameraPos
      .copy(aircraft.position)
      .addScaledVector(forward, view === 0 ? -24 : view === 1 ? 24 : -0.1);
    cameraPos.y += view === 2 ? 90 : 6.8;
    cameraPos.y = Math.max(
      cameraPos.y,
      tiles.roof(cameraPos.x, cameraPos.z) + 4,
      ground(cameraPos.x, cameraPos.z) + 4,
    );
    camera.position.lerp(cameraPos, smooth ? 1 - Math.exp(-dt * 12) : 1);
    smooth = true;
    look.copy(aircraft.position).addScaledVector(forward, view === 2 ? 4 : view === 1 ? -31 : 31);
    look.y -= view === 2 ? 0 : 1.8;
    camera.up.set(0, 1, 0);
    if (view === 2) camera.up.copy(forward);
    camera.lookAt(look);
    camera.updateMatrixWorld();
    sky.update(camera, ground, state.night, false, $('cloud-toggle').checked);
    time.value = state.elapsed;
    scene.fog.color.setHex(state.night ? 0x233748 : 0xb6d6ed);
    sun.intensity = state.night ? 0.26 : 2.55;
    ambient.intensity = state.night ? 0.44 : 1.15;
    if (
      shadowGeneration !== tiles.generation ||
      Math.hypot(sun.target.position.x - f.x, sun.target.position.z - f.z) > 70
    ) {
      sun.target.position.set(f.x, ground(f.x, f.z) + 50, f.z);
      sun.position.copy(sun.target.position).addScaledVector(sky.sunDirection, 960);
      sun.shadow.needsUpdate = true;
      shadowGeneration = tiles.generation;
    }
    skyline.update(f.x, f.z, 5100, tiles.tiles, tiles.generation);
    elapsedHud += dt;
    if (elapsedHud > 0.18) {
      labels();
      hud();
      elapsedHud = 0;
    }
    renderer.render(scene, camera);
  }
  return {
    render,
    hud,
    reset,
    selectRoute() {},
    inspect() {
      return {
        region: 'chengdu',
        mode: 'streets',
        coordinate: geographic(f.x / 1000, f.z / 1000),
        heading: f.heading,
        district: f.district,
        ground: ground(f.x, f.z),
        altitude: f.y,
        clearance: f.y - ground(f.x, f.z),
        obstacleClearance: airClear,
        speedKmh: speed * 3.6,
        travelled: f.travelled / 1000,
        target: geographic(target[2] / 1000, target[3] / 1000),
        waypoint: target[0],
        distance: dist(target) / 1000,
        visited: leg,
        lastArrival: lastNotice,
        arrived,
        chartSpan: chart.span,
        selected: chart.selected,
        nearest,
        labels: shown,
        tiles: tiles.stats(),
      };
    },
  };
}
