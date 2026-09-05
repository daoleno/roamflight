import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUDIO_PRESET, flightMix, FlightAudio } from '../src/audio.js';

test('one immutable mix replaces all user volume configuration', () => {
  assert.ok(Object.isFrozen(AUDIO_PRESET));
  assert.ok(AUDIO_PRESET.engine < AUDIO_PRESET.music);
  for (const level of Object.values(AUDIO_PRESET)) assert.ok(level > 0 && level <= 1);
  const audio = new FlightAudio({
    storage: {
      getItem() {
        throw new Error('Old settings must not be read');
      },
    },
  });
  assert.equal(audio.setVolume, undefined);
  assert.deepEqual(audio.inspect().mix, AUDIO_PRESET);
});
test('engine and wind follow flight gently and saturate at boost speed', () => {
  const slow = flightMix({ speed: 0.3 }),
    fast = flightMix({ speed: 2 });
  assert.ok(fast.rpm > slow.rpm && fast.wind > slow.wind);
  assert.ok(flightMix({ map: true }).engine < slow.engine);
  assert.equal(flightMix({ speed: 100 }).rpm, flightMix({ speed: 2.2 }).rpm);
  assert.ok(Number.isFinite(flightMix({ speed: NaN, bank: NaN }).wind));
});
test('preset does not autoplay before an explicit gesture', () => {
  let created = 0;
  const audio = new FlightAudio({
    contextFactory() {
      created++;
    },
  });
  audio.update({ speed: 1 });
  audio.play('drop');
  assert.equal(created, 0);
  assert.equal(audio.enabled, false);
});
test('cruise noise stays below the previous mix without reducing music', () => {
  const previousWind = 0.48 * (0.07 + 0.75 * 0.025);
  const cruiseWind = AUDIO_PRESET.ambience * flightMix({ speed: 0.75 }).wind;
  assert.ok(cruiseWind < previousWind * 0.04);
  assert.ok(AUDIO_PRESET.engine < 0.22 * 0.5);
  assert.equal(AUDIO_PRESET.music, 0.55);
  assert.equal(AUDIO_PRESET.effects, 0.42);
  assert.equal(flightMix({ map: true }).wind, 0);
});
test('failed audio unlock leaves the user muted', async () => {
  const audio = new FlightAudio({
    contextFactory() {
      throw new Error('Unavailable');
    },
  });
  await assert.rejects(audio.setEnabled(true), /Unavailable/);
  assert.equal(audio.enabled, false);
});
