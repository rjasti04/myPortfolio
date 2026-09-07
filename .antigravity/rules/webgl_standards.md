# WebGL & Animation Standards

Deprecated. This file described Three.js/GSAP/WebGL practice that this project
has never used: the animated background in `frontend/three-bg.js` is plain 2D
canvas, and there is no WebGL context, no Three.js and no GSAP in the repo. The
one rule worth keeping — a 60fps target on mid-tier mobile, and cancelling every
`requestAnimationFrame` handle on teardown — has been merged into the single
source of truth.

Read instead: **[AGENTS.md](../../AGENTS.md)**
