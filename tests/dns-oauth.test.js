import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DNS_AUTH,
  DNS_SETUP_CODE,
  handleDnsCallback,
  validateCallback,
} from '../server/dns-oauth.mjs';

const config = {
  clientId: 'test-client',
  verifier: 'v'.repeat(43),
  state: 's'.repeat(43),
  expiresAt: Date.now() + 60000,
};
const request = (changes = {}) => {
  const url = new URL(DNS_AUTH.redirect);
  url.search = new URLSearchParams({
    state: config.state,
    code: 'one-use-code',
    iss: DNS_AUTH.issuer,
    ...changes,
  });
  return new Request(url);
};
test('callback verifies destination, state, issuer, expiry and unique parameters', () => {
  assert.equal(validateCallback(request(), JSON.stringify(config)).code, 'one-use-code');
  assert.throws(
    () => validateCallback(request({ state: 'wrong' }), JSON.stringify(config)),
    /state/,
  );
  assert.throws(
    () => validateCallback(request({ iss: 'https://example.com' }), JSON.stringify(config)),
    /issuer/,
  );
  assert.throws(
    () => validateCallback(request(), JSON.stringify(config), config.expiresAt),
    /expired/,
  );
  assert.throws(
    () => validateCallback(new Request(request().url + '&code=second'), JSON.stringify(config)),
    /code/,
  );
  assert.throws(
    () =>
      validateCallback(
        new Request(request().url.replace('roamflight.pages.dev', 'example.com')),
        JSON.stringify(config),
      ),
    /destination/,
  );
});
test('invalid requests make no token exchange or DNS call', async () => {
  let calls = 0;
  const response = await handleDnsCallback(
    request({ state: 'invalid' }),
    { ROAMFLIGHT_DNS_AUTH: JSON.stringify(config) },
    {
      exchange: async () => {
        calls++;
      },
    },
  );
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
});
test('approved callback performs setup then redirects without exposing credentials', async () => {
  let configured = false;
  const response = await handleDnsCallback(
    request(),
    { ROAMFLIGHT_DNS_AUTH: JSON.stringify(config) },
    {
      exchange: async () => 'private-token',
      configure: async (token) => {
        assert.equal(token, 'private-token');
        configured = true;
      },
    },
  );
  assert.equal(configured, true);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), DNS_AUTH.origin + '/auth/complete');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), '');
});
test('errors do not disclose provider tokens, codes or verifier', async () => {
  const response = await handleDnsCallback(
    request(),
    { ROAMFLIGHT_DNS_AUTH: JSON.stringify(config) },
    {
      exchange: async () => {
        throw new Error('private-token one-use-code ' + config.verifier);
      },
    },
  );
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /private-token|one-use-code|vvvv/);
});
test('automation is pinned to the authorized domain and never updates or deletes a record', () => {
  assert.match(DNS_SETUP_CODE, /roamflight\.wooo\.guru/);
  assert.match(DNS_SETUP_CODE, /Refusing to overwrite/);
  assert.doesNotMatch(DNS_SETUP_CODE, /method: '(PUT|PATCH|DELETE)'/);
});
