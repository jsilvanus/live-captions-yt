// LCYT service worker — minimal shell for PWA installability
// Serves cached app shell for offline resilience and enables install prompts.

const CACHE = 'lcyt-v1';
const SHELL = ['/'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Only handle GET requests for same-origin navigation; pass everything else through.
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // API calls — always go to network
  if (url.pathname.startsWith('/live') ||
      url.pathname.startsWith('/captions') ||
      url.pathname.startsWith('/stats') ||
      url.pathname.startsWith('/sync') ||
      url.pathname.startsWith('/events') ||
      url.pathname.startsWith('/mic') ||
      url.pathname.startsWith('/keys') ||
      url.pathname.startsWith('/health')) {
    return;
  }

  // Navigation — stale-while-revalidate for app shell
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res.ok) {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        }
        return res;
      });
      return cached || network;
    })
  );
});
