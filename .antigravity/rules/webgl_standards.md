# WebGL & Animation Standards

- **Performance First:** All animations must target 60fps on mid-tier mobile devices.
- **Cleanup:** Always implement `useEffect` cleanup for Three.js scenes to prevent memory leaks.
- **Math:** Prefer `MathUtils.lerp` or GSAP for all movement; avoid "jumpy" transitions.
