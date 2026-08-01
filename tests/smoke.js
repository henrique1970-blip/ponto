// Smoke test do Ponto Digital em DOM simulado.
// Foco: a política de localização (bloqueia com rede, libera sem rede) e a
// proteção contra registro duplo.
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
    get semRede(){return semRede},
    get coolUntil(){return coolUntil}, set coolUntil(v){coolUntil=v},
    set geoLast(v){geoLast=v},          // envelhece o último fix sem esperar 90 s
    set netAt(v){netAt=v},              // invalida o veredito de rede guardado
    get punching(){return punching},
    podeRegistrar, temRede,
    doPunch, setPunchBtn, dbAll, setCfg, onGeoErr, onGeoOk, showGpsModal,
  };
</script></body>`);

// ── Estado controlável do aparelho ───────────────────────────────────────────
let geoMode = 'off';   // 'off' = sem fix (code 2) | 'ok' = localização funcionando
let netMode = true;    // navigator.onLine — o que o navegador ACHA da rede
let fetchOk = true;    // se a sondagem de rede realmente completa
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
    w.fetch = () => fetchOk
      ? Promise.resolve({ ok:true, json: async () => ({ ok:true, saved:0 }) })
      : Promise.reject(new Error('sem rede'));
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

  console.log('\n【1】 COM rede + localização desligada — deve travar o registro');
  ok($('gpsModal').classList.contains('on'), 'modal central de localização aparece',
     'classes=' + $('gpsModal').className);
  ok($('gpsTitle').textContent.includes('desligada'), 'título diz "Localização desligada"',
     $('gpsTitle').textContent);
  ok(w.__t.geoOk === false, 'geoOk = false');
  ok(w.__t.semRede === false, 'semRede = false (o aparelho tem rede)');
  ok(w.__t.podeRegistrar() === false, 'podeRegistrar() = false');
  ok(!$('geoWarn').classList.contains('on'), 'aviso amarelo NÃO aparece — aqui é bloqueio');

  // Simula rosto reconhecido e pede o estado do botão.
  w.__t.curMatch = { name:'Maria Silva', distance:0.3 };
  await w.__t.setPunchBtn(w.__t.curMatch);
  ok($('btnPunch').disabled === true, 'botão de ponto fica desabilitado');
  ok($('btnPunch').textContent.includes('Ative a localização'), 'botão pede para ativar a localização',
     $('btnPunch').textContent);

  await w.__t.doPunch();
  await sleep(300);
  let regs = await w.__t.dbAll('punches');
  ok(regs.length === 0, 'doPunch() NÃO grava nada com localização desligada',
     'gravou ' + regs.length);

  console.log('\n【2】 Localização LIGADA — deve liberar e gravar com coordenadas');
  geoMode = 'ok';
  await w.__t.setCfg('loc', 'Fazenda Exemplo');
  w.__t.onGeoOk({ coords: POS.coords });
  ok(w.__t.geoOk === true, 'geoOk = true após um fix válido');
  ok(!$('gpsModal').classList.contains('on'), 'modal some sozinho');

  await w.__t.setPunchBtn(w.__t.curMatch);
  ok($('btnPunch').disabled === false, 'botão libera');
  ok($('btnPunch').textContent.includes('Registrar Entrada'), 'primeiro registro do dia é Entrada',
     $('btnPunch').textContent);

  await w.__t.doPunch();
  await sleep(300);
  regs = await w.__t.dbAll('punches');
  ok(regs.length === 1, 'gravou 1 registro', 'gravou ' + regs.length);
  const r = regs[0] || {};
  ok(r.type === 'entry', 'tipo = entry', r.type);
  ok(r.lat === -19.916700 && r.lon === -43.934500, 'lat/lon gravados', r.lat + ',' + r.lon);
  ok(r.accuracy === 12, 'precisão gravada', r.accuracy);
  ok(r.locationName === 'Fazenda Exemplo', 'nome do local gravado', r.locationName);
  ok(r.synced === false, 'marcado como pendente de envio');

  console.log('\n【3】 Toque duplo — a carência precisa segurar');
  await w.__t.doPunch();                      // segundo toque imediato
  await sleep(300);
  regs = await w.__t.dbAll('punches');
  ok(regs.length === 1, 'segundo toque imediato é ignorado', 'agora há ' + regs.length);
  await w.__t.setPunchBtn(w.__t.curMatch);
  ok($('btnPunch').disabled === true && /aguarde/.test($('btnPunch').textContent),
     'botão mostra a carência', $('btnPunch').textContent);

  console.log('\n【4】 SEM rede + sem localização — libera, mas sem coordenadas');
  geoMode = 'off';  netMode = false;  fetchOk = false;
  w.__t.coolUntil = 0;          // dispensa a carência do teste anterior
  w.__t.geoLast   = 0;          // envelhece o fix de 【2】
  w.__t.netAt     = 0;
  w.__t.onGeoErr({ code:2, message:'Position unavailable' });
  await sleep(200);
  ok(w.__t.geoOk === false && w.__t.semRede === true, 'entra no estado "sem rede"',
     `geoOk=${w.__t.geoOk} semRede=${w.__t.semRede}`);
  ok(w.__t.podeRegistrar() === true, 'podeRegistrar() = true');
  ok(!$('gpsModal').classList.contains('on'), 'modal bloqueante NÃO sobe');
  ok($('geoWarn').classList.contains('on'), 'aviso amarelo aparece na tela');

  await w.__t.setPunchBtn(w.__t.curMatch);
  ok($('btnPunch').disabled === false, 'botão libera mesmo sem localização');
  ok(/sem localização/.test($('btnPunch').textContent), 'botão avisa que vai sem localização',
     $('btnPunch').textContent);
  ok($('btnPunch').className.includes('nogeo'), 'botão usa a cor de alerta',
     $('btnPunch').className);

  await w.__t.doPunch();
  await sleep(400);
  regs = await w.__t.dbAll('punches');
  ok(regs.length === 2, 'gravou o 2º registro', 'há ' + regs.length);
  const r2 = regs[1] || {};
  ok(r2.lat === null && r2.lon === null, 'gravado sem coordenadas', r2.lat + ',' + r2.lon);
  ok(r2.semLocal === true, 'marcado com semLocal', r2.semLocal);
  ok(r2.timestamp && r2.locationName === 'Fazenda Exemplo', 'horário e local continuam valendo');

  console.log('\n【5】 Permissão NEGADA sem rede — bloqueia mesmo assim');
  w.__t.coolUntil = 0;
  w.__t.onGeoErr({ code:1, message:'User denied Geolocation' });
  await sleep(200);
  ok(w.__t.semRede === false, 'a exceção do modo sem rede não vale para permissão negada');
  ok(w.__t.podeRegistrar() === false, 'podeRegistrar() = false');
  ok($('gpsModal').classList.contains('on'), 'modal sobe de novo');
  ok($('gpsTitle').textContent.includes('bloqueada'), 'texto muda para permissão negada',
     $('gpsTitle').textContent);
  ok(/Android|iPhone/.test($('gpsHelp').textContent), 'mostra o passo a passo do aparelho');
  ok(!$('geoWarn').classList.contains('on'), 'aviso amarelo some');

  await w.__t.doPunch();
  await sleep(300);
  regs = await w.__t.dbAll('punches');
  ok(regs.length === 2, 'nada foi gravado com a permissão negada', 'há ' + regs.length);

  console.log('\n【6】 navigator.onLine mente — a sondagem desempata');
  await w.__t.setCfg('webhook', 'https://script.google.com/macros/s/AKfake/exec');
  netMode = true;   // o navegador diz que há rede…
  fetchOk = false;  // …mas nada trafega (Wi-Fi sem internet, zona morta)
  w.__t.coolUntil = 0;
  w.__t.geoLast   = 0;
  w.__t.netAt     = 0;
  ok((await w.__t.temRede()) === false, 'temRede() confia na sondagem, não no onLine');
  w.__t.netAt = 0;
  w.__t.onGeoErr({ code:2, message:'Position unavailable' });
  await sleep(300);
  ok(w.__t.semRede === true, 'libera o registro apesar de onLine=true');
  await w.__t.doPunch();
  await sleep(400);
  regs = await w.__t.dbAll('punches');
  ok(regs.length === 3, 'gravou o 3º registro', 'há ' + regs.length);
  ok((regs[2]||{}).lat === null, '3º registro também sem coordenadas');

  console.log('\n【7】 Erros de JavaScript');
  ok(erros.length === 0, 'nenhum erro no console', erros.join(' | '));

  console.log('\n' + (falhas ? `❌ ${falhas} falha(s)` : '✅ todos os testes passaram'));
  process.exit(falhas ? 1 : 0);
})();
