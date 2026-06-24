// Ponto Digital — Service Worker
// Offline-first robusto:
//  - Núcleo local: precache OBRIGATÓRIO (mesma origem, confiável).
//  - Lib + modelos de IA: precache BEST-EFFORT (falha de um não derruba a instalação).
//  - App: network-first com fallback a cache e à index.html.
//  - CDN (lib/modelos): cache-first (grandes e imutáveis).

const CACHE = 'ponto-v3';

// Mesma origem — precisa funcionar para o app abrir offline.
const CORE = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
];

// Remotos — biblioteca + pesos dos modelos. Best-effort (Promise.allSettled).
const CDN    = 'https://cdn.jsdelivr.net';
const LIB    = CDN + '/npm/face-api.js@0.22.2/dist/face-api.min.js';
const MODELS = CDN + '/gh/justadudewhohacks/face-api.js@master/weights';
const REMOTE = [
  LIB,
  MODELS + '/tiny_face_detector_model-weights_manifest.json',
  MODELS + '/tiny_face_detector_model-shard1',
  MODELS + '/face_landmark_68_tiny_model-weights_manifest.json',
  MODELS + '/face_landmark_68_tiny_model-shard1',
  MODELS + '/face_recognition_model-weights_manifest.json',
  MODELS + '/face_recognition_model-shard1',
  MODELS + '/face_recognition_model-shard2',
];

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(CORE);                                  // crítico
    await Promise.allSettled(REMOTE.map(u => c.add(u)));   // best-effort
    await self.skipWaiting();
  })());
});

// ── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// ── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const { request } = e;

  // Só interceptamos GET (cache.put falha em POST etc.).
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Nunca interceptar o webhook do Google (POST do sync e seu redirect).
  if (url.hostname.includes('script.google.com') ||
      url.hostname.includes('script.googleusercontent.com')) return;

  // CDN (lib + modelos) → cache-first.
  if (url.hostname.includes('jsdelivr.net') || url.hostname.includes('unpkg.com')) {
    e.respondWith(cacheFirst(request));
    return;
  }

  // App local → network-first com fallback a cache.
  e.respondWith(networkFirst(request));
});

// ── Estratégias ───────────────────────────────────────────────────────────────
async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) {
      const c = await caches.open(CACHE);
      c.put(req, res.clone());
    }
    return res;
  } catch (_) {
    return new Response('Offline — recurso não disponível.', { status: 503 });
  }
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const c = await caches.open(CACHE);
      c.put(req, res.clone());
    }
    return res;
  } catch (_) {
    const cached = await caches.match(req);
    if (cached) return cached;
    // Navegação offline sem match exato → cai na index.html cacheada.
    if (req.mode === 'navigate') {
      const fallback = await caches.match('./index.html') || await caches.match('./');
      if (fallback) return fallback;
    }
    return new Response('Offline', { status: 503 });
  }
}
