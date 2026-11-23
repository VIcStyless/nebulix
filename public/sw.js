/* Nebulix service worker (13.8): installable app, works on a bad connection, and push notifications.
   Network first for everything (you always get the newest version when online); the last good copy is used when
   offline. The API, live connections, the proxy and big VM images are never cached. */
const CACHE = 'nbx-v1';
const SKIP = /^\/(api|ws|px|vmd|vm\/|emu\/|blobs)/;
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/offline.html', '/assets/icon-192.png'])).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url); if (url.origin !== self.location.origin || SKIP.test(url.pathname)) return;
  const nav = req.mode === 'navigate';
  e.respondWith(fetch(req).then((res) => {
    if (res.ok && res.type === 'basic' && /^\/(js|css|assets|fonts)\//.test(url.pathname)) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
    return res;
  }).catch(async () => (nav ? caches.match('/offline.html') : (await caches.match(req)) || Response.error())));
});
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Nebulix', { body: d.body || '', icon: '/assets/icon-192.png', badge: '/assets/icon-192.png', tag: d.tag || undefined, renotify: !!d.tag, data: { url: d.url || '/' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close(); const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => { const w = list.find((c) => c.url.startsWith(self.location.origin)); if (w) { w.focus(); return w.navigate ? w.navigate(url) : null; } return self.clients.openWindow(url); }));
});
