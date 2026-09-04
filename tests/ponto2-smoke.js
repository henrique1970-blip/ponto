// Carrega o ponto2/index.html DE VERDADE num navegador simulado (jsdom) e
// dirige o registro do começo ao fim: o que a tela diz e o que entra no banco.
//
// O ponto2 é um app de SAÍDA. Quem está marcado como "entrada e saída" no
// cadastro alterna; todo o resto do quadro continua registrando só a saída,
// com a trava de 12h de sempre. Este teste cobre os dois lados no mesmo boot —
// é onde um `type` trocado apareceria antes de virar linha errada na folha.
//
// A regra em si (sem tela) tem teste próprio em `ponto2-regra.test.js`.
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
require('fake-indexeddb/auto');

const ROOT = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(ROOT, 'ponto2', 'index.html'), 'utf8');

html = html.replace(/<script src="https:\/\/cdn\.jsdelivr[^"]*"><\/script>/, `<script>
  window.faceapi = {
    TinyFaceDetectorOptions: function(){},
    detectSingleFace: async () => null,
    nets: {
      tinyFaceDetector:     { loadFromUri: async()=>{} },
      faceLandmark68TinyNet:{ loadFromUri: async()=>{} },
      faceRecognitionNet:   { loadFromUri: async()=>{} },
    },
  };
</script>`);

html = html.replace('</body>', `<script>
  window.__t = {
    get mode(){return mode}, set mode(v){mode=v},
    get curMatch(){return curMatch},
    get users(){return users},
    set liveOn(v){liveOn=v}, set gestureOn(v){gestureOn=v},
    enterConfirm, confirmPunch, planoDoRegistro, dbPut, dbAll,
    loadUsers, renderPlog, renderUserList, updTitulo,
  };
</script></body>`);

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
      value: { getCurrentPosition: (ok,err) => setTimeout(()=>err({code:2}),0) },
      configurable: true,
    });
    Object.defineProperty(w.navigator, 'mediaDevices', {
      value: { getUserMedia: async () => { throw new Error('sem câmera no teste'); } },
      configurable: true,
    });
    Object.defineProperty(w.navigator, 'onLine', { get: () => false, configurable: true });
    w.fetch = () => Promise.reject(new Error('sem rede'));
    w.matchMedia = () => ({ matches:false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
    // jsdom sem o pacote `canvas` devolve null em getContext — nada a ver com o app.
    w.HTMLCanvasElement.prototype.getContext = () => ({
      clearRect(){}, drawImage(){}, fillRect(){}, getImageData:()=>({data:[]}),
    });
    w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,x';
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

// Espera o boot pela condição, não pelo relógio: num disco lento uma espera
// fixa vira falha intermitente na primeira asserção.
async function esperaBoot(limite = 8000) {
  const ate = Date.now() + limite;
  while (Date.now() < ate) {
    if ($('loading') && $('loading').style.display === 'none') return true;
    await sleep(50);
  }
  return false;
}

(async () => {
  await esperaBoot();
  await sleep(60);

  console.log('\n【1】 Abre normalmente');
  ok($('loading').style.display === 'none', 'sai da tela de carregamento');
  ok($('appTitle').textContent.includes('Saída'),
     'sem ninguém marcado, o título continua "Registro de Saída"', $('appTitle').textContent);

  console.log('\n【2】 Funcionário marcado como entrada+saída');
  w.__t.liveOn    = false;     // sem câmera não há como provar vivacidade
  w.__t.gestureOn = false;
  await w.__t.dbPut('users', { name:'Beto Duplo', descs:[[0,1]], thumb:'', duplo:true,
                               at:new Date().toISOString() });
  await w.__t.loadUsers();
  w.__t.updTitulo();
  ok($('appTitle').textContent.includes('Ponto'),
     'o título passa a "Registro de Ponto"', $('appTitle').textContent);

  const user  = w.__t.users.find(u => u.name === 'Beto Duplo');
  let plano = await w.__t.planoDoRegistro(user);
  ok(plano.type === 'entry', 'a primeira marcação dele é Entrada');

  w.__t.enterConfirm({ name:user.name, type:plano.type, duplo:true, dist:0.2,
                       margem:0.3, thumb:'', id:user.id, desc:[0,1] });
  await sleep(80);
  ok(w.document.querySelector('#confirmOv .co-hi').textContent === 'Confirmar entrada',
     'a tela diz "Confirmar entrada"', w.document.querySelector('#confirmOv .co-hi').textContent);
  ok($('btnPunch').textContent === '✔ CONFIRMAR ENTRADA',
     'o botão diz CONFIRMAR ENTRADA', $('btnPunch').textContent);

  await w.__t.confirmPunch('botao');
  await sleep(400);
  let regs = await w.__t.dbAll('punches');
  ok(regs.length === 1, 'gravou 1 registro', 'há ' + regs.length);
  ok((regs[0]||{}).type === 'entry', 'gravado como type=entry', JSON.stringify(regs[0]||{}));
  ok($('doneSub').textContent.startsWith('Entrada registrada'),
     'a tela de sucesso diz Entrada', $('doneSub').textContent);

  await w.__t.renderPlog();
  ok($('plogList').textContent.includes('Entrada'),
     'a lista de pendentes mostra Entrada', $('plogList').textContent.trim());

  console.log('\n【3】 A saída é a próxima — mas não nos 5 primeiros minutos');
  plano = await w.__t.planoDoRegistro(user);
  ok(plano.type === 'exit' && !!plano.block,
     'logo após a entrada: Saída travada pelo intervalo curto');

  // Envelhece a entrada em 30min e tenta de novo.
  regs[0].timestamp = new Date(Date.now() - 30*60e3).toISOString();
  await w.__t.dbPut('punches', regs[0]);
  plano = await w.__t.planoDoRegistro(user);
  ok(plano.type === 'exit' && !plano.block, 'meia hora depois: Saída liberada');

  w.__t.mode = 'scanning';
  w.__t.enterConfirm({ name:user.name, type:plano.type, duplo:true, dist:0.2,
                       margem:0.3, thumb:'', id:user.id, desc:[0,1] });
  await sleep(80);
  ok($('btnPunch').textContent === '✔ CONFIRMAR SAÍDA', 'agora o botão diz CONFIRMAR SAÍDA',
     $('btnPunch').textContent);
  await w.__t.confirmPunch('botao');
  await sleep(400);
  regs = await w.__t.dbAll('punches');
  ok(regs.length === 2, 'gravou o 2º registro', 'há ' + regs.length);
  ok((regs[1]||{}).type === 'exit', '2º gravado como type=exit', JSON.stringify(regs[1]||{}).slice(0,120));

  console.log('\n【4】 Quem NÃO está marcado continua só na saída');
  await w.__t.dbPut('users', { name:'Ana Saida', descs:[[1,0]], thumb:'',
                               at:new Date().toISOString() });
  await w.__t.loadUsers();
  const ana = w.__t.users.find(u => u.name === 'Ana Saida');
  plano = await w.__t.planoDoRegistro(ana);
  ok(plano.type === 'exit' && !plano.block, 'primeira marcação dela é Saída, liberada');
  w.__t.mode = 'scanning';
  w.__t.enterConfirm({ name:ana.name, type:plano.type, duplo:false, dist:0.2,
                       margem:0.3, thumb:'', id:ana.id, desc:[1,0] });
  await sleep(80);
  ok($('btnPunch').textContent === '✔ CONFIRMAR SAÍDA', 'o botão dela diz CONFIRMAR SAÍDA');
  await w.__t.confirmPunch('botao');
  await sleep(400);
  regs = await w.__t.dbAll('punches');
  ok(regs.filter(r=>r.userName==='Ana Saida')[0].type === 'exit', 'gravou saída para ela');
  plano = await w.__t.planoDoRegistro(ana);
  ok(plano.type === 'exit' && !!plano.block, 'e a trava de 12h dela continua valendo');

  console.log('\n【5】 Erros de JavaScript');
  ok(erros.length === 0, 'nenhum erro no console', erros.join(' | '));

  console.log('\n' + (falhas ? `❌ ${falhas} falha(s)` : '✅ todos os testes passaram'));
  process.exit(falhas ? 1 : 0);
})();
