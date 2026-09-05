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
      await page.goto(`${base}/?test=1&paused=1`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__flight?.state.ready, {}, { timeout: 90000 });
      await page.locator('#loading').waitFor({ state: 'hidden' });
      await page.locator('#pause').click();
      const state = () => page.evaluate(() => window.__flight.state);
      const input = async (id, key, seconds) => {
        const before = await state();
        let cdp;
        if (mobile) {
          const box = await page.locator('#' + id).boundingBox();
          assert.ok(box);
          cdp = await context.newCDPSession(page);
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
          });
        } else await page.keyboard.down(key);
        const started = (await state()).elapsed;
        await page.waitForFunction(
          ({ t, d }) => window.__flight.state.elapsed > t + d,
          { t: started, d: seconds },
          { timeout: 30000 },
        );
        const held = await state();
        if (mobile) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await cdp.detach();
        } else await page.keyboard.up(key);
        return { before, held, after: await state() };
      };
      const climb = await input('climb', 'e', 1.2);
      assert.ok(climb.after.radius > climb.before.radius + 0.1);
      assert.ok(climb.held.pitch > 0.1);
      await page.screenshot({
        path: new URL(mobile ? 'flight-climb-mobile.png' : 'flight-climb-desktop.png', dir)
          .pathname,
      });
      const down = await input('descend', 'q', 1.8);
      assert.ok(down.after.radius < down.before.radius - 0.1);
      assert.ok(down.held.pitch < -0.1);
      assert.ok(down.after.radius >= down.after.ground + 1.8);
      await page.locator('#pause').click();
      const paused = await state();
      await page.waitForTimeout(200);
      assert.equal((await state()).radius, paused.radius);
      await page.locator('#resume').click();
      await page.locator('#globe').click();
      assert.equal((await state()).map, true);
      await page.locator('#globe').click();
      if (mobile) {
        for (const [width, height] of [
          [390, 844],
          [844, 390],
        ]) {
          await page.setViewportSize({ width, height });
          const overlaps = await page.evaluate(() => {
            const ids = ['climb', 'descend', 'boost', 'drop', 'country'];
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
          await page.screenshot({ path: new URL(`flight-controls-${width}.png`, dir).pathname });
        }
      }
      checks.push({
        mobile,
        pass: true,
        climb: climb.after.radius - climb.before.radius,
        descent: down.after.radius - down.before.radius,
      });
      console.log('PASS altitude, pitch, pause, map and layout', mobile ? 'mobile' : 'desktop');
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
    new URL('flight-report.json', dir),
    JSON.stringify({ checks, errors, failure }, null, 2),
  );
  await browser.close();
}
