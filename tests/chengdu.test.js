import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { project, geographic, origin, places, makeTerrain, contains } from '../src/chengdu-geo.js';
import { distanceKm } from '../src/geo.js';
const assets = new URL('../public/assets/chengdu/', import.meta.url);
const atlas = JSON.parse(readFileSync(new URL('atlas.json', assets)));
const bytes = readFileSync(new URL('height.bin', assets));
const samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
const terrain = makeTerrain(atlas, samples);
test('Chengdu chart encloses all 20 county-level areas and both airports', () => {
  assert.equal(atlas.areas.length, 21);
  for (const area of atlas.areas)
    for (const poly of area.polygons)
      for (const ring of poly)
        for (const [lon, lat] of ring) {
          assert.ok(
            lon >= atlas.bounds[0] &&
              lon <= atlas.bounds[2] &&
              lat >= atlas.bounds[1] &&
              lat <= atlas.bounds[3],
          );
        }
  for (const place of Object.values(places))
    assert.ok(contains(atlas.areas[0], place.slice(2)), place[0]);
  for (const [place, district] of [
    ['fish', '都江堰市'],
    ['xiling', '大邑县'],
    ['tianfu', '简阳市'],
    ['pujiang', '蒲江县'],
    ['pengzhou', '彭州市'],
  ])
    assert.ok(
      contains(
        atlas.areas.find((a) => a.zh === district),
        places[place].slice(2),
      ),
    );
});
test('local axes, geodesic distance and DEM samples agree at geographic landmarks', () => {
  assert.deepEqual(geographic(...project(origin)), origin);
  assert.ok(project([104.5, 31])[0] > 0 && project([104.5, 31])[1] < 0);
  const km = distanceKm(origin, places.fish.slice(2));
  assert.ok(km > 58 && km < 59);
  assert.equal(samples.length, atlas.grid[0] * atlas.grid[1]);
  assert.equal(terrain.meters(terrain.right, terrain.bottom), samples.at(-1));
  const plain = terrain.meters(...project(origin)),
    mountain = terrain.meters(...project(places.xiling.slice(2)));
  assert.ok(plain > 460 && plain < 550);
  assert.ok(mountain > 2200);
});
