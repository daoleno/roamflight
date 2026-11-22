import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tour, guide } from '../src/street-guide.js';
const root = new URL('../public/assets/streets-v1/', import.meta.url);
const file = (name) => readFileSync(new URL(name, root));
const index = JSON.parse(file('index.json'));
function records(x, z) {
  const i = Math.floor(x / index.size),
    j = Math.floor(z / index.size),
    [offset, length] = index.tiles[[i, j]];
  return JSON.parse(
    gunzipSync(
      file(Math.floor(i / 8) + '_' + Math.floor(j / 8) + '.pack').subarray(offset, offset + length),
    ),
  );
}
test('the distributed street packs contain mapped stops and sourced heights at their projected positions', () => {
  const museum = guide.find((p) => p[0] === '成都博物馆'),
    rows = records(museum[2], museum[3]);
  assert.ok(
    rows.some(
      ([k, , attr, rings]) =>
        k === 'b' &&
        attr[0] === 47 &&
        attr[1] === 1 &&
        Math.min(...rings[0].filter((_, i) => i % 2 === 0)) <= museum[2] % 1200,
    ),
  );
  for (const [name, , x, z] of tour) {
    const features = records(x, z);
    assert.ok(
      features.some(([k, n]) => k === 'p' && n === name),
      name,
    );
  }
  const bridge = tour.at(-1);
  assert.ok(records(bridge[2], bridge[3]).some(([k, n]) => k === 'deck' && n === bridge[0]));
});
test('twenty districts have measured street inventory and the searchable records retain local provenance', () => {
  const coverage = JSON.parse(file('coverage.json')),
    places = JSON.parse(gunzipSync(file('places.gzdata')));
  assert.equal(index.districts.length, 20);
  assert.equal(places.length, coverage.search);
  for (const district of index.districts) {
    const d = coverage.districts[district];
    assert.ok(d.places > 0 && d.street > 0);
    assert.equal(
      d.buildings,
      (d.height_source || 0) + (d.height_floors || 0) + (d.height_remote || 0) + d.height_default,
    );
  }
  const target = places.find((p) => p[0] === '简阳市人民政府');
  assert.equal(index.districts[target[4]], '简阳市');
  assert.ok(
    records(target[2], target[3]).some(
      ([k, n, meta]) =>
        k === 'p' && n === target[0] && meta[1] === target[4] && meta[2] === target[5],
    ),
  );
});
