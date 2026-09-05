import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Box3, Vector3 } from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { preparePropeller, rotatePropeller } from '../src/aircraft.js';

test('propeller spins at the nose without orbiting the aircraft', () => {
  const bytes = readFileSync(new URL('../public/assets/plane.fbx', import.meta.url));
  const plane = new FBXLoader().parse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  plane.updateMatrixWorld(true);
  const blade = plane.getObjectByName('Prop');
  const initial = new Box3().setFromObject(blade).getCenter(new Vector3());
  const pivot = preparePropeller(plane);
  for (let i = 0; i < 72; i++) {
    pivot.rotation.z = (i * Math.PI) / 36;
    plane.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(blade);
    assert.ok(bounds.getCenter(new Vector3()).distanceTo(initial) < 0.0001);
    assert.ok(bounds.min.z > 52 && bounds.max.z < 55);
    assert.ok(bounds.getSize(new Vector3()).length() < 45);
  }
  rotatePropeller(pivot, 100, 2);
  assert.ok(pivot.rotation.z >= 0 && pivot.rotation.z < Math.PI * 2);
});
