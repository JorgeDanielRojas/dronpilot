// sw.js — Service Worker de Dron Pilot. App-shell network-first (los deploys llegan al instante),
// resto cache-first. Bumpear CACHE en cada deploy. Patrón heredado de RC Combat.
const CACHE = 'dronpilot-0.8.3';
const SHELL = [
  './', './index.html', './manifest.json',
  './js/physics_drone.js', './js/scene_house.js', './js/controls.js', './js/main.js',
  './vendor/three.module.js', './vendor/GLTFLoader.js', './vendor/utils/BufferGeometryUtils.js',
  './models/drone.glb', './models/simulus_heli.glb',
  './audio/drone_loop.mp3', './audio/drone_start.mp3', './audio/crash2.mp3', './audio/crash.mp3', './audio/silence.mp3',
  './img/cover.jpg', './img/wpA.png', './img/wpB.png', './img/wpC.png', './img/wpD.png', './img/wpE.png',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-180.png',
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c =>
    Promise.all(SHELL.map(u => fetch(u, { cache: 'reload' }).then(r => r.ok && c.put(u, r)).catch(() => {})))
  ));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.endsWith('score.php')) { e.respondWith(fetch(req)); return; }   // leaderboard dinámico: nunca cachear
  const isShell = req.mode === 'navigate' || /\.(js|css)$/.test(url.pathname) || url.pathname.endsWith('/');
  // solo cachear respuestas BUENAS del mismo origen (no envenenar la caché con 404/500/redirect)
  const good = r => r && r.ok && r.type === 'basic';
  if (isShell) {
    // network-first: código fresco sin reinstalar; caché de respaldo si no hay red
    e.respondWith(fetch(req, { cache: 'reload' }).then(r => { if (good(r)) caches.open(CACHE).then(c => c.put(req, r.clone())); return r; }).catch(() => caches.match(req).then(m => m || caches.match('./index.html'))));
  } else {
    // cache-first para assets pesados (glb/audio/img)
    e.respondWith(caches.match(req).then(m => m || fetch(req).then(r => { if (good(r)) { const rc = r.clone(); caches.open(CACHE).then(c => c.put(req, rc)); } return r; }).catch(() => m)));
  }
});
