import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'smol-toml';

let token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) {
  try {
    const config = join(
      process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
      '.wrangler/config/default.toml',
    );
    token = parse(await readFile(config, 'utf8')).oauth_token;
  } catch {
    throw new Error(
      'Cloudflare credentials unavailable. Run npx wrangler login --device or configure CLOUDFLARE_API_TOKEN.',
    );
  }
}
if (!token) throw new Error('No Cloudflare token available. Run npx wrangler login --device.');
async function get(path) {
  const response = await fetch('https://api.cloudflare.com/client/v4' + path, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await response.json();
  if (!response.ok || !json.success)
    throw new Error(
      `Cloudflare ${response.status}: ${json.errors?.map((e) => e.message).join(', ')}`,
    );
  return json.result;
}
let account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!account) {
  const accounts = await get('/accounts');
  if (accounts.length !== 1)
    throw new Error(
      'Set CLOUDFLARE_ACCOUNT_ID explicitly for an account with multiple memberships.',
    );
  account = accounts[0].id;
}
const domains = await get(
  `/accounts/${encodeURIComponent(account)}/pages/projects/roamflight/domains`,
);
console.log(
  JSON.stringify(
    domains.map(({ name, status, verification_data, validation_data }) => ({
      name,
      status,
      verification: verification_data,
      validation: validation_data,
    })),
    null,
    2,
  ),
);
