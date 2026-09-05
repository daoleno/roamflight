# Contributing To Roamflight

Use Node.js 24 and `npm ci`. Read `AGENTS.md`, the product direction and architecture
before changing shared behavior. Keep changes scoped and preserve source credits.

Before submitting a change:

```sh
npm run format
npm test
npm run build:pages
```

For graphics or UI changes, capture desktop and mobile screenshots and verify
canvas content and controls. For audio changes, check output, transitions,
mute/background behavior and headroom, not just whether an AudioContext exists.

Keep generated `dist/`, `pages-dist/`, `verification/`, original `reference/` assets
and credentials out of Git. Never include Cloudflare tokens or deployment secrets
in screenshots, logs, issues or commits. Do not remove or replace upstream licenses.

Document new capabilities accurately. City-scale flying and progression remain
roadmap items until they work end-to-end and have been verified on target devices.
