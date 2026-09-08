// Testa o cálculo de jornadas e horas do ponto2 — a seção nova do
// `apps-script.gs`, carregada DE VERDADE numa VM do Node, com o Apps Script
// substituído por dublês. É a peça que vira dinheiro na folha: um erro aqui não
// aparece na tela de ninguém, aparece no contracheque.
//
// Roda também como SIMULAÇÃO: ao final imprime a aba `setembro_calculos` como
// ela sairia na planilha, para conferência visual.
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
  Utilities, console, Date, Math, String, Number, Array, Object, RegExp, JSON, isNaN,
  SpreadsheetApp: {}, DriveApp: {}, ContentService: {}, LockService: {}, ScriptApp: {},
});
// `const` de topo fica no escopo léxico do script, não vira propriedade do
// contexto — só `function` vira. Por isso o que o teste precisa é exportado
// explicitamente, no mesmo script, onde os bindings ainda estão à vista.
vm.runInContext(SRC + `
;globalThis.__gs = {
  COLS, CHAVE, TZ, ABA, FERIADOS_PADRAO, CAB_CALC, CAB_FIM, PARES_MAX,
  PAINEL_LIN, LIN_CAB, LIN_DADOS,
  lerMarcacoes_, lerTudo_, agruparJornadas_, calcularLinhas_, limiteDoDia_,
  mesDaChave_, rotuloMes_, mesDoRotulo_, nomeAba_,
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

// Setembro de 2026: 07 é FERIADO (segunda), 11 é SEXTA, 12 é SÁBADO e 13 é
// DOMINGO — escolhidos de propósito, um para cada regra.
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

  // SÁBADO com o mesmo horário da Maria: a jornada normal ali é de 4h.
  marcar('Rita Nunes',   'entry', '09-12', '07:00'),
  marcar('Rita Nunes',   'exit',  '09-12', '11:30'),
  marcar('Rita Nunes',   'entry', '09-12', '12:30'),
  marcar('Rita Nunes',   'exit',  '09-12', '17:00'),

  // DUAS jornadas na mesma sexta (6h de intervalo passa da pausa máxima, então
  // são jornadas separadas). Elas dividem uma cota de 8h, não ganham 8h cada.
  marcar('Tino Alves',   'entry', '09-11', '06:00'),
  marcar('Tino Alves',   'exit',  '09-11', '12:00'),
  marcar('Tino Alves',   'entry', '09-11', '18:00'),
  marcar('Tino Alves',   'exit',  '09-11', '23:00'),
];

// A aba real tem o painel de botões acima do cabeçalho: os dados começam na
// LIN_DADOS, e o teste passa por esse mesmo deslocamento em vez de fingir que
// o cabeçalho está na linha 1.
const sheetFalso = {
  getLastRow: () => LINHAS.length + gs.LIN_CAB,
  getRange: () => ({ getValues: () => LINHAS }),
};
const ssFalso = { getSheetByName: n => (n === gs.ABA ? sheetFalso : null) };

// Feriados como o `lerFeriados_` os devolve, a partir da aba.
const FERIADOS = {};
gs.FERIADOS_PADRAO.forEach(d => {
  const p = d.split('/');
  FERIADOS[`${p[2]}-${p[1]}-${p[0]}`] = true;
});

// ── Execução ─────────────────────────────────────────────────────────────────
const marcacoes = gs.lerTudo_(ssFalso, '2026-09');
const jornadas  = gs.agruparJornadas_(marcacoes);
const linhas    = gs.calcularLinhas_(jornadas, FERIADOS);

const CAB = gs.CAB_CALC
  .concat(...Array.from({ length: gs.PARES_MAX }, (_, i) => [`E${i + 1}`, `S${i + 1}`]))
  .concat(gs.CAB_FIM);

const col = nome => CAB.indexOf(nome);
const hhmm = frac => {
  const min = Math.round(frac * 1440);
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
};
const todas = nome => linhas.filter(l => l[0] === nome);
const dos   = nome => todas(nome)[0];
const pares = l => {
  let n = 0;
  for (let i = 0; i < gs.PARES_MAX; i++) if (l[col(`S${i + 1}`)]) n++;
  return n;
};

let falhas = 0;
function ok(cond, texto, extra = '') {
  console.log((cond ? '  ✅ ' : '  ❌ ') + texto + (cond ? '' : '  → ' + extra));
  if (!cond) falhas++;
}
function conf(nome, campo, esperado, qual = 0) {
  const v = hhmm(todas(nome)[qual][col(campo)]);
  ok(v === esperado, `${nome} · ${campo} = ${esperado}`, v);
}

console.log('\n【1】 Leitura com o painel acima do cabeçalho');
ok(gs.PAINEL_LIN === 3 && gs.LIN_CAB === 4 && gs.LIN_DADOS === 5,
   'painel em 1–3, cabeçalho na 4, dados a partir da 5',
   `${gs.PAINEL_LIN}/${gs.LIN_CAB}/${gs.LIN_DADOS}`);
ok(marcacoes.length === LINHAS.length, 'lê as ' + LINHAS.length + ' marcações da aba bruta',
   String(marcacoes.length));
ok(jornadas.length === 8, '8 jornadas (o Tino tem duas no mesmo dia)', String(jornadas.length));
ok(pares(dos('Beto Almeida')) === 2,
   'o corte de meia-noite fica numa jornada só, com 2 pares');
ok(pares(dos('Lincon Braga')) === 3, 'o plantão fica com os 3 pares da noite');

console.log('\n【2】 Dia útil com intervalo de almoço — 8h normais');
conf('Maria Silva', 'Total de horas', '9h00');
conf('Maria Silva', 'Pausas',         '1h00');
conf('Maria Silva', 'Normais',        '8h00');
conf('Maria Silva', 'HE 50%',         '1h00');
conf('Maria Silva', 'HE 100%',        '0h00');
ok(dos('Maria Silva')[col('S1')] === '11:30' && dos('Maria Silva')[col('E2')] === '12:30',
   'o almoço aparece como S1/E2, fora das horas trabalhadas');
ok(dos('Maria Silva')[col('Tipo de dia')] === 'Útil', '08/09 sai como Útil');

console.log('\n【3】 Turno noturno atravessando a meia-noite');
// A cota do dia é contada no dia em que a jornada COMEÇOU. Fatiada por dia
// civil, esta jornada daria 7h50 + 7h55 e sairia sem nenhuma hora extra.
conf('Beto Almeida', 'Total de horas',    '15h45');
conf('Beto Almeida', 'Normais',           '8h00');
conf('Beto Almeida', 'HE 50%',            '7h45');
conf('Beto Almeida', 'Adic. noturno 20%', '7h45');
ok(dos('Beto Almeida')[col('S2')] === '08:00 +1',
   'a saída do dia seguinte vem marcada com +1', dos('Beto Almeida')[col('S2')]);

console.log('\n【4】 Plantão começando em feriado');
conf('Lincon Braga', 'Total de horas',    '8h10');
conf('Lincon Braga', 'HE 100%',           '3h50');   // só o pedaço do feriado
conf('Lincon Braga', 'Normais',           '4h20');
conf('Lincon Braga', 'HE 50%',            '0h00');
conf('Lincon Braga', 'Adic. noturno 20%', '5h40');
conf('Lincon Braga', 'Pausas',            '2h20');
ok(dos('Lincon Braga')[col('Tipo de dia')] === 'Feriado', '07/09 sai como Feriado');

console.log('\n【5】 Domingo e jornada aberta');
conf('Ana Souza', 'Total de horas', '5h00');
conf('Ana Souza', 'HE 100%',        '5h00');
conf('Ana Souza', 'Normais',        '0h00');
ok(dos('Ana Souza')[col('Tipo de dia')] === 'Domingo', '13/09 sai como Domingo');
ok(dos('Carlos Dias')[col('Observação')].includes('jornada aberta'),
   'a saída esquecida é sinalizada', dos('Carlos Dias')[col('Observação')]);
ok(dos('Carlos Dias')[col('E1')] === '08:00',
   'e a entrada em aberto continua visível na coluna E1');

console.log('\n【6】 Sábado — a jornada normal é de 4h, não de 8h');
ok(gs.limiteDoDia_('2026-09-12') === 240, 'o sábado tem cota de 4h',
   String(gs.limiteDoDia_('2026-09-12')));
ok(gs.limiteDoDia_('2026-09-11') === 480, 'a sexta tem cota de 8h',
   String(gs.limiteDoDia_('2026-09-11')));
conf('Rita Nunes', 'Total de horas', '9h00');
conf('Rita Nunes', 'Normais',        '4h00');
conf('Rita Nunes', 'HE 50%',         '5h00');
ok(dos('Rita Nunes')[col('Tipo de dia')] === 'Sábado', '12/09 sai como Sábado');

console.log('\n【7】 Duas jornadas no mesmo dia dividem UMA cota');
const tino = todas('Tino Alves');
ok(tino.length === 2, 'as duas viram jornadas separadas', String(tino.length));
conf('Tino Alves', 'Normais', '6h00', 0);
conf('Tino Alves', 'HE 50%',  '0h00', 0);
conf('Tino Alves', 'Normais', '2h00', 1);   // sobraram 2h da cota de 8h
conf('Tino Alves', 'HE 50%',  '3h00', 1);
conf('Tino Alves', 'Adic. noturno 20%', '2h00', 1);

console.log('\n【8】 Somas fecham');
const soma = campo => linhas.reduce((a, l) => a + l[col(campo)], 0);
const partesSoma = soma('Normais') + soma('HE 50%') + soma('HE 100%');
ok(Math.abs(partesSoma - soma('Total de horas')) < 1e-9,
   'Normais + HE 50% + HE 100% = Total de horas',
   hhmm(partesSoma) + ' vs ' + hhmm(soma('Total de horas')));

console.log('\n【9】 Mês de referência e nome das abas');
const ANO = String(new Date().getFullYear());
ok(gs.mesDaChave_('Ana Souza|' + iso('09-13', '07:00')) === '2026-09',
   'o mês sai da chave, não da coluna Data');
ok(gs.rotuloMes_('2026-09') === 'setembro/2026', 'rótulo da lista suspensa');
ok(gs.mesDoRotulo_('setembro/2026') === '2026-09', 'e volta do rótulo para o mês');
ok(gs.mesDoRotulo_('qualquer coisa') === null, 'texto inválido não vira mês');
ok(gs.nomeAba_(ANO + '-08', 'calculos') === 'agosto_calculos',
   'no ano corrente a aba é "agosto_calculos"', gs.nomeAba_(ANO + '-08', 'calculos'));
ok(gs.nomeAba_('2019-08', 'registros') === 'agosto_2019_registros',
   'de outro ano leva o ano junto, para dois agostos não colidirem',
   gs.nomeAba_('2019-08', 'registros'));

// ── Simulação impressa ───────────────────────────────────────────────────────
const MOSTRAR = ['Nome', 'Data', 'Dia', 'Tipo de dia',
                 'E1', 'S1', 'E2', 'S2', 'E3', 'S3',
                 'Pausas', 'Total de horas', 'Normais',
                 'HE 50%', 'HE 100%', 'Adic. noturno 20%', 'Observação'];
const DUR = new Set(['Pausas', 'Total de horas', 'Normais',
                     'HE 50%', 'HE 100%', 'Adic. noturno 20%']);

const tabela = [MOSTRAR].concat(linhas.map(l =>
  MOSTRAR.map(c => {
    const v = l[col(c)];
    return DUR.has(c) ? hhmm(v) : String(v == null ? '' : v);
  })));

const larg = MOSTRAR.map((_, i) => Math.max(...tabela.map(r => r[i].length)));
console.log('\n\n══ ponto2 · aba "setembro_calculos" — como sairia na planilha ' + '═'.repeat(10) + '\n');
tabela.forEach((r, i) => {
  console.log('  ' + r.map((c, j) => c.padEnd(larg[j])).join(' │ '));
  if (i === 0) console.log('  ' + larg.map(w => '─'.repeat(w)).join('─┼─'));
});

console.log('\n' + (falhas ? `❌ ${falhas} falha(s)` : '✅ todos os testes passaram'));
process.exit(falhas ? 1 : 0);
