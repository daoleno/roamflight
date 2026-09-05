import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Box3, Vector3 } from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { prepareControlSurfaces, updateControlSurfaces } from '../src/control-surfaces.js';

function aircraft() {
  const bytes = readFileSync(new URL('../public/assets/plane.fbx', import.meta.url));
  return new FBXLoader().parse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
}
test('ailerons preserve their original pose, then rotate about stable front-edge hinges', () => {
  const plane = aircraft();
  plane.updateMatrixWorld(true);
  const names = ['Aileron_left', 'Aileron_right'];
  const before = names.map((name) => new Box3().setFromObject(plane.getObjectByName(name)));
  const controls = prepareControlSurfaces(plane);
  plane.updateMatrixWorld(true);
  const centers = controls.ailerons.map(({ pivot }) => pivot.getWorldPosition(new Vector3()));
  for (let i = 0; i < 2; i++) {
    const box = new Box3().setFromObject(controls.ailerons[i].mesh);
    assert.ok(box.min.distanceTo(before[i].min) < 1e-4 && box.max.distanceTo(before[i].max) < 1e-4);
  }
  updateControlSurfaces(controls, 1, 0, 1);
  plane.updateMatrixWorld(true);
  assert.ok(controls.ailerons[0].pivot.rotation.x < -0.3);
  assert.ok(controls.ailerons[1].pivot.rotation.x > 0.3);
  controls.ailerons.forEach(({ pivot, mesh }, i) => {
    assert.ok(pivot.getWorldPosition(new Vector3()).distanceTo(centers[i]) < 1e-6);
    assert.ok(new Box3().setFromObject(mesh).getSize(new Vector3()).length() < 50);
  });
  updateControlSurfaces(controls, 0, 0, 2);
  assert.ok(controls.ailerons.every(({ pivot }) => Math.abs(pivot.rotation.x) < 1e-6));
});
test('navigation lights have correct side colors and fade with night state', () => {
  const controls = prepareControlSurfaces(aircraft());
  updateControlSurfaces(controls, 0, 0, 0);
  assert.equal(controls.lights.visible, false);
  updateControlSurfaces(controls, 0, 0.5, 0);
  assert.equal(controls.lights.visible, true);
  assert.equal(controls.lights.children[0].material.color.getHex(), 0xff382c);
  assert.equal(controls.lights.children[1].material.color.getHex(), 0x53ff88);
  assert.ok(
    controls.lights.children[0].position.x > 0 && controls.lights.children[1].position.x < 0,
  );
  assert.equal(controls.lights.children[0].material.opacity, 0.475);
});
