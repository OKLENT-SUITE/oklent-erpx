// App-shell cache only. Financial data is NEVER cached: /api/* always goes to the network.
const SHELL = 'oklent-business-shell-v24', FILES = ['/', '/style.css', '/app.js', '/commerce.js', '/dashboard.js', '/icons.js', '/nav.json', '/logo.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES))));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL).map(k => caches.delete(k))))));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin || u.pathname.startsWith('/api/') || u.pathname.startsWith('/shop') || e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).catch(async () => (await caches.match(e.request)) || Response.error()));
});
