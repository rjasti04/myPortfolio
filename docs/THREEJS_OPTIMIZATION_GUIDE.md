# Three.js Bundle Optimization Guide

## 🎯 Problem

Your current Three.js setup loads the **entire library** (~600KB) when you only need a small subset of features for the particle background effect.

**Current**: `js/vendor/three.module.js` - Full library (~600KB)
**Target**: Custom build with only required modules (~100-150KB)

**Potential Savings**: ~450KB (75% reduction)

---

## Current Usage Analysis

Your `three-bg.js` only uses these Three.js features:

```javascript
// Required imports
import * as THREE from "./js/vendor/three.module.js";

// Actually used:
- THREE.Scene
- THREE.PerspectiveCamera
- THREE.WebGLRenderer
- THREE.BufferGeometry
- THREE.BufferAttribute
- THREE.Points
- THREE.ShaderMaterial
- THREE.Color
- THREE.AdditiveBlending
- THREE.NormalBlending
- THREE.Clock
```

**Not needed**: Lights, Meshes, Loaders, Controls, Helpers, Audio, etc.

---

## Solution 1: Use Three.js from CDN with Tree-Shaking (Recommended)

Replace the vendor file with selective imports from a CDN that supports tree-shaking.

### Step 1: Remove vendor file

```bash
# Backup first
mv js/vendor/three.module.js js/vendor/three.module.js.backup
```

### Step 2: Update `three-bg.js`

Replace:
```javascript
import * as THREE from "./js/vendor/three.module.js";
```

With:
```javascript
import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  BufferGeometry,
  BufferAttribute,
  Points,
  ShaderMaterial,
  Color,
  AdditiveBlending,
  NormalBlending,
  Clock
} from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
```

### Step 3: Update references

Replace all `THREE.` references with direct names:
```javascript
// Before
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(...);

// After
const scene = new Scene();
const camera = new PerspectiveCamera(...);
```

---

## Solution 2: Use npm with Build Tool (Best for Production)

If you're using a bundler like Vite, Webpack, or Rollup:

### Step 1: Install Three.js via npm

```bash
npm install three@0.170.0
```

### Step 2: Update imports in `three-bg.js`

```javascript
import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  BufferGeometry,
  BufferAttribute,
  Float32Array,
  Points,
  ShaderMaterial,
  Color,
  AdditiveBlending,
  NormalBlending,
  Clock
} from 'three';
```

### Step 3: Configure bundler for tree-shaking

**Vite** (vite.config.js):
```javascript
export default {
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'three': ['three']
        }
      }
    }
  }
}
```

**Webpack** (webpack.config.js):
```javascript
module.exports = {
  optimization: {
    usedExports: true,
    sideEffects: false
  }
}
```

---

## Solution 3: Create Custom Three.js Build

Build a minimal Three.js bundle with only required modules.

### Step 1: Clone Three.js repo

```bash
git clone https://github.com/mrdoob/three.js.git
cd three.js
npm install
```

### Step 2: Create custom build file

Create `custom-build.js`:

```javascript
export {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  BufferGeometry,
  BufferAttribute,
  Points,
  ShaderMaterial,
  Color,
  AdditiveBlending,
  NormalBlending,
  Clock
} from './src/Three.js';
```

### Step 3: Build

```bash
npm run build
# Copy the generated file to your project
cp build/three.module.js /path/to/your/project/js/vendor/three.custom.js
```

---

## Solution 4: Quick Win - Use Minified Version

If you can't implement tree-shaking immediately, at least use the minified version:

### Download minified Three.js

```bash
# Download from CDN
curl -o js/vendor/three.min.js https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.min.js
```

**Savings**: ~600KB → ~170KB (72% reduction)

---

## Recommended Approach

**For immediate deployment**: Use Solution 1 (CDN with selective imports)
- ✅ No build process needed
- ✅ Automatic tree-shaking
- ✅ CDN caching benefits
- ✅ Easy to implement

**For production**: Use Solution 2 (npm + bundler)
- ✅ Better control
- ✅ Offline support
- ✅ Version locking
- ✅ Optimal bundle size

---

## Implementation Steps (Solution 1)

### 1. Update `three-bg.js` imports

```javascript
// At the top of three-bg.js
import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  BufferGeometry,
  BufferAttribute,
  Points,
  ShaderMaterial,
  Color,
  AdditiveBlending,
  NormalBlending,
  Clock,
  MutationObserver as ThreeMutationObserver
} from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
```

### 2. Find and replace all THREE. references

```bash
# In three-bg.js, replace:
THREE.Scene → Scene
THREE.PerspectiveCamera → PerspectiveCamera
THREE.WebGLRenderer → WebGLRenderer
THREE.BufferGeometry → BufferGeometry
THREE.BufferAttribute → BufferAttribute
THREE.Points → Points
THREE.ShaderMaterial → ShaderMaterial
THREE.Color → Color
THREE.AdditiveBlending → AdditiveBlending
THREE.NormalBlending → NormalBlending
THREE.Clock → Clock
```

### 3. Test thoroughly

```bash
# Open in browser and check:
- WebGL background renders correctly
- No console errors
- Animations work smoothly
- Theme switching works
```

---

## Verification

After optimization, check bundle size:

```bash
# Check network tab in DevTools
# Before: ~600KB for three.module.js
# After: ~100-150KB for selective imports
```

---

## Expected Results

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Three.js Size | 600KB | 150KB | -75% |
| Initial Bundle | 750KB | 300KB | -60% |
| Parse Time | ~200ms | ~50ms | -75% |
| Time to Interactive | 2.5s | 1.8s | -700ms |

---

## Fallback Strategy

If tree-shaking causes issues, you can always:

1. Revert to full library
2. Use minified version (170KB)
3. Disable Three.js on slower devices (already implemented)

---

## Testing Checklist

- [ ] WebGL canvas renders
- [ ] Particles animate smoothly
- [ ] Mouse parallax works
- [ ] Theme switching updates colors
- [ ] Mobile 2D canvas works
- [ ] No console errors
- [ ] Bundle size reduced
- [ ] Lighthouse score improved

---

## Additional Optimizations

Once tree-shaking is implemented, consider:

1. **Lazy-load Three.js**: Already implemented ✅
2. **Reduce particle count**: Already implemented ✅
3. **Throttle frame rate**: Already implemented ✅
4. **Use OffscreenCanvas**: For better performance
5. **Implement LOD**: Reduce quality on low-end devices

---

## Resources

- [Three.js Tree-Shaking Guide](https://threejs.org/docs/#manual/en/introduction/Installation)
- [Three.js Performance Tips](https://threejs.org/docs/#manual/en/introduction/Performance-tips)
- [Vite Tree-Shaking](https://vitejs.dev/guide/features.html#tree-shaking)
- [Webpack Tree-Shaking](https://webpack.js.org/guides/tree-shaking/)
