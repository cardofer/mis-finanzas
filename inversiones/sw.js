// Mis Inversiones: guarda la app en el teléfono para que abra sin internet.
// Solo maneja sus propios archivos; nunca guarda en caché las respuestas de precios.
const CACHE = 'mis-inversiones-v1';
const ARCHIVOS = ['./', 'index.html', 'app.js', 'manifest.webmanifest', 'chart.umd.min.js', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('mis-inversiones-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(fetch(r).then(res => { if (res.ok) { const copia = res.clone(); caches.open(CACHE).then(c => c.put(r, copia)); } return res; })
    .catch(() => caches.match(r).then(x => x || caches.match('index.html'))));
});
