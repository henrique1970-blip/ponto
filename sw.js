// Ponto Digital — Service Worker
// Cache-first para assets estáticos e modelos de IA (CDN).
// Network-first para o próprio app.

const CACHE = 'ponto-v2';

// Arquivos core a pré-cachear na instalação
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js',
];

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// ── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Nunca interceptar chamadas para o webhook do Google
  if (url.hostname.includes('script.google.com')) return;

  // Recursos do CDN (face-api.js, modelos) → cache-first
  // Modelos são grandes mas não mudam; uma vez baixados ficam disponíveis offline.
  if (url.hostname.includes('jsdelivr.net') || url.hostname.includes('unpkg.com')) {
    e.respondWith(cacheFirst(request));
    return;
  }

  // App local → network-first com fallback para cache
  e.respondWith(networkFirst(request));
});

// ── Estratégias ───────────────────────────────────────────────────────────────
async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) {
      const c = await caches.open(CACHE);
      c.put(req, res.clone()); // guarda em background
    }
    return res;
  } catch (_) {
    return new Response('Offline — recurso não disponível.', { status: 503 });
  }
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const c = await caches.open(CACHE);
      c.put(req, res.clone());
    }
    return res;
  } catch (_) {
    const cached = await caches.match(req);
    return cached || new Response('Offline', { status: 503 });
  }
}
