// Testa a regra de entrada/saída do ponto2 (planoDoRegistro) extraída do
// ponto2/index.html DE VERDADE e executada numa VM do Node — sem jsdom, sem
// câmera, sem face-api: só a decisão "o que esta pessoa registra agora".
//
// É a peça de risco da mudança. O app registra ENTRADA E SAÍDA para todo mundo:
// a primeira marcação da jornada é a entrada, a seguinte é a saída. A jornada
// admite INTERVALOS — sair e voltar dentro de `pausaMax` é almoço/café, não
// jornada nova. Quem está marcado com `plantao` vai e volta sem esse limite.
// Errar aqui é gravar o tipo errado na planilha da folha.
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
let pausaMax = 4;

// Relógio simulado. `NOW = null` usa a hora real — é assim que roda a maior
// parte do arquivo; os testes que dependem do dia civil cravam um instante.
let NOW = null;
class FakeDate extends Date {
  constructor(...a) { if (a.length === 0) super(NOW === null ? Date.now() : NOW); else super(...a); }
  static now() { return NOW === null ? Date.now() : NOW; }
}

const ctx = vm.createContext({
  get minHours(){ return minHours; },
  get jornadaH(){ return jornadaH; },
  get minEntre(){ return minEntre; },
  get pausaMax(){ return pausaMax; },
  dbAll: async () => punches,
  Date: FakeDate, console,
});
vm.runInContext(REGRA, ctx);

const h   = n => new Date(Date.now() - n * 3600e3).toISOString();
const min = n => new Date(Date.now() - n * 60e3).toISOString();
const reg = (userName, type, timestamp) => ({ userName, type, timestamp });

// Instante cravado — para tudo que depende de qual DIA CIVIL a marcação caiu.
// Com o relógio real esses casos viram falha intermitente perto da meia-noite.
const dia = (d, hh, mm, ss = 0) => new Date(2026, 8, d, hh, mm, ss).getTime();
const em  = ms => { NOW = ms; };

let falhas = 0;
function ok(cond, nome, extra = '') {
  console.log((cond ? '  ✅ ' : '  ❌ ') + nome + (cond ? '' : '  → ' + extra));
  if (!cond) falhas++;
}
const plano = user => ctx.planoDoRegistro(user);

const PESSOA  = { name: 'Beto' };                       // funcionário comum
const PLANTAO = { name: 'Lincon', plantao: true };

const marca = (type, ms, quem = PESSOA.name) => reg(quem, type, new Date(ms).toISOString());

(async () => {

  console.log('\n【1】 Todo mundo alterna: entrada, depois saída');
  punches = [];
  let p = await plano(PESSOA);
  ok(p.type === 'entry' && !p.block, 'sem histórico → Entrada, liberada', JSON.stringify(p));

  punches = [reg(PESSOA.name, 'entry', min(1))];
  p = await plano(PESSOA);
  ok(p.type === 'exit' && !!p.block, 'entrada há 1min → Saída, travada (5min)');
  ok(ctx.blockMsg(p.block).startsWith('Entrada já registrada'),
     'a mensagem fala da entrada, não de uma saída', ctx.blockMsg(p.block));

  punches = [reg(PESSOA.name, 'entry', min(30))];
  p = await plano(PESSOA);
  ok(p.type === 'exit' && !p.block, 'entrada há 30min → Saída, liberada');

  punches = [reg(PESSOA.name, 'entry', h(9)), reg(PESSOA.name, 'exit', h(1))];
  p = await plano(PESSOA);
  ok(p.type === 'entry' && !p.block,
     'saída há 1h → Entrada liberada: é volta de intervalo, não jornada nova');

  // Passada a pausa máxima, dentro do mesmo dia, aí sim é jornada nova.
  em(dia(8, 15, 0));
  punches = [marca('entry', dia(8, 6, 0)), marca('exit', dia(8, 9, 0))];
  p = await plano(PESSOA);
  ok(p.type === 'entry' && !!p.block,
     'saída 09:00 e volta 15:00 (6h) → jornada nova, travada pelas 12h');
  NOW = null;

  punches = [reg(PESSOA.name, 'entry', h(21)), reg(PESSOA.name, 'exit', h(13))];
  p = await plano(PESSOA);
  ok(p.type === 'entry' && !p.block, 'jornada fechada há 13h → Entrada, liberada');

  // A regra olha a marcação MAIS RECENTE, não a primeira do histórico.
  punches = [reg(PESSOA.name, 'exit', h(30)), reg(PESSOA.name, 'entry', h(1))];
  p = await plano(PESSOA);
  ok(p.type === 'exit' && !p.block, 'vale a marcação mais recente, não a primeira');

  console.log('\n【2】 Migração — quem só tinha saídas passa a bater entrada');
  // Antes desta mudança a maior parte do quadro registrava SÓ A SAÍDA. O banco
  // dessas pessoas é uma sequência de 'exit', sem nenhuma entrada. A próxima
  // marcação delas tem que ser a ENTRADA, não mais uma saída.
  em(dia(8, 10, 0));
  punches = [marca('exit', dia(6, 17, 0)), marca('exit', dia(7, 17, 30))];
  p = await plano(PESSOA);
  ok(p.type === 'entry' && !p.block, 'histórico só de saídas → a próxima é Entrada');

  // E a trava de 12h continua fazendo o seu papel dentro do dia.
  punches = [marca('exit', dia(8, 2, 0))];
  p = await plano(PESSOA);
  ok(p.type === 'entry' && !!p.block,
     'mas a saída de hoje às 02:00 ainda trava a entrada às 10:00 (8h > pausa)');
  NOW = null;

  console.log('\n【3】 Turno noturno — entra 23:00, sai 04:00 do dia seguinte');
  // O timestamp é cravado em OUTRO dia civil de propósito: é exatamente onde a
  // regra por dia falhava no app da raiz.
  const vespera = new Date();
  vespera.setDate(vespera.getDate() - 1);
  vespera.setHours(23, 0, 0, 0);
  const decorrido = (Date.now() - vespera.getTime()) / 3600e3;

  punches  = [reg(PESSOA.name, 'entry', vespera.toISOString())];
  jornadaH = Math.ceil(decorrido) + 1;          // a jornada ainda cabe na janela
  p = await plano(PESSOA);
  ok(p.type === 'exit' && !p.block,
     'entrada de ontem 23:00, dentro da jornada → Saída',
     'faz ' + decorrido.toFixed(1) + 'h');

  console.log('\n【4】 Saída esquecida não pode prender ninguém');
  jornadaH = Math.max(1, Math.floor(decorrido) - 1);   // jornada estourada
  p = await plano(PESSOA);
  ok(p.type === 'entry' && !p.block,
     'entrada além da janela → Entrada de novo, sem trava');
  jornadaH = 16;

  console.log('\n【5】 Bordas');
  punches = [reg('Outra Pessoa', 'entry', min(2)), reg(PESSOA.name, 'exit', h(20))];
  p = await plano(PESSOA);
  ok(p.type === 'entry' && !p.block, 'o histórico de outra pessoa não interfere');

  em(dia(8, 10, 0));
  punches  = [marca('exit', dia(8, 3, 0))];      // 7h: pausa longa, cai na trava longa
  minHours = 0;                                  // trava desligada
  p = await plano(PESSOA);
  ok(p.type === 'entry' && !p.block, 'minHours = 0 desliga a trava longa');
  minHours = 12;
  NOW = null;

  punches = [reg(PESSOA.name, 'entry', min(1))];
  minEntre = 0;
  p = await plano(PESSOA);
  ok(p.type === 'exit' && !p.block, 'minEntre = 0 desliga o intervalo curto');
  minEntre = 5;

  // Cadastro antigo não tem campo nenhum além do nome — alterna como todo mundo.
  punches = [];
  p = await plano({ name: 'Cadastro Antigo' });
  ok(p.type === 'entry', 'usuário sem os campos novos alterna normalmente');

  console.log('\n【6】 Corte de meia-noite — a jornada partida em dois dias');
  // A operação pode encerrar a jornada antes das 00:00 e reabrir depois, para
  // que cada dia da planilha feche com os pares completos. Isso é UMA jornada,
  // não duas: a trava de 12h entre jornadas não pode valer na virada, senão a
  // noite inteira se perde (a pessoa não reabre e nem consegue bater a saída).
  punches = [marca('entry', dia(7, 16, 0)), marca('exit', dia(7, 23, 50))];
  em(dia(8, 0, 5));
  p = await plano(PESSOA);
  ok(p.type === 'entry' && !p.block,
     'saída 23:50, reabertura 00:05 → Entrada liberada', JSON.stringify(p.block || {}));

  punches.push(marca('entry', dia(8, 0, 5)));
  em(dia(8, 8, 0));
  p = await plano(PESSOA);
  ok(p.type === 'exit' && !p.block, 'e às 08:00 a saída sai normalmente');

  // A trava longa continua valendo DENTRO do dia: sem isso, qualquer um
  // reabriria uma jornada nova logo depois de encerrar a sua.
  punches = [marca('entry', dia(7, 16, 0)), marca('exit', dia(7, 23, 50))];
  em(dia(7, 23, 52));
  p = await plano(PESSOA);
  ok(p.type === 'entry' && !!p.block,
     'reabrir 2min depois → travado pelo intervalo curto');

  // E a virada não pode virar atalho para o toque duplo: o intervalo curto
  // continua separando a saída da reabertura.
  punches = [marca('entry', dia(7, 16, 0)), marca('exit', dia(7, 23, 59, 50))];
  em(dia(8, 0, 0, 30));
  p = await plano(PESSOA);
  ok(p.type === 'entry' && !!p.block,
     'reabrir 40s depois, já no dia seguinte → travado pelo intervalo curto');

  // E quem NÃO cortar continua fechando o turno sozinho, como antes.
  punches = [marca('entry', dia(7, 23, 0))];
  em(dia(8, 4, 0));
  p = await plano(PESSOA);
  ok(p.type === 'exit' && !p.block,
     'sem corte: entrada 23:00 → às 04:00 ainda é Saída');

  console.log('\n【7】 Plantão — sair e voltar é o trabalho, não uma jornada nova');
  // Quem faz ronda (pivôs, chamado noturno) sai e volta várias vezes na mesma
  // noite. A trava de 12h pressupõe uma jornada por dia: barrava a volta e,
  // pior, deixava a marcação seguinte entrar com o tipo trocado.
  const noite = [
    [dia(7, 19,  0), 'entry', 'chega'],
    [dia(7, 21, 30), 'exit',  'sai para o pivô 3'],
    [dia(7, 22, 40), 'entry', 'volta'],
    [dia(8,  0, 10), 'exit',  'sai para o pivô 7'],
    [dia(8,  1, 20), 'entry', 'volta'],
    [dia(8,  5, 30), 'exit',  'fim do plantão'],
  ];
  punches = [];
  let okNoite = true, detalhe = '';
  for (const [ms, esperado, rotulo] of noite) {
    em(ms);
    const r = await plano(PLANTAO);
    if (r.block || r.type !== esperado) {
      okNoite = false;
      detalhe = rotulo + ' → ' + (r.block ? 'BLOQUEADO' : r.type);
      break;
    }
    punches.push(marca(esperado, ms, PLANTAO.name));
  }
  ok(okNoite, 'as 6 marcações da noite passam, todas com o tipo certo', detalhe);
  ok(punches.length === 6, 'e as 6 chegam ao banco', 'entraram ' + punches.length);

  // O intervalo curto continua valendo: plantão não é licença para toque duplo.
  punches = [marca('entry', dia(7, 19, 0), PLANTAO.name),
             marca('exit',  dia(7, 21, 30), PLANTAO.name)];
  em(dia(7, 21, 32));
  p = await plano(PLANTAO);
  ok(p.type === 'entry' && !!p.block, 'voltar 2min depois ainda é travado pelo intervalo curto');

  // Sem plantão, a volta rápida também passa — é intervalo. O que separa os
  // dois casos deixou de ser a marca no cadastro e passou a ser a DURAÇÃO da
  // pausa: acima de `pausaMax`, só o plantão continua.
  punches = [marca('entry', dia(7, 19, 0)), marca('exit', dia(7, 21, 30))];
  em(dia(7, 22, 40));
  p = await plano(PESSOA);
  ok(p.type === 'entry' && !p.block, 'sem plantão: voltar 1h10 depois é intervalo, e passa');

  punches = [marca('entry', dia(7, 6, 0)), marca('exit', dia(7, 9, 0))];
  em(dia(7, 15, 0));                              // 6h de pausa, mesmo dia
  p = await plano(PESSOA);
  ok(p.type === 'entry' && !!p.block,
     'comum: pausa de 6h no mesmo dia → travado, é jornada nova');

  punches = [marca('entry', dia(7, 6, 0), PLANTAO.name),
             marca('exit',  dia(7, 9, 0), PLANTAO.name)];
  p = await plano(PLANTAO);
  ok(p.type === 'entry' && !p.block, 'plantão: a mesma pausa de 6h passa');

  // Plantão não depende de mais nenhuma marca no cadastro para funcionar.
  punches = [];
  em(dia(7, 19, 0));
  p = await plano({ name: 'Fantasma', plantao: true });
  ok(p.type === 'entry', 'plantão sozinho no cadastro já alterna normalmente');

  console.log('\n【8】 Intervalo dentro da jornada — almoço e café');
  // O caso que fez a regra mudar: sem isto, quem saísse para o almoço só
  // voltaria a bater 12h depois, e a coluna E2 da planilha nunca encheria.
  em(dia(8, 12, 30));
  punches = [marca('entry', dia(8, 7, 0)), marca('exit', dia(8, 11, 30))];
  p = await plano(PESSOA);
  ok(p.type === 'entry' && !p.block, 'volta do almoço (1h) → Entrada liberada');

  punches.push(marca('entry', dia(8, 12, 30)));
  em(dia(8, 17, 0));
  p = await plano(PESSOA);
  ok(p.type === 'exit' && !p.block, 'e a saída das 17:00 fecha o segundo par');

  // Café de 15 min também é intervalo — mas o toque duplo continua barrado.
  punches = [marca('entry', dia(8, 7, 0)), marca('exit', dia(8, 9, 0))];
  em(dia(8, 9, 2));
  p = await plano(PESSOA);
  ok(p.type === 'entry' && !!p.block, 'voltar 2min do café → travado pelo intervalo curto');

  em(dia(8, 9, 15));
  p = await plano(PESSOA);
  ok(p.type === 'entry' && !p.block, 'passados 15min, a volta do café passa');

  // Desligar a pausa devolve o comportamento anterior, para quem não quiser
  // intervalo registrado.
  pausaMax = 0;
  em(dia(8, 12, 30));
  punches = [marca('entry', dia(8, 7, 0)), marca('exit', dia(8, 11, 30))];
  p = await plano(PESSOA);
  ok(p.type === 'entry' && !!p.block, 'pausaMax = 0 volta a barrar a volta do almoço');
  pausaMax = 4;

  NOW = null;

  console.log('\n' + (falhas ? `❌ ${falhas} falha(s)` : '✅ todos os testes passaram'));
  process.exit(falhas ? 1 : 0);
})();
