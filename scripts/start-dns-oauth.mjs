import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { DNS_AUTH } from '../server/dns-oauth.mjs';

const verifier = randomBytes(32).toString('base64url');
const state = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const scope = 'dns.read dns.write zone.read';
const response = await fetch(DNS_AUTH.issuer + '/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    client_name: 'Roamflight domain setup',
    client_uri: DNS_AUTH.origin,
    redirect_uris: [DNS_AUTH.redirect],
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope,
  }),
  signal: AbortSignal.timeout(20000),
});
if (!response.ok)
  throw new Error(`Cloudflare OAuth client registration failed (${response.status}).`);
const client = await response.json();
if (!client.client_id || client.token_endpoint_auth_method !== 'none')
  throw new Error('Unexpected OAuth client registration.');
const secret = JSON.stringify({
  clientId: client.client_id,
  verifier,
  state,
  expiresAt: Date.now() + 30 * 60 * 1000,
});
await new Promise((resolve, reject) => {
  const child = spawn(
    process.execPath,
    [
      'node_modules/wrangler/bin/wrangler.js',
      'pages',
      'secret',
      'bulk',
      '--project-name',
      'roamflight',
    ],
    {
      stdio: ['pipe', 'inherit', 'inherit'],
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    },
  );
  child.on('error', reject);
  child.on('close', (code) =>
    code === 0 ? resolve() : reject(new Error(`Secret provisioning failed (${code}).`)),
  );
  child.stdin.end(JSON.stringify({ ROAMFLIGHT_DNS_AUTH: secret }));
});
const url = new URL(DNS_AUTH.issuer + '/authorize');
url.search = new URLSearchParams({
  client_id: client.client_id,
  redirect_uri: DNS_AUTH.redirect,
  response_type: 'code',
  code_challenge: challenge,
  code_challenge_method: 'S256',
  state,
  scope,
  resource: DNS_AUTH.issuer + '/mcp',
});
await mkdir(new URL('../.wrangler/', import.meta.url), { recursive: true });
await writeFile(new URL('../.wrangler/dns-authorization-url.txt', import.meta.url), url.href, {
  mode: 0o600,
});
console.log('Authorization link prepared. Deploy the callback before sharing this link:');
console.log(url.href);
