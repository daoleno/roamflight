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

test('the historical pavilion lies in Jinjiang and the covered bridge connects both district banks', async () => {
  const { contains, geographic } = await import('../src/chengdu-geo.js');
  const districts = JSON.parse(file('districts.json'));
  const at = (x, z) => districts.find((a) => contains(a, geographic(x / 1000, z / 1000)))?.zh;
  const [, , x, z] = guide.find((p) => p[0] === '合江亭');
  assert.equal(at(x, z), '锦江区');
  assert.equal(at(7981, 6167), '锦江区');
  assert.equal(at(7957, 6243), '武侯区');
  const candidates = JSON.parse(gunzipSync(file('places.gzdata'))).filter((p) => p[0] === '合江亭');
  assert.deepEqual(
    candidates.map((p) => [p[1], index.districts[p[4]]]).sort(),
    [
      ['公交站', '锦江区'],
      ['历史建筑', '锦江区'],
    ].sort(),
  );
});

test('regional skyline triangles keep the local metre outline and height of the museum', () => {
  const [, , x, z] = guide.find((p) => p[0] === '成都博物馆');
  const [kind, , [height], [ring]] = records(x, z).find(
    ([kind, , attr, rings]) =>
      kind === 'b' &&
      attr[0] === 47 &&
      Math.min(...rings[0].filter((_, i) => i % 2 === 0)) <= x % 1200 &&
      Math.max(...rings[0].filter((_, i) => i % 2 === 0)) >= x % 1200 &&
      Math.min(...rings[0].filter((_, i) => i % 2 === 1)) <= z % 1200 &&
      Math.max(...rings[0].filter((_, i) => i % 2 === 1)) >= z % 1200,
  );
  assert.equal(kind, 'b');
  const bytes = gunzipSync(file('skyline.gzdata'));
  const roof = new Set();
  for (let offset = 0; offset < bytes.length;) {
    const i = bytes.readInt32LE(offset),
      j = bytes.readInt32LE(offset + 4),
      length = bytes.readInt32LE(offset + 8);
    offset += 12;
    assert.ok(length > 0 && length % 9 === 0 && offset + length * 2 <= bytes.length);
    if (i === Math.floor(x / 1200) && j === Math.floor(z / 1200))
      for (let k = offset; k < offset + length * 2; k += 6)
        if (bytes.readInt16LE(k + 2) === height)
          roof.add([bytes.readInt16LE(k), bytes.readInt16LE(k + 4)].join(','));
    offset += length * 2;
  }
  for (let i = 0; i < ring.length; i += 2) assert.ok(roof.has([ring[i], ring[i + 1]].join(',')));
});
