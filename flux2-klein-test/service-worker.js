const CACHE_NAME = 'stitchsketch-flux-shell-v1';
const BASE = new URL('./', self.location.href);
const APP_FILES = [
  new URL('./', self.location.href).href,
  new URL('index.html', BASE).href,
  new URL('styles.css', BASE).href,
  new URL('app.js', BASE).href,
  new URL('manifest.webmanifest', BASE).href
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('stitchsketch-flux-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== 'GET' || requestUrl.origin !== self.location.origin) return;
  if (!APP_FILES.includes(requestUrl.href)) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
