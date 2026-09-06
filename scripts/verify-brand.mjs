import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.TEST_URL || 'http://127.0.0.1:4177';
const browser = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9222');
const checks = [],
  errors = [];
const dir = new URL('../verification/', import.meta.url);
await mkdir(dir, { recursive: true });
let failure;
try {
  for (const [width, height, mobile] of [
    [1440, 900, false],
    [390, 844, true],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      isMobile: mobile,
      hasTouch: mobile,
      deviceScaleFactor: 1,
    });
    try {
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('response', (response) => {
        if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
      });
      await page.goto(`${base}/?test=1&paused=1`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      await page.waitForFunction(() => window.__flight?.state.ready, {}, { timeout: 180000 });
      await page.locator('#loading').waitFor({ state: 'hidden' });
      assert.equal(await page.title(), 'Roamflight');
      assert.equal(await page.locator('#identity').innerText(), 'Roamflight');
      const result = await page.evaluate(() => {
        const a = document.querySelector('#identity').getBoundingClientRect(),
          b = document.querySelector('#toolbar').getBoundingClientRect();
        const c = document.createElement('canvas');
        c.width = 100;
        c.height = 80;
        const ctx = c.getContext('2d');
        ctx.drawImage(document.querySelector('#world'), 0, 0, 100, 80);
        const pixels = ctx.getImageData(0, 0, 100, 80).data;
        const colors = new Set();
        for (let i = 0; i < pixels.length; i += 4)
          colors.add(`${pixels[i] >> 4},${pixels[i + 1] >> 4},${pixels[i + 2] >> 4}`);
        return {
          gap: b.left - a.right,
          overflow: document.documentElement.scrollWidth > innerWidth,
          colors: colors.size,
        };
      });
      assert.ok(result.gap > 0 && !result.overflow && result.colors > 80);
      await page.screenshot({
        path: new URL(mobile ? 'roamflight-mobile.png' : 'roamflight-desktop.png', dir).pathname,
      });
      const health = await context.request.get(base + '/healthz');
      assert.equal(health.status(), 200);
      assert.equal((await health.json()).service, 'roamflight');
      assert.equal((await context.request.get(base + '/LICENSE.txt')).status(), 200);
      const credits = await context.request.get(base + '/credits.html');
      assert.match(await credits.text(), /SebLague\/Geographical-Adventures/);
      assert.equal((await context.request.get(base + '/missing-roamflight-page')).status(), 404);
      await page.locator('#pause').click();
      const elapsed = await page.evaluate(() => window.__flight.state.elapsed);
      await page.waitForFunction((t) => window.__flight.state.elapsed > t + 0.25, elapsed);
      await page.locator('#drop').click();
      assert.equal(await page.evaluate(() => window.__flight.state.dropped), 1);
      checks.push({ viewport: `${width}x${height}`, pass: true, ...result });
      console.log('PASS branding, canvas, health, license and 404', `${width}x${height}`, result);
    } finally {
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
} catch (error) {
  failure = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(
    new URL('brand-report.json', dir),
    JSON.stringify({ checks, errors, failure }, null, 2),
  );
  await browser.close();
}
