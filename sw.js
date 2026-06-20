const CACHE_NAME = "rj-portfolio-v14";
const CACHE_EXPIRATION_DAYS = 7;
const CACHE_EXPIRATION_MS = CACHE_EXPIRATION_DAYS * 24 * 60 * 60 * 1000;

const ALLOWED_ORIGINS = new Set([
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
  "https://cdnjs.cloudflare.com",
  "https://unpkg.com",
  "https://cdn.jsdelivr.net",
]);

const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/styles.css",
  "/three-bg.js",
  "/manifest.json",
  "/android-chrome-192x192.png",
  "/android-chrome-512x512.png",
  "/profile-pic-160.webp",
  "/js/app-logic.js",
  "/js/main.js",
  "/js/theme-bootstrap.js",
  "/js/config.js",
  "/js/navigation.js",
  "/js/theme.js",
  "/js/projects.js",
  "/js/form.js",
  "/js/confetti.js",
  "/js/animations.js",
  "/js/tilt.js",
  "/js/modal.js",
  "/js/utils.js",
  "/js/terminal.js",
  "/js/analytics.js",
  "/js/chat.js",
  "/js/activity.js",
  "/js/physics.js",
  "/js/particles-config.js",
  "/js/skills-carousel.js",
  "/js/swipe-handler.js",
  "/js/ripple.js",
  "/js/scroll-to-top.js",
  "/js/theme-customizer.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter(
              (name) => name.startsWith("rj-portfolio-") && name !== CACHE_NAME,
            )
            .map((name) => caches.delete(name)),
        );
      })
      .then(() => {
        // Clean up expired cache entries
        return caches.open(CACHE_NAME).then((cache) => {
          return cache.keys().then((requests) => {
            const now = Date.now();
            return Promise.all(
              requests.map((request) => {
                return cache.match(request).then((response) => {
                  if (!response) return;
                  const cachedTime = response.headers.get("sw-cached-time");
                  if (
                    cachedTime &&
                    now - parseInt(cachedTime, 10) > CACHE_EXPIRATION_MS
                  ) {
                    return cache.delete(request);
                  }
                });
              }),
            );
          });
        });
      })
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // 1. External dependencies (CDNs): Cache-First strategy
  // We want to lock down external scripts/fonts and serve from cache instantly.
  if (url.origin !== location.origin) {
    if (event.request.method !== "GET") return;
    if (!ALLOWED_ORIGINS.has(url.origin)) return;

    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        // Guard: only fetch URLs with http/https scheme to prevent SSRF via extension/internal URLs
        if (
          !event.request.url.startsWith("https://") &&
          !event.request.url.startsWith("http://")
        ) {
          return new Response("", { status: 400, statusText: "Bad Request" });
        }
        // If not in cache, fetch it AND cache it for next time
        return fetch(event.request)
          .then((networkResponse) => {
            // Only cache valid CORS responses from allowlisted origins
            if (
              !networkResponse ||
              networkResponse.status !== 200 ||
              networkResponse.type !== "cors"
            ) {
              return networkResponse;
            }

            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              const headers = new Headers(responseToCache.headers);
              headers.set("sw-cached-time", Date.now().toString());
              const modifiedResponse = new Response(responseToCache.body, {
                status: responseToCache.status,
                statusText: responseToCache.statusText,
                headers: headers,
              });
              cache.put(event.request, modifiedResponse);
            });
            return networkResponse;
          })
          .catch(() => {
            // Failure to fetch cross-origin resource while offline
            return new Response("", { status: 408, statusText: "Offline" });
          });
      }),
    );
    return;
  }

  // Never cache API responses; they may contain session-scoped data.
  if (url.pathname.startsWith("/api/")) return;

  // 2. Local App Shell & Assets (HTML/CSS/JS/Images): Stale-While-Revalidate strategy
  // We serve exactly what is in the cache instantly, then blindly fetch in the background
  // to update the cache for the NEXT page load.
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Guard: only fetch same-origin http/https URLs
      if (
        !event.request.url.startsWith("https://") &&
        !event.request.url.startsWith("http://")
      ) {
        return (
          cachedResponse ||
          new Response("", { status: 400, statusText: "Bad Request" })
        );
      }
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            (event.request.url.startsWith("https://") ||
              url.hostname === "localhost" ||
              url.hostname === "127.0.0.1")
          ) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              const headers = new Headers(responseToCache.headers);
              headers.set("sw-cached-time", Date.now().toString());
              const modifiedResponse = new Response(responseToCache.body, {
                status: responseToCache.status,
                statusText: responseToCache.statusText,
                headers: headers,
              });
              cache.put(event.request, modifiedResponse);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // If offline and fetching fails, return a basic offline response
          return new Response("Offline — cached content unavailable.", {
            status: 503,
            statusText: "Service Unavailable",
            headers: { "Content-Type": "text/plain" },
          });
        });

      // Return the cached response immediately, or wait for the network response if nothing is cached.
      return cachedResponse || fetchPromise;
    }),
  );
});
