import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.TEST_URL || 'http://127.0.0.1:4177';
const browser = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9222');
const dir = new URL('../verification/', import.meta.url);
await mkdir(dir, { recursive: true });
const checks = [],
  errors = [];
let failure;
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      hasTouch: mobile,
      isMobile: mobile,
      deviceScaleFactor: 1,
    });
    try {
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      await page.goto(`${base}/?test=1`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__flight?.state.ready, {}, { timeout: 90000 });
      await page.locator('#loading').waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => window.__flight.state.navigationLights), false);
      await page.keyboard.down('ArrowRight');
      await page.waitForFunction(
        () => {
          const a = window.__flight.state.ailerons;
          return a[0] < -0.12 && a[1] > 0.12;
        },
        {},
        { timeout: 20000 },
      );
      const turning = await page.evaluate(() => window.__flight.state.ailerons);
      await page.screenshot({
        path: new URL(mobile ? 'ailerons-mobile.png' : 'ailerons-desktop.png', dir).pathname,
      });
      await page.keyboard.up('ArrowRight');
      await page.waitForFunction(
        () => window.__flight.state.ailerons.every((a) => Math.abs(a) < 0.015),
        {},
        { timeout: 20000 },
      );
      await page.locator('#daylight').click();
      await page.waitForFunction(
        () => window.__flight.state.navigationLightOpacity > 0.9,
        {},
        { timeout: 30000 },
      );
      await page.screenshot({
        path: new URL(
          mobile ? 'navigation-lights-mobile.png' : 'navigation-lights-desktop.png',
          dir,
        ).pathname,
      });
      const pixels = await page.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = 160;
        c.height = 100;
        const ctx = c.getContext('2d');
        ctx.drawImage(document.querySelector('#world'), 0, 0, 160, 100);
        const data = ctx.getImageData(0, 0, 160, 100).data;
        let max = 0,
          min = 255;
        for (let i = 0; i < data.length; i += 4) {
          const b = (data[i] + data[i + 1] + data[i + 2]) / 3;
          max = Math.max(max, b);
          min = Math.min(min, b);
        }
        return max - min;
      });
      assert.ok(pixels > 40);
      await page.locator('#daylight').click();
      await page.waitForFunction(
        () => !window.__flight.state.navigationLights,
        {},
        { timeout: 30000 },
      );
      checks.push({ mobile, pass: true, turning, nightPixelRange: pixels });
      console.log(
        'PASS control surfaces and night navigation lights',
        mobile ? 'mobile' : 'desktop',
      );
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
    new URL('aircraft-report.json', dir),
    JSON.stringify({ checks, errors, failure }, null, 2),
  );
  await browser.close();
}
