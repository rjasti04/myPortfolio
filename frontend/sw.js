const CACHE_NAME = 'rj-portfolio-v29';
const CACHE_EXPIRATION_DAYS = 7;
const CACHE_EXPIRATION_MS = CACHE_EXPIRATION_DAYS * 24 * 60 * 60 * 1000;

// Everything the page loads is now same-origin: the fonts are self-hosted and
// subset, and marked/DOMPurify are vendored from npm. Nothing here needs a
// cross-origin caching path any more, and keeping one would let a future stray
// third-party request be cached silently.
const ALLOWED_ORIGINS = new Set([]);

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/styles.css',
  '/auth-modal.css',
  '/manifest.json',
  '/android-chrome-192x192.png',
  '/android-chrome-512x512.png',
  '/android-chrome-maskable-512x512.png',
  '/profile-cutout-380.webp',
  '/js/app-logic.js',
  '/js/main.js',
  '/js/auth.js',
  '/js/auth-ui.js',
  '/js/theme-bootstrap.js',
  '/js/config.js',
  '/js/navigation.js',
  '/js/home-portrait.js',
  '/js/theme.js',
  '/js/form.js',
  '/js/confetti.js',
  '/js/animations.js',
  '/js/tilt.js',
  '/js/modal.js',
  '/js/utils.js',
  '/js/terminal/index.js',
  '/js/terminal/registry.js',
  '/js/terminal/output.js',
  '/js/terminal/history.js',
  '/js/terminal/keymap.js',
  '/js/terminal/palette.js',
  '/js/terminal/math.js',
  '/js/analytics.js',
  '/js/chat.js',
  '/js/activity.js',
  '/js/activity-charts.js',
  '/js/physics.js',
  '/js/skills-carousel.js',
  '/js/swipe-handler.js',
  '/js/ripple.js',
  '/js/scroll-to-top.js',
  '/js/theme-customizer.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      // Per-URL rather than cache.addAll: addAll rejects the whole install if a
      // single entry 404s, so one renamed or missing file stopped the worker
      // installing at all and left the visitor with no offline shell whatever.
      // A shell that is 90% cached beats no shell.
      const results = await Promise.allSettled(
        PRECACHE_URLS.map(url => cache.add(new Request(url, { cache: 'reload' })))
      );
      const failed = results
        .map((r, i) => (r.status === 'rejected' ? PRECACHE_URLS[i] : null))
        .filter(Boolean);
      if (failed.length) {
        console.warn('SW: could not precache', failed);
      }
    })
    // No skipWaiting() here. It used to activate the new worker immediately,
    // which swapped the asset set under a page that was already running - and
    // made the "a new version is available" banner appear after the swap had
    // already happened. The page now asks for it, from that banner.
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name.startsWith('rj-portfolio-') && name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
    }).then(() => {
      // Clean up expired cache entries
      return caches.open(CACHE_NAME).then(cache => {
        return cache.keys().then(requests => {
          const now = Date.now();
          return Promise.all(
            requests.map(request => {
              return cache.match(request).then(response => {
                if (!response) return;
                const cachedTime = response.headers.get('sw-cached-time');
                if (cachedTime && (now - parseInt(cachedTime, 10)) > CACHE_EXPIRATION_MS) {
                  return cache.delete(request);
                }
              });
            })
          );
        });
      });
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. External dependencies (CDNs): Cache-First strategy
  // We want to lock down external scripts/fonts and serve from cache instantly.
  if (url.origin !== location.origin) {
    if (event.request.method !== 'GET') return;
    if (!ALLOWED_ORIGINS.has(url.origin)) return;

    event.respondWith(
      caches.match(event.request).then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
        // Guard: only fetch URLs with http/https scheme to prevent SSRF via extension/internal URLs
        if (!event.request.url.startsWith('https://') && !event.request.url.startsWith('http://')) {
          return new Response('', { status: 400, statusText: 'Bad Request' });
        }
        // If not in cache, fetch it AND cache it for next time
        return fetch(event.request).then(networkResponse => {
          // Only cache valid CORS responses from allowlisted origins
          if (!networkResponse || networkResponse.status !== 200 ||
            networkResponse.type !== 'cors') {
            return networkResponse;
          }

          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            const headers = new Headers(responseToCache.headers);
            headers.set('sw-cached-time', Date.now().toString());
            const modifiedResponse = new Response(responseToCache.body, {
              status: responseToCache.status,
              statusText: responseToCache.statusText,
              headers: headers
            });
            cache.put(event.request, modifiedResponse);
          });
          return networkResponse;
        }).catch(() => {
          // Failure to fetch cross-origin resource while offline
          return new Response('', { status: 408, statusText: 'Offline' });
        });
      })
    );
    return;
  }

  // Never cache API responses; they may contain session-scoped data.
  if (url.pathname.startsWith('/api/')) return;

  if (event.request.method !== 'GET') return;

  // 2a. Navigations and HTML: network-first.
  //
  // index.html names the hashed asset files, so a stale copy points at a build
  // that no longer exists. Stale-while-revalidate served the previous deploy's
  // HTML against the current deploy's assets - a mismatch that only resolved on
  // the *second* reload. The cache is still the offline fallback.
  const isDocument =
    event.request.mode === 'navigate' ||
    (event.request.headers.get('accept') || '').includes('text/html');

  if (isDocument) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then(hit => hit || caches.match('/index.html')))
    );
    return;
  }

  // 2b. Everything else (hashed assets, images): stale-while-revalidate.
  // Safe here precisely because the filenames are content-hashed - a cached
  // asset can never be the wrong version of itself.

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      // Guard: only fetch same-origin http/https URLs
      if (!event.request.url.startsWith('https://') && !event.request.url.startsWith('http://')) {
        return cachedResponse || new Response('', { status: 400, statusText: 'Bad Request' });
      }
      const fetchPromise = fetch(event.request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200 && (event.request.url.startsWith('https://') || url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            const headers = new Headers(responseToCache.headers);
            headers.set('sw-cached-time', Date.now().toString());
            const modifiedResponse = new Response(responseToCache.body, {
              status: responseToCache.status,
              statusText: responseToCache.statusText,
              headers: headers
            });
            cache.put(event.request, modifiedResponse);
          });
        }
        return networkResponse;
      }).catch(() => {
        // If offline and fetching fails, return a basic offline response
        return new Response('Offline — cached content unavailable.', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain' }
        });
      });

      // Return the cached response immediately, or wait for the network response if nothing is cached.
      return cachedResponse || fetchPromise;
    })
  );
});
