import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const browser = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9222');
const context = await browser.newContext({
  viewport: { width: 844, height: 390 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(`${process.env.TEST_URL || 'http://127.0.0.1:4177'}/?paused=1`);
  await page.waitForFunction(() => window.__flight?.state.ready, {}, { timeout: 60000 });
  await page.locator('#loading').waitFor({ state: 'hidden' });
  const result = await page.evaluate(() => {
    const a = document.querySelector('#touch-controls').getBoundingClientRect(),
      b = document.querySelector('#compass').getBoundingClientRect();
    return {
      overlap: a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top,
      gap: b.top - a.bottom,
    };
  });
  assert.equal(result.overlap, false);
  assert.ok(result.gap >= 10);
  assert.deepEqual(errors, []);
  await page.screenshot({
    path: new URL('../verification/mobile-landscape.png', import.meta.url).pathname,
  });
  await writeFile(
    new URL('../verification/layout-report.json', import.meta.url),
    JSON.stringify({ pass: true, ...result, errors }, null, 2),
  );
  console.log('PASS landscape controls and compass', result);
} finally {
  await context.close();
  await browser.close();
}
