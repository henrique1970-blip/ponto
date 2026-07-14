// Ponto Saída — Service Worker
// Offline-first robusto:
//  - Núcleo local: precache OBRIGATÓRIO (mesma origem, confiável).
//  - Libs + modelos de IA (face-api + MediaPipe): precache BEST-EFFORT
//    (a falha de um recurso não derruba a instalação).
//  - App: network-first com fallback a cache e à index.html.
//  - CDN (libs/modelos): cache-first (grandes e imutáveis).

// Ao trocar ícones/manifest, suba a versão: é o que faz o celular descartar o
// cache antigo e buscar os arquivos novos.
const CACHE = 'ponto-saida-v3';

// Mesma origem — precisa funcionar para o app abrir offline.
const CORE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-192-maskable.png',
  './icon-512-maskable.png',
  './apple-touch-icon.png',
];

// ── Remotos: reconhecimento facial (face-api.js) ─────────────────────────────
const CDN      = 'https://cdn.jsdelivr.net';
const FACE_LIB = CDN + '/npm/face-api.js@0.22.2/dist/face-api.min.js';
const FACE_MDL = CDN + '/gh/justadudewhohacks/face-api.js@master/weights';

// ── Remotos: reconhecimento de gestos (MediaPipe Tasks Vision) ───────────────
// O FilesetResolver escolhe entre a variante SIMD e a nosimd conforme o aparelho.
// Pré-cacheamos só a SIMD (~9 MB), suportada por qualquer celular atual — precachear
// as duas dobraria o download da instalação sem necessidade. Se algum aparelho antigo
// pedir a nosimd, o handler cache-first abaixo a busca e guarda no primeiro uso online.
const TASKS    = CDN + '/npm/@mediapipe/tasks-vision@0.10.14';
const GEST_MDL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';

const REMOTE = [
  FACE_LIB,
  FACE_MDL + '/tiny_face_detector_model-weights_manifest.json',
  FACE_MDL + '/tiny_face_detector_model-shard1',
  FACE_MDL + '/face_landmark_68_tiny_model-weights_manifest.json',
  FACE_MDL + '/face_landmark_68_tiny_model-shard1',
  FACE_MDL + '/face_recognition_model-weights_manifest.json',
  FACE_MDL + '/face_recognition_model-shard1',
  FACE_MDL + '/face_recognition_model-shard2',

  TASKS + '/vision_bundle.mjs',
  TASKS + '/wasm/vision_wasm_internal.js',
  TASKS + '/wasm/vision_wasm_internal.wasm',
  GEST_MDL,
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
  const url = new URL(request.url);

  // Nunca interceptar o webhook do Google (POST do sync e seu redirect).
  if (url.hostname.includes('script.google.com') ||
      url.hostname.includes('script.googleusercontent.com')) return;

  // CDN + modelos (face-api, MediaPipe wasm, .task) → cache-first.
  if (url.hostname.includes('jsdelivr.net') ||
      url.hostname.includes('unpkg.com') ||
      url.hostname.includes('storage.googleapis.com')) {
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
