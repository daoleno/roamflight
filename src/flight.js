import { MathUtils } from 'three';
import { RADIUS, advanceFlight } from './geo.js';

export const FLIGHT_LIMITS = Object.freeze({
  step: 1 / 120,
  clearance: 1.8,
  maxRadius: RADIUS + 14,
  maxPitch: 0.24,
});

export function stepFlight(state, input, dt, groundRadius) {
  const step = FLIGHT_LIMITS.step;
  const floor = Math.max(RADIUS, groundRadius) + FLIGHT_LIMITS.clearance;
  const ceiling = Math.max(FLIGHT_LIMITS.maxRadius, floor + 1);
  state.pitch ??= 0;
  state.flightAccumulator = (state.flightAccumulator || 0) + Math.min(0.1, Math.max(0, dt));
  state.radius = MathUtils.clamp(state.radius, floor, ceiling);
  // A fixed integration step keeps pitch, altitude and movement consistent across frame rates.
  while (state.flightAccumulator >= step - 1e-10) {
    state.flightAccumulator = Math.max(0, state.flightAccumulator - step);
    state.throttle = MathUtils.clamp(state.throttle + input.accelerate * step * 0.3, 0.3, 1.7);
    state.speed = MathUtils.damp(state.speed, state.throttle * (input.boost ? 2.2 : 1), 2, step);
    const margin = input.climb > 0 ? ceiling - state.radius : state.radius - floor;
    const targetPitch = input.climb * FLIGHT_LIMITS.maxPitch * MathUtils.clamp(margin / 0.8, 0, 1);
    state.pitch = MathUtils.damp(state.pitch, targetPitch, 4.5, step);
    state.bank = MathUtils.damp(state.bank, input.turn * 0.48, 4.5, step);
    const forwardSpeed = state.speed * Math.cos(state.pitch);
    advanceFlight(state.up, state.forward, forwardSpeed * 0.012 * step, input.turn * 0.7 * step);
    state.radius = MathUtils.clamp(
      state.radius + Math.sin(state.pitch) * state.speed * 1.2 * step,
      floor,
      ceiling,
    );
  }
}
