import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { mergeGroups } from 'three/addons/utils/BufferGeometryUtils.js';
import { preparePropeller } from './aircraft.js';
import { prepareControlSurfaces } from './control-surfaces.js';

export async function loadAircraft(scene) {
  const plane = await new FBXLoader().loadAsync('/assets/plane.fbx');
  const yellow = new THREE.MeshPhysicalMaterial({
    color: 0xffc414,
    roughness: 0.36,
    metalness: 0.08,
    clearcoat: 0.45,
    clearcoatRoughness: 0.3,
  });
  const gold = new THREE.MeshStandardMaterial({ color: 0xf2aa06, roughness: 0.58 });
  const red = new THREE.MeshStandardMaterial({ color: 0xf34a27, roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x313936, roughness: 0.74 });
  const windowMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x416f7c,
    roughness: 0.12,
    metalness: 0.3,
    clearcoat: 1,
  });
  const propellerMaterial = new THREE.MeshBasicMaterial({
    color: 0xd7e3d8,
    transparent: true,
    opacity: 0.1,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  plane.traverse((o) => {
    if (!o.isMesh) return;
    if (o.geometry.groups.length > 1) mergeGroups(o.geometry);
    const old = o.material;
    if (o.name === 'Prop_circle') o.material = propellerMaterial;
    else if (o.name === 'Window') o.material = windowMaterial;
    else if (/Wheel|Prop$/.test(o.name)) o.material = dark;
    else if (Array.isArray(old))
      o.material = old.map((m) => (m.name === 'C' ? red : m.name === 'Flaps' ? gold : yellow));
    else o.material = /Circle|Support/.test(o.name) ? gold : yellow;
  });
  const propeller = preparePropeller(plane);
  const controls = prepareControlSurfaces(plane);
  plane.scale.setScalar(0.042);
  plane.position.y = -0.8;
  const aircraft = new THREE.Group();
  aircraft.add(plane);
  scene.add(aircraft);
  return { aircraft, plane, propeller, controls };
}
