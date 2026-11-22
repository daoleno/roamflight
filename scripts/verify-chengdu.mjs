import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { distanceKm } from '../src/geo.js';
import { bearing, origin, places } from '../src/chengdu-geo.js';

const base = process.env.TEST_URL || 'http://127.0.0.1:4177';
const dir = process.env.EVIDENCE_DIR || 'verification/chengdu';
await mkdir(dir, { recursive: true });
const browser = process.env.CDP_URL
  ? await chromium.connectOverCDP(process.env.CDP_URL)
  : await chromium.launch({
      executablePath: process.env.CHROME_BIN,
      args: ['--enable-unsafe-swiftshader'],
    });
const report = { base, browser: browser.version(), runs: [], errors: [] };
async function examine(mobile) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1200, height: 740 },
    deviceScaleFactor: 1,
    hasTouch: mobile,
    isMobile: mobile,
    locale: 'zh-CN',
  });
  try {
    const page = await context.newPage(),
      cdp = await context.newCDPSession(page);
    page.on('pageerror', (e) => report.errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') report.errors.push(m.text());
    });
    page.on('response', (r) => {
      if (r.status() >= 400) report.errors.push(r.status() + ' ' + r.url());
    });
    const run = { mobile, paths: [], shots: {}, control: {} };
    report.runs.push(run);
    const state = () => page.evaluate(() => window.__flight.state);
    const tap = async (selector) =>
      mobile ? page.locator(selector).tap() : page.locator(selector).click();
    const ready = async () => {
      await page.waitForFunction(() => window.__flight?.state.ready, null, { timeout: 90000 });
      await page.locator('#loading').waitFor({ state: 'hidden' });
    };
    async function capture(name) {
      const pixels = await page.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = 128;
        c.height = 96;
        const ctx = c.getContext('2d');
        ctx.drawImage(document.querySelector('#world'), 0, 0, 128, 96);
        const d = ctx.getImageData(0, 0, 128, 96).data,
          colors = new Set();
        let min = 255,
          max = 0,
          lit = 0;
        for (let i = 0; i < d.length; i += 4) {
          const b = (d[i] + d[i + 1] + d[i + 2]) / 3;
          min = Math.min(b, min);
          max = Math.max(max, b);
          if (b > 15) lit++;
          colors.add([d[i] >> 4, d[i + 1] >> 4, d[i + 2] >> 4].join('/'));
        }
        return { colors: colors.size, range: max - min, nonblack: lit / (128 * 96) };
      });
      assert.ok(
        pixels.colors > 38 && pixels.range > 80 && pixels.nonblack > 0.9,
        JSON.stringify(pixels),
      );
      run.shots[name] = { pixels, state: await state() };
      await page.screenshot({ path: join(dir, name + '.png') });
    }
    // Follow the visible links on the actual root. Each device also exercises the globe.
    await page.goto(base);
    await ready();
    assert.equal((await state()).region, 'world');
    run.worldColdBytes = await page.evaluate(() =>
      [
        ...performance.getEntriesByType('navigation'),
        ...performance.getEntriesByType('resource'),
      ].reduce((n, r) => n + r.transferSize, 0),
    );
    await tap('#pause');
    await tap('#pause-dialog .city-entry');
    await ready();
    assert.equal((await state()).region, 'chengdu');
    run.regionAfterWorldBytes = await page.evaluate(() =>
      [
        ...performance.getEntriesByType('navigation'),
        ...performance.getEntriesByType('resource'),
      ].reduce((n, r) => n + r.transferSize, 0),
    );
    const prefix = mobile ? 'mobile' : 'desktop';
    await capture(prefix + '-city');
    await tap('#globe');
    assert.ok((await state()).map);
    const frozen = await state();
    await capture(prefix + '-map');
    assert.deepEqual((await state()).coordinate, frozen.coordinate);
    await tap('#globe');
    const held = new Set(),
      codes = { climb: 'e', descend: 'q', left: 'ArrowLeft', right: 'ArrowRight', boost: 'Shift' };
    const coords = {};
    for (const key of Object.keys(codes)) {
      const box = await page.locator('#' + key).boundingBox();
      if (box)
        coords[key] = {
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
          id: Object.keys(codes).indexOf(key) + 1,
        };
    }
    async function inputs(...want) {
      if (want.length === held.size && want.every((k) => held.has(k))) return;
      if (mobile) {
        if (held.size)
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        if (want.length)
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: want.map((k) => coords[k]),
          });
      } else {
        for (const k of held) if (!want.includes(k)) await page.keyboard.up(codes[k]);
        for (const k of want) if (!held.has(k)) await page.keyboard.down(codes[k]);
      }
      held.clear();
      want.forEach((k) => held.add(k));
    }
    for (const k of ['right', 'climb', 'descend']) {
      const before = await state();
      await inputs(k);
      await page.waitForFunction((t) => window.__flight.state.elapsed > t + 1.1, before.elapsed);
      const end = await state();
      await inputs();
      run.control[k] = { before, end };
      if (k === 'right') assert.ok((end.heading - before.heading + 360) % 360 > 20);
      if (k === 'climb') assert.ok(end.altitude - before.altitude > 55 && end.pitch > 0.1);
      if (k === 'descend') assert.ok(before.altitude - end.altitude > 40 && end.pitch < -0.1);
    }
    // Route changes preserve position. Restart is used explicitly only at the start of each itinerary.
    for (const route of mobile ? ['east', 'south'] : ['west', 'north', 'lake']) {
      await tap('#route-button');
      const before = await state();
      await page.locator('#city-route').selectOption(route);
      assert.deepEqual((await state()).coordinate, before.coordinate);
      await page.locator('#throttle').focus();
      await page.keyboard.press('End');
      await tap('#restart');
      const path = { route, samples: [], arrivals: [] };
      run.paths.push(path);
      let lastTarget = '',
        nextSample = 0;
      const started = Date.now();
      let capturedAirport = false;
      while (Date.now() - started < 210000) {
        const s = await state();
        assert.ok(s.clearance >= 234.9 && !s.paused && !s.map);
        assert.ok(Math.abs(s.distance - distanceKm(s.coordinate, s.target)) < 1e-6);
        if (s.travelled >= nextSample || s.waypoint !== lastTarget || s.finished) {
          path.samples.push(s);
          nextSample = s.travelled + 1.5;
        }
        if (s.waypoint !== lastTarget || s.finished) {
          if (lastTarget) {
            const distance = distanceKm(s.coordinate, places[lastTarget].slice(2));
            path.arrivals.push({ place: lastTarget, distance, state: s });
            assert.ok(distance < 3.5);
            console.log('ARRIVAL', prefix, route, lastTarget, distance.toFixed(2));
          }
          lastTarget = s.waypoint;
        }
        if (s.finished) {
          await inputs();
          await capture(prefix + '-' + route + '-arrival');
          break;
        }
        if (s.waypoint === 'tianfu' && s.distance < 4 && !capturedAirport) {
          await inputs();
          await tap('#view');
          await tap('#view');
          await capture('mobile-tianfu-airfield');
          await tap('#view');
          capturedAirport = true;
        }
        const error = ((bearing(s.coordinate, s.target) - s.heading + 540) % 360) - 180;
        const turn = Math.abs(error) > 3 ? [error > 0 ? 'right' : 'left'] : [];
        await inputs(...turn, ...(Math.abs(error) < 18 && s.distance > 5 ? ['boost'] : []));
        await page.waitForTimeout(110);
      }
      assert.ok(
        (await state()).finished,
        'Route timed out ' + route + ' ' + JSON.stringify(await state()),
      );
      assert.ok(new Set(path.samples.map((s) => s.district).filter(Boolean)).size >= 3);
      assert.ok(path.arrivals.length >= 2);
      if (route === 'west') assert.ok(path.samples.at(-1).ground > 2000);
    }
    // Warm in-flight sample, timed by wall-clock requestAnimationFrame during actual rendering.
    run.performance = await page.evaluate(async () => {
      const timings = [],
        calls = [],
        triangles = [];
      let last = performance.now();
      await new Promise((resolve) => {
        const start = last;
        function frame(now) {
          timings.push(now - last);
          last = now;
          calls.push(window.__flight.state.meshes);
          triangles.push(window.__flight.state.triangles);
          if (now - start >= 4000) resolve();
          else requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      });
      const sum = timings.reduce((a, b) => a + b, 0);
      timings.sort((a, b) => a - b);
      const gl = document.querySelector('#world').getContext('webgl2');
      return {
        frames: timings.length,
        seconds: sum / 1000,
        fps: (timings.length * 1000) / sum,
        p95ms: timings[Math.floor(timings.length * 0.95)],
        maxCalls: Math.max(...calls),
        maxTriangles: Math.max(...triangles),
        gpu: gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL),
      };
    });
    await tap('#pause');
    await tap('#pause-dialog a[href="/"]');
    await ready();
    assert.equal((await state()).region, 'world');
    // Separate cold direct entry; prior menu navigation can reuse the graphics bundle and FBX.
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    const begin = Date.now();
    await page.goto(new URL('/?region=chengdu', base).href);
    await ready();
    run.cold = await page.evaluate(() => {
      const entries = [
        ...performance.getEntriesByType('navigation'),
        ...performance.getEntriesByType('resource'),
      ].filter((r) => /^https?:/.test(r.name));
      return {
        resources: entries.map((r) => ({
          path: new URL(r.name).pathname,
          body: r.encodedBodySize,
          transfer: r.transferSize,
        })),
        transferred: entries.reduce((n, r) => n + r.transferSize, 0),
        body: entries.reduce((n, r) => n + r.encodedBodySize, 0),
        external: entries.filter((r) => new URL(r.name).origin !== location.origin).length,
      };
    });
    run.cold.readyMs = Date.now() - begin;
    assert.equal(run.cold.external, 0);
    assert.ok(run.cold.transferred > 1000000 && run.cold.transferred < 3500000);
    assert.ok(!run.cold.resources.some((r) => r.path.endsWith('terrain.bytes')));
    console.log('PASS', prefix, run.performance, run.cold.transferred);
  } finally {
    await context.close();
  }
}
try {
  await examine(false);
  await examine(true);
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.failure = String(error.stack);
  throw error;
} finally {
  await writeFile(join(dir, 'browser.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
