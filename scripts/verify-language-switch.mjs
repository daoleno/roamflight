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
const context = await browser.newContext({
  locale: 'zh-CN',
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 1,
});
try {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const ready = async () => {
    await page.waitForFunction(() => window.__flight?.state.ready, {}, { timeout: 180000 });
    await page.locator('#loading').waitFor({ state: 'hidden' });
  };
  await page.goto(base + '/?test=1', { waitUntil: 'domcontentloaded' });
  await ready();
  assert.equal(await page.title(), '漫航');
  assert.equal(await page.locator('#identity').innerText(), '漫航');
  assert.equal(await page.locator('.loading-title').innerText(), '漫航');
  assert.equal(await page.locator('#language-select').isVisible(), false);
  assert.equal(await page.locator('#game > #language-control').count(), 0);
  await page.locator('#pause').click();
  assert.ok(await page.locator('#pause-dialog #language-select').isVisible());
  const before = await page.evaluate(() => ({
    coords: window.__flight.state.coordinate,
    requests: performance.getEntriesByType('resource').length,
  }));
  await page.locator('#language-select').selectOption('en');
  assert.equal(await page.title(), 'Roamflight');
  assert.equal(await page.locator('#identity').innerText(), 'Roamflight');
  assert.equal(await page.locator('#destination').innerText(), 'Cape Town');
  const after = await page.evaluate(() => ({
    coords: window.__flight.state.coordinate,
    requests: performance.getEntriesByType('resource').length,
  }));
  assert.deepEqual(after, before);
  await page.evaluate(() => window.dispatchEvent(new Event('languagechange')));
  assert.equal(await page.title(), 'Roamflight');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
  assert.equal(await page.title(), 'Roamflight');
  assert.equal(await page.locator('#language-select').inputValue(), 'en');
  checks.push(
    'Manual English selection overrides Chinese browser preferences and survives reload without a scene reload during switching',
  );
  for (const [width, height, language, title] of [
    [390, 844, 'zh', '漫航'],
    [320, 700, 'en', 'Roamflight'],
    [844, 390, 'zh', '漫航'],
    [1440, 900, 'en', 'Roamflight'],
  ]) {
    await page.setViewportSize({ width, height });
    if (!(await page.locator('#pause-dialog').isVisible())) await page.locator('#pause').click();
    await page.locator('#language-select').selectOption(language);
    assert.equal(await page.title(), title);
    const overlaps = await page.evaluate(() => {
      const ids = ['identity', 'toolbar', 'delivery'];
      const result = [];
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++) {
          const a = document.getElementById(ids[i]).getBoundingClientRect(),
            b = document.getElementById(ids[j]).getBoundingClientRect();
          if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top)
            result.push([ids[i], ids[j]]);
        }
      return result;
    });
    assert.deepEqual(overlaps, []);
    const contained = await page.evaluate(() => {
      const menu = document.getElementById('pause-dialog').getBoundingClientRect(),
        control = document.getElementById('language-control').getBoundingClientRect();
      return (
        control.left >= menu.left &&
        control.right <= menu.right &&
        control.top >= menu.top &&
        control.bottom <= menu.bottom
      );
    });
    assert.equal(contained, true);
    await page.screenshot({ path: new URL(`language-settings-${width}.png`, dir).pathname });
    await page.locator('#resume').click();
    assert.equal(await page.locator('#language-select').isVisible(), false);
    await page.screenshot({ path: new URL(`language-switch-${width}.png`, dir).pathname });
    checks.push(
      `${width}x${height}: language selector stays in settings, gameplay header stays clear`,
    );
  }
  await page.goto(base + '/credits.html');
  await page.locator('[data-language-switch]').selectOption('zh');
  assert.equal(await page.title(), '致谢 | 漫航');
  await page.goto(base + '/?test=1', { waitUntil: 'domcontentloaded' });
  await ready();
  assert.equal(await page.title(), '漫航');
  checks.push('Language choice is shared by supporting pages and the game');
  assert.deepEqual(errors, []);
} catch (error) {
  failure = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(
    new URL('language-switch-report.json', dir),
    JSON.stringify({ checks, errors, failure }, null, 2),
  );
  console.log(JSON.stringify({ checks, errors, failure }, null, 2));
  await context.close();
  await browser.close();
}
