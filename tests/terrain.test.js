import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { parseTerrain } from '../src/world.js';

test('original Unity mesh imports with correct scale and outward triangle winding', () => {
  const bytes = readFileSync(new URL('../public/assets/terrain.bytes', import.meta.url));
  const { geometry, names } = parseTerrain(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  assert.equal(names.length, 252);
  assert.ok(names.includes('South Africa'));
  assert.equal(geometry.attributes.position.count, 466880);
  const p = geometry.attributes.position,
    index = geometry.index;
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3();
  let tallest = 0;
  for (let i = 0; i < p.count; i += 101) {
    a.fromBufferAttribute(p, i);
    assert.ok(a.length() >= 99.999);
    tallest = Math.max(tallest, a.length());
  }
  assert.ok(tallest > 101 && tallest < 105);
  for (let i = 0; i < index.count - 3; i += 3003) {
    a.fromBufferAttribute(p, index.getX(i));
    b.fromBufferAttribute(p, index.getX(i + 1));
    c.fromBufferAttribute(p, index.getX(i + 2));
    assert.ok(b.sub(a).cross(c.sub(a)).dot(a) >= -1e-5);
  }
  geometry.dispose();
});
test('invalid terrain record sizes fail explicitly', () => {
  const buffer = new ArrayBuffer(32);
  new DataView(buffer).setInt32(0, 300, true);
  assert.throws(() => parseTerrain(buffer), /Invalid terrain/);
});
