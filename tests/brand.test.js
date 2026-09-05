import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('product branding changes without replacing upstream attribution', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const credits = readFileSync(new URL('../public/credits.html', import.meta.url), 'utf8');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  assert.equal(pkg.name, 'roamflight');
  assert.match(html, /<title>Roamflight/);
  assert.match(html, /ROAMFLIGHT/);
  assert.match(html, /name="description"/);
  assert.doesNotMatch(html, /GEOGRAPHICAL|ADVENTURES/);
  assert.match(credits, /Sebastian/);
  assert.match(credits, /SebLague\/Geographical-Adventures/);
});
