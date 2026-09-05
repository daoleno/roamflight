import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.TEST_URL || 'http://127.0.0.1:4177';
const browser = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9222');
const dir = new URL('../verification/', import.meta.url);
await mkdir(dir, { recursive: true });
const checks = [],
  errors = [];
let failure, referenceHTML;
try {
  for (const locale of ['zh-CN', 'en-US']) {
    const chinese = locale.startsWith('zh');
    const context = await browser.newContext({
      locale,
      viewport: chinese ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      hasTouch: chinese,
      isMobile: chinese,
      deviceScaleFactor: 1,
    });
    try {
      const response = await context.request.get(base + '/', {
        headers: { 'Accept-Language': locale },
      });
      const html = await response.text();
      if (referenceHTML) assert.equal(html, referenceHTML);
      else referenceHTML = html;
      assert.ok(!response.headers().vary?.toLowerCase().includes('accept-language'));
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`${m.text()} ${m.location().url}`);
      });
      await page.goto(base + '/?test=1&paused=1', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__flight?.state.ready, {}, { timeout: 180000 });
      await page.locator('#loading').waitFor({ state: 'hidden' });
      assert.equal(await page.locator('html').getAttribute('lang'), chinese ? 'zh-CN' : 'en');
      assert.equal(
        await page.locator('#destination').innerText(),
        chinese ? '开普敦' : 'Cape Town',
      );
      assert.equal(
        await page.locator('#destination-country').innerText(),
        chinese ? '南非' : 'South Africa',
      );
      assert.equal(
        await page.locator('#drop').getAttribute('aria-label'),
        chinese ? '投递包裹' : 'Drop package',
      );
      assert.equal(await page.evaluate(() => window.__flight.state.target[0]), 'Cape Town');
      const missing = await page.evaluate(() =>
        [...document.querySelectorAll('[data-i18n]')]
          .filter((e) => e.textContent === e.dataset.i18n)
          .map((e) => e.dataset.i18n),
      );
      assert.deepEqual(missing, []);
      const localeURL = await page.evaluate(
        () =>
          performance
            .getEntriesByType('resource')
            .find((r) => /\/app\/locale-[^/]+\.js$/.test(r.name))?.name,
      );
      assert.ok(localeURL);
      const languageAsset = await context.request.get(localeURL);
      assert.match(languageAsset.headers()['cache-control'], /immutable/);
      assert.ok((await languageAsset.body()).length < 16000);
      await page.screenshot({ path: new URL(`i18n-${locale}.png`, dir).pathname });
      await page.locator('#pause').click();
      await page.locator('#drop').click();
      assert.equal(
        await page.locator('#notification').innerText(),
        chinese ? '包裹已投出' : 'Package away',
      );
      await page.locator('#pause').click();
      assert.equal(
        await page.locator('#pause-dialog h2').innerText(),
        chinese ? '飞行已暂停' : 'Flight paused',
      );
      if (chinese) {
        await page.screenshot({ path: new URL('i18n-zh-menu.png', dir).pathname });
        await page.locator('#departure').selectOption('asia');
        assert.equal(await page.locator('#destination').innerText(), '加德满都');
        assert.equal(await page.evaluate(() => window.__flight.state.target[0]), 'Kathmandu');
        const before = await page.evaluate(() => ({
          coordinate: window.__flight.state.coordinate,
          resources: performance.getEntriesByType('resource').length,
        }));
        await page.evaluate(() => {
          Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true });
          window.dispatchEvent(new Event('languagechange'));
        });
        assert.equal(await page.locator('#destination').innerText(), 'Kathmandu');
        assert.equal(await page.locator('#pause-dialog h2').innerText(), 'Flight paused');
        const after = await page.evaluate(() => ({
          coordinate: window.__flight.state.coordinate,
          resources: performance.getEntriesByType('resource').length,
        }));
        assert.deepEqual(after, before);
      }
      await page.goto(base + '/credits.html', { waitUntil: 'domcontentloaded' });
      // This document gets a fresh navigator with the context's locale.
      await page.waitForFunction(
        (language) => document.documentElement.lang === language,
        chinese ? 'zh-CN' : 'en',
      );
      assert.equal(
        await page.locator('h1').innerText(),
        chinese ? '致谢与来源' : 'Credits & Sources',
      );
      assert.ok(
        await page.locator('a[href="https://github.com/SebLague/Geographical-Adventures"]').count(),
      );
      if (chinese) {
        await page.setViewportSize({ width: 320, height: 700 });
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        );
      }
      checks.push({ locale, pass: true });
      console.log(
        'PASS automatic locale, game text, internal IDs, notices, supporting pages and CDN sharing',
        locale,
      );
    } finally {
      await context.close();
    }
  }
  const fallback = await browser.newContext({ locale: 'ja-JP' });
  try {
    const page = await fallback.newPage();
    await page.goto(base + '/credits.html');
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    checks.push({ locale: 'ja-JP -> en', pass: true });
  } finally {
    await fallback.close();
  }
  assert.deepEqual(errors, []);
} catch (error) {
  failure = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(
    new URL('i18n-report.json', dir),
    JSON.stringify({ checks, errors, failure }, null, 2),
  );
  await browser.close();
}
