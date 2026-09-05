# Visual And Product Roadmap

## Product Milestones

These are planned stages, not features included in the current build.

1. **World exploration:** refine country/region routes, flight feel, audio, scenery
   and varied objectives around the existing real-world globe.
2. **City-scale flying:** prototype one city with recognizable landmarks, local
   routes and streamed detail; establish data licensing and mobile performance
   budgets before attempting worldwide coverage.
3. **A pilot's journey:** add discovery records, meaningful rewards, aircraft
   variation and route unlocks that connect individual flights into a longer game.
4. **Broader world coverage:** extend verified city and regional pipelines to more
   countries with explicit quality and loading budgets, rather than promising every
   city before the approach is proven.

## 0.2 Implemented

- Softer cloud shading and subtle cloud drift.
- Less uniform shore foam, moving wave crests and tangent-space wave normals.
- Softened aircraft shadow projected away from the sun.
- Clear-coated aircraft paint and glossier cockpit windows.
- Smooth camera and boost-FOV transitions with restrained banking.
- Parallel texture requests and precompressed static assets.
- Persistent service, health checks, security headers, container recipe and CI.

## Next Visual Pass

1. Capture fixed-reference camera poses from the video, then compare deterministic
   screenshots instead of relying on memory of the reference.
2. Replace approximate terrain/aircraft shadows with a verified shadow-map pipeline
   that includes terrain occlusion and stable bias at all latitudes.
3. Add a physically based atmosphere and a validated day/night cycle. Budget this
   against mobile GPU time before introducing volumetric clouds.
4. Introduce terrain LOD and texture tiers for mobile. Measure frame time and GPU
   memory on real phones, not only headless desktop emulation.
5. Upgrade ship and parachute geometry, motion and secondary animation.

## Before Wider Launch

- Deploy to the selected Cloudflare Pages account and validate public HTTPS.
- Test loading and sustained performance on real iOS/Android devices and slower
  networks; set transfer and frame-time budgets from those measurements.
- Choose a dedicated hostname and CDN/static hosting account for distribution if
  audience size exceeds a workstation-origin demo.
- Establish crash reporting only after deciding retention and privacy policy.
- Expand mission variety and optional local progress save. Multiplayer is a separate
  product decision, not a property of putting the static game online.
