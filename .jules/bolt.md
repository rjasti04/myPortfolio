## 2026-06-17 - O(N^2) Particle Interaction Optimization
**Learning:** Background canvas animations relying on nested loops (O(n²)) like particle connections can become CPU bottlenecks, even more than WebGL rendering paths.
**Action:** Always pre-sort arrays representing spatial data to leverage early breaking inside inner loops, changing O(n²) to O(n*k).
