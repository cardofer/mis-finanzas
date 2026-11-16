// Mis Finanzas: guarda la app en el teléfono para que abra sin internet.
const CACHE = 'mis-finanzas-v2';
const ARCHIVOS = ['./', 'index.html', 'manifest.webmanifest', 'config.js', 'vendor/supabase.js', 'vendor/chart.umd.min.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  // Primero la red (para recibir actualizaciones), y si no hay internet, lo guardado.
  e.respondWith(fetch(r).then(res => { if (res.ok) { const copia = res.clone(); caches.open(CACHE).then(c => c.put(r, copia)); } return res; })
    .catch(() => caches.match(r).then(x => x || caches.match('index.html'))));
});
