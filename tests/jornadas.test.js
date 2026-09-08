// Testa o cálculo de jornadas e horas do ponto2 — a seção nova do
// `apps-script.gs`, carregada DE VERDADE numa VM do Node, com o Apps Script
// substituído por dublês. É a peça que vira dinheiro na folha: um erro aqui não
// aparece na tela de ninguém, aparece no contracheque.
//
// Roda também como SIMULAÇÃO: ao final imprime a aba `Jornadas` como ela sairia
// na planilha, para conferência visual.
const fs   = require('fs');
const vm   = require('vm');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'ponto2', 'apps-script.gs'), 'utf8');

// ── Dublês do Apps Script ────────────────────────────────────────────────────
// Só o que a seção de cálculo toca. O resto do arquivo é declaração: carregar
// inteiro não executa nada, e garante que os consts (TZ, COLS, CHAVE) sejam os
// mesmos que a planilha usa, em vez de cópias que envelhecem.
function partes(d, tz) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const o = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  return o;
}

const Utilities = {
  formatDate(d, tz, padrao) {
    const p = partes(d, tz);
    return padrao
      .replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day)
      .replace('HH', p.hour === '24' ? '00' : p.hour)
      .replace('mm', p.minute).replace('ss', p.second);
  },
};

const ctx = vm.createContext({
  Utilities, console, Date, Math, String, Number, Array, JSON, isNaN,
  SpreadsheetApp: {}, DriveApp: {}, ContentService: {}, LockService: {},
});
// `const` de topo fica no escopo léxico do script, não vira propriedade do
// contexto — só `function` vira. Por isso o que o teste precisa é exportado
// explicitamente, no mesmo script, onde os bindings ainda estão à vista.
vm.runInContext(SRC + `
;globalThis.__gs = {
  COLS, CHAVE, TZ, FERIADOS_PADRAO, CAB_CALC, CAB_FIM, PARES_MAX,
  lerMarcacoes_, agruparJornadas_, linhaJornada_,
};`, ctx);
const gs = ctx.__gs;

// ── Fixture ──────────────────────────────────────────────────────────────────
// Instantes com offset explícito (-03:00): é o mesmo ISO que o app grava, e
// evita que o teste dependa do fuso da máquina que o roda.
const iso = (data, hora) => `2026-${data}T${hora}:00-03:00`;

function marcar(nome, tipo, data, hora) {
  const linha = new Array(gs.COLS.length).fill('');
  linha[1] = nome;
  linha[2] = tipo === 'entry' ? 'Entrada' : 'Saída';
  linha[gs.CHAVE - 1] = nome + '|' + iso(data, hora);
  return linha;
}

// 07/09/2026 é FERIADO (segunda) e 13/09 é DOMINGO — escolhidos de propósito.
const LINHAS = [
  // Dia útil com almoço: 9h no total, 1h de pausa que não conta.
  marcar('Maria Silva',  'entry', '09-08', '07:00'),
  marcar('Maria Silva',  'exit',  '09-08', '11:30'),
  marcar('Maria Silva',  'entry', '09-08', '12:30'),
  marcar('Maria Silva',  'exit',  '09-08', '17:00'),

  // Turno noturno cortado na meia-noite: uma jornada só, dois dias.
  marcar('Beto Almeida', 'entry', '09-09', '16:00'),
  marcar('Beto Almeida', 'exit',  '09-09', '23:50'),
  marcar('Beto Almeida', 'entry', '09-10', '00:05'),
  marcar('Beto Almeida', 'exit',  '09-10', '08:00'),

  // Plantão que começa no feriado e termina no dia útil seguinte.
  marcar('Lincon Braga', 'entry', '09-07', '19:00'),
  marcar('Lincon Braga', 'exit',  '09-07', '21:30'),
  marcar('Lincon Braga', 'entry', '09-07', '22:40'),
  marcar('Lincon Braga', 'exit',  '09-08', '00:10'),
  marcar('Lincon Braga', 'entry', '09-08', '01:20'),
  marcar('Lincon Braga', 'exit',  '09-08', '05:30'),

  // Domingo inteiro a 100%.
  marcar('Ana Souza',    'entry', '09-13', '07:00'),
  marcar('Ana Souza',    'exit',  '09-13', '12:00'),

  // Saída esquecida: a jornada fica aberta e é sinalizada.
  marcar('Carlos Dias',  'entry', '09-11', '08:00'),
];

const sheetFalso = {
  getLastRow: () => LINHAS.length + 1,
  getRange: () => ({ getValues: () => LINHAS }),
};

// Feriados como o `lerFeriados_` os devolve, a partir da aba.
const FERIADOS = {};
gs.FERIADOS_PADRAO.forEach(d => {
  const p = d.split('/');
  FERIADOS[`${p[2]}-${p[1]}-${p[0]}`] = true;
});

// ── Execução ─────────────────────────────────────────────────────────────────
const marcacoes = gs.lerMarcacoes_(sheetFalso);
const jornadas  = gs.agruparJornadas_(marcacoes);
const linhas    = jornadas.map(j => gs.linhaJornada_(j, FERIADOS));

const CAB = gs.CAB_CALC
  .concat(...Array.from({ length: gs.PARES_MAX }, (_, i) => [`E${i + 1}`, `S${i + 1}`]))
  .concat(gs.CAB_FIM);

const col = nome => CAB.indexOf(nome);
const hhmm = frac => {
  const min = Math.round(frac * 1440);
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
};
const dos = nome => linhas.find(l => l[0] === nome);

let falhas = 0;
function ok(cond, texto, extra = '') {
  console.log((cond ? '  ✅ ' : '  ❌ ') + texto + (cond ? '' : '  → ' + extra));
  if (!cond) falhas++;
}
function conf(nome, campo, esperado) {
  const l = dos(nome);
  const v = hhmm(l[col(campo)]);
  ok(v === esperado, `${nome} · ${campo} = ${esperado}`, v);
}

console.log('\n【1】 Leitura e agrupamento');
ok(marcacoes.length === LINHAS.length, 'lê as ' + LINHAS.length + ' marcações da aba bruta',
   String(marcacoes.length));
ok(jornadas.length === 5, '5 jornadas (uma por pessoa)', String(jornadas.length));
ok(dos('Beto Almeida')[col('Pares')] === 2,
   'o corte de meia-noite fica numa jornada só, com 2 pares');
ok(dos('Lincon Braga')[col('Pares')] === 3, 'o plantão fica com os 3 pares da noite');

console.log('\n【2】 Dia útil com intervalo de almoço');
conf('Maria Silva', 'Total trabalhado', '9h00');
conf('Maria Silva', 'Pausas',           '1h00');
conf('Maria Silva', 'Normais',          '8h00');
conf('Maria Silva', 'HE 50%',           '1h00');
conf('Maria Silva', 'HE 100%',          '0h00');
ok(dos('Maria Silva')[col('S1')] === '11:30' && dos('Maria Silva')[col('E2')] === '12:30',
   'o almoço aparece como S1/E2, fora das horas trabalhadas');

console.log('\n【3】 Turno noturno atravessando a meia-noite');
conf('Beto Almeida', 'Total trabalhado', '15h45');
conf('Beto Almeida', 'HE 50%',           '7h45');
conf('Beto Almeida', 'Adic. noturno 20%', '7h45');
ok(dos('Beto Almeida')[col('S2')] === '08:00 +1',
   'a saída do dia seguinte vem marcada com +1', dos('Beto Almeida')[col('S2')]);

console.log('\n【4】 Plantão começando em feriado');
conf('Lincon Braga', 'Total trabalhado',  '8h10');
conf('Lincon Braga', 'HE 100%',           '3h50');   // só o pedaço do feriado
conf('Lincon Braga', 'Normais',           '4h20');
conf('Lincon Braga', 'HE 50%',            '0h00');
conf('Lincon Braga', 'Adic. noturno 20%', '5h40');
conf('Lincon Braga', 'Pausas',            '2h20');
ok(dos('Lincon Braga')[col('Tipo de dia')] === 'Feriado', '07/09 sai como Feriado');

console.log('\n【5】 Domingo e jornada aberta');
conf('Ana Souza', 'Total trabalhado', '5h00');
conf('Ana Souza', 'HE 100%',          '5h00');
conf('Ana Souza', 'Normais',          '0h00');
ok(dos('Ana Souza')[col('Tipo de dia')] === 'Domingo', '13/09 sai como Domingo');
ok(dos('Carlos Dias')[col('Observação')].includes('jornada aberta'),
   'a saída esquecida é sinalizada', dos('Carlos Dias')[col('Observação')]);
ok(dos('Carlos Dias')[col('E1')] === '08:00',
   'e a entrada em aberto continua visível na coluna E1');

console.log('\n【6】 Somas fecham');
const soma = campo => linhas.reduce((a, l) => a + l[col(campo)], 0);
const partesSoma = soma('Normais') + soma('HE 50%') + soma('HE 100%');
ok(Math.abs(partesSoma - soma('Total trabalhado')) < 1e-9,
   'Normais + HE 50% + HE 100% = Total trabalhado',
   hhmm(partesSoma) + ' vs ' + hhmm(soma('Total trabalhado')));

// ── Simulação impressa ───────────────────────────────────────────────────────
const MOSTRAR = ['Nome', 'Início', 'Dia', 'Tipo de dia',
                 'E1', 'S1', 'E2', 'S2', 'E3', 'S3',
                 'Pausas', 'Total trabalhado', 'Normais',
                 'HE 50%', 'HE 100%', 'Adic. noturno 20%', 'Observação'];
const DUR = new Set(['Pausas', 'Total trabalhado', 'Normais',
                     'HE 50%', 'HE 100%', 'Adic. noturno 20%']);

const tabela = [MOSTRAR].concat(linhas.map(l =>
  MOSTRAR.map(c => {
    const v = l[col(c)];
    return DUR.has(c) ? hhmm(v) : String(v == null ? '' : v);
  })));

const larg = MOSTRAR.map((_, i) => Math.max(...tabela.map(r => r[i].length)));
console.log('\n\n══ Aba "Jornadas" — como sairia na planilha ' + '═'.repeat(20) + '\n');
tabela.forEach((r, i) => {
  console.log('  ' + r.map((c, j) => c.padEnd(larg[j])).join(' │ '));
  if (i === 0) console.log('  ' + larg.map(w => '─'.repeat(w)).join('─┼─'));
});

console.log('\n' + (falhas ? `❌ ${falhas} falha(s)` : '✅ todos os testes passaram'));
process.exit(falhas ? 1 : 0);
