import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { bearing, project } from '../src/chengdu-geo.js';
const base = process.env.TEST_URL || 'http://127.0.0.1:4177';
const dir = process.env.EVIDENCE_DIR || 'verification/streets';
const short = process.env.SHORT_RUN === '1';
await mkdir(dir, { recursive: true });
const browser = process.env.CDP_URL
  ? await chromium.connectOverCDP(process.env.CDP_URL)
  : await chromium.launch({
      executablePath: process.env.CHROME_BIN,
      args: ['--disable-quic', '--enable-unsafe-swiftshader'],
    });
async function run(mobile) {
  const name = mobile ? 'touch' : 'desktop';
  const context = await browser.newContext({
    locale: 'zh-CN',
    isMobile: mobile,
    hasTouch: mobile,
    viewport: mobile ? { width: 390, height: 844 } : { width: 1200, height: 740 },
  });
  const p = await context.newPage(),
    cdp = await context.newCDPSession(p);
  const r = {
    base,
    browser: browser.version(),
    mobile,
    errors: [],
    packResponses: {},
    samples: [],
    shots: {},
    arrivals: [],
  };
  const read = () => p.evaluate(() => window.__flight.state);
  const wait = (fn, arg) => p.waitForFunction(fn, arg, { timeout: 90000 });
  const ready = async () => {
    await wait(() => window.__flight?.state.ready);
    await p.locator('#loading').waitFor({ state: 'hidden' });
  };
  const act = (selector) => (mobile ? p.locator(selector).tap() : p.locator(selector).click());
  const loaded = () =>
    wait(() => window.__flight?.state.tiles?.active >= 8 && !window.__flight.state.tiles.pending);
  p.on('pageerror', (e) => r.errors.push(e.message));
  p.on('console', (m) => {
    if (m.type() === 'error') r.errors.push(m.text());
  });
  p.on('response', (v) => {
    if (v.status() >= 400) r.errors.push(v.status() + ' ' + v.url());
    if (v.url().endsWith('.pack'))
      r.packResponses[v.status()] = (r.packResponses[v.status()] || 0) + 1;
  });
  async function shot(label) {
    const s = await read(),
      selector = s.map ? '#chart-ink' : '#world';
    const pixels = await p.evaluate((sel) => {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 96;
      const ctx = c.getContext('2d');
      ctx.drawImage(document.querySelector(sel), 0, 0, 128, 96);
      const a = ctx.getImageData(0, 0, 128, 96).data,
        colors = new Set();
      let lit = 0,
        min = 255,
        max = 0;
      for (let i = 0; i < a.length; i += 4) {
        const b = (a[i] + a[i + 1] + a[i + 2]) / 3;
        lit += b > 10;
        min = Math.min(b, min);
        max = Math.max(b, max);
        colors.add((a[i] >> 4) * 256 + (a[i + 1] >> 4) * 16 + (a[i + 2] >> 4));
      }
      return { colors: colors.size, range: max - min, nonblack: lit / (128 * 96) };
    }, selector);
    assert.ok(
      pixels.colors > 16 && pixels.range > 65 && pixels.nonblack > 0.9,
      JSON.stringify(pixels),
    );
    await p.screenshot({ path: join(dir, name + '-' + label + '.png') });
    r.shots[label] = { s, pixels };
    return s;
  }
  const codes = {
    right: 'ArrowRight',
    left: 'ArrowLeft',
    climb: 'e',
    descend: 'q',
    boost: 'Shift',
  };
  const held = new Set(),
    points = {};
  async function inputs(want = []) {
    if (want.length === held.size && want.every((k) => held.has(k))) return;
    if (mobile) {
      if (held.size)
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      if (want.length)
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: want.map((k) => points[k]),
        });
    } else {
      for (const k of held) if (!want.includes(k)) await p.keyboard.up(codes[k]);
      for (const k of want) if (!held.has(k)) await p.keyboard.down(codes[k]);
    }
    held.clear();
    want.forEach((k) => held.add(k));
  }
  async function fly(until, seconds) {
    const start = Date.now();
    let next = 0,
      last = r.arrivals.at(-1) || '';
    while (Date.now() - start < seconds * 1000) {
      const s = await read();
      assert.ok(!s.paused && !s.map && s.obstacleClearance >= 8.9);
      const [x, z] = project(s.coordinate),
        [a, b] = project(s.target);
      assert.ok(Math.abs(Math.hypot(x - a, z - b) - s.distance) < 0.00001);
      if (s.travelled >= next || s.lastArrival !== last) {
        r.samples.push(s);
        next = s.travelled + 0.15;
      }
      if (s.lastArrival && s.lastArrival !== last) {
        r.arrivals.push(s.lastArrival);
        console.log(name, s.lastArrival, s.travelled);
        last = s.lastArrival;
      }
      if (until(s)) {
        await inputs();
        return s;
      }
      const err = ((bearing(s.coordinate, s.target) - s.heading + 540) % 360) - 180;
      const turn = Math.abs(err) > 4 ? [err > 0 ? 'right' : 'left'] : [];
      await inputs([...turn, ...(s.distance > 0.14 && Math.abs(err) < 28 ? ['boost'] : [])]);
      await p.waitForTimeout(120);
    }
    throw Error('Flight timeout ' + JSON.stringify(await read()));
  }
  async function choose(q, action) {
    await act('#route-button');
    await wait(() => window.__flight.state.map);
    const before = await read();
    await p.locator('#street-query').fill(q);
    const item = p.locator('#street-results button').filter({ hasText: q }).first();
    if (mobile) await item.tap();
    else await item.click();
    await wait(() => !window.__flight.state.tiles.pending);
    r.cards ||= {};
    r.cards[q] = await p.locator('#street-info').innerText();
    await act('#street-plus');
    await p.waitForTimeout(350);
    await shot('chart-' + q);
    const chart = await p
      .locator('#chart-ink')
      .evaluate((c) => c.toDataURL('image/png').split(',')[1]);
    await writeFile(join(dir, name + '-ink-' + q + '.png'), Buffer.from(chart, 'base64'));

    assert.deepEqual((await read()).coordinate, before.coordinate);
    await act(action);
    await wait(() => !window.__flight.state.map);
    return before;
  }
  try {
    if (!mobile) {
      await p.goto(new URL('/?region=chengdu&paused=1', base).href);
      await ready();
      await loaded();
      r.cold = await p.evaluate(() => {
        const rows = [
          ...performance.getEntriesByType('navigation'),
          ...performance.getEntriesByType('resource'),
        ].filter((x) => x.name.startsWith('http'));
        return {
          bytes: rows.reduce((a, x) => a + x.transferSize, 0),
          lastResponseMs: Math.max(...rows.map((x) => x.responseEnd)),
          files: rows.map((x) => [new URL(x.name).pathname, x.transferSize]),
        };
      });
      await shot('square');
      await act('#pause');
      await act('#globe');
      await act('#street-plus');
      await p.waitForTimeout(350);
      await shot('square-map');
    }
    await p.goto(base);
    await ready();
    assert.equal((await read()).region, 'world');
    await act('#pause');
    await act('#pause-dialog .city-entry');
    await ready();
    await loaded();
    assert.equal((await read()).mode, 'streets');
    for (const [i, k] of Object.keys(codes).entries()) {
      const box = await p.locator('#' + k).boundingBox();
      if (box) points[k] = { id: i + 1, x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
    r.controls = {};
    for (const k of ['right', 'climb', 'descend']) {
      const a = await read();
      await inputs([k]);
      const reached = await p.waitForFunction(
        ({ k, a }) => {
          const s = window.__flight.state;
          return (
            (k === 'right'
              ? (s.heading - a.heading + 360) % 360 > 32
              : k === 'climb'
                ? s.altitude - a.altitude > 65
                : a.altitude - s.altitude > 9) && s
          );
        },
        { k, a },
        { timeout: 45000 },
      );
      r.controls[k] = { before: a, after: await reached.jsonValue() };
      await inputs();
    }
    r.performance = await p.evaluate(async () => {
      const ts = [],
        calls = [],
        tri = [];
      let last = performance.now();
      const start = last;
      await new Promise((resolve) => {
        function frame(n) {
          ts.push(n - last);
          last = n;
          calls.push(window.__flight.state.meshes);
          tri.push(window.__flight.state.triangles);
          if (n - start >= 3500) resolve();
          else requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      });
      const gl = document.querySelector('#world').getContext('webgl2');
      return {
        fps: (ts.length * 1000) / (last - start),
        p95ms: ts.sort((a, b) => a - b)[Math.floor(ts.length * 0.95)],
        calls: Math.max(...calls),
        triangles: Math.max(...tri),
        gpu: gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL),
      };
    });
    if (mobile) {
      const a = await choose('人民公园', '#street-nav');
      assert.ok(Math.abs((await read()).travelled - a.travelled) < 0.05);
      await fly((s) => (short ? s.travelled > a.travelled + 0.15 : s.arrived), 110);
      await shot('park-flight');
      await choose('简阳市人民政府', '#street-depart');
      await loaded();
      await inputs(['left', 'climb']);
      await wait(() => window.__flight.state.travelled > 0.085);
      await inputs();
      await shot('jianyang-flight');
      assert.equal((await read()).district, '简阳市');
    } else {
      await p.keyboard.down('w');
      await p.waitForTimeout(3200);
      await p.keyboard.up('w');
      if (!short) {
        await fly((s) => s.waypoint === '安顺廊桥', 200);
        await shot('confluence');
        await fly((s) => s.arrived, 45);
        await shot('bridge');
        await choose('安顺廊桥', '#street-nav');
      } else {
        await fly((s) => s.travelled > 0.28, 50);
        await shot('street-flight');
      }
    }
    await act('#pause');
    await act('#regional-entry');
    await ready();
    const regional = await read();
    assert.equal(regional.region, 'chengdu');
    assert.notEqual(regional.mode, 'streets');
    r.regional = regional;
    await act('#globe');
    assert.equal((await read()).map, true);
    await act('#globe');
    await act('#pause');
    await act('#pause-dialog a[href="/"]');
    await ready();
    assert.equal((await read()).region, 'world');
    r.world = true;
    assert.deepEqual(r.errors, []);
  } finally {
    await writeFile(join(dir, name + '.json'), JSON.stringify(r, null, 2));
    await context.close();
  }
}
try {
  for (const m of [false, true]) await run(m);
} finally {
  await browser.close();
}
