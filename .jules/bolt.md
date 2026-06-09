
## 2024-05-18 - Avoid Math.sqrt() in O(n²) spatial loops
**Learning:** In frontend animations involving particle systems, computing `Math.sqrt()` to calculate distances within an O(n²) loop (`connectParticles`) is a significant performance bottleneck.
**Action:** Always compare squared distances (`dx * dx + dy * dy`) against a squared max distance (`maxDistance * maxDistance`). Only compute `Math.sqrt()` inside the conditional block if the exact distance is strictly needed (e.g., for calculating proportional opacity).
