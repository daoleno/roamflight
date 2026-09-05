import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  toPoint,
  toCoordinate,
  headingVector,
  headingDegrees,
  advanceFlight,
  distanceKm,
  findCountry,
  DEG,
} from '../src/geo.js';

test('coordinates round-trip across hemispheres and the date line', () => {
  for (const coordinate of [
    [0, 0],
    [18.4, -33.9],
    [85, 28],
    [-179, 75],
    [179, -80],
  ]) {
    const actual = toCoordinate(toPoint(...coordinate));
    coordinate.forEach((n, i) => assert.ok(Math.abs(n - actual[i]) < 1e-8));
  }
});
test('compass directions correspond to geographic north and east', () => {
  for (const coordinate of [
    [0, 0],
    [18, -33],
    [-90, 40],
  ]) {
    for (const heading of [0, 90, 180, 270]) {
      const up = toPoint(...coordinate),
        forward = headingVector(up, heading);
      assert.ok(Math.abs(headingDegrees(up, forward) - heading) < 1e-6);
      advanceFlight(up, forward, 0.001);
      const [lon, lat] = toCoordinate(up);
      if (heading === 0) assert.ok(lat > coordinate[1]);
      if (heading === 180) assert.ok(lat < coordinate[1]);
      if (heading === 90) assert.ok(lon > coordinate[0]);
      if (heading === 270) assert.ok(lon < coordinate[0]);
    }
  }
});
test('right turn increases heading', () => {
  const up = toPoint(0, 0),
    forward = headingVector(up, 0);
  advanceFlight(up, forward, 0, 90 * DEG);
  assert.ok(Math.abs(headingDegrees(up, forward) - 90) < 1e-6);
});
test('east is visually right when looking north in the WebGL coordinate system', () => {
  const up = toPoint(18, -33),
    north = headingVector(up, 0),
    east = headingVector(up, 90);
  assert.ok(north.clone().cross(up).dot(east) > 0.99999);
});
test('flight preserves altitude frame and tangent direction over many orbits', () => {
  const up = toPoint(179, 85),
    forward = headingVector(up, 10);
  for (let i = 0; i < 10000; i++) advanceFlight(up, forward, 0.003, 0.002);
  assert.ok(Math.abs(up.length() - 1) < 1e-10);
  assert.ok(Math.abs(forward.length() - 1) < 1e-10);
  assert.ok(Math.abs(up.dot(forward)) < 1e-10);
});
test('great-circle distance is accurate and crosses the date line', () => {
  assert.equal(distanceKm([0, 0], [0, 0]), 0);
  assert.ok(Math.abs(distanceKm([179, 0], [-179, 0]) - 222.39) < 0.1);
  assert.ok(Math.abs(distanceKm([0, 0], [90, 0]) - 10007.54) < 0.1);
});
test('country lookup uses actual source polygons', () => {
  const { features } = JSON.parse(
    readFileSync(new URL('../public/assets/countries.json', import.meta.url)),
  );
  assert.equal(findCountry(features, [18.5, -33.8]), 'South Africa');
  assert.equal(findCountry(features, [2.35, 48.86]), 'France');
  assert.equal(findCountry(features, [85.32, 27.72]), 'Nepal');
  assert.equal(findCountry(features, [-20, -20]), null);
});
