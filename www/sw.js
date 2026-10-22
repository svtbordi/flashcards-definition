// Service worker : l'application marche hors connexion ; les définitions sont mises à jour dès qu'il y a du réseau.
// Les applications publiées sur svtbordi.github.io (définitions de SVT, formules de maths…) partagent le même
// stockage de caches : celle-ci ne supprime que les caches dont le nom commence par PREFIX.
const PREFIX = 'fc-bcpst-';
const CACHE = PREFIX + '__BUILD__';
const SHELL = ['./', 'index.html', 'styles.css', 'qcm.js', 'app.js', 'config.json', 'manifest.webmanifest',
  'vendor/ts-fsrs.umd.js', 'vendor/xlsx.full.min.js',
  'data/definitions.json', 'data/chapters.json', 'data/ouverts.json', 'data/leurres.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'prof.html', 'prof.js', 'chapitres.html', 'chapitres.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/data/') || url.pathname.endsWith('/config.json')) {
    // réseau d'abord pour les définitions et la configuration (adresse des signalements), cache si hors connexion
    e.respondWith(fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request)));
});
