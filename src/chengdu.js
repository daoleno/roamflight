import * as T from 'three';
import { loadAircraft } from './aircraft-model.js';
import { rotatePropeller } from './aircraft.js';
import { updateControlSurfaces } from './control-surfaces.js';
import { distanceKm, DEG } from './geo.js';
import { getLocale, t, number } from './i18n.js';
import {
  project,
  geographic,
  contains,
  bearing,
  makeTerrain,
  origin,
  places,
  routes,
} from './chengdu-geo.js';
import {
  terrainMesh,
  buildings,
  landmarks,
  boundaries,
  cloudField,
  relief,
} from './chengdu-scenery.js';

const $ = (id) => document.getElementById(id);
const directory = '/assets/chengdu/';
const placeName = (id) => places[id][getLocale() === 'zh' ? 0 : 1];
const point = (id) => places[id].slice(2);
async function resource(file) {
  const response = await fetch(directory + file);
  if (!response.ok) throw Error('Cannot load ' + file);
  return response;
}
export async function createChengdu(renderer, scene, camera, state, notify) {
  const loader = new T.TextureLoader();
  const [atlas, buffer, surface, urban, model] = await Promise.all([
    resource('atlas.json').then((r) => r.json()),
    resource('height.bin').then((r) => r.arrayBuffer()),
    loader.loadAsync(directory + 'surface.webp'),
    new T.ImageLoader().loadAsync(directory + 'urban.png'),
    loadAircraft(scene),
  ]);
  const heights = new Int16Array(buffer),
    terrain = makeTerrain(atlas, heights);
  const { aircraft, propeller, controls } = model;
  const blocks = buildings(terrain, urban, atlas.runways),
    borders = boundaries(atlas, terrain),
    clouds = cloudField(terrain);
  scene.add(terrainMesh(atlas, terrain, heights, surface), blocks, borders, clouds);
  landmarks(scene, terrain, atlas);
  aircraft.scale.setScalar(0.084);
  const sun = new T.DirectionalLight(0xffe4b8, 1.85),
    ambient = new T.HemisphereLight(0xe6f5ff, 0xaba58b, 1.65);
  sun.position.set(-65, 50, -30);
  scene.add(sun, ambient);
  const fog = new T.FogExp2(0xbbd7d5, 0.031);
  const sky = new T.Mesh(
    new T.SphereGeometry(175, 32, 16),
    new T.ShaderMaterial({
      side: T.BackSide,
      depthWrite: false,
      uniforms: { night: { value: 0 } },
      vertexShader:
        'varying vec3 dir;void main(){dir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `varying vec3 dir;uniform float night;void main(){float h=clamp(normalize(dir).y*2.1,0.,1.);vec3 daylight=mix(vec3(.50,.69,.70),vec3(.10,.37,.61),sqrt(h));gl_FragColor=vec4(mix(daylight,vec3(.012,.025,.058),night),1.);
    #include <colorspace_fragment>
    }`,
    }),
  );
  scene.add(sky);
  const mapCamera = new T.OrthographicCamera(-1, 1, 1, -1, 0.01, 400);
  mapCamera.up.set(0, 0, -1);
  const chart = $('chart-ink'),
    ink = chart.getContext('2d'),
    projected = new T.Vector3();
  const forward = new T.Vector3(),
    desired = new T.Vector3(),
    look = new T.Vector3(),
    cameraLook = new T.Vector3();
  const current = { x: 0, z: 0, altitude: 0, heading: 0, travelled: 0 };
  let route = 'west',
    leg = 0,
    visited = 0,
    finished = false,
    district = null,
    ground = 0,
    previousView = -1,
    hudTime = 0;
  let mapSignature = '';
  const path = () => routes[route],
    target = () => path()[leg];
  function chartPoint(coord) {
    const [x, z] = project(coord);
    projected.set(x, 0, z).project(mapCamera);
    return [((projected.x + 1) * innerWidth) / 2, ((1 - projected.y) * innerHeight) / 2];
  }
  function map() {
    const signature = [
      innerWidth,
      innerHeight,
      current.x,
      current.z,
      current.heading,
      route,
      leg,
      getLocale(),
    ].join('/');
    if (signature === mapSignature) return;
    mapSignature = signature;
    const ratio = innerWidth / innerHeight;
    const h = Math.max(
      (terrain.bottom - terrain.top) * 1.22,
      ((terrain.right - terrain.left) * 1.09) / ratio,
    );
    mapCamera.left = (-h * ratio) / 2;
    mapCamera.right = (h * ratio) / 2;
    mapCamera.top = h / 2;
    mapCamera.bottom = -h / 2;
    const x = (terrain.left + terrain.right) / 2,
      z = (terrain.top + terrain.bottom) / 2;
    mapCamera.position.set(x, 150, z);
    mapCamera.lookAt(x, 0, z);
    mapCamera.updateProjectionMatrix();
    mapCamera.updateMatrixWorld();
    const dpr = Math.min(devicePixelRatio, 2);
    chart.width = innerWidth * dpr;
    chart.height = innerHeight * dpr;
    ink.scale(dpr, dpr);
    // Subdue the buffer outside the municipality while retaining neighbouring terrain.
    const footprint = new Path2D();
    for (const polygon of atlas.areas[0].polygons)
      for (const ring of polygon) {
        ring.forEach((coordinate, index) => {
          const [px, py] = chartPoint(coordinate);
          if (index === 0) footprint.moveTo(px, py);
          else footprint.lineTo(px, py);
        });
        footprint.closePath();
      }
    const outside = new Path2D(footprint);
    const [west, south, east, north] = atlas.bounds;
    const [left, top] = chartPoint([west, north]),
      [right, bottom] = chartPoint([east, south]);
    outside.rect(left, top, right - left, bottom - top);
    ink.fillStyle = '#142e3a78';
    ink.fill(outside, 'evenodd');
    ink.strokeStyle = '#f4deb2';
    ink.lineWidth = 1.3;
    ink.stroke(footprint);
    const here = chartPoint(geographic(current.x, current.z));
    ink.beginPath();
    ink.moveTo(...here);
    for (const id of path().slice(leg)) ink.lineTo(...chartPoint(point(id)));
    ink.strokeStyle = '#ffe66a';
    ink.lineWidth = 2;
    ink.setLineDash([5, 4]);
    ink.stroke();
    ink.setLineDash([]);
    const reserved = [];
    const visible = [
      ...new Set([
        target(),
        ...path(),
        'square',
        'fish',
        'xiling',
        'tianfu',
        'pengzhou',
        'pujiang',
        'jianyang',
        'shuangliu',
      ]),
    ];
    for (const id of visible) {
      const [cx, cy] = chartPoint(point(id)),
        active = id === target();
      ink.fillStyle = active ? '#ffe66a' : '#eff7e9';
      ink.beginPath();
      ink.arc(cx, cy, active ? 4 : 2.5, 0, 2 * Math.PI);
      ink.fill();
      ink.font = (active ? 'bold ' : '') + (innerWidth < 600 ? 10 : 13) + 'px system-ui';
      const label = placeName(id),
        w = ink.measureText(label).width + 8;
      const lx = Math.min(innerWidth - w - 2, cx + 6);
      if (reserved.some(([a, b, c]) => Math.abs(b - cy) < 15 && a < lx + w && lx < c)) continue;
      reserved.push([lx, cy, lx + w]);
      ink.fillStyle = '#153736dd';
      ink.fillRect(lx, cy - 9, w, 17);
      ink.fillStyle = active ? '#ffeb88' : 'white';
      ink.fillText(label, lx + 4, cy + 4);
    }
    ink.save();
    ink.translate(...here);
    ink.rotate(current.heading * DEG);
    ink.fillStyle = '#ff884c';
    ink.strokeStyle = '#fff';
    ink.lineWidth = 1.8;
    ink.beginPath();
    ink.moveTo(0, -9);
    ink.lineTo(6, 7);
    ink.lineTo(0, 4);
    ink.lineTo(-6, 7);
    ink.closePath();
    ink.fill();
    ink.stroke();
    ink.restore();
    const scaleKm = 20,
      pixels = (scaleKm * innerHeight) / h;
    const sx = 16,
      sy = innerHeight - 26;
    ink.fillStyle = '#123737';
    ink.fillRect(sx - 5, sy - 18, pixels + 11, 28);
    ink.fillStyle = 'white';
    ink.font = '11px system-ui';
    ink.fillText('20 km', sx, sy - 4);
    ink.fillRect(sx, sy, pixels, 2);
  }
  function hud() {
    const coord = geographic(current.x, current.z);
    $('slow-entry').href =
      '/?region=chengdu&lon=' +
      coord[0].toFixed(6) +
      '&lat=' +
      coord[1].toFixed(6) +
      '&hdg=' +
      Math.round(current.heading);
    district = atlas.areas.slice(1).find((a) => contains(a, coord));
    const id = target();
    state.distance = distanceKm(coord, point(id));
    $('destination').textContent = placeName(id);
    $('destination-country').textContent = t('route.' + route);
    $('distance').textContent = state.distance.toFixed(1) + ' km';
    $('score').textContent = finished
      ? t('cd.complete')
      : String(leg + 1) +
        ' / ' +
        path().length +
        ' · ' +
        Math.round(bearing(coord, point(id))) +
        '°';
    $('country-name').textContent = district?.[getLocale()] || t('cd.outside');
    $('city-coordinate').textContent = coord[1].toFixed(3) + '° N  ' + coord[0].toFixed(3) + '° E';
    $('speed').textContent = number(state.speed * 235);
    $('altitude').textContent = number(current.altitude - ground);
    $('needle').style.transform = 'rotate(' + -current.heading + 'deg)';
    $('target-label').textContent = placeName(id);
    $('globe').title = t('cd.map');
    $('globe').setAttribute('aria-label', t('cd.map'));
  }
  function selectRoute(value) {
    route = value;
    leg = 0;
    finished = false;
    $('city-route').value = value;
    mapSignature = '';
    hud();
  }
  function reset() {
    [current.x, current.z] = project(origin);
    ground = terrain.meters(current.x, current.z);
    current.altitude = ground + 630;
    state.bank = state.pitch = 0;
    state.speed = state.throttle;
    visited = 0;
    current.travelled = 0;
    selectRoute($('city-route').value || 'west');
    current.heading = bearing(origin, point(target()));
    previousView = -1;
  }
  function step(dt, input) {
    state.throttle = T.MathUtils.clamp(state.throttle + input.accelerate * dt * 0.3, 0.3, 1.7);
    state.speed = T.MathUtils.damp(state.speed, state.throttle * (input.boost ? 2.2 : 1), 2, dt);
    state.bank = T.MathUtils.damp(state.bank, input.turn * 0.48, 4.5, dt);
    state.pitch = T.MathUtils.damp(state.pitch, input.climb * 0.24, 4.5, dt);
    current.heading = (current.heading + (input.turn * 0.7 * dt) / DEG + 360) % 360;
    const angle = current.heading * DEG,
      travel = state.speed * Math.cos(state.pitch) * 1.65 * dt;
    current.x += Math.sin(angle) * travel;
    current.z -= Math.cos(angle) * travel;
    current.travelled += travel;
    if (
      current.x < terrain.left + 0.35 ||
      current.x > terrain.right - 0.35 ||
      current.z < terrain.top + 0.35 ||
      current.z > terrain.bottom - 0.35
    ) {
      current.x = T.MathUtils.clamp(current.x, terrain.left + 0.36, terrain.right - 0.36);
      current.z = T.MathUtils.clamp(current.z, terrain.top + 0.36, terrain.bottom - 0.36);
      current.heading = bearing(geographic(current.x, current.z), origin);
      notify('cd.edge');
    }
    ground = terrain.meters(current.x, current.z);
    current.altitude = T.MathUtils.clamp(
      current.altitude + Math.sin(state.pitch) * state.speed * 1100 * dt,
      ground + 235,
      ground + 3800,
    );
    if (!finished && distanceKm(geographic(current.x, current.z), point(target())) < 1.65) {
      visited++;
      const name = placeName(target());
      if (leg + 1 === path().length) finished = true;
      else leg++;
      notify(finished ? 'cd.finished' : 'cd.reached', { name });
      hud();
    }
  }
  function render(dt, input) {
    const inFlight = !state.map && !state.paused;
    if (inFlight) {
      state.elapsed += dt;
      const n = Math.ceil(dt * 120);
      for (let i = 0; i < n; i++) step(dt / n, input);
      rotatePropeller(propeller, dt, state.speed);
    }
    const angle = current.heading * DEG;
    forward.set(Math.sin(angle), 0, -Math.cos(angle));
    aircraft.position.set(current.x, current.altitude * relief, current.z);
    aircraft.rotation.set(-state.pitch, Math.PI - angle, state.bank, 'YXZ');
    updateControlSurfaces(controls, state.bank / 0.48, state.night ? 1 : 0, inFlight ? dt : 0);
    aircraft.visible = !state.map;
    blocks.visible = !state.map;
    sky.visible = !state.map;
    clouds.visible = $('cloud-toggle').checked && !state.map;
    borders.visible = state.map && $('border-toggle').checked;
    scene.fog = state.map ? null : fog;
    scene.background = state.map ? mapBackground : null;
    const dark = state.night && !state.map;
    sky.material.uniforms.night.value = dark ? 1 : 0;
    sun.intensity = dark ? 0.35 : 1.85;
    ambient.intensity = dark ? 0.42 : 1.65;
    fog.color.setHex(dark ? 0x27384d : 0xbbd7d5);
    if (state.map) {
      map();
      renderer.render(scene, mapCamera);
      previousView = -1;
      return;
    }
    const portrait = innerWidth < innerHeight,
      view = state.view;
    camera.near = 0.027;
    camera.far = 210;
    camera.fov = portrait ? 63 : 49;
    camera.updateProjectionMatrix();
    desired
      .copy(aircraft.position)
      .addScaledVector(forward, view === 0 ? (portrait ? -1.65 : -1.3) : view === 1 ? 1.6 : -0.001);
    desired.y += view === 2 ? 3.1 : portrait ? 0.84 : 0.59;
    desired.y = Math.max(desired.y, terrain.meters(desired.x, desired.z) * relief + 0.22);
    look
      .copy(aircraft.position)
      .addScaledVector(forward, view === 1 ? -0.85 : view === 2 ? 0.01 : 1.2);
    look.y += view === 2 ? 0 : 0.05;
    const mix = previousView === view ? 1 - Math.exp(-dt * 8) : 1;
    camera.position.lerp(desired, mix);
    cameraLook.lerp(look, mix);
    camera.up.set(0, 1, 0);
    if (view === 2) camera.up.copy(forward);
    camera.lookAt(cameraLook);
    camera.updateMatrixWorld();
    sky.position.copy(camera.position);
    previousView = view;
    const [tx, tz] = project(point(target()));
    projected.set(tx, terrain.meters(tx, tz) * relief + 0.4, tz).project(camera);
    const visible =
      !finished &&
      Math.abs(projected.x) < 0.88 &&
      Math.abs(projected.y) < 0.68 &&
      projected.z < 1 &&
      projected.z > -1;
    $('target').style.display = visible ? 'block' : 'none';
    if (visible) {
      $('target').style.left = (projected.x + 1) * 50 + '%';
      $('target').style.top = (1 - projected.y) * 50 + '%';
    }
    hudTime += dt;
    if (hudTime > 0.22) {
      hud();
      hudTime = 0;
    }
    renderer.render(scene, camera);
  }
  const mapBackground = new T.Color(0x214542);
  reset();
  const params = new URLSearchParams(location.search);
  const co = [Number(params.get('lon')), Number(params.get('lat'))];
  if (params.has('lon') && params.has('lat') && contains(atlas.areas[0], co)) {
    [current.x, current.z] = project(co);
    ground = terrain.meters(current.x, current.z);
    current.altitude = ground + 630;
    current.heading = Number(params.get('hdg')) || 0;
  }
  return {
    render,
    reset,
    selectRoute,
    hud,
    inspect() {
      return {
        region: 'chengdu',
        coordinate: geographic(current.x, current.z),
        heading: current.heading,
        district: district?.zh,
        ground,
        altitude: current.altitude,
        clearance: current.altitude - ground,
        travelled: current.travelled,
        route,
        waypoint: target(),
        visited,
        finished,
        target: point(target()),
        distance: distanceKm(geographic(current.x, current.z), point(target())),
        pitch: state.pitch,
        bank: state.bank,
      };
    },
  };
}
