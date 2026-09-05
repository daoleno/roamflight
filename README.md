# Geographical Adventures Web

A playable, self-hosted Three.js adaptation of the final gameplay in Sebastian
Lague's [first Geographical Adventures video](https://youtu.be/sLqXFF8mlEU).

Version 0.2 lives in `/home/daoleno/workspace/geographical-adventures-web`.
See [architecture](docs/ARCHITECTURE.md) and the [visual roadmap](docs/ROADMAP.md).

## Fidelity

This is a browser port, **not a pixel-identical reproduction or an official Unity
WebGL build**. The original repository at commit
`82fcda20bebb033c749b2339e9ce3a6e58007699` supplies the plane,
252 terrain mesh records, country boundaries, geographical polygons, ocean map,
and ground colour and world-normal textures. Those source assets include changes
made after the video. The 16K hemisphere textures are reduced to 4K per hemisphere.

The flight controller, procedural clouds and shadows, water/sky shaders,
parachutes, boats, missions and HUD are browser implementations. Original Unity
volumetric scattering, exact cloud formations, development debug views, native
menus, complete original quest system and original soundtrack are not reproduced.
The day/night switch is illustrative, not an astronomical simulation.

## Run

Requires Node.js 22.12+; the installed service uses Node.js 24.

```sh
npm ci
npm run dev -- --port 5173 --strictPort
```

The server binds `0.0.0.0`, making it available to other devices on the same LAN.
All runtime models, textures, font, icons and scripts are served locally. No API
keys, external CDNs or network map services are needed at runtime. No accounts,
telemetry, persistence or backend database are used.

```sh
npm test
npm run format:check
npm run build
npm start
```

`npm start` uses the production Express/sirv server, not Vite preview. It exposes
only `dist/` and `/healthz`, with Brotli/gzip, ETags and security headers.

The installed persistent user unit `geographical-adventures-web.service` is
enabled at boot and automatically restarts on failure. User lingering is enabled
on this machine, so no interactive login is needed. The unit source is retained
in `deploy/geographical-adventures-web.service`.

```sh
systemctl --user status geographical-adventures-web.service
systemctl --user restart geographical-adventures-web.service
systemctl --user stop geographical-adventures-web.service
```

After building a new release, restart the service so its static-file index is
refreshed. Do not start `npm start` or Docker on 4177 while the installed unit is
already using that port. The development server can use 5173 independently.

## Public HTTPS

LAN: `http://192.168.110.223:4177/`.
Tailnet: `http://100.92.174.90:4177/`.

A Funnel publication attempt was blocked by the machine's administrator-permission
requirement. **A public URL is not considered deployed until this step succeeds
and an external HTTPS check passes.** Run on the host:

```sh
sudo tailscale funnel --bg --yes 4177
tailscale funnel status
```

If Tailscale requires account-level Funnel enablement, follow the authorization
link printed by the command. The expected hostname is
`https://manjaro.tail7e23.ts.net/`; use the actual URL returned by the command.
Only port 4177 is published. Visitors do not need Tailscale once Funnel is enabled.

To turn off only this publication:

```sh
sudo tailscale funnel --https=443 off
```

This is a workstation-origin public demo, not a CDN or an uptime guarantee. The
machine must remain online. For a dedicated server, the same build can run with
`docker compose up -d --build`; put a managed HTTPS reverse proxy in front of it.
The container recipe is included; validate it on the destination host before use.
Vercel is not connected in the current environment, and no deployment or repository
has been created under any GitHub organization or cloud account.

## Controls

| Input                                  | Action                                       |
| -------------------------------------- | -------------------------------------------- |
| A / D or Left / Right                  | Turn and bank                                |
| W / S or Up / Down                     | Increase / decrease air speed                |
| Shift                                  | Boost                                        |
| Space                                  | Drop a package                               |
| C                                      | Chase, reverse and overhead cameras          |
| M                                      | Globe view; drag to orbit and scroll to zoom |
| N                                      | Day / night                                  |
| F                                      | Fullscreen                                   |
| Escape                                 | Pause and settings                           |
| Drag horizontally on the flight canvas | Steer                                        |

Touch devices have left/right, boost and package buttons. The pause menu controls
clouds, borders, air speed and departure region. Packages delivered within 190 km
of the destination count as successful after landing and advance the mission.
Flight is stylized and does not implement aerodynamic physics or realistic speed
relative to Earth's geographic scale.

## Sources And Assets

Credits and the retained original MIT license are available at `/credits.html`.
The source project is [SebLague/Geographical-Adventures](https://github.com/SebLague/Geographical-Adventures).
Geographical sources are Natural Earth, NASA Blue Marble and GEBCO, as credited by
the source project. Political boundaries are displayed as provided in that data.

`reference/` contains original large source textures and is not shipped by Vite.
`public/assets/` contains optimized runtime assets. Rebuild them with:

```sh
node scripts/assets.mjs
node scripts/prepare-assets.mjs
```

The terrain converter reverses the Unity Z axis and triangle winding to preserve
correct geographic handedness in WebGL. Normal maps receive the same Z reflection.

## Browser Verification

`scripts/verify.mjs` connects Playwright to an existing Chromium CDP endpoint.
It tests canvas pixels, flight movement, steering, pause/settings, package landing,
mission advancement, camera modes, globe orbit, night, departures, mobile touch
controls, responsive framing, resource locality and console errors. Screenshots
and a JSON report are placed in `verification/`.

```sh
CDP_URL=http://127.0.0.1:9222 TEST_URL=http://127.0.0.1:4177 node scripts/verify.mjs
```
