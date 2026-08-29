# WebGL & Animation Standards
- **Performance First:** All animations must target 60fps on mid-tier mobile devices.
- **Cleanup:** Always dispose geometries, materials, textures, and cancel `requestAnimationFrame` IDs during module cleanup or page unload to prevent WebGL memory leaks.
- **Math:** Prefer `MathUtils.lerp` or GSAP for all movement; avoid "jumpy" transitions.