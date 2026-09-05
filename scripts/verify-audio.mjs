import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.TEST_URL || 'http://127.0.0.1:4177';
const browser = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9222');
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 1,
});
await context.addInitScript(() =>
  localStorage.setItem(
    'geo-adventures.audio.v1',
    JSON.stringify({ master: 0, engine: 1, music: 0, effects: 1 }),
  ),
);
const page = await context.newPage();
const errors = [],
  checks = [];
const output = new URL('../verification/', import.meta.url);
await mkdir(output, { recursive: true });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const status = () => page.evaluate(() => window.__flight.audio());
function check(name, data = null) {
  checks.push({ name, pass: true, data });
  console.log('PASS', name, JSON.stringify(data));
}
async function ready() {
  await page.waitForFunction(() => window.__flight?.state.ready, {}, { timeout: 60000 });
  await page.locator('#loading').waitFor({ state: 'hidden' });
}
async function audible() {
  await page.waitForFunction(
    () => window.__flight.audio().rms > 0.001,
    {},
    { timeout: 15000, polling: 100 },
  );
}
async function silent() {
  await page.waitForFunction(
    () => window.__flight.audio().rms < 0.00001,
    {},
    { timeout: 10000, polling: 100 },
  );
}
let failure;
try {
  await page.goto(`${base}/?test=1`);
  await ready();
  const initial = await status();
  assert.equal(initial.context, 'not-created');
  assert.equal(initial.preset, 'quiet-flight-v2');
  assert.equal(initial.mix.master, 0.7);
  assert.ok(await page.locator('#sound').isVisible());
  assert.equal(await page.locator('[id^="audio-"]').count(), 0);
  check('one sound toggle, no mixer, no autoplay, legacy preferences ignored', initial.mix);
  await page.locator('#sound').tap();
  await audible();
  const playing = await status();
  assert.ok(playing.peak < 0.98);
  check('preset produces nonclipping audio', { rms: playing.rms, peak: playing.peak });
  await page.evaluate(() => window.__flight.audioEvent('success'));
  await page.waitForFunction(
    (level) => {
      const s = window.__flight.audio();
      return s.ducking && s.musicLevel < level * 0.8;
    },
    playing.musicLevel,
    { timeout: 10000, polling: 50 },
  );
  check('delivery cue automatically ducks the background');
  await page.waitForFunction(() => !window.__flight.audio().ducking);
  const chord = (await status()).chord;
  await page.waitForFunction((chord) => window.__flight.audio().chord !== chord, chord, {
    timeout: 25000,
  });
  const harmony = (await status()).harmony;
  const notes = [41, 43, 45, 48, 52, 53, 55, 59, 60, 62, 64, 65].map(
    (n) => 440 * 2 ** ((n - 69) / 12),
  );
  assert.ok(harmony.every((f) => notes.some((note) => Math.abs(note - f) < 0.001)));
  await audible();
  check('harmony changes at fixed pitches without glissando', harmony);
  await page.locator('#pause').tap();
  await silent();
  assert.equal(await page.locator('#pause-dialog input[type="range"]').count(), 1);
  await page.screenshot({ path: new URL('preset-menu-mobile.png', output).pathname });
  check('pause menu contains no audio configuration and pause is silent');
  await page.locator('#resume').tap();
  await audible();
  await page.locator('#sound').tap();
  await silent();
  assert.equal((await status()).enabled, false);
  await page.locator('#sound').tap();
  await audible();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await silent();
  check('mute, resume and background silence work');
  await page.reload();
  await ready();
  assert.deepEqual((await status()).mix, initial.mix);
  assert.equal((await status()).context, 'not-created');
  check('reload always uses the same authored preset');
  for (const [width, height, name] of [
    [320, 700, 'preset-small-mobile.png'],
    [1440, 900, 'preset-desktop.png'],
  ]) {
    await page.setViewportSize({ width, height });
    const layout = await page.evaluate(() => {
      const a = document.querySelector('#identity').getBoundingClientRect(),
        b = document.querySelector('#toolbar').getBoundingClientRect();
      return { gap: b.left - a.right, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.ok(layout.gap >= 0);
    assert.equal(layout.overflow, false);
    await page.screenshot({ path: new URL(name, output).pathname });
    check(`${width}px layout fits`, layout);
  }
  assert.deepEqual(errors, []);
  check('no browser or audio errors');
} catch (error) {
  failure = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(
    new URL('audio-report.json', output),
    JSON.stringify({ checks, errors, failure }, null, 2),
  );
  await context.close();
  await browser.close();
}
