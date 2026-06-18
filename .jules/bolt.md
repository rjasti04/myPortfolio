## 2024-05-24 - Particle system spatial check optimization
**Learning:** Nested loops for distance checks in animation frames (O(n²) complexity) cause performance degradation, even with a small number of particles.
**Action:** Always pre-sort collections by one coordinate (e.g., X) and early-exit the inner loop (`if (dx > maxDistance) break;`) to effectively reduce spatial check complexity.
