const CACHE_NAME = 'rj-portfolio-v2';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/styles.css',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/app-logic.js',
  '/three-bg.js',
  '/js/main.js',
  '/js/config.js',
  '/js/navigation.js',
  '/js/theme.js',
  '/js/projects.js',
  '/js/form.js',
  '/js/animations.js',
  '/js/tilt.js',
  '/js/modal.js',
  '/js/utils.js',
  '/js/terminal.js',
  '/js/info-bar.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name.startsWith('rj-portfolio-') && name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. External dependencies (CDNs): Cache-First strategy
  // We want to lock down external scripts/fonts and serve from cache instantly.
  if (url.origin !== location.origin) {
    if (event.request.method !== 'GET') return;
    
    event.respondWith(
      caches.match(event.request).then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
        // If not in cache, fetch it AND cache it for next time
        return fetch(event.request).then(networkResponse => {
          // Check if the request is internal/extension (non-http) or invalid
          const requestScheme = new URL(event.request.url).protocol;
          if (!networkResponse || networkResponse.status !== 200 || 
              (networkResponse.type !== 'basic' && networkResponse.type !== 'cors') ||
              !requestScheme.startsWith('http')) {
            return networkResponse;
          }

          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
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

  // 2. Local App Shell & Assets (HTML/CSS/JS/Images): Stale-While-Revalidate strategy
  // We serve exactly what is in the cache instantly, then blindly fetch in the background
  // to update the cache for the NEXT page load.
  if (url.origin === location.origin) {
    if (event.request.method !== 'GET') return;

    event.respondWith(
      caches.match(event.request).then(cachedResponse => {
        const fetchPromise = fetch(event.request).then(networkResponse => {
          const requestScheme = new URL(event.request.url).protocol;
          if (networkResponse && networkResponse.status === 200 && requestScheme.startsWith('http')) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseToCache);
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
  }
});
