// Service worker: deixa o app instalável e 100% offline desde a primeira abertura.
// Todos os arquivos (inclusive IA e bibliotecas) são da própria origem; nada externo é usado.
const CACHE = 'fotoguia-v2';
const SHELL = [
  './', 'index.html', 'css/style.css', 'js/app.js', 'js/pre-tf.js', 'manifest.webmanifest', 'icons/icon.svg',
  'vendor/tf.min.js', 'vendor/coco-ssd.min.js', 'vendor/jszip.min.js',
  'vendor/model/model.json',
  'vendor/model/group1-shard1of5', 'vendor/model/group1-shard2of5', 'vendor/model/group1-shard3of5',
  'vendor/model/group1-shard4of5', 'vendor/model/group1-shard5of5',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const isVendor = new URL(req.url).pathname.includes('/vendor/');
  if (isVendor) {
    // Bibliotecas e modelo: versões fixas, cache primeiro.
    e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
    return;
  }
  // Código do app: rede primeiro (pega atualizações), cache como reserva.
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then(r => r || caches.match('index.html'))));
});
