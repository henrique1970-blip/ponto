// Ponto Digital — Service Worker
// Offline-first robusto:
//  - Núcleo local: precache OBRIGATÓRIO (mesma origem, confiável).
//  - Lib + modelos de IA: precache BEST-EFFORT (falha de um não derruba a instalação).
//  - App: network-first com fallback a cache e à index.html.
//  - CDN (lib/modelos): cache-first (grandes e imutáveis).
//  - Mensagens PRECACHE_ALL / CACHE_STATUS: a tela de Admin baixa e confere
//    tudo sob demanda, com barra de progresso.

const CACHE = 'ponto-v4';

// Mesma origem. Só os três primeiros são críticos para o app abrir offline;
// os ícones entram best-effort para não derrubar a instalação se faltar um.
const CORE = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];
const CRITICO = 3;

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

const ALL = CORE.concat(REMOTE);

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(CORE.slice(0, CRITICO));                       // crítico
    await Promise.allSettled(CORE.slice(CRITICO).map(u => c.add(u)));
    await Promise.allSettled(REMOTE.map(u => c.add(u)));          // best-effort
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

// ── Mensagens vindas da página (tela de Admin) ───────────────────────────────
self.addEventListener('message', e => {
  const port = e.ports && e.ports[0];
  const type = e.data && e.data.type;
  if (type === 'PRECACHE_ALL')      e.waitUntil(precacheAll(port));
  else if (type === 'CACHE_STATUS') e.waitUntil(cacheStatus(port));
  else if (type === 'SKIP_WAITING') self.skipWaiting();
});

// Baixa tudo de novo, um a um, reportando progresso. `cache:'reload'` obriga a
// buscar da rede em vez de reaproveitar o cache HTTP do navegador.
async function precacheAll(port) {
  const c = await caches.open(CACHE);
  let done = 0, fail = 0;
  for (const u of ALL) {
    try {
      const res = await fetch(new Request(u, {cache:'reload'}));
      if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status));
      await c.put(u, res);
    } catch (_) { fail++; }
    done++;
    if (port) port.postMessage({type:'PROGRESS', done, total: ALL.length, fail});
  }
  if (port) port.postMessage({type:'DONE', done, total: ALL.length, fail});
}

async function cacheStatus(port) {
  const c = await caches.open(CACHE);
  let have = 0;
  for (const u of ALL) if (await c.match(u)) have++;
  if (port) port.postMessage({type:'STATUS', have, total: ALL.length});
}

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
