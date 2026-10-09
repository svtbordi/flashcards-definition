// Service worker : l'application marche hors connexion ; les définitions sont mises à jour dès qu'il y a du réseau.
const CACHE = 'fc-bcpst-__BUILD__';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest',
  'vendor/ts-fsrs.umd.js', 'vendor/xlsx.full.min.js',
  'data/definitions.json', 'data/chapters.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/data/')) {
    // réseau d'abord pour les définitions, cache si hors connexion
    e.respondWith(fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request)));
});
