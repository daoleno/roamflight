# Project Working Rules

- Product name: Roamflight. Chinese name: Manhang (U+6F2B U+822A).
- Positioning: an exploration-focused flying game; the journey matters as much as the destination.
- Keep planned city-scale exploration clearly distinct from currently implemented gameplay.

- This is an independent browser adaptation, not an official or pixel-identical Unity release.
- Preserve the full-screen flying experience. Do not introduce a marketing landing page.
- Keep real geographical source assets and the Unity-to-WebGL Z reflection consistent.
- Preserve all third-party attribution and licenses in `public/assets/` and `/credits.html`.
- Never serve the repository root. The production server must expose only `dist/` and `/healthz`.
- Do not publish to a cloud account, change DNS, or expose additional ports without user authorization.
- Run `npm test`, `npm run format:check`, and `npm run build` before a release.
- Verify rendering with desktop and mobile screenshots and canvas-pixel checks after graphics changes.
- The local persistent service is `roamflight.service` on port 4177.
- Browser verification accepts `CDP_URL` and `TEST_URL`; do not hard-code session-specific ports.
