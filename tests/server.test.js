import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { createApp } from '../server/app.mjs';

test('production server exposes only built files with compression, caching and security headers', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'geo-server-'));
  await mkdir(join(root, 'assets'));
  const html = '<html><title>Flight</title></html>';
  await writeFile(join(root, 'index.html'), html);
  await writeFile(join(root, '.env'), 'private');
  await writeFile(join(root, 'assets', 'terrain.bytes'), Buffer.from([0, 1, 2, 255]));
  const js = 'console.log("flight");'.repeat(500);
  const path = join(root, 'assets', 'index-abcdefgh.js');
  await writeFile(path, js);
  await writeFile(path + '.br', brotliCompressSync(js));
  await writeFile(path + '.gz', gzipSync(js));
  const server = createApp(root).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  await t.test('HTML is revalidated and secure without forcing LAN HTTPS', async () => {
    const response = await fetch(base);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), html);
    assert.equal(response.headers.get('cache-control'), 'no-cache');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-powered-by'), null);
    assert.ok(response.headers.get('content-security-policy').includes("script-src 'self'"));
    assert.ok(
      !response.headers.get('content-security-policy').includes('upgrade-insecure-requests'),
    );
  });
  await t.test('Brotli and gzip are served and decoded correctly', async () => {
    for (const encoding of ['br', 'gzip']) {
      const response = await fetch(base + '/assets/index-abcdefgh.js', {
        headers: { 'Accept-Encoding': encoding },
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-encoding'), encoding);
      assert.equal(await response.text(), js);
      assert.match(response.headers.get('cache-control'), /immutable/);
      assert.match(response.headers.get('vary'), /Accept-Encoding/i);
    }
  });
  await t.test('binary geography has an explicit MIME type', async () => {
    const response = await fetch(base + '/assets/terrain.bytes');
    assert.equal(response.headers.get('content-type'), 'application/octet-stream');
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0, 1, 2, 255]);
  });
  await t.test('conditional requests return 304', async () => {
    const response = await fetch(base + '/assets/index-abcdefgh.js');
    const cached = await fetch(base + '/assets/index-abcdefgh.js', {
      headers: { 'If-None-Match': response.headers.get('etag') },
    });
    assert.equal(cached.status, 304);
  });
  await t.test('health check is uncached', async () => {
    const response = await fetch(base + '/healthz');
    const health = await response.json();
    assert.equal(health.status, 'ok');
    assert.equal(health.service, 'roamflight');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
  await t.test('unknown, hidden and source paths do not return the game HTML', async () => {
    for (const path of [
      '/.env',
      '/.git/config',
      '/src/main.js',
      '/reference/',
      '/does-not-exist',
      '/%2e%2e/package.json',
    ]) {
      assert.equal((await fetch(base + path)).status, 404, path);
    }
  });
  await t.test('write methods are rejected', async () => {
    const response = await fetch(base + '/', { method: 'POST', body: 'x' });
    assert.equal(response.status, 405);
  });
});
test('server refuses to start without a build', () => {
  assert.throws(() => createApp('/nonexistent-geographical-build'), /Build missing/);
});
