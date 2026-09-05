# Architecture

## Runtime

The entire game runs in the visitor's browser. Three.js renders the world and
aircraft; d3-geo handles country containment and great-circle distances;
three-mesh-bvh accelerates terrain-height raycasts. There is no shared game state,
account system, database, matchmaking, or multiplayer server. Different visitors
play independent sessions.

`src/world.js` imports terrain, materials, aircraft, clouds, ships and packages.
`src/geo.js` owns geographical coordinate conversion and spherical movement.
`src/main.js` owns flight state, input, camera, missions and HUD integration.
`src/style.css` owns responsive HUD and touch layout.

The geography uses a right-handed WebGL coordinate system. Original Unity mesh
positions and normal-map Z components are reflected. Unit tests verify compass
directions, coordinate round trips, country containment and triangle winding.

## Production Service

`server/app.mjs` exposes only the build directory with Express, sirv and Helmet.
It serves Brotli/gzip variants, ETags, cache policies, security headers, real 404s,
and `/healthz`. File writes and source-directory access are not exposed.

`server/index.mjs` binds `HOST`/`PORT`, validates the build, and handles termination.
The systemd unit runs read-only with automatic restart. Docker offers an equivalent
non-root, read-only deployment on another server. Use one process manager at a time
on the same port.

The Tailscale Funnel option terminates public HTTPS and forwards to port 4177.
It is an origin on this workstation, not a global CDN. Availability depends on
this machine, its uplink and Tailscale; it is suitable for an initial public demo,
not a substitute for capacity planning or a production uptime guarantee.

## Assets And Delivery

Optimized runtime assets are versioned in `public/assets/`. The largest terrain
file is approximately 21 MB before compression. `scripts/compress.mjs` emits
precompressed Brotli and gzip variants at build time. Image files are already
compressed and are served without redundant recompression.

HTML is revalidated on every navigation. Hashed JS/CSS receive immutable caching;
non-hashed geography assets receive a short one-hour cache with revalidation.
Whenever non-hashed assets change incompatibly, version their URLs or filenames.

Large original textures in `reference/` are deliberately excluded from Git and
deployments. `scripts/assets.mjs` and `scripts/prepare-assets.mjs` regenerate assets.

## Verification

Node tests cover movement, geography, mesh conversion and HTTP delivery/security.
Playwright, connected to Chromium through CDP, verifies full gameplay, package
landing, camera/map controls, mobile touch, responsive layout, canvas pixels,
console errors and local-only resource loading. The script generates evidence in
`verification/`; this generated directory is not published.
