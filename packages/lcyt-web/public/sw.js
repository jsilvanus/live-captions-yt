// LCYT service worker — minimal shell for PWA installability
// Serves cached app shell for offline resilience and enables install prompts.

const CACHE = 'lcyt-v1';
const SHELL = ['/'];

function offlinePage() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>LCYT — No Connection</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#0d1117;color:#e6edf3;font-family:system-ui,sans-serif;
         display:flex;align-items:center;justify-content:center;
         min-height:100dvh;text-align:center;padding:2rem}
    .card{background:#161b22;border:1px solid #30363d;border-radius:12px;
          padding:2.5rem 3rem;max-width:380px}
    .icon{font-size:3rem;margin-bottom:1rem}
    h1{font-size:1.25rem;font-weight:600;margin-bottom:.6rem}
    p{font-size:.95rem;color:#8b949e;line-height:1.55}
    button{margin-top:1.5rem;padding:.55rem 1.4rem;border:none;border-radius:6px;
           background:#4f8ef7;color:#fff;font-size:.9rem;cursor:pointer}
    button:hover{background:#6aa3f8}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">📡</div>
    <h1>Network required</h1>
    <p>This application requires a network connection to send live captions to YouTube.</p>
    <button onclick="location.reload()">Try again</button>
  </div>
</body>
</html>`;
  return new Response(html, {
    status: 503,
    headers: { 'Content-Type': 'text/html;charset=utf-8' },
  });
}

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
          const toCache = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, toCache));
        }
        return res;
      });
      return cached || network.catch(() => offlinePage());
    })
  );
});
