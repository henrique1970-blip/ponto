// Testa as MIGRAÇÕES da planilha do ponto2 contra um mock do SpreadsheetApp com
// várias abas. Só migração: a planilha voltou a ser o registro bruto, sem
// cálculo nenhum.
//
// As três coisas cobertas aqui são irreversíveis se derem errado, e é por isso
// que o teste existe:
//   • a troca de nome (Saidas → Registros) não pode largar registro na aba
//     velha nem gravar por cima do que já foi renomeado à mão;
//   • a volta do painel apaga 3 linhas da planilha de quem chegou a colar
//     aquela versão — elas têm que ser as 3 do painel, nunca um registro;
//   • depois de qualquer uma das duas, o cabeçalho tem que estar na linha 1 e
//     os dados a partir da 2, que é de onde todo o resto do código lê.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'ponto2', 'apps-script.gs'), 'utf8');

// ── Mock do SpreadsheetApp ───────────────────────────────────────────────────
function novaAba(nome, grid) {
  const sh = {
    _d: grid ? grid.map(r => r.slice()) : [],
    _nome: nome,
    _frozen: 0, _hidden: [], _caixas: [], _regras: [], _pai: null,
    getName(){ return this._nome; },
    setName(n){ this._nome = n; return this; },
    getParent(){ return this._pai; },
    getLastRow(){ return this._d.length; },
    getLastColumn(){ return this._d.reduce((m,r)=>Math.max(m,r.length),0); },
    getMaxRows(){ return Math.max(this._d.length, 1000); },
    getMaxColumns(){ return Math.max(this.getLastColumn(), 16); },
    setFrozenRows(n){ this._frozen = n; return this; },
    setColumnWidth(){ return this; },
    setRowHeights(){ return this; },
    hideColumns(c){ if(!this._hidden.includes(c)) this._hidden.push(c); },
    appendRow(r){ this._d.push(r.slice()); },
    insertRowsAfter(){ return this; },
    insertColumnsAfter(){ return this; },
    deleteRows(lin, quantas){ this._d.splice(lin-1, quantas); },
    deleteColumn(c){ this._d.forEach(row => row.splice(c-1, 1)); },
    getConditionalFormatRules(){ return this._regras; },
    setConditionalFormatRules(rs){ this._regras = rs; return this; },
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
        // A foto de verdade é uma fórmula =IMAGE: ela tem que viajar como
        // fórmula, senão chega na aba nova como o resultado, que não se cola.
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
        setFontWeight(){ return r; }, setBackground(){ return r; },
      };
      return r;
    },
  };
  return sh;
}

function novaPlanilha(abas) {
  const ss = {
    _abas: abas || [],
    getSheetByName(n){ return this._abas.find(s => s.getName() === n) || null; },
    getSheets(){ return this._abas; },
    insertSheet(n){ const s = novaAba(n, []); s._pai = this; this._abas.push(s); return s; },
    toast(){},
  };
  ss._abas.forEach(s => { s._pai = ss; });
  return ss;
}

function contexto(ss) {
  const ctx = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      getActive: () => ss,
      newConditionalFormatRule: () => {
        const b = { whenFormulaSatisfied(f){ b._f = f; return b; }, setBackground(){ return b; },
                    setRanges(){ return b; },
                    build(){ return { getBooleanCondition: () => ({ getCriteriaValues: () => [b._f] }) }; } };
        return b;
      },
    },
    LockService: { getScriptLock: () => ({ waitLock(){}, releaseLock(){} }) },
    Utilities: {
      formatDate(dt, tz, fmt){
        const d = new Date(dt.getTime() - 3*3600e3);
        const p = n => String(n).padStart(2,'0');
        return fmt
          .replace('yyyy', d.getUTCFullYear()).replace('MM', p(d.getUTCMonth()+1))
          .replace('dd', p(d.getUTCDate())).replace('HH', p(d.getUTCHours()))
          .replace('mm', p(d.getUTCMinutes())).replace('ss', p(d.getUTCSeconds()));
      },
      newBlob(){ return {}; }, base64Decode(){ return []; },
    },
    ContentService: {
      MimeType: { JSON:'json', TEXT:'text' },
      createTextOutput(t){ return { _t:t, setMimeType(){ return this; } }; },
    },
    DriveApp: {}, PropertiesService: {}, Logger: { log(){} }, console,
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

function linha(id, nome, tipo, dia, hora) {
  const l = new Array(16).fill('');
  l[0] = id; l[1] = nome; l[2] = tipo;
  l[3] = dia.slice(8) + '/' + dia.slice(5,7) + '/' + dia.slice(0,4);
  l[4] = hora + ':00';
  l[9] = nome + '|' + dia + 'T' + hora + ':00-03:00';
  l[14] = false;
  return l;
}

const semRegistro = () =>
  ({ postData: { contents: JSON.stringify({ records: [] }) } });

console.log('\n【1】 Só existe a "Saidas" antiga — ela vira "Registros"');
{
  const velha = novaAba('Saidas', [
    COLS16.slice(),
    linha(1, 'Maria', 'Entrada', '2026-08-03', '07:00'),
    linha(2, 'Maria', 'Saída',   '2026-08-03', '16:00'),
  ]);
  const ss = novaPlanilha([velha]);
  contexto(ss).doPost(semRegistro());

  const reg = ss.getSheetByName('Registros');
  ok(!!reg, 'a aba passou a se chamar "Registros"',
     ss.getSheets().map(s=>s.getName()).join(', '));
  ok(ss.getSheets().length === 1, 'e nenhuma "Saidas" nova foi criada',
     ss.getSheets().map(s=>s.getName()).join(', '));
  ok(JSON.stringify(reg._d[0]) === JSON.stringify(COLS16),
     'o cabeçalho continua na linha 1', JSON.stringify(reg._d[0]));
  ok(reg._d[1][9] === 'Maria|2026-08-03T07:00:00-03:00',
     'e os registros continuam intactos', reg._d[1][9]);
}

console.log('\n【2】 As duas abas existindo — foi o que aconteceu ao renomear à mão');
{
  // "Registros" é a original renomeada na unha; "Saidas" é a que o código
  // recriou depois, com o último registro só.
  const reg = novaAba('Registros', [
    COLS16.slice(),
    linha(1, 'Maria', 'Entrada', '2026-08-03', '07:00'),
  ]);
  const perdida = novaAba('Saidas', [
    COLS16.slice(),
    linha(2, 'Maria', 'Saída', '2026-08-03', '16:00'),
  ]);
  const ss = novaPlanilha([reg, perdida]);
  contexto(ss).doPost(semRegistro());

  const alvo = ss.getSheetByName('Registros');
  ok(alvo._d.length === 3, 'o registro órfão da "Saidas" foi absorvido',
     'linhas de dados: ' + (alvo._d.length - 1));
  ok(alvo._d[2][9] === 'Maria|2026-08-03T16:00:00-03:00',
     'com a chave intacta, na sequência', alvo._d[2][9]);
  ok(!ss.getSheetByName('Saidas'), 'a aba antiga saiu do caminho');
  ok(ss.getSheets().some(s => s.getName().indexOf('Saidas (migrada') === 0),
     'mas não foi apagada — só aposentada',
     ss.getSheets().map(s=>s.getName()).join(', '));
}

console.log('\n【3】 Volta do painel — as 3 linhas saem, os registros ficam');
{
  // A planilha de quem chegou a colar a versão com painel: 3 linhas no topo,
  // cabeçalho na 4, e uma coluna "Anulado" a mais no fim.
  const cab = COLS16.concat(['Anulado']);
  const p = n => new Array(17).fill('').map((_, i) => (i === 0 ? n : ''));
  const dado = (id, nome, tipo, dia, hora) => linha(id, nome, tipo, dia, hora).concat([false]);

  const reg = novaAba('Registros', [
    p('Mês de referência'),
    p(false),
    p(false),
    cab,
    dado(1, 'Maria', 'Entrada', '2026-08-03', '07:00'),
    dado(2, 'Maria', 'Saída',   '2026-08-03', '16:00'),
  ]);
  reg._regras = [{ getBooleanCondition: () => ({ getCriteriaValues: () => ['=$O5=TRUE'] }) }];

  const ss = novaPlanilha([reg]);
  contexto(ss).doPost(semRegistro());

  ok(JSON.stringify(reg._d[0]) === JSON.stringify(COLS16),
     'o cabeçalho voltou para a linha 1, sem a coluna Anulado',
     JSON.stringify(reg._d[0]));
  ok(reg._d.length === 3, 'e sobraram exatamente os 2 registros',
     'linhas de dados: ' + (reg._d.length - 1));
  ok(reg._d[1][9] === 'Maria|2026-08-03T07:00:00-03:00' &&
     reg._d[2][9] === 'Maria|2026-08-03T16:00:00-03:00',
     'com as duas chaves intactas',
     JSON.stringify([reg._d[1][9], reg._d[2][9]]));
  ok(reg._d[1].length === 16, 'a coluna Anulado foi embora da linha de dados também',
     String(reg._d[1].length));
  ok(!reg._regras.some(r => String(r.getBooleanCondition().getCriteriaValues()[0]).indexOf('5') > 0),
     'e a regra de formatação que apontava para a linha 5 não ficou',
     JSON.stringify(reg._regras.map(r => r.getBooleanCondition().getCriteriaValues()[0])));

  // Rodar de novo não pode apagar mais nada.
  contexto(ss).doPost(semRegistro());
  ok(reg._d.length === 3, 'rodar de novo não apaga mais nada',
     'linhas de dados: ' + (reg._d.length - 1));
}

console.log('\n' + (falhas ? `❌ ${falhas} falha(s)` : '✅ todos os testes passaram'));
process.exit(falhas ? 1 : 0);
