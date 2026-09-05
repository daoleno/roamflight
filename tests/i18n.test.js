import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  messages,
  detectLocale,
  translate,
  cityName,
  countryName,
  setCountryData,
} from '../src/i18n.js';
import { departures, destinations, findCountry } from '../src/geo.js';

test('browser language priority selects Chinese or English with an English fallback', () => {
  assert.equal(detectLocale(['zh-CN', 'en-US']), 'zh');
  assert.equal(detectLocale(['zh-Hant-TW']), 'zh');
  assert.equal(detectLocale(['fr-FR', 'en-GB', 'zh']), 'en');
  assert.equal(detectLocale(['fr-FR', 'zh-HK']), 'zh');
  assert.equal(detectLocale(['de-DE']), 'en');
  assert.equal(detectLocale([]), 'en');
});
test('both bundled dictionaries have the same keys and interpolation contracts', () => {
  assert.deepEqual(Object.keys(messages.zh).sort(), Object.keys(messages.en).sort());
  for (const key of Object.keys(messages.en)) {
    assert.deepEqual(
      (messages.en[key].match(/\{\w+\}/g) || []).sort(),
      (messages.zh[key].match(/\{\w+\}/g) || []).sort(),
      key,
    );
  }
  assert.equal(translate('zh', 'notice.success', { city: '开普敦' }), '已完成开普敦的投递！');
  assert.equal(translate('en', 'hud.delivered', { count: 3 }), '3 delivered');
  assert.equal(translate('fr', 'controls.drop'), 'Drop package');
});
test('all currently playable destinations have Chinese names without changing IDs', () => {
  const all = [...Object.values(departures).map((d) => d.destination), ...destinations];
  for (const [city] of all) {
    assert.notEqual(cityName(city, 'zh'), city);
    assert.equal(cityName(city, 'en'), city);
  }
  assert.equal(departures.africa.destination[0], 'Cape Town');
});
test('country names use structured region codes while geography remains canonical', () => {
  const { features } = JSON.parse(
    readFileSync(new URL('../public/assets/countries.json', import.meta.url)),
  );
  setCountryData(features);
  assert.equal(countryName('South Africa', 'zh'), '南非');
  assert.equal(countryName('France', 'zh'), '法国');
  assert.equal(countryName('Norway', 'zh'), '挪威');
  assert.equal(countryName('China', 'zh'), '中国');
  assert.equal(findCountry(features, [2.35, 48.86]), 'France');
  assert.equal(countryName('France', 'en'), 'France');
});
test('CDN language selection adds no Accept-Language variation and hashed app assets are immutable', () => {
  const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
  assert.doesNotMatch(headers, /Vary:\s*Accept-Language/i);
  assert.match(headers, /\/app\/\*\s+Cache-Control: public, max-age=31536000, immutable/);
});
