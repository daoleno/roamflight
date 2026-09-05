import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPoint, headingVector } from '../src/geo.js';
import { FLIGHT_LIMITS, stepFlight } from '../src/flight.js';

function flight() {
  const up = toPoint(10, -29);
  return {
    up,
    forward: headingVector(up, 107),
    radius: 106.2,
    pitch: 0,
    bank: 0,
    speed: 0.75,
    throttle: 0.75,
    flightAccumulator: 0,
  };
}
const level = { turn: 0, accelerate: 0, climb: 0, boost: false };
function simulate(state, input, seconds, fps = 60, ground = 100) {
  for (let i = 0; i < seconds * fps; i++) stepFlight(state, input, 1 / fps, ground);
  return state;
}
test('level flight keeps selected altitude instead of snapping back to an automatic cruise height', () => {
  const state = flight();
  state.radius = 108;
  simulate(state, level, 4);
  assert.equal(state.radius, 108);
});
test('pitch changes altitude and settles smoothly when the input stops', () => {
  const up = simulate(flight(), { ...level, climb: 1 }, 4);
  const down = simulate(flight(), { ...level, climb: -1 }, 4);
  assert.ok(up.radius > 106.7 && up.pitch > 0.2);
  assert.ok(down.radius < 105.7 && down.pitch < -0.2);
  simulate(up, level, 4);
  assert.ok(Math.abs(up.pitch) < 0.00001);
});
test('height limits and rising terrain preserve safety clearance', () => {
  const up = simulate(flight(), { ...level, climb: 1, boost: true }, 90);
  const down = simulate(flight(), { ...level, climb: -1, boost: true }, 90);
  assert.ok(up.radius <= FLIGHT_LIMITS.maxRadius);
  assert.ok(down.radius >= 100 + FLIGHT_LIMITS.clearance);
  stepFlight(down, level, 1 / 60, 104);
  assert.ok(down.radius >= 104 + FLIGHT_LIMITS.clearance);
});
test('fixed integration is consistent at 30, 60 and 144 FPS', () => {
  const input = { turn: 0.4, accelerate: 0.2, climb: 1, boost: false };
  const baseline = simulate(flight(), input, 6, 30);
  for (const fps of [60, 144]) {
    const state = simulate(flight(), input, 6, fps);
    assert.ok(state.up.distanceTo(baseline.up) < 1e-9);
    assert.ok(state.forward.distanceTo(baseline.forward) < 1e-9);
    assert.ok(Math.abs(state.radius - baseline.radius) < 1e-9);
    assert.ok(Math.abs(state.pitch - baseline.pitch) < 1e-9);
  }
});
