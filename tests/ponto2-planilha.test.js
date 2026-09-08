// Testa a PLANILHA do ponto2 — o que os dois botões novos fazem, contra um mock
// do SpreadsheetApp com várias abas.
//
// Três coisas aqui são irreversíveis se derem errado, e é por isso que existem:
//   • a troca de nome da aba (Saidas → Registros) não pode largar registros na
//     aba velha nem gravar por cima do que já foi renomeado à mão;
//   • "Mover dados" APAGA da origem — só pode apagar o que chegou no destino;
//   • o cabeçalho desceu para a linha 4, e qualquer leitura que ainda pense em
//     "linha 2" lê o painel de botões como se fosse registro.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'ponto2', 'apps-script.gs'), 'utf8');

const PAINEL = 3, CAB = 4, D0 = 4;   // D0 = índice 0-based do 1º registro

// ── Mock do SpreadsheetApp ───────────────────────────────────────────────────
function novaAba(nome, grid) {
  const sh = {
    _d: grid ? grid.map(r => r.slice()) : [],
    _nome: nome,
    _frozen: 0, _hidden: [], _caixas: [], _validacoes: {}, _pai: null,
    getName(){ return this._nome; },
    setName(n){ this._nome = n; return this; },
    getParent(){ return this._pai; },
    getLastRow(){ return this._d.length; },
    getLastColumn(){ return this._d.reduce((m,r)=>Math.max(m,r.length),0); },
    getMaxRows(){ return Math.max(this._d.length, 1000); },
    getMaxColumns(){ return Math.max(this.getLastColumn(), 16); },
    setFrozenRows(n){ this._frozen = n; return this; },
    setFrozenColumns(){ return this; },
    setColumnWidth(){ return this; },
    setRowHeights(){ return this; },
    hideColumns(c){ if(!this._hidden.includes(c)) this._hidden.push(c); },
    clear(){ this._d = []; return this; },
    appendRow(r){ this._d.push(r.slice()); },
    insertRowsBefore(lin, quantas){
      this._d.splice(lin-1, 0, ...Array.from({length: quantas}, () => []));
    },
    insertColumnsAfter(){ return this; },
    deleteRows(lin, quantas){ this._d.splice(lin-1, quantas); },
    getConditionalFormatRules(){ return []; },
    setConditionalFormatRules(){ return this; },
    getRange(lin, col, nl=1, nc=1){
      const s = this;
      const r = {
        getValue(){ const row = s._d[lin-1]; return row && row[col-1] !== undefined ? row[col-1] : ''; },
        getValues(){
          const out = [];
          for (let i=0;i<nl;i++){
            const row = s._d[lin-1+i] || [];
            const linha = [];
            for (let j=0;j<nc;j++) linha.push(row[col-1+j] !== undefined ? row[col-1+j] : '');
            out.push(linha);
          }
          return out;
        },
        // Nenhuma célula do fixture é fórmula: a foto de verdade é um =IMAGE, e
        // o teste 【3】 usa uma para provar que ela viaja como fórmula.
        getFormulas(){
          return r.getValues().map(l => l.map(v =>
            (typeof v === 'string' && v.charAt(0) === '=') ? v : ''));
        },
        setValue(v){ return r.setValues([[v]]); },
        setValues(vals){
          vals.forEach((v,i)=>{
            const idx = lin-1+i;
            while (s._d.length <= idx) s._d.push([]);
            const row = s._d[idx];
            v.forEach((x,j)=>{ row[col-1+j] = x; });
          });
          return r;
        },
        insertCheckboxes(){ s._caixas.push(lin+','+col); return r.setValues([[false]]); },
        setDataValidation(v){ s._validacoes[lin+','+col] = v; return r; },
        clearDataValidations(){ delete s._validacoes[lin+','+col]; return r; },
        setFontWeight(){ return r; },   setBackground(){ return r; },
        setFontStyle(){ return r; },    setFontColor(){ return r; },
        setNumberFormat(){ return r; }, setVerticalAlignment(){ return r; },
      };
      return r;
    },
  };
  return sh;
}

function novaPlanilha(abas) {
  const ss = {
    _abas: abas || [],
    _toasts: [],
    getSheetByName(n){ return this._abas.find(s => s.getName() === n) || null; },
    getSheets(){ return this._abas; },
    insertSheet(n){ const s = novaAba(n, []); s._pai = this; this._abas.push(s); return s; },
    toast(t){ this._toasts.push(t); },
  };
  ss._abas.forEach(s => { s._pai = ss; });
  return ss;
}

function contexto(ss) {
  const ctx = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      getActive: () => ss,
      flush: () => {},
      newDataValidation: () => ({
        requireValueInList(){ return this; }, setAllowInvalid(){ return this; },
        build(){ return { lista: true }; },
      }),
      newConditionalFormatRule: () => {
        const b = { whenFormulaSatisfied(){ return b; }, setBackground(){ return b; },
                    setRanges(){ return b; }, build(){ return {}; } };
        return b;
      },
      getUi(){
        const m = { createMenu(){ return m; }, addItem(){ return m; },
                    addSeparator(){ return m; }, addToUi(){ return m; } };
        return { createMenu: () => m };
      },
    },
    LockService: { getScriptLock: () => ({ waitLock(){}, releaseLock(){} }) },
    Utilities: {
      formatDate(dt, tz, fmt){
        // Fixture inteiro em -03:00; o mock formata em UTC-3 na mão para não
        // depender do fuso da máquina que roda o teste.
        const d = new Date(dt.getTime() - 3*3600e3);
        const p = n => String(n).padStart(2,'0');
        return fmt
          .replace('yyyy', d.getUTCFullYear())
          .replace('MM', p(d.getUTCMonth()+1))
          .replace('dd', p(d.getUTCDate()))
          .replace('HH', p(d.getUTCHours()))
          .replace('mm', p(d.getUTCMinutes()))
          .replace('ss', p(d.getUTCSeconds()));
      },
      newBlob(){ return {}; }, base64Decode(){ return []; },
    },
    ContentService: {
      MimeType: { JSON:'json', TEXT:'text' },
      createTextOutput(t){ return { _t:t, setMimeType(){ return this; } }; },
    },
    DriveApp: {}, PropertiesService: {}, ScriptApp: {}, Logger: { log(){} }, console,
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return ctx;
}

let falhas = 0;
const ok = (c, nome, extra='') => {
  console.log((c?'  ✅ ':'  ❌ ')+nome+(c?'':'  → '+extra)); if(!c) falhas++;
};

// ── Fixture ──────────────────────────────────────────────────────────────────
const COLS16 = ['ID','Nome','Tipo','Data','Hora','Local','Confirmacao','Latitude',
                'Longitude','Chave','Foto','Distancia','Margem','Rigor',
                'Conferido','Vivacidade'];

function linha(id, nome, tipo, dia, hora, foto) {
  const l = new Array(16).fill('');
  l[0] = id; l[1] = nome; l[2] = tipo;
  l[3] = dia.slice(8) + '/' + dia.slice(5,7) + '/' + dia.slice(0,4);
  l[4] = hora + ':00';
  l[9] = nome + '|' + dia + 'T' + hora + ':00-03:00';
  l[10] = foto || '';
  l[14] = false;
  return l;
}

console.log('\n【1】 Só existe a "Saidas" antiga — ela vira "Registros"');
{
  const velha = novaAba('Saidas', [
    COLS16.slice(),
    linha(1, 'Maria', 'Entrada', '2026-08-03', '07:00'),
    linha(2, 'Maria', 'Saída',   '2026-08-03', '16:00'),
  ]);
  const ss = novaPlanilha([velha]);
  const ctx = contexto(ss);
  ctx.doPost({ postData: { contents: JSON.stringify({ records: [] }) } });

  const reg = ss.getSheetByName('Registros');
  ok(!!reg, 'a aba passou a se chamar "Registros"',
     ss.getSheets().map(s=>s.getName()).join(', '));
  ok(ss.getSheets().length === 1, 'e nenhuma "Saidas" nova foi criada',
     ss.getSheets().map(s=>s.getName()).join(', '));
  ok(JSON.stringify(reg._d[CAB-1]) === JSON.stringify(COLS16),
     'o cabeçalho desceu para a linha ' + CAB);
  ok(reg._d[D0][9] === 'Maria|2026-08-03T07:00:00-03:00',
     'e os registros desceram junto, com a chave', reg._d[D0][9]);
  ok(reg._d[0][0] === 'Mês de referência', 'o painel ocupa as 3 primeiras linhas');
}

console.log('\n【2】 As duas abas existindo — foi o que aconteceu ao renomear à mão');
{
  // "Registros" é a original renomeada na unha (cabeçalho ainda na linha 1);
  // "Saidas" é a que o código recriou depois, com o último registro só.
  const reg = novaAba('Registros', [
    COLS16.slice(),
    linha(1, 'Maria', 'Entrada', '2026-08-03', '07:00'),
  ]);
  const perdida = novaAba('Saidas', [
    COLS16.slice(),
    linha(2, 'Maria', 'Saída', '2026-08-03', '16:00'),
  ]);
  const ss = novaPlanilha([reg, perdida]);
  const ctx = contexto(ss);
  ctx.doPost({ postData: { contents: JSON.stringify({ records: [] }) } });

  const alvo = ss.getSheetByName('Registros');
  ok(alvo._d.length === CAB + 2, 'o registro órfão da "Saidas" foi absorvido',
     'linhas de dados: ' + (alvo._d.length - CAB));
  ok(alvo._d[D0+1][9] === 'Maria|2026-08-03T16:00:00-03:00',
     'com a chave intacta, na sequência', alvo._d[D0+1][9]);
  ok(!ss.getSheetByName('Saidas'), 'a aba antiga saiu do caminho');
  ok(ss.getSheets().some(s => s.getName().indexOf('Saidas (migrada') === 0),
     'mas não foi apagada — só aposentada',
     ss.getSheets().map(s=>s.getName()).join(', '));
}

console.log('\n【3】 Mover dados — copia, confere, e só então apaga');
{
  const reg = novaAba('Registros', [
    ['Mês de referência','agosto/2026','','','','','','','','','','','','','',''],
    [false,'◀  Calcular horas do mês','','','','','','','','','','','','','',''],
    [false,'◀  Mover os dados do mês','','','','','','','','','','','','','',''],
    COLS16.slice(),
    linha(1, 'Zeca',  'Entrada', '2026-08-03', '07:00', '=IMAGE("http://x/1")'),
    linha(2, 'Ana',   'Entrada', '2026-08-03', '07:05'),
    new Array(16).fill(''),                                   // linha em branco
    linha(3, 'Zeca',  'Saída',   '2026-08-03', '16:00'),
    linha(4, 'Ana',   'Saída',   '2026-08-03', '16:10'),
    linha(5, 'Ana',   'Entrada', '2026-09-01', '07:00'),      // outro mês: fica
  ]);
  const ss = novaPlanilha([reg]);
  const ctx = contexto(ss);
  ctx.moverDados();

  const arq = ss.getSheetByName('agosto_registros');
  ok(!!arq, 'criou a aba "agosto_registros"',
     ss.getSheets().map(s=>s.getName()).join(', '));
  ok(arq._d.length === 5, 'com cabeçalho + os 4 registros de agosto',
     'linhas: ' + arq._d.length);
  ok(arq._d.slice(1).map(l => l[1]).join(',') === 'Ana,Ana,Zeca,Zeca',
     'ordenados por funcionário', arq._d.slice(1).map(l => l[1]).join(','));
  ok(arq._d[3][10] === '=IMAGE("http://x/1")',
     'a foto viajou como FÓRMULA, não como o resultado dela', String(arq._d[3][10]));

  ok(reg._d.length === CAB + 1, 'na origem sobrou só o registro de setembro',
     'linhas de dados: ' + (reg._d.length - CAB));
  ok(reg._d[D0][9] === 'Ana|2026-09-01T07:00:00-03:00', 'e é o de setembro mesmo',
     reg._d[D0][9]);
  ok(String(reg._d[0][3]).indexOf('4 registro(s)') === 0,
     'o painel conta o que foi movido', String(reg._d[0][3]));
  ok(String(reg._d[0][3]).indexOf('em branco') > 0,
     'e diz que a linha em branco foi removida', String(reg._d[0][3]));
}

console.log('\n【4】 Calcular horas — a aba do mês nasce com uma linha por jornada');
{
  const reg = novaAba('Registros', [
    ['Mês de referência','agosto/2026','','','','','','','','','','','','','',''],
    [false,'','','','','','','','','','','','','','',''],
    [false,'','','','','','','','','','','','','','',''],
    COLS16.slice(),
    linha(1, 'Zeca', 'Entrada', '2026-08-03', '07:00'),
    linha(2, 'Zeca', 'Saída',   '2026-08-03', '11:30'),
    linha(3, 'Zeca', 'Entrada', '2026-08-03', '12:30'),
    linha(4, 'Zeca', 'Saída',   '2026-08-03', '17:00'),
  ]);
  const ss = novaPlanilha([reg]);
  const ctx = contexto(ss);
  ctx.calcularHoras();

  const calc = ss.getSheetByName('agosto_calculos');
  ok(!!calc, 'criou a aba "agosto_calculos"',
     ss.getSheets().map(s=>s.getName()).join(', '));
  ok(calc._d.length === 2, 'cabeçalho + 1 jornada', 'linhas: ' + calc._d.length);
  ok(calc._d[1][0] === 'Zeca' && calc._d[1][1] === '03/08/2026',
     'nome e data na frente', JSON.stringify(calc._d[1].slice(0,2)));
  const iTotal = calc._d[0].indexOf('Total de horas');
  ok(Math.round(calc._d[1][iTotal] * 1440) === 540, '9h de total (a pausa não conta)',
     String(Math.round(calc._d[1][iTotal] * 1440)) + ' min');
  ok(!!ss.getSheetByName('Feriados'), 'e a aba Feriados nasceu junto');
  ok(reg._d.length === CAB + 4, 'a aba de registros não foi tocada',
     'linhas de dados: ' + (reg._d.length - CAB));
}

console.log('\n【5】 Mês sem registro — avisa e não cria aba nenhuma');
{
  const reg = novaAba('Registros', [
    ['Mês de referência','janeiro/2026','','','','','','','','','','','','','',''],
    [false,'','','','','','','','','','','','','','',''],
    [false,'','','','','','','','','','','','','','',''],
    COLS16.slice(),
    linha(1, 'Zeca', 'Entrada', '2026-08-03', '07:00'),
  ]);
  const ss = novaPlanilha([reg]);
  const ctx = contexto(ss);
  ctx.calcularHoras();

  ok(!ss.getSheetByName('janeiro_calculos'), 'nenhuma aba de janeiro foi criada',
     ss.getSheets().map(s=>s.getName()).join(', '));
  // A lista suspensa só oferece meses com registro: escolher janeiro nem chega a
  // acontecer pela tela — a mensagem cobre quem digitou ou moveu os dados.
  ok(String(reg._d[0][3]).indexOf('agosto/2026') > 0,
     'e o painel diz onde há registro', String(reg._d[0][3]));
}

console.log('\n【6】 Abrir a planilha já desenha o painel');
{
  // Foi o furo relatado: colar o código e recarregar mostrava o menu e mais
  // nada. O painel só nascia no primeiro clique de um item do menu.
  const velha = novaAba('Saidas', [
    COLS16.slice(),
    linha(1, 'Maria', 'Entrada', '2026-08-03', '07:00'),
  ]);
  const ss = novaPlanilha([velha]);
  const ctx = contexto(ss);
  ctx.onOpen();

  const reg = ss.getSheetByName('Registros');
  ok(!!reg, 'a aba migrou de nome só de abrir',
     ss.getSheets().map(s=>s.getName()).join(', '));
  ok(reg._d[0][0] === 'M\u00eas de refer\u00eancia', 'e o painel está desenhado',
     JSON.stringify(reg._d[0][0]));
  ok(reg._caixas.includes('2,1') && reg._caixas.includes('3,1'),
     'com as duas caixinhas', JSON.stringify(reg._caixas));
  ok(String(reg._d[0][3]).indexOf('Preparar planilha') > 0,
     'a D1 avisa que falta armar as caixinhas', String(reg._d[0][3]));
  ok(reg._d[D0][9] === 'Maria|2026-08-03T07:00:00-03:00',
     'e o registro continua lá, inteiro', reg._d[D0][9]);

  // Reabrir não pode redesenhar por cima nem empilhar linhas de painel.
  reg._d[0][3] = 'resultado da última ação';
  ctx.onOpen();
  ok(reg._d.length === CAB + 1, 'reabrir não insere painel de novo',
     'linhas: ' + reg._d.length);
  ok(reg._d[0][3] === 'resultado da última ação',
     'e não apaga a resposta da última ação', String(reg._d[0][3]));
}

console.log('\n' + (falhas ? `❌ ${falhas} falha(s)` : '✅ todos os testes passaram'));
process.exit(falhas ? 1 : 0);
