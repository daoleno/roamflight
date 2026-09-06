import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  createIcons,
  Camera,
  Globe2,
  Sun,
  Moon,
  VolumeX,
  Volume2,
  Maximize,
  Minimize,
  Pause,
  Play,
  PackageOpen,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  ChevronsUp,
  RotateCcw,
  Languages,
} from 'lucide';
import { createWorld, createPackage } from './world.js';
import { rotatePropeller } from './aircraft.js';
import { FlightAudio } from './audio.js';
import { stepFlight } from './flight.js';
import { updateControlSurfaces } from './control-surfaces.js';
import { t, number, cityName, countryName, setCountryData, getLocale } from './i18n.js';
import {
  RADIUS,
  DEG,
  toPoint,
  toCoordinate,
  headingVector,
  headingDegrees,
  distanceKm,
  findCountry,
  departures,
  destinations,
} from './geo.js';

const $ = (id) => document.getElementById(id);
const icons = {
  Camera,
  Globe2,
  Sun,
  Moon,
  VolumeX,
  Volume2,
  Maximize,
  Minimize,
  Pause,
  Play,
  PackageOpen,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  ChevronsUp,
  RotateCcw,
  Languages,
};
createIcons({ icons });
function setIcon(id, name) {
  $(id).innerHTML = `<i data-lucide="${name}"></i>`;
  createIcons({ icons });
}

const canvas = $('world');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 3000);
let renderer, world;
const params = new URLSearchParams(location.search);
const state = {
  ready: false,
  paused: false,
  map: false,
  view: 0,
  night: false,
  throttle: 0.75,
  speed: 0.75,
  bank: 0,
  pitch: 0,
  flightAccumulator: 0,
  radius: 106.2,
  up: toPoint(...departures.africa.coordinate),
  forward: headingVector(toPoint(...departures.africa.coordinate), departures.africa.heading),
  target: [...departures.africa.destination],
  delivered: 0,
  elapsed: 0,
  distance: 0,
  packages: [],
  totalDropped: 0,
  lastDrop: -100,
  country: null,
  countryId: -1,
};
const keys = new Set();
let last = performance.now(),
  hudElapsed = 0,
  terrainElapsed = 0,
  ground = RADIUS,
  nextMission = 0,
  notificationTimeout;
const audio = new FlightAudio();
let audioBusy = false;
const desiredCamera = new THREE.Vector3(),
  desiredLook = new THREE.Vector3(),
  cameraLook = new THREE.Vector3();
const basis = new THREE.Matrix4(),
  right = new THREE.Vector3(),
  localUp = new THREE.Vector3();
const targetWorld = new THREE.Vector3(),
  targetScreen = new THREE.Vector3();
const shadowRay = new THREE.Ray(),
  shadowSphere = new THREE.Sphere(new THREE.Vector3(), RADIUS);
const shadowHit = new THREE.Vector3(),
  shadowUp = new THREE.Vector3(),
  shadowForward = new THREE.Vector3(),
  shadowRight = new THREE.Vector3();
let orbit,
  marker,
  trails,
  cameraInitialized = false;

let lastNotice = null;
let loadingKey = 'loading.earth';
let failureKey = 'errors.startup';
function renderNotice() {
  if (!lastNotice) return;
  const values = { ...lastNotice.values };
  if (values.city) values.city = cityName(values.city);
  if (values.distance !== undefined) values.distance = number(values.distance);
  $('notification').textContent = t(lastNotice.key, values);
}
function notify(key, values = {}, duration = 3300) {
  clearTimeout(notificationTimeout);
  lastNotice = { key, values };
  renderNotice();
  $('notification').classList.add('visible');
  notificationTimeout = setTimeout(() => $('notification').classList.remove('visible'), duration);
}

function failure(error, key = 'errors.startup') {
  console.error(error);
  $('failure').hidden = false;
  $('loading').classList.add('done');
  failureKey = key;
  $('error-message').textContent = t(key);
}

async function start() {
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setSize(innerWidth, innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.04;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    world = await createWorld(renderer, scene, (value) => {
      $('load-progress').value = value;
      loadingKey =
        value < 60 ? 'loading.textures' : value < 80 ? 'loading.terrain' : 'loading.flight';
      $('load-status').textContent = t(loadingKey);
    });
    setCountryData(world.countries);
    orbit = new OrbitControls(camera, canvas);
    orbit.enabled = false;
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.minDistance = 145;
    orbit.maxDistance = 430;
    orbit.enablePan = false;
    marker = createMarker();
    scene.add(marker);
    trails = createTrails();
    setDeparture(params.get('departure') || 'africa');
    if (params.get('paused') === '1') state.paused = true;
    if (params.get('view') === 'globe') toggleMap();
    state.ready = true;
    $('loading').classList.add('done');
    setTimeout(() => ($('loading').hidden = true), 700);
    last = performance.now();
    renderer.setAnimationLoop(frame);
    window.__flight = {
      get state() {
        return {
          ready: state.ready,
          locale: getLocale(),
          paused: state.paused,
          map: state.map,
          view: state.view,
          coordinate: toCoordinate(state.up),
          heading: headingDegrees(state.up, state.forward),
          target: [...state.target],
          distance: state.distance,
          delivered: state.delivered,
          dropped: state.totalDropped,
          packages: state.packages.length,
          night: state.night,
          elapsed: state.elapsed,
          meshes: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          camera: camera.position.toArray(),
          radius: state.radius,
          pitch: state.pitch,
          ailerons: world.controls.ailerons.map(({ pivot }) => pivot.rotation.x),
          navigationLights: world.controls.lights.visible,
          navigationLightOpacity: world.controls.lights.children[0].material.opacity,
          ground,
        };
      },
      setDeparture,
      // Test-only positioning supports deterministic landing and geography assertions.
      ...(params.has('test')
        ? {
            audio: () => audio.inspect(),
            audioEvent: (event) => audio.play(event),
            place: (lon, lat) => {
              state.up.copy(toPoint(lon, lat));
              state.forward.copy(headingVector(state.up, 0));
              cameraInitialized = false;
            },
          }
        : {}),
    };
  } catch (error) {
    failure(error);
  }
}

function createMarker() {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.59, 40),
    new THREE.MeshBasicMaterial({
      color: 0xffdb46,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  group.add(ring);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 5, 8),
    new THREE.MeshBasicMaterial({ color: 0xffdf62, transparent: true, opacity: 0.6 }),
  );
  beam.position.y = 2.5;
  group.add(beam);
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xffe57c }),
  );
  dot.position.y = 5;
  group.add(dot);
  return group;
}

function updateMission() {
  $('destination').textContent = cityName(state.target[0]);
  $('destination-country').textContent = countryName(state.target[1]);
  $('target-label').textContent = cityName(state.target[0]);
  const up = toPoint(state.target[2], state.target[3]);
  const radius = world.groundRadius(up);
  marker.position.copy(up).multiplyScalar(radius + 0.07);
  marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
  targetWorld.copy(up).multiplyScalar(radius + 5.15);
}

function setDeparture(key) {
  const config = departures[key] || departures.africa;
  state.up.copy(toPoint(...config.coordinate));
  state.forward.copy(headingVector(state.up, config.heading));
  state.target = [...config.destination];
  state.radius = 106.2;
  state.bank = 0;
  state.pitch = 0;
  state.flightAccumulator = 0;
  state.speed = state.throttle;
  state.delivered = 0;
  state.totalDropped = 0;
  nextMission = 0;
  state.lastDrop = -100;
  for (const p of state.packages) disposePackage(p);
  state.packages = [];
  trails?.forEach((t) => {
    t.points = [];
    t.mesh.geometry.setDrawRange(0, 0);
  });
  ground = world.groundRadius(state.up);
  state.country = null;
  state.countryId = -1;
  cameraInitialized = false;
  updateMission();
  updateHud();
  if (state.map) {
    camera.position.copy(state.up).multiplyScalar(280);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    orbit.update();
  }
}

function setPaused(value) {
  if (!state.ready) return;
  state.paused = value;
  audio.setActivity(!value && !document.hidden);
  keys.clear();
  $('pause').setAttribute('aria-pressed', String(value));
  setIcon('pause', value ? 'play' : 'pause');
  syncControlLabels();
  if (value && !$('pause-dialog').open) $('pause-dialog').showModal();
  if (!value && $('pause-dialog').open) $('pause-dialog').close();
}

function toggleMap() {
  if (!world || state.paused) return;
  state.map = !state.map;
  orbit.enabled = state.map;
  document.body.classList.toggle('map-mode', state.map);
  $('globe').setAttribute('aria-pressed', String(state.map));
  $('drop').disabled = state.map;
  if (state.map) {
    const right = state.up.clone().cross(state.forward).normalize();
    camera.position
      .copy(state.up)
      .multiplyScalar(innerWidth < 700 ? 345 : 270)
      .addScaledVector(right, 45);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    orbit.target.set(0, 0, 0);
    orbit.update();
    world.sky.visible = false;
    scene.background = new THREE.Color(0x101d2c);
    world.clouds.visible = false;
  } else {
    world.sky.visible = true;
    scene.background = null;
    world.clouds.visible = $('cloud-toggle').checked;
    cameraInitialized = false;
  }
}

function changeCamera() {
  if (!state.ready || state.paused) return;
  if (state.map) toggleMap();
  state.view = (state.view + 1) % 3;
}

function toggleNight() {
  if (!state.ready) return;
  state.night = !state.night;
  $('daylight').setAttribute('aria-pressed', String(state.night));
  setIcon('daylight', state.night ? 'moon' : 'sun');
}

function dropPackage() {
  if (!state.ready || state.paused || state.map || state.elapsed - state.lastDrop < 1.2) return;
  state.lastDrop = state.elapsed;
  state.totalDropped++;
  const item = createPackage(scene, state.up, state.forward, world.groundRadius);
  item.radius = state.radius - 0.8;
  item.group.position.copy(state.up).multiplyScalar(item.radius);
  item.deliveryTarget = [...state.target];
  item.error = distanceKm(toCoordinate(state.up), [state.target[2], state.target[3]]);
  state.packages.push(item);
  audio.play('drop');
  if (state.packages.length > 12) disposePackage(state.packages.shift());
  notify('notice.drop', {}, 1500);
}

function disposePackage(p) {
  scene.remove(p.group);
  p.group.traverse((o) => {
    o.geometry?.dispose();
    if (o.material) {
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      ms.forEach((m) => m.dispose());
    }
  });
}

function updatePackages(dt) {
  for (const p of state.packages) {
    p.age += dt;
    if (!p.landed) {
      if (!p.openSound && p.age >= 0.7) {
        p.openSound = true;
        audio.play('parachute');
      }
      const opening = Math.min(1, p.age / 1.2);
      p.canopy.scale.setScalar(Math.max(0.03, 1 - Math.pow(1 - opening, 3)));
      p.radius = Math.max(p.ground + 0.27, p.radius - dt * (p.age < 0.7 ? 1.3 : 0.72));
      p.group.position.copy(p.up).multiplyScalar(p.radius);
      p.canopy.rotation.z = Math.sin(p.age * 2.4) * 0.08;
      if (p.radius <= p.ground + 0.28) {
        p.landed = true;
        const current = p.deliveryTarget[0] === state.target[0];
        if (p.error < 190 && current) {
          state.delivered++;
          audio.play('success');
          notify('notice.success', { city: p.deliveryTarget[0] }, 4000);
          state.target = [...destinations[nextMission++ % destinations.length]];
          updateMission();
        } else if (current) {
          audio.play('miss');
          notify('notice.miss', { distance: p.error, city: p.deliveryTarget[0] }, 3600);
        }
      }
    } else {
      p.canopy.scale.y = THREE.MathUtils.damp(p.canopy.scale.y, 0.035, 2, dt);
      p.canopy.position.y = THREE.MathUtils.damp(p.canopy.position.y, 0.24, 2, dt);
    }
  }
  state.packages = state.packages.filter((p) => {
    if (p.age > 32) {
      disposePackage(p);
      return false;
    }
    return true;
  });
}

function createTrails() {
  const trails = [];
  for (const side of [-1, 1]) {
    const capacity = 100;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(capacity * 6), 3).setUsage(THREE.DynamicDrawUsage),
    );
    geometry.setAttribute(
      'alpha',
      new THREE.BufferAttribute(new Float32Array(capacity * 2), 1).setUsage(THREE.DynamicDrawUsage),
    );
    const indices = [];
    for (let i = 0; i < capacity - 1; i++) {
      const k = i * 2;
      indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    geometry.setIndex(indices);
    geometry.setDrawRange(0, 0);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader:
        'attribute float alpha;varying float vAlpha;void main(){vAlpha=alpha;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'varying float vAlpha;void main(){gl_FragColor=vec4(.9,.96,1.,vAlpha);}',
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    scene.add(mesh);
    trails.push({ mesh, side, points: [], last: 0 });
  }
  return trails;
}

function updateTrails() {
  const wingRight = new THREE.Vector3(1, 0, 0).applyQuaternion(world.aircraft.quaternion);
  for (const t of trails) {
    if (state.elapsed - t.last > 0.065) {
      t.points.unshift({
        p: world.aircraft.position
          .clone()
          .addScaledVector(wingRight, t.side * 3.08)
          .addScaledVector(state.up, 0.28),
        right: wingRight.clone(),
        time: state.elapsed,
      });
      if (t.points.length > 100) t.points.pop();
      t.last = state.elapsed;
    }
    const position = t.mesh.geometry.attributes.position,
      alpha = t.mesh.geometry.attributes.alpha;
    t.points.forEach((p, i) => {
      const age = state.elapsed - p.time,
        w = 0.035 + age * 0.018;
      position.setXYZ(i * 2, p.p.x - p.right.x * w, p.p.y - p.right.y * w, p.p.z - p.right.z * w);
      position.setXYZ(
        i * 2 + 1,
        p.p.x + p.right.x * w,
        p.p.y + p.right.y * w,
        p.p.z + p.right.z * w,
      );
      const opacity = Math.max(0, 1 - age / 6.5) * 0.29;
      alpha.setX(i * 2, opacity);
      alpha.setX(i * 2 + 1, opacity);
    });
    position.needsUpdate = alpha.needsUpdate = true;
    t.mesh.geometry.setDrawRange(0, Math.max(0, t.points.length - 1) * 6);
  }
}

function updateLighting(dt) {
  const night = state.night ? 1 : 0;
  world.uniforms.night.value = THREE.MathUtils.damp(world.uniforms.night.value, night, 1.7, dt);
  const n = world.uniforms.night.value;
  const sun = state.up
    .clone()
    .multiplyScalar(1.1 - 2.5 * n)
    .addScaledVector(state.forward, 0.35)
    .addScaledVector(right, -0.7)
    .normalize();
  world.uniforms.sun.value.copy(sun);
  world.sunlight.position.copy(sun).multiplyScalar(300);
  world.sunlight.intensity = 2.7 * (1 - n) + 0.22 * n;
  world.ambient.intensity = 2.0 * (1 - n) + 0.25 * n;
  world.sky.material.uniforms.up.value.copy(state.up);
  world.sky.position.copy(camera.position);
  world.stars.material.opacity = n;
  world.clouds.userData.shadowMaterial.uniforms.opacity.value = 0.22 * (1 - n);
  world.planeShadow.material.opacity = 0.27 * (1 - n);
}

function updateCamera(dt) {
  if (state.map) {
    orbit.update();
    return;
  }
  const position = world.aircraft.position;
  const mobile = innerWidth / innerHeight < 0.9;
  const fov = (mobile ? 65 : 50) + (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 5 : 0);
  camera.fov = cameraInitialized ? THREE.MathUtils.damp(camera.fov, fov, 4, dt) : fov;
  if (state.view === 0) {
    desiredCamera
      .copy(position)
      .addScaledVector(state.up, mobile ? 14 : 10)
      .addScaledVector(state.forward, mobile ? -13 : -8);
    desiredLook.copy(position).addScaledVector(state.forward, mobile ? 4 : 3);
    localUp.copy(state.up);
  } else if (state.view === 1) {
    desiredCamera
      .copy(position)
      .addScaledVector(state.up, mobile ? 14 : 10)
      .addScaledVector(state.forward, mobile ? 13 : 8);
    desiredLook.copy(position).addScaledVector(state.forward, mobile ? -4 : -3);
    localUp.copy(state.up);
  } else {
    desiredCamera.copy(position).addScaledVector(state.up, mobile ? 31 : 22);
    desiredLook.copy(position).addScaledVector(state.forward, 4);
    localUp.copy(state.forward);
  }
  localUp.applyAxisAngle(state.forward, state.bank * 0.09);
  if (!cameraInitialized) {
    camera.position.copy(desiredCamera);
    cameraLook.copy(desiredLook);
    camera.up.copy(localUp);
    cameraInitialized = true;
  } else {
    const lerp = 1 - Math.exp(-dt * 7);
    camera.position.lerp(desiredCamera, lerp);
    cameraLook.lerp(desiredLook, lerp);
    camera.up.lerp(localUp, lerp).normalize();
  }
  camera.lookAt(cameraLook);
  camera.updateProjectionMatrix();
}

function updateHud() {
  if (!world) return;
  const coordinate = toCoordinate(state.up);
  state.country = findCountry(world.countries, coordinate);
  state.countryId = world.names.indexOf(state.country);
  world.uniforms.selected.value = state.countryId;
  state.distance = distanceKm(coordinate, [state.target[2], state.target[3]]);
  $('distance').textContent = t('hud.distance', { distance: number(state.distance) });
  $('score').textContent = t('hud.delivered', { count: number(state.delivered) });
  $('country-name').textContent =
    countryName(state.country) ||
    t(
      Math.abs(coordinate[1]) > 65
        ? 'ocean.polar'
        : coordinate[0] > 30 && coordinate[0] < 120
          ? 'ocean.indian'
          : coordinate[0] > 120 || coordinate[0] < -70
            ? 'ocean.pacific'
            : 'ocean.atlantic',
    );
  $('speed').textContent = number(state.speed * 235);
  $('altitude').textContent = number((state.radius - ground) * 500);
  $('needle').style.transform = `rotate(${-headingDegrees(state.up, state.forward)}deg)`;
  $('drop').disabled = state.map || state.paused || state.elapsed - state.lastDrop < 1.2;
}

function updateTarget() {
  camera.updateMatrixWorld();
  targetScreen.copy(targetWorld).project(camera);
  const visible =
    targetScreen.z < 1 &&
    targetScreen.z > -1 &&
    Math.abs(targetScreen.x) < 0.87 &&
    Math.abs(targetScreen.y) < 0.72 &&
    camera.position.clone().sub(targetWorld).dot(targetWorld) > 0;
  $('target').style.display = visible ? 'block' : 'none';
  if (visible) {
    $('target').style.left = `${(targetScreen.x * 0.5 + 0.5) * innerWidth}px`;
    $('target').style.top = `${(-targetScreen.y * 0.5 + 0.5) * innerHeight}px`;
  }
}

function frame(now) {
  const dt = Math.min(0.1, Math.max(0.001, (now - last) / 1000));
  last = now;
  if (!state.paused && !state.map) {
    state.elapsed += dt;
    const turn =
      (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) -
      (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0);
    terrainElapsed += dt;
    if (terrainElapsed > 0.14) {
      ground = world.groundRadius(state.up);
      terrainElapsed = 0;
    }
    stepFlight(
      state,
      {
        turn,
        accelerate:
          (keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0) -
          (keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0),
        climb: (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0),
        boost: keys.has('ShiftLeft') || keys.has('ShiftRight'),
      },
      dt,
      ground,
    );
    updatePackages(dt);
    world.uniforms.time.value = state.elapsed;
  }
  right.copy(state.up).cross(state.forward).normalize();
  basis.makeBasis(right, state.up, state.forward);
  world.aircraft.quaternion.setFromRotationMatrix(basis);
  world.aircraft.rotateX(-state.pitch);
  world.aircraft.rotateZ(state.bank);
  world.aircraft.position.copy(state.up).multiplyScalar(state.radius);
  if (!state.paused && !state.map) rotatePropeller(world.propeller, dt, state.speed);
  if (!state.paused && !state.map) updateTrails();
  updateCamera(dt);
  updateLighting(dt);
  updateControlSurfaces(
    world.controls,
    state.bank / 0.48,
    world.uniforms.night.value,
    state.paused || state.map ? 0 : dt,
  );
  updateTarget();
  shadowSphere.radius = ground;
  shadowRay.set(world.aircraft.position, world.uniforms.sun.value.clone().negate());
  const hit = shadowRay.intersectSphere(shadowSphere, shadowHit);
  world.planeShadow.visible = !!hit && !state.map && !state.night;
  if (hit) {
    shadowUp.copy(hit).normalize();
    const height = world.groundRadius(shadowUp);
    world.planeShadow.position.copy(shadowUp).multiplyScalar(height + 0.085);
    shadowForward
      .copy(state.forward)
      .addScaledVector(shadowUp, -state.forward.dot(shadowUp))
      .normalize();
    shadowRight.crossVectors(shadowForward, shadowUp).normalize();
    world.planeShadow.quaternion.setFromRotationMatrix(
      basis.makeBasis(shadowRight, shadowForward, shadowUp),
    );
  }
  world.clouds.rotation.y = state.elapsed * 0.00012;
  world.atmosphere.visible = state.map;
  if (!state.paused) {
    hudElapsed += dt;
    if (hudElapsed > 0.25) {
      updateHud();
      hudElapsed = 0;
    }
  }
  audio.update({
    speed: state.speed,
    bank: state.bank,
    map: state.map,
    night: state.night,
    country: state.country,
    boost: keys.has('ShiftLeft') || keys.has('ShiftRight'),
  });
  renderer.render(scene, camera);
}

async function toggleSound(value = !audio.enabled) {
  if (audioBusy) return;
  audioBusy = true;
  $('sound').disabled = true;
  try {
    audio.setActivity(state.ready && !state.paused && !document.hidden);
    await audio.setEnabled(value);
  } catch {
    notify('errors.audio');
  } finally {
    audioBusy = false;
    $('sound').disabled = false;
    $('sound').setAttribute('aria-pressed', String(audio.enabled));
    syncControlLabels();
    setIcon('sound', audio.enabled ? 'volume-2' : 'volume-x');
  }
}

async function fullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $('game').requestFullscreen();
  } catch {
    notify('errors.fullscreen');
  }
}

$('pause').onclick = () => setPaused(!state.paused);
$('resume').onclick = () => setPaused(false);
$('retry').onclick = () => location.reload();
$('pause-dialog').addEventListener('cancel', (e) => {
  e.preventDefault();
  setPaused(false);
});
$('view').onclick = changeCamera;
$('globe').onclick = toggleMap;
$('daylight').onclick = toggleNight;
$('sound').onclick = () => toggleSound();
$('fullscreen').onclick = fullscreen;
$('drop').onclick = dropPackage;
$('throttle').oninput = (e) => {
  state.throttle = Number(e.target.value);
};
$('cloud-toggle').onchange = (e) => {
  if (world) world.clouds.visible = e.target.checked && !state.map;
};
$('border-toggle').onchange = (e) => {
  if (world) world.borders.visible = e.target.checked;
};
$('departure').onchange = (e) => {
  setDeparture(e.target.value);
};
$('restart').onclick = () => {
  setDeparture($('departure').value);
  setPaused(false);
};
function syncControlLabels() {
  for (const [id, label, title] of [
    [
      'pause',
      state.paused ? 'controls.resume' : 'controls.pause',
      state.paused ? 'controls.resumeTitle' : 'controls.pauseTitle',
    ],
    [
      'sound',
      audio.enabled ? 'controls.muteAudio' : 'controls.enableAudio',
      audio.enabled ? 'controls.muteAudio' : 'controls.enableAudio',
    ],
    [
      'fullscreen',
      document.fullscreenElement ? 'controls.exitFullscreen' : 'controls.fullscreen',
      document.fullscreenElement ? 'controls.exitFullscreenTitle' : 'controls.fullscreenTitle',
    ],
  ]) {
    $(id).setAttribute('aria-label', t(label));
    $(id).title = t(title);
  }
}
document.addEventListener('fullscreenchange', () => {
  setIcon('fullscreen', document.fullscreenElement ? 'minimize' : 'maximize');
  syncControlLabels();
});
window.addEventListener('roamflight:language', () => {
  syncControlLabels();
  $('load-status').textContent = t(loadingKey);
  if (!$('failure').hidden) $('error-message').textContent = t(failureKey);
  if (world && marker) {
    updateMission();
    updateHud();
  }
  renderNotice();
});
window.addEventListener('keydown', (e) => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code))
    e.preventDefault();
  if (e.code === 'Escape') {
    if (!e.repeat) setPaused(!state.paused);
    return;
  }
  if (state.paused) return;
  keys.add(e.code);
  if (e.repeat) return;
  if (e.code === 'Space') dropPackage();
  if (e.code === 'KeyC') changeCamera();
  if (e.code === 'KeyM') toggleMap();
  if (e.code === 'KeyN') toggleNight();
  if (e.code === 'KeyF') fullscreen();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => {
  audio.setActivity(false);
  keys.clear();
  if (state.ready && !state.paused) setPaused(true);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) audio.setActivity(false);
  if (document.hidden && state.ready && !state.paused) setPaused(true);
});
window.addEventListener('pagehide', () => audio.setActivity(false));
for (const [id, code] of [
  ['left', 'ArrowLeft'],
  ['right', 'ArrowRight'],
  ['boost', 'ShiftLeft'],
  ['climb', 'KeyE'],
  ['descend', 'KeyQ'],
]) {
  $(id).addEventListener('pointerdown', (e) => {
    e.preventDefault();
    $(id).setPointerCapture(e.pointerId);
    keys.add(code);
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'])
    $(id).addEventListener(event, () => keys.delete(code));
}
let dragStart = null;
canvas.addEventListener('pointerdown', (e) => {
  if (!state.map) {
    dragStart = { x: e.clientX, id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragStart || state.map) return;
  const dx = e.clientX - dragStart.x;
  keys.delete('ArrowLeft');
  keys.delete('ArrowRight');
  if (Math.abs(dx) > 8) keys.add(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
});
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'])
  canvas.addEventListener(event, () => {
    dragStart = null;
    keys.delete('ArrowLeft');
    keys.delete('ArrowRight');
  });
window.addEventListener('resize', () => {
  if (!renderer) return;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  cameraInitialized = false;
});
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  renderer?.setAnimationLoop(null);
  failure(new Error('Graphics context lost. Reload the page to resume.'), 'errors.context');
});
start();
