# Deployment

## Current Status

The local `roamflight.service` serves the built app at port 4177. The public Pages
deployment is **https://roamflight.wooo.guru/** (with `roamflight.pages.dev` as a fallback) and follows verified incremental
releases from `main`. The first release was published from commit `bc33d76`.
Initial deployment URL: `https://100ef101.roamflight.pages.dev`.
OAuth device authorization completed successfully with account/user read and
Pages write permissions. Public HTML, health metadata and terrain downloads return
HTTP 200. See generated browser verification reports for rendering checks.

During verification on this workstation, HTTP/3 image downloads were unusually slow
while HTTP/2 fetched the same assets normally. Public browser checks use Chromium
with `--disable-quic` to separate that network-path issue from rendering correctness.
This is not evidence of equivalent load times on all devices or networks.

The Pages custom domain `roamflight.wooo.guru` is active: DNS verification,
certificate validation and HTTPS requests all passed. The one-time OAuth callback
configured the CNAME automatically after user approval; its temporary Pages secret
has been removed. The Wrangler Pages
session cannot modify DNS records, so domain setup now has a separate official
Cloudflare API MCP OAuth flow. The user approves a link; no token needs to be
copied and no localhost callback or SSH tunnel is required.

### Click-To-Authorize DNS Setup

`node scripts/start-dns-oauth.mjs` registers a public PKCE client with Cloudflare's
official API MCP server and places a 30-minute verifier/state configuration in
the Pages secret `ROAMFLIGHT_DNS_AUTH`. Deploy the callback with
`npm run deploy:pages`, then share the generated authorization link. Never commit
the generated `.wrangler/` files or secret configuration.

The approval page requests `dns.read`, `dns.write` and `zone.read`; Cloudflare also
requires account/user bootstrap scopes. `/auth/callback` validates state, expiry,
issuer and redirect host, exchanges the code server-side, and executes a fixed
operation: verify the expected account/zone and create only
`roamflight.wooo.guru -> roamflight.pages.dev` if absent. Conflicting records are
never overwritten. Tokens are not returned to the browser or persisted, and access
token revocation is attempted after use. The callback redirects to a clean status
page. Only this callback path invokes a Pages Function; the game stays static.

The approval link expires after 30 minutes. Run setup again for a new link if it
expires. After completion, inspect `npm run domain:status` and verify public HTTPS;
certificate issuance may lag behind DNS creation.

### Manual Or CI Fallback

The equivalent record is:

Alternatively, let the **Configure Roamflight DNS** GitHub workflow perform this
step. Create a Cloudflare API token with **Zone / DNS / Edit** and **Zone / Zone /
Read**, restricted to **wooo.guru**, and add it as the repository secret
`CLOUDFLARE_DNS_API_TOKEN`. The workflow verifies the zone, creates only the record
below, accepts an already-correct record, and refuses to overwrite conflicting
records. It does not modify the apex or print the token. After DNS is configured,
check Pages validation and the public HTTPS certificate separately.

| Type  | Name       | Target               | Proxy   | TTL  |
| ----- | ---------- | -------------------- | ------- | ---- |
| CNAME | roamflight | roamflight.pages.dev | Proxied | Auto |

The subdomain was NXDOMAIN before attachment; no existing record or apex domain
was changed. Run `npm run domain:status` to inspect Pages validation without
printing credentials. Do not label the custom hostname active until DNS, certificate
validation and an HTTPS request all succeed.

## Cloudflare Pages

The game is client-side and needs no Worker, database or paid map API. Pages serves
the static build through Cloudflare's network; the workstation does not need to
stay online for the hosted game to remain available.

```sh
npx wrangler login --device --browser=false
npx wrangler whoami
npx wrangler pages project create roamflight --production-branch=main
npm run deploy:pages
```

Create the project once. If the account contains multiple teams, select the intended
personal account explicitly with `CLOUDFLARE_ACCOUNT_ID`; do not guess or select a
company account. Use the deployment URL returned by Wrangler. No custom domain or
existing DNS record is changed by these commands.

### Authorizing From Another Computer

Prefer Wrangler's device authorization flow. It does not use a localhost callback
and does not require SSH port forwarding:

```sh
npx wrangler login --device --browser=false
```

Open the verification URL printed by Wrangler on the other computer, enter its
short-lived device code, and approve the requested account. The server polls for
the result automatically. Use the minimum scopes for Pages where appropriate:

```sh
npx wrangler login --device --browser=false --scopes account:read user:read pages:write
```

For older Wrangler versions without `--device`, the ordinary OAuth flow listens
on loopback port 8976. An SSH tunnel is a fallback, not required for device login:

```sh
ssh -N -L 8976:127.0.0.1:8976 daoleno@100.92.174.90
```

Keep the tunnel open. On the server run `npx wrangler login --browser=false`, then
open the printed authorization URL on the other computer. Its localhost callback
will travel through SSH. Use the server's LAN address instead when both devices
are on the LAN. Never paste callback URLs, authorization codes or tokens into issues
or chat; they are credentials.

`npm run build:pages` produces `pages-dist/`, excludes local `.br`/`.gz` variants,
and checks every asset against a conservative 25 MiB per-file and 20,000-file budget.
`_headers` supplies security/cache headers; `_redirects` maps `/healthz` to generated
health metadata. `404.html` prevents missing assets from returning the game HTML.

After deployment, verify the root page, `/healthz`, `/credits.html`, actual model
and texture loads, and a real 404. Run the browser tests against the returned URL.

## GitHub Workflow

The normal CI workflow validates every push/PR. The separate **Deploy to Cloudflare
Pages** workflow is manually triggered and requires these GitHub secrets:

- `CLOUDFLARE_ACCOUNT_ID`: the intended Cloudflare account.
- `CLOUDFLARE_API_TOKEN`: an account-scoped token with Cloudflare Pages edit permission
  and the read permissions required by Wrangler for that account.

Use a scoped API token for CI, not the workstation's OAuth session. The workflow
targets the existing `roamflight` project and production branch `main`. It does not
claim to be configured until the secrets and project exist.

## Local Production Service

Repository: `/home/daoleno/workspace/roamflight`.
Service definition: `deploy/roamflight.service`.

```sh
npm ci
npm test
npm run build
systemctl --user restart roamflight.service
systemctl --user status roamflight.service
```

The unit is enabled at boot with user lingering and restarts on failure. Only
`dist/` and `/healthz` are exposed, using Express, sirv and Helmet. Runtime file
writes are disabled by the unit's sandbox. Rebuilding requires a service restart
to refresh its static-file index. The replaced `geographical-adventures-web.service`
is disabled; port 4177 and existing LAN/Tailnet addresses remain unchanged.

## Docker Alternative

```sh
docker compose up -d --build
```

This is an alternative to the local service, not a second process on the same port.
The image runs as a non-root user with a read-only filesystem. Put a managed HTTPS
reverse proxy in front of it on a dedicated server. The Compose configuration is
validated locally; validate image building and deployment on the destination host.
