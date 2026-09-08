// Testa o cálculo de jornadas e horas do app da RAIZ — a seção nova do
// `apps-script.gs` da raiz, carregada de verdade numa VM do Node.
//
// A raiz é INDEPENDENTE do ponto2: planilha própria (`Registros`, 10 colunas),
// código próprio, cópia própria da seção. Este teste não olha para o ponto2 —
// se um dia as duas divergirem, é aqui que a da raiz continua sendo garantida.
//
// Duas diferenças de comportamento em relação ao ponto2 moldam os casos abaixo:
//   • a raiz não trava a volta de intervalo, então almoço já entra sozinho;
//   • a raiz alterna DENTRO do dia civil, então o turno noturno depende de
//     cortar na meia-noite — e quem esquecer tem que APARECER, não somar errado.
//
// Roda também como SIMULAÇÃO: ao final imprime a aba como sairia na planilha.
const fs   = require('fs');
const vm   = require('vm');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const SRC  = fs.readFileSync(path.join(RAIZ, 'apps-script.gs'), 'utf8');

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
vm.runInContext(SRC + `
;globalThis.__gs = {
  COLS, CHAVE, TZ, ABA, FERIADOS_PADRAO, CAB_CALC, CAB_FIM, PARES_MAX,
  lerMarcacoes_, agruparJornadas_, linhaJornada_,
};`, ctx);
const gs = ctx.__gs;

const iso = (data, hora) => `2026-${data}T${hora}:00-03:00`;

function marcar(nome, tipo, data, hora) {
  const linha = new Array(gs.COLS.length).fill('');
  linha[1] = nome;
  linha[2] = tipo === 'entry' ? 'Entrada' : 'Saída';
  linha[gs.CHAVE - 1] = nome + '|' + iso(data, hora);
  return linha;
}

// 07/09/2026 é FERIADO (segunda) e 13/09 é DOMINGO.
const LINHAS = [
  // Dia útil com almoço — na raiz isso já funciona sem trava nenhuma.
  marcar('Maria Silva', 'entry', '09-08', '07:00'),
  marcar('Maria Silva', 'exit',  '09-08', '11:30'),
  marcar('Maria Silva', 'entry', '09-08', '12:30'),
  marcar('Maria Silva', 'exit',  '09-08', '17:00'),

  // Turno noturno CORTADO na meia-noite, como o procedimento manda.
  marcar('José Lima',   'entry', '09-09', '16:00'),
  marcar('José Lima',   'exit',  '09-09', '23:50'),
  marcar('José Lima',   'entry', '09-10', '00:05'),
  marcar('José Lima',   'exit',  '09-10', '08:00'),

  // Turno noturno SEM cortar: virada a meia-noite o app volta a oferecer
  // entrada, e sai entrada-depois-de-entrada. Tem que aparecer como problema.
  marcar('Pedro Nunes', 'entry', '09-11', '23:00'),
  marcar('Pedro Nunes', 'entry', '09-12', '04:00'),

  // Vários pares começando em feriado e terminando em dia útil.
  marcar('Lincon Braga', 'entry', '09-07', '19:00'),
  marcar('Lincon Braga', 'exit',  '09-07', '21:30'),
  marcar('Lincon Braga', 'entry', '09-07', '22:40'),
  marcar('Lincon Braga', 'exit',  '09-08', '00:10'),
  marcar('Lincon Braga', 'entry', '09-08', '01:20'),
  marcar('Lincon Braga', 'exit',  '09-08', '05:30'),

  // Domingo inteiro a 100%.
  marcar('Ana Souza',   'entry', '09-13', '07:00'),
  marcar('Ana Souza',   'exit',  '09-13', '12:00'),
];

const sheetFalso = {
  getLastRow: () => LINHAS.length + 1,
  getRange: () => ({ getValues: () => LINHAS }),
};

const FERIADOS = {};
gs.FERIADOS_PADRAO.forEach(d => {
  const p = d.split('/');
  FERIADOS[`${p[2]}-${p[1]}-${p[0]}`] = true;
});

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
const todas = nome => linhas.filter(l => l[0] === nome);
const dos   = nome => todas(nome)[0];

let falhas = 0;
function ok(cond, texto, extra = '') {
  console.log((cond ? '  ✅ ' : '  ❌ ') + texto + (cond ? '' : '  → ' + extra));
  if (!cond) falhas++;
}
function conf(nome, campo, esperado) {
  const v = hhmm(dos(nome)[col(campo)]);
  ok(v === esperado, `${nome} · ${campo} = ${esperado}`, v);
}

console.log('\n【1】 A planilha da raiz é a `Registros`, com layout próprio');
ok(gs.ABA === 'Registros', 'a aba de origem é "Registros"', gs.ABA);
ok(gs.COLS.length === 10 && gs.CHAVE === 10,
   '10 colunas, Chave na J — o layout da raiz, não o do ponto2',
   gs.COLS.length + ' colunas, chave em ' + gs.CHAVE);
ok(marcacoes.length === LINHAS.length, 'lê as ' + LINHAS.length + ' marcações');

console.log('\n【2】 Almoço — na raiz não há trava, o segundo par entra sozinho');
conf('Maria Silva', 'Total trabalhado', '9h00');
conf('Maria Silva', 'Pausas',           '1h00');
conf('Maria Silva', 'HE 50%',           '1h00');
ok(dos('Maria Silva')[col('E2')] === '12:30', 'a volta do almoço ocupa a coluna E2');

console.log('\n【3】 Turno noturno cortado na meia-noite');
conf('José Lima', 'Total trabalhado',  '15h45');
conf('José Lima', 'HE 50%',            '7h45');
conf('José Lima', 'Adic. noturno 20%', '7h45');
ok(dos('José Lima')[col('Pares')] === 2, 'os dois pedaços viram UMA jornada, com 2 pares');

console.log('\n【4】 Turno noturno SEM cortar — tem que aparecer, não somar errado');
const pedro = todas('Pedro Nunes');
ok(pedro.length === 2, 'as duas entradas soltas viram 2 jornadas', String(pedro.length));
ok(pedro.every(l => l[col('Observação')].includes('jornada aberta')),
   'ambas marcadas como jornada aberta',
   pedro.map(l => l[col('Observação')]).join(' / '));
ok(pedro.every(l => l[col('Total trabalhado')] === 0),
   'e nenhuma hora é inventada para elas');

console.log('\n【5】 Feriado, domingo e a virada do dia');
conf('Lincon Braga', 'Total trabalhado',  '8h10');
conf('Lincon Braga', 'HE 100%',           '3h50');
conf('Lincon Braga', 'Normais',           '4h20');
conf('Lincon Braga', 'Adic. noturno 20%', '5h40');
ok(dos('Lincon Braga')[col('Tipo de dia')] === 'Feriado', '07/09 sai como Feriado');
conf('Ana Souza', 'HE 100%', '5h00');
ok(dos('Ana Souza')[col('Tipo de dia')] === 'Domingo', '13/09 sai como Domingo');

console.log('\n【6】 Somas fecham');
const soma = campo => linhas.reduce((a, l) => a + l[col(campo)], 0);
const partesSoma = soma('Normais') + soma('HE 50%') + soma('HE 100%');
ok(Math.abs(partesSoma - soma('Total trabalhado')) < 1e-9,
   'Normais + HE 50% + HE 100% = Total trabalhado',
   hhmm(partesSoma) + ' vs ' + hhmm(soma('Total trabalhado')));

console.log('\n【7】 As duas cópias do Apps Script não podem divergir');
// A raiz é autossuficiente: a tela de Admin mostra e copia o código SEM REDE,
// então ele vive embutido no index.html além do arquivo .gs. Duas cópias é o
// preço de não depender de rede — este teste é o que impede que se separem.
const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
const abre = html.indexOf('const APPS_SCRIPT = `');
const fecha = html.indexOf('`;', abre);
ok(abre >= 0 && fecha > abre, 'o literal APPS_SCRIPT existe no index.html');

const embutido = html.slice(abre + 'const APPS_SCRIPT = `'.length, fecha);
const doArquivo = SRC.slice(SRC.indexOf('const TZ'));
const limpa = s => s.replace(/\r/g, '').trim();
ok(limpa(embutido) === limpa(doArquivo),
   'o embutido é igual ao apps-script.gs (do `const TZ` em diante)',
   `embutido ${limpa(embutido).length} bytes × arquivo ${limpa(doArquivo).length} bytes`);
ok(!embutido.includes('`') && !embutido.includes('${'),
   'e não tem crase nem ${…}, que quebrariam o literal');

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
console.log('\n\n══ Raiz · aba "Jornadas" — como sairia na planilha ' + '═'.repeat(14) + '\n');
tabela.forEach((r, i) => {
  console.log('  ' + r.map((c, j) => c.padEnd(larg[j])).join(' │ '));
  if (i === 0) console.log('  ' + larg.map(w => '─'.repeat(w)).join('─┼─'));
});

console.log('\n' + (falhas ? `❌ ${falhas} falha(s)` : '✅ todos os testes passaram'));
process.exit(falhas ? 1 : 0);
