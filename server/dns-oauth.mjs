import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export const DNS_AUTH = Object.freeze({
  origin: 'https://roamflight.pages.dev',
  redirect: 'https://roamflight.pages.dev/auth/callback',
  issuer: 'https://mcp.cloudflare.com',
  account: '4d91ce685354fcc9ebae23ff7fa4ac9f',
  zone: 'c2a13e93f9cb1754c2c43ae76e8c7208',
  name: 'roamflight.wooo.guru',
  target: 'roamflight.pages.dev',
});

export function validateCallback(request, encoded, now = Date.now()) {
  const url = new URL(request.url);
  if (
    request.method !== 'GET' ||
    url.origin !== DNS_AUTH.origin ||
    url.pathname !== '/auth/callback'
  )
    throw new Error('Invalid callback destination.');
  let config;
  try {
    config = JSON.parse(encoded);
  } catch {
    throw new Error('Authorization is not configured.');
  }
  if (
    typeof config.clientId !== 'string' ||
    !config.clientId ||
    typeof config.verifier !== 'string' ||
    config.verifier.length < 43 ||
    typeof config.state !== 'string' ||
    config.state.length < 32
  )
    throw new Error('Invalid authorization configuration.');
  if (!Number.isFinite(config.expiresAt) || now >= config.expiresAt)
    throw new Error('Authorization expired. Request a fresh link.');
  if (
    url.searchParams.get('state') !== config.state ||
    url.searchParams.getAll('state').length !== 1
  )
    throw new Error('Invalid authorization state.');
  const issuer = url.searchParams.get('iss');
  if (issuer && issuer !== DNS_AUTH.issuer) throw new Error('Invalid authorization issuer.');
  if (url.searchParams.has('error')) throw new Error('Authorization was not approved.');
  const code = url.searchParams.get('code');
  if (!code || code.length > 4096 || url.searchParams.getAll('code').length !== 1)
    throw new Error('Missing or invalid authorization code.');
  return { config, code };
}

async function exchangeAuthorization(config, code) {
  const response = await fetch(DNS_AUTH.issuer + '/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      redirect_uri: DNS_AUTH.redirect,
      code_verifier: config.verifier,
      code,
    }),
    signal: AbortSignal.timeout(20000),
  });
  const token = await response.json();
  if (
    !response.ok ||
    typeof token.access_token !== 'string' ||
    token.token_type?.toLowerCase() !== 'bearer'
  )
    throw new Error('Authorization exchange failed. Request a fresh link.');
  return token.access_token;
}

// Fixed, auditable operation. Neither the URL nor the user supplies executable code or DNS targets.
export const DNS_SETUP_CODE = `async () => {
  const zoneId = ${JSON.stringify(DNS_AUTH.zone)};
  const name = ${JSON.stringify(DNS_AUTH.name)};
  const target = ${JSON.stringify(DNS_AUTH.target)};
  const zone = await cloudflare.request({ method: 'GET', path: '/zones/' + zoneId });
  if (zone.result.name !== 'wooo.guru' || zone.result.account.id !== ${JSON.stringify(DNS_AUTH.account)} || zone.result.status !== 'active') throw new Error('The expected active zone is not authorized. No changes made.');
  const path = '/zones/' + zoneId + '/dns_records';
  const records = (await cloudflare.request({ method: 'GET', path, query: { name } })).result;
  if (records.length) {
    if (records.length !== 1 || records[0].type !== 'CNAME' || records[0].content.replace(/\\.$/, '') !== target) throw new Error('A conflicting record exists. Refusing to overwrite it.');
  } else {
    await cloudflare.request({ method: 'POST', path, body: { type: 'CNAME', name, content: target, proxied: true, ttl: 1, comment: 'Roamflight authorized domain setup' } });
  }
  const verified = (await cloudflare.request({ method: 'GET', path, query: { name } })).result;
  if (!verified.some(r => r.type === 'CNAME' && r.content.replace(/\\.$/, '') === target)) throw new Error('DNS verification failed.');
  return { configured: true, name, target };
}`;

function toolResult(result) {
  if (result.isError) throw new Error('Cloudflare could not complete the requested DNS operation.');
  const text = result.content?.find((item) => item.type === 'text')?.text;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Invalid DNS setup response.');
  }
}

async function configureDomain(token) {
  const client = new Client({ name: 'roamflight-domain-setup', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(DNS_AUTH.issuer + '/mcp'), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  try {
    await client.connect(transport);
    const endpoints = toolResult(
      await client.callTool({
        name: 'search',
        arguments: {
          code: "async () => { const p = spec.paths['/zones/{zone_id}/dns_records']; return { get: !!p?.get, post: !!p?.post }; }",
        },
      }),
    );
    if (!endpoints.get || !endpoints.post) throw new Error('DNS endpoints are unavailable.');
    const result = toolResult(
      await client.callTool({
        name: 'execute',
        arguments: { account_id: DNS_AUTH.account, code: DNS_SETUP_CODE },
      }),
    );
    if (!result.configured || result.name !== DNS_AUTH.name || result.target !== DNS_AUTH.target)
      throw new Error('DNS setup was not verified.');
  } finally {
    await client.close().catch(() => {});
  }
}

const headers = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
};

export async function handleDnsCallback(request, env, dependencies = {}) {
  let authorization;
  try {
    authorization = validateCallback(request, env.ROAMFLIGHT_DNS_AUTH);
  } catch (error) {
    return new Response(error.message, { status: 400, headers });
  }
  let token;
  try {
    token = await (dependencies.exchange || exchangeAuthorization)(
      authorization.config,
      authorization.code,
    );
    await (dependencies.configure || configureDomain)(token);
    return new Response(null, {
      status: 303,
      headers: { ...headers, Location: DNS_AUTH.origin + '/auth/complete' },
    });
  } catch {
    return new Response(
      'Domain setup could not finish. Return to the conversation so the authorization can be checked. No conflicting records are overwritten.',
      { status: 502, headers },
    );
  } finally {
    // The grant is used for this operation only and is never persisted or returned to the browser.
    if (token && !dependencies.exchange) {
      await fetch(DNS_AUTH.issuer + '/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token,
          token_type_hint: 'access_token',
          client_id: authorization.config.clientId,
        }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    }
  }
}
