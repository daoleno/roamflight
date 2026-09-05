import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';

const base = process.env.TEST_URL || 'http://127.0.0.1:4177';
const browser = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9222');
const output = new URL('../verification/', import.meta.url);
await mkdir(output, { recursive: true });
const page =
  browser
    .contexts()[0]
    .pages()
    .find((p) => p.url().startsWith(base)) || (await browser.contexts()[0].newPage());
const errors = [],
  failed = [];
const report = { checks: [], screenshots: [] };
function observe(p) {
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  p.on('response', (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
}
observe(page);
const flight = (p) => p.evaluate(() => window.__flight.state);
async function ready(p) {
  await p.waitForFunction(() => window.__flight?.state.ready, {}, { timeout: 60000 });
  await p.locator('#loading').waitFor({ state: 'hidden' });
}
async function capture(p, name) {
  await p.screenshot({ path: new URL(name, output).pathname });
  report.screenshots.push(name);
}
async function pixels(p) {
  return p.evaluate(() => {
    const source = document.querySelector('#world'),
      c = document.createElement('canvas');
    c.width = 128;
    c.height = 96;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, 128, 96);
    const { data } = ctx.getImageData(0, 0, 128, 96);
    let nonblack = 0,
      min = 255,
      max = 0;
    const colours = new Set();
    for (let i = 0; i < data.length; i += 4) {
      const b = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (b > 15) nonblack++;
      min = Math.min(min, b);
      max = Math.max(max, b);
      colours.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`);
    }
    return { nonblack: nonblack / (128 * 96), range: max - min, colours: colours.size };
  });
}
function check(name, detail) {
  report.checks.push({ name, pass: true, detail });
  writeFileSync(new URL('report.json', output), JSON.stringify(report, null, 2));
  console.log('PASS', name, JSON.stringify(detail ?? ''));
}

let mobileContext;
try {
  await page.bringToFront();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/?test=1&paused=1`);
  await ready(page);
  const desktopPixels = await pixels(page);
  assert.ok(
    desktopPixels.nonblack > 0.9 && desktopPixels.colours > 60 && desktopPixels.range > 100,
  );
  check('desktop canvas renders textured scene', desktopPixels);
  await capture(page, 'desktop.png');
  await page.locator('#pause').click();
  await page.locator('#sound').click();
  await page.waitForFunction(() => window.__flight.audio().enabled);
  const before = await flight(page);
  await page.waitForFunction((t) => window.__flight.state.elapsed > t + 0.4, before.elapsed, {
    timeout: 30000,
  });
  const moved = await flight(page);
  assert.notDeepEqual(moved.coordinate, before.coordinate);
  check('flight advances', moved.coordinate);
  await page.keyboard.down('ArrowRight');
  const turnStart = await flight(page);
  await page.waitForFunction((t) => window.__flight.state.elapsed > t + 0.5, turnStart.elapsed, {
    timeout: 30000,
  });
  await page.keyboard.up('ArrowRight');
  const turned = await flight(page);
  assert.ok((turned.heading - turnStart.heading + 360) % 360 > 15);
  check('right steering changes heading', turned.heading - turnStart.heading);
  await page.locator('#pause').click();
  await page.locator('#pause-dialog').waitFor({ state: 'visible' });
  const paused = await flight(page);
  await page.waitForTimeout(250);
  assert.deepEqual((await flight(page)).coordinate, paused.coordinate);
  await page.locator('#cloud-toggle').uncheck();
  await page.locator('#cloud-toggle').check();
  await page.locator('#border-toggle').uncheck();
  await page.locator('#border-toggle').check();
  await page.locator('#resume').click();
  assert.equal((await flight(page)).paused, false);
  check('pause, settings and resume');
  await page.locator('#drop').click();
  assert.equal((await flight(page)).dropped, 1);
  assert.equal((await flight(page)).packages, 1);
  check('package deployment creates parachute');
  await page.evaluate(() => {
    const target = window.__flight.state.target;
    window.__flight.place(target[2], target[3]);
  });
  await page.waitForFunction(
    () => !document.querySelector('#drop').disabled,
    {},
    { timeout: 30000 },
  );
  await page.locator('#drop').click();
  await page.waitForFunction(() => window.__flight.state.delivered === 1, {}, { timeout: 120000 });
  const delivery = await flight(page);
  assert.notEqual(delivery.target[0], 'Cape Town');
  check('landing validates distance and advances mission', delivery.target);
  assert.equal(await page.evaluate(() => window.__flight.audio().lastEvent), 'success');
  check('successful gameplay delivery triggers the audio cue');
  await capture(page, 'delivery.png');
  await page.locator('#view').click();
  assert.equal((await flight(page)).view, 1);
  await capture(page, 'rear-view.png');
  await page.locator('#view').click();
  assert.equal((await flight(page)).view, 2);
  check('three camera modes');
  await page.locator('#globe').click();
  assert.equal((await flight(page)).map, true);
  await capture(page, 'globe.png');
  const mapBefore = await flight(page);
  await page.mouse.move(800, 420);
  await page.mouse.down();
  await page.mouse.move(1020, 450, { steps: 8 });
  await page.mouse.up();
  const mapAfter = await flight(page);
  assert.notDeepEqual(mapAfter.camera, mapBefore.camera);
  check('globe map orbit responds to dragging');
  await page.locator('#daylight').click();
  assert.equal((await flight(page)).night, true);
  await page.waitForTimeout(1600);
  await capture(page, 'night.png');
  await page.locator('#daylight').click();
  await page.locator('#globe').click();
  check('night toggle and return to flight');
  await page.locator('#pause').click();
  await page.locator('#departure').selectOption('asia');
  assert.equal((await flight(page)).target[0], 'Kathmandu');
  await page.locator('#resume').click();
  check('changing departure resets mission');
  await capture(page, 'himalayas.png');
  mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  const mobile = await mobileContext.newPage();
  observe(mobile);
  await mobile.goto(`${base}/?test=1&paused=1`);
  await ready(mobile);
  const mobilePixels = await pixels(mobile);
  assert.ok(mobilePixels.nonblack > 0.9 && mobilePixels.colours > 50 && mobilePixels.range > 100);
  check('mobile canvas renders textured scene', mobilePixels);
  assert.ok(await mobile.locator('#left').isVisible());
  assert.ok(await mobile.locator('#drop').isVisible());
  const overflow = await mobile.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth > innerWidth,
    items: [
      ...document.querySelectorAll(
        '#identity,#toolbar,#delivery,#flight-data,#compass,#drop,#country',
      ),
    ]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.left < 0 || r.right > innerWidth + 1 || r.top < 0 || r.bottom > innerHeight + 1;
      })
      .map((e) => e.id),
  }));
  assert.equal(overflow.horizontal, false);
  assert.deepEqual(overflow.items, []);
  check('mobile controls fit viewport', overflow);
  await capture(mobile, 'mobile.png');
  await mobile.locator('#pause').tap();
  const touchStart = await flight(mobile),
    box = await mobile.locator('#right').boundingBox();
  const cdp = await mobileContext.newCDPSession(mobile);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
  });
  await mobile.waitForFunction(
    (t) => window.__flight.state.elapsed > t + 0.45,
    touchStart.elapsed,
    { timeout: 30000 },
  );
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.ok(((await flight(mobile)).heading - touchStart.heading + 360) % 360 > 10);
  check('mobile touch steering');
  await mobile.locator('#drop').tap();
  assert.equal((await flight(mobile)).dropped, 1);
  check('mobile package button');
  await mobile.setViewportSize({ width: 844, height: 390 });
  await capture(mobile, 'mobile-landscape.png');
  check('mobile landscape render', await pixels(mobile));
  const overlap = await mobile.evaluate(() => {
    const a = document.querySelector('#touch-controls').getBoundingClientRect(),
      b = document.querySelector('#compass').getBoundingClientRect();
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  });
  assert.equal(overlap, false);
  check('mobile landscape touch controls do not overlap compass');
  assert.deepEqual(errors, []);
  assert.deepEqual(failed, []);
  check('no runtime, shader or resource errors');
  const requests = await mobile.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((r) => r.name)
      .filter((s) => /^https?:/.test(s) && new URL(s).origin !== location.origin),
  );
  assert.deepEqual(requests, []);
  check('all runtime assets are local');
} catch (error) {
  report.failure = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  report.errors = errors;
  report.failedRequests = failed;
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2));
  await mobileContext?.close();
  await browser.close();
}
