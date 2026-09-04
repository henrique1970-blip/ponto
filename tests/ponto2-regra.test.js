// Testa a regra de entrada/saída do ponto2 (planoDoRegistro) extraída do
// ponto2/index.html DE VERDADE e executada numa VM do Node — sem jsdom, sem
// câmera, sem face-api: só a decisão "o que esta pessoa registra agora".
//
// É a peça de risco da mudança. O app é de SAÍDA por padrão e continua sendo
// para todo mundo; só quem está marcado com `duplo` no cadastro alterna entre
// entrada e saída. Errar aqui é gravar o tipo errado na planilha da folha.
const fs   = require('fs');
const vm   = require('vm');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'ponto2', 'index.html'), 'utf8');

// Recorta a seção da regra. Os marcadores são os cabeçalhos de seção do próprio
// arquivo — se alguém renomear a seção, o teste falha alto em vez de testar nada.
const INI = '// ─── O QUE ESTA PESSOA REGISTRA AGORA';
const FIM = '// ─── CONFIRMAÇÃO';
const i = SRC.indexOf(INI), f = SRC.indexOf(FIM);
if (i < 0 || f < 0 || f < i) {
  console.log('❌ não achei a seção da regra em ponto2/index.html — o teste não testou nada');
  process.exit(1);
}
const REGRA = SRC.slice(i, f);

// ── Estado do "app" que a regra enxerga ──────────────────────────────────────
let punches  = [];
let minHours = 12;
let jornadaH = 16;
let minEntre = 5;

const ctx = vm.createContext({
  get minHours(){ return minHours; },
  get jornadaH(){ return jornadaH; },
  get minEntre(){ return minEntre; },
  dbAll: async () => punches,
  Date, console,
});
vm.runInContext(REGRA, ctx);

const h   = n => new Date(Date.now() - n * 3600e3).toISOString();
const min = n => new Date(Date.now() - n * 60e3).toISOString();
const reg = (userName, type, timestamp) => ({ userName, type, timestamp });

let falhas = 0;
function ok(cond, nome, extra = '') {
  console.log((cond ? '  ✅ ' : '  ❌ ') + nome + (cond ? '' : '  → ' + extra));
  if (!cond) falhas++;
}
const plano = user => ctx.planoDoRegistro(user);

const SO_SAIDA = { name: 'Ana Só-Saída', duplo: false };
const DUPLO    = { name: 'Beto Duplo',   duplo: true  };

(async () => {

  console.log('\n【1】 Quem não está marcado continua igual: só saída');
  punches = [];
  let p = await plano(SO_SAIDA);
  ok(p.type === 'exit' && !p.block, 'sem histórico → Saída, liberada', JSON.stringify(p));

  punches = [reg(SO_SAIDA.name, 'exit', h(2))];
  p = await plano(SO_SAIDA);
  ok(p.type === 'exit' && !!p.block, 'saída há 2h → Saída, travada (12h)');
  ok(ctx.blockMsg(p.block).startsWith('Saída já registrada'),
     'a mensagem fala da saída anterior', ctx.blockMsg(p.block));

  punches = [reg(SO_SAIDA.name, 'exit', h(13))];
  p = await plano(SO_SAIDA);
  ok(p.type === 'exit' && !p.block, 'saída há 13h → Saída, liberada');

  // A trava velha olhava a última marcação de qualquer tipo. Para quem é só de
  // saída não há entrada nenhuma no histórico — o comportamento tem que ser
  // idêntico ao de antes, e este caso cobre isso.
  punches = [reg(SO_SAIDA.name, 'exit', h(30)), reg(SO_SAIDA.name, 'exit', h(1))];
  p = await plano(SO_SAIDA);
  ok(p.type === 'exit' && !!p.block, 'vale a saída MAIS RECENTE, não a primeira');

  console.log('\n【2】 Marcado como entrada+saída: alterna');
  punches = [];
  p = await plano(DUPLO);
  ok(p.type === 'entry' && !p.block, 'sem histórico → Entrada, liberada');

  punches = [reg(DUPLO.name, 'entry', min(1))];
  p = await plano(DUPLO);
  ok(p.type === 'exit' && !!p.block, 'entrada há 1min → Saída, travada (5min)');
  ok(ctx.blockMsg(p.block).startsWith('Entrada já registrada'),
     'a mensagem fala da entrada, não de uma saída', ctx.blockMsg(p.block));

  punches = [reg(DUPLO.name, 'entry', min(30))];
  p = await plano(DUPLO);
  ok(p.type === 'exit' && !p.block, 'entrada há 30min → Saída, liberada');

  punches = [reg(DUPLO.name, 'entry', h(9)), reg(DUPLO.name, 'exit', h(1))];
  p = await plano(DUPLO);
  ok(p.type === 'entry' && !!p.block, 'jornada fechada há 1h → Entrada, travada (12h)');

  punches = [reg(DUPLO.name, 'entry', h(21)), reg(DUPLO.name, 'exit', h(13))];
  p = await plano(DUPLO);
  ok(p.type === 'entry' && !p.block, 'jornada fechada há 13h → Entrada, liberada');

  console.log('\n【3】 Turno noturno — entra 23:00, sai 04:00 do dia seguinte');
  // O timestamp é cravado em OUTRO dia civil de propósito: é exatamente onde a
  // regra por dia falhava no app da raiz.
  const vespera = new Date();
  vespera.setDate(vespera.getDate() - 1);
  vespera.setHours(23, 0, 0, 0);
  const decorrido = (Date.now() - vespera.getTime()) / 3600e3;

  punches  = [reg(DUPLO.name, 'entry', vespera.toISOString())];
  jornadaH = Math.ceil(decorrido) + 1;          // a jornada ainda cabe na janela
  p = await plano(DUPLO);
  ok(p.type === 'exit' && !p.block,
     'entrada de ontem 23:00, dentro da jornada → Saída',
     'faz ' + decorrido.toFixed(1) + 'h');

  console.log('\n【4】 Saída esquecida não pode prender ninguém');
  jornadaH = Math.max(1, Math.floor(decorrido) - 1);   // jornada estourada
  p = await plano(DUPLO);
  ok(p.type === 'entry' && !p.block,
     'entrada além da janela → Entrada de novo, sem trava');
  jornadaH = 16;

  console.log('\n【5】 Bordas');
  punches = [reg('Outra Pessoa', 'entry', min(2)), reg(DUPLO.name, 'exit', h(20))];
  p = await plano(DUPLO);
  ok(p.type === 'entry' && !p.block, 'o histórico de outra pessoa não interfere');

  punches  = [reg(SO_SAIDA.name, 'exit', min(1))];
  minHours = 0;                                  // trava desligada
  p = await plano(SO_SAIDA);
  ok(p.type === 'exit' && !p.block, 'minHours = 0 desliga a trava, como antes');
  minHours = 12;

  punches = [reg(DUPLO.name, 'entry', min(1))];
  minEntre = 0;
  p = await plano(DUPLO);
  ok(p.type === 'exit' && !p.block, 'minEntre = 0 desliga o intervalo curto');
  minEntre = 5;

  // Cadastro antigo não tem o campo `duplo` — tem que continuar só-saída.
  punches = [];
  p = await plano({ name: 'Cadastro Antigo' });
  ok(p.type === 'exit', 'usuário sem o campo `duplo` continua só-saída');

  console.log('\n' + (falhas ? `❌ ${falhas} falha(s)` : '✅ todos os testes passaram'));
  process.exit(falhas ? 1 : 0);
})();
