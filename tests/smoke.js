// Smoke test do Ponto Digital em DOM simulado.
// Foco: a política de localização vigente (03/08/2026 — AVISA, nunca bloqueia)
// e a proteção contra registro duplo.
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
require('fake-indexeddb/auto');

const ROOT = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// Tira o <script src> do CDN e põe um stub do face-api no lugar.
html = html.replace(/<script src="https:\/\/cdn\.jsdelivr[^"]*"><\/script>/, `<script>
  window.faceapi = {
    TinyFaceDetectorOptions: function(){},
    LabeledFaceDescriptors: function(l,d){this.label=l;this.descriptors=d;},
    FaceMatcher: function(){ this.findBestMatch = () => ({label:'unknown', distance:1}); },
    nets: {
      tinyFaceDetector:     { loadFromUri: async()=>{} },
      faceLandmark68TinyNet:{ loadFromUri: async()=>{} },
      faceRecognitionNet:   { loadFromUri: async()=>{} },
    },
  };
</script>`);

// Gancho de teste: expõe as variáveis léxicas do script principal.
html = html.replace('</body>', `<script>
  window.__t = {
    get curMatch(){return curMatch}, set curMatch(v){curMatch=v},
    get geoOk(){return geoOk},
    get gpsAviso(){return gpsAviso}, set gpsAviso(v){gpsAviso=v},
    get coolUntil(){return coolUntil}, set coolUntil(v){coolUntil=v},
    set geoLast(v){geoLast=v},          // envelhece o último fix sem esperar 90 s
    get punching(){return punching},
    get OPTS(){return OPTS},
    doPunch, setPunchBtn, dbAll, setCfg, onGeoErr, onGeoOk,
    showGpsModal, dispensaGps, avisaSemGeo,
  };
</script></body>`);

// ── Estado controlável do aparelho ───────────────────────────────────────────
let geoMode = 'off';   // 'off' = sem fix (code 2) | 'ok' = localização funcionando
let netMode = true;    // navigator.onLine
const POS = { coords:{ latitude:-19.9167, longitude:-43.9345, accuracy:12 } };

function geoImpl(ok, err) {
  if (geoMode === 'ok') { setTimeout(()=>ok(POS), 0); return; }
  setTimeout(()=>err({ code:2, message:'Position unavailable' }), 0);
}

const vc = new VirtualConsole();
const erros = [];
vc.on('jsdomError', e => erros.push(String(e.message || e)));
vc.on('error', (...a) => erros.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost:8765/',
  virtualConsole: vc,
  beforeParse(w) {
    w.indexedDB = global.indexedDB;
    w.IDBKeyRange = global.IDBKeyRange;
    Object.defineProperty(w.navigator, 'geolocation', {
      value: {
        getCurrentPosition: geoImpl,
        watchPosition: (ok, err) => { geoImpl(ok, err); return 1; },
        clearWatch: () => {},
      }, configurable: true,
    });
    Object.defineProperty(w.navigator, 'mediaDevices', {
      value: { getUserMedia: async () => { throw new Error('sem câmera no teste'); } },
      configurable: true,
    });
    Object.defineProperty(w.navigator, 'onLine', { get: () => netMode, configurable: true });
    w.fetch = () => Promise.resolve({ ok:true, json: async () => ({ ok:true, saved:0 }) });
    w.matchMedia = () => ({ matches:false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
  },
});

const w = dom.window;
const $ = id => w.document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));

let falhas = 0;
function ok(cond, nome, extra='') {
  console.log((cond ? '  ✅ ' : '  ❌ ') + nome + (cond ? '' : '  → ' + extra));
  if (!cond) falhas++;
}

(async () => {
  await sleep(900);   // deixa init() rodar

  console.log('\n【0】 Carregamento');
  ok($('loading').style.display === 'none', 'tela de carregamento sai', $('loading').style.display);
  ok(w.__t.OPTS !== null, 'OPTS é criado depois dos modelos, não no topo do script');

  console.log('\n【1】 COM rede + localização desligada — AVISA, mas libera o registro');
  ok($('gpsModal').classList.contains('on'), 'modal central de localização aparece',
     'classes=' + $('gpsModal').className);
  ok($('gpsTitle').textContent.includes('desligada'), 'título diz "Localização desligada"',
     $('gpsTitle').textContent);
  ok(/SEM coordenadas/.test($('gpsTxt').textContent), 'texto avisa que o ponto vai sem coordenadas',
     $('gpsTxt').textContent);
  ok($('gpsSkip') && $('gpsSkip').textContent.includes('Continuar sem localização'),
     'modal oferece a saída "Continuar sem localização"');
  ok(w.__t.geoOk === false, 'geoOk = false');
  ok($('geoWarn').classList.contains('on'), 'faixa amarela aparece na tela do ponto');

  // Simula rosto reconhecido e pede o estado do botão.
  w.__t.curMatch = { name:'Maria Silva', distance:0.3 };
  await w.__t.setPunchBtn(w.__t.curMatch);
  ok($('btnPunch').disabled === false, 'botão de ponto fica LIBERADO mesmo com rede e sem GPS');
  ok(/sem localização/.test($('btnPunch').textContent), 'botão avisa que vai sem localização',
     $('btnPunch').textContent);
  ok($('btnPunch').className.includes('nogeo'), 'botão usa a cor de alerta', $('btnPunch').className);

  await w.__t.setCfg('loc', 'Fazenda Exemplo');
  await w.__t.doPunch();
  await sleep(400);
  let regs = await w.__t.dbAll('punches');
  ok(regs.length === 1, 'doPunch() GRAVA mesmo sem localização', 'gravou ' + regs.length);
  const r1 = regs[0] || {};
  ok(r1.type === 'entry', 'primeiro registro do dia é Entrada', r1.type);
  ok(r1.lat === null && r1.lon === null, 'gravado sem coordenadas', r1.lat + ',' + r1.lon);
  ok(r1.semLocal === true, 'marcado com semLocal', r1.semLocal);
  ok(r1.locationName === 'Fazenda Exemplo', 'local configurado continua valendo', r1.locationName);

  console.log('\n【2】 Aviso dispensado — não volta a interromper sozinho');
  w.__t.dispensaGps();
  ok(!$('gpsModal').classList.contains('on'), 'modal fecha ao "Continuar sem localização"');
  ok($('geoWarn').classList.contains('on'), 'faixa amarela CONTINUA — a falta segue visível');
  w.__t.geoLast = 0;
  w.__t.onGeoErr({ code:2, message:'Position unavailable' });
  await sleep(150);
  ok(!$('gpsModal').classList.contains('on'), 'nova falha de GPS não reabre o modal dispensado');
  w.__t.showGpsModal(null, false, true);
  ok($('gpsModal').classList.contains('on'), 'toque na faixa amarela reabre o modal (force)');
  w.__t.dispensaGps();

  console.log('\n【3】 Localização LIGADA — grava com coordenadas');
  geoMode = 'ok';
  w.__t.coolUntil = 0;
  w.__t.onGeoOk({ coords: POS.coords });
  ok(w.__t.geoOk === true, 'geoOk = true após um fix válido');
  ok(!$('gpsModal').classList.contains('on'), 'modal some sozinho');
  ok(!$('geoWarn').classList.contains('on'), 'faixa amarela some');
  ok(w.__t.gpsAviso === false, 'aviso é rearmado — se cair de novo, avisa de novo');

  await w.__t.setPunchBtn(w.__t.curMatch);
  ok($('btnPunch').disabled === false, 'botão libera');
  ok(/Registrar Saída/.test($('btnPunch').textContent), 'agora o próximo é Saída',
     $('btnPunch').textContent);
  ok(!$('btnPunch').className.includes('nogeo'), 'botão volta à cor normal');

  await w.__t.doPunch();
  await sleep(400);
  regs = await w.__t.dbAll('punches');
  ok(regs.length === 2, 'gravou o 2º registro', 'gravou ' + regs.length);
  const r2 = regs[1] || {};
  ok(r2.type === 'exit', 'tipo = exit', r2.type);
  ok(r2.lat === -19.916700 && r2.lon === -43.934500, 'lat/lon gravados', r2.lat + ',' + r2.lon);
  ok(r2.accuracy === 12, 'precisão gravada', r2.accuracy);
  ok(r2.semLocal === false, 'não marcado como semLocal', r2.semLocal);
  ok(r2.synced === false, 'marcado como pendente de envio');

  console.log('\n【4】 Toque duplo — a carência precisa segurar');
  await w.__t.doPunch();                      // segundo toque imediato
  await sleep(300);
  regs = await w.__t.dbAll('punches');
  ok(regs.length === 2, 'segundo toque imediato é ignorado', 'agora há ' + regs.length);
  await w.__t.setPunchBtn(w.__t.curMatch);
  ok($('btnPunch').disabled === true && /aguarde/.test($('btnPunch').textContent),
     'botão mostra a carência', $('btnPunch').textContent);

  console.log('\n【5】 Permissão NEGADA — avisa com o passo a passo, e ainda assim libera');
  geoMode = 'off';
  w.__t.coolUntil = 0;
  w.__t.onGeoErr({ code:1, message:'User denied Geolocation' });
  await sleep(200);
  ok(w.__t.geoOk === false, 'geoOk = false');
  ok($('gpsModal').classList.contains('on'), 'modal sobe');
  ok($('gpsTitle').textContent.includes('bloqueada'), 'texto muda para permissão negada',
     $('gpsTitle').textContent);
  ok(/Android|iPhone/.test($('gpsHelp').textContent), 'mostra o passo a passo do aparelho');
  ok($('geoWarn').classList.contains('on'), 'faixa amarela aparece');

  await w.__t.setPunchBtn(w.__t.curMatch);
  ok($('btnPunch').disabled === false, 'botão continua liberado com a permissão negada');
  await w.__t.doPunch();
  await sleep(400);
  regs = await w.__t.dbAll('punches');
  ok(regs.length === 3, 'gravou o 3º registro', 'há ' + regs.length);
  ok((regs[2]||{}).lat === null && (regs[2]||{}).semLocal === true,
     '3º registro sem coordenadas e carimbado');

  console.log('\n【6】 Sem sinal (offline) — mesmo comportamento, nada de sondagem de rede');
  netMode = false;
  w.__t.coolUntil = 0;
  w.__t.geoLast = 0;
  w.__t.onGeoErr({ code:2, message:'Position unavailable' });
  await sleep(200);
  await w.__t.setPunchBtn(w.__t.curMatch);
  ok($('btnPunch').disabled === false, 'botão liberado offline');
  await w.__t.doPunch();
  await sleep(400);
  regs = await w.__t.dbAll('punches');
  ok(regs.length === 4, 'gravou o 4º registro offline', 'há ' + regs.length);

  console.log('\n【7】 Erros de JavaScript');
  ok(erros.length === 0, 'nenhum erro no console', erros.join(' | '));

  console.log('\n' + (falhas ? `❌ ${falhas} falha(s)` : '✅ todos os testes passaram'));
  process.exit(falhas ? 1 : 0);
})();
