// Testa o Apps Script (apps-script.gs) contra um mock do SpreadsheetApp.
// O que importa: as migrações da planilha não podem perder as chaves já
// gravadas, senão tudo que estiver pendente nos celulares volta duplicado.
//
// São duas migrações empilhadas hoje:
//   • 9 → 10 colunas (a "Precisão (m)" entrou antes da Chave);
//   • cabeçalho da linha 1 → linha 4, para o painel de botões caber acima dele.
// A segunda é a nova: ela EMPURRA os dados para baixo, e é justamente por isso
// que nada se perde — mas todo índice de leitura mudou junto.
const fs = require('fs');
const vm = require('vm');

const SRC = fs.readFileSync(require('path').join(__dirname,'..','apps-script.gs'), 'utf8');

const PAINEL = 3;      // linhas do painel
const CAB    = PAINEL + 1;   // linha do cabeçalho (1-based)
const D0     = CAB;          // índice 0-based da PRIMEIRA linha de dados

function novaPlanilha(grid, nome) {
  const d = grid ? grid.map(r => r.slice()) : null;
  const sheet = {
    _d: d || [],
    _nome: nome || 'Registros',
    _frozen: 0,
    _hidden: [],
    _caixas: [],
    _validacoes: {},
    _pai: null,
    getName(){ return this._nome; },
    setName(n){ this._nome = n; return this; },
    getParent(){ return this._pai; },
    getLastRow(){ return this._d.length; },
    getLastColumn(){ return this._d.reduce((m,r)=>Math.max(m,r.length),0); },
    getMaxRows(){ return Math.max(this._d.length, 1000); },
    getMaxColumns(){ return Math.max(this.getLastColumn(), 10); },
    setFrozenRows(n){ this._frozen = n; return this; },
    setColumnWidth(){ return this; },
    hideColumns(c){ if(!this._hidden.includes(c)) this._hidden.push(c); },
    appendRow(r){ this._d.push(r.slice()); },
    insertRowsBefore(lin, quantas){
      // igual ao Sheets: empurra a linha `lin` e as seguintes para baixo,
      // levando os dados junto — é o que salva o histórico na migração.
      const vazias = Array.from({length: quantas}, () => []);
      this._d.splice(lin-1, 0, ...vazias);
    },
    insertColumnBefore(c){
      // empurra a coluna c e as seguintes para a direita, com os dados.
      this._d.forEach(row => { while(row.length < c-1) row.push(''); row.splice(c-1, 0, ''); });
      this._hidden = this._hidden.map(h => h >= c ? h+1 : h);
    },
    insertColumnsAfter(){ return this; },
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
        getFormulas(){ return r.getValues().map(l => l.map(() => '')); },
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
        setFontWeight(){ return r; },  setBackground(){ return r; },
        setFontStyle(){ return r; },   setFontColor(){ return r; },
        setNumberFormat(){ return r; },setVerticalAlignment(){ return r; },
      };
      return r;
    },
  };
  return sheet;
}

function rodar(sheetInicial, records) {
  const ss = {
    _s: sheetInicial,
    getSheetByName(n){ return (this._s && this._s.getName() === n) ? this._s : null; },
    getSheets(){ return this._s ? [this._s] : []; },
    insertSheet(n){ this._s = novaPlanilha([], n); this._s._pai = this; return this._s; },
    toast(){},
  };
  if (ss._s) ss._s._pai = ss;

  const locks = [];
  const ctx = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      getActive: () => ss,
      newDataValidation: () => ({
        requireValueInList(){ return this; }, setAllowInvalid(){ return this; },
        build(){ return { lista: true }; },
      }),
      getUi(){
        const m = { createMenu(){ return m; }, addItem(){ return m; },
                    addSeparator(){ return m; }, addToUi(){ return m; } };
        return { createMenu: () => m };
      },
    },
    LockService: { getScriptLock: () => ({ waitLock(){ locks.push('lock'); }, releaseLock(){ locks.push('unlock'); } }) },
    Utilities: {
      formatDate(dt, tz, fmt){
        const p = n => String(n).padStart(2,'0');
        if (fmt === 'dd/MM/yyyy') return `${p(dt.getUTCDate())}/${p(dt.getUTCMonth()+1)}/${dt.getUTCFullYear()}`;
        if (fmt === 'yyyy-MM')    return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth()+1)}`;
        if (fmt === 'yyyy')       return String(dt.getUTCFullYear());
        return `${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}:${p(dt.getUTCSeconds())}`;
      },
    },
    ContentService: {
      MimeType: { JSON:'json', TEXT:'text' },
      createTextOutput(t){ return { _t:t, setMimeType(){ return this; } }; },
    },
    ScriptApp: {},
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  if (!records) return { ss, ctx, locks };
  const res = ctx.doPost({ postData: { contents: JSON.stringify({ records }) } });
  return { sheet: ss._s, resp: JSON.parse(res._t), locks };
}

// Abre a planilha sem enviar registro nenhum — é o que o usuário faz ao colar
// o código e recarregar a página.
function abrir(sheetInicial) {
  const { ss, ctx } = rodar(sheetInicial, null);
  ctx.onOpen();
  return ss._s;
}

let falhas = 0;
const ok = (c, nome, extra='') => {
  console.log((c?'  ✅ ':'  ❌ ')+nome+(c?'':'  → '+extra)); if(!c) falhas++;
};

const HDR10 = ['ID','Nome','Tipo','Data','Hora','Local','Latitude','Longitude','Precisão (m)','Chave'];
const rec = (id,nome,ts,acc) => ({
  id, userName:nome, type:'entry', timestamp:ts,
  locationName:'Fazenda Exemplo', lat:-19.9167, lon:-43.9345, accuracy:acc,
});

console.log('\n【A】 Planilha nova');
{
  const { sheet, resp } = rodar(null, [rec(1,'Maria','2026-07-31T12:00:00.000Z',12)]);
  ok(JSON.stringify(sheet._d[CAB-1]) === JSON.stringify(HDR10),
     'cabeçalho com 10 colunas, na linha ' + CAB, JSON.stringify(sheet._d[CAB-1]));
  ok(sheet._hidden.includes(10), 'coluna Chave (J) oculta', JSON.stringify(sheet._hidden));
  ok(sheet._d[D0][8] === 12, 'precisão gravada na coluna I', sheet._d[D0][8]);
  ok(sheet._d[D0][9] === 'Maria|2026-07-31T12:00:00.000Z', 'chave na coluna J', sheet._d[D0][9]);
  ok(resp.saved === 1, 'resposta saved=1');
}

console.log('\n【B】 Planilha de 9 colunas EM USO — a migração não pode perder chaves');
{
  const antiga = [
    ['ID','Nome','Tipo','Data','Hora','Local','Latitude','Longitude','Chave'],
    [1,'Maria','Entrada','30/07/2026','08:00:00','Fazenda',-19.9,-43.9,'Maria|2026-07-30T11:00:00.000Z'],
    [2,'João','Entrada','30/07/2026','08:05:00','Fazenda',-19.9,-43.9,'João|2026-07-30T11:05:00.000Z'],
  ];
  // O celular reenvia o registro da Maria (já na planilha) + um novo do João.
  const { sheet, resp } = rodar(novaPlanilha(antiga), [
    rec(1,'Maria','2026-07-30T11:00:00.000Z',15),
    rec(9,'João','2026-07-31T12:30:00.000Z',8),
  ]);
  ok(JSON.stringify(sheet._d[CAB-1]) === JSON.stringify(HDR10),
     'cabeçalho migrado para 10 colunas', JSON.stringify(sheet._d[CAB-1]));
  ok(sheet._d[D0][9] === 'Maria|2026-07-30T11:00:00.000Z', 'chave antiga preservada em J', sheet._d[D0][9]);
  ok(sheet._d[D0][8] === '', 'precisão vazia nas linhas antigas', JSON.stringify(sheet._d[D0][8]));
  ok(sheet._d[D0][7] === -43.9, 'longitude antiga continua em H', sheet._d[D0][7]);
  ok(resp.saved === 1 && resp.ignorados === 1, 'reenvio da Maria ignorado, João gravado',
     JSON.stringify(resp));
  ok(sheet._d.length === CAB + 3, 'a planilha ficou com 3 linhas de dados', sheet._d.length - CAB);
  ok(sheet._d[D0+2][8] === 8, 'precisão do novo registro em I', sheet._d[D0+2][8]);
  ok(sheet._hidden.includes(10), 'Chave oculta após migrar', JSON.stringify(sheet._hidden));
}

console.log('\n【B2】 O painel entra acima do cabeçalho sem empurrar nada para fora');
{
  const atual = [
    HDR10.slice(),
    [1,'Maria','Entrada','31/07/2026','09:00:00','Fazenda',-19.9,-43.9,12,'Maria|2026-07-31T12:00:00.000Z'],
  ];
  const { sheet } = rodar(novaPlanilha(atual), [rec(2,'Ana','2026-07-31T13:00:00.000Z',20)]);
  ok(sheet._d[0][0] === 'Mês de referência', 'A1 vira o rótulo do mês de referência',
     JSON.stringify(sheet._d[0][0]));
  ok(sheet._caixas.includes('2,1') && sheet._caixas.includes('3,1'),
     'as duas caixinhas-botão nascem em A2 e A3', JSON.stringify(sheet._caixas));
  ok(sheet._d[1][0] === false && sheet._d[2][0] === false,
     'e nascem desmarcadas', JSON.stringify([sheet._d[1][0], sheet._d[2][0]]));
  ok(sheet._frozen === CAB, 'as ' + CAB + ' primeiras linhas ficam congeladas', sheet._frozen);
  ok(sheet._d[D0][9] === 'Maria|2026-07-31T12:00:00.000Z',
     'a linha da Maria desceu inteira, com a chave', sheet._d[D0][9]);
}

console.log('\n【C】 Planilha já migrada — roda de novo sem estragar nada');
{
  const atual = [
    ['Mês de referência','julho/2026','','', '','','','','',''],
    [false,'◀  Calcular horas do mês','','','','','','','',''],
    [false,'◀  Mover os dados do mês','','','','','','','',''],
    HDR10.slice(),
    [1,'Maria','Entrada','31/07/2026','09:00:00','Fazenda',-19.9,-43.9,12,'Maria|2026-07-31T12:00:00.000Z'],
  ];
  const { sheet, resp } = rodar(novaPlanilha(atual), [
    rec(1,'Maria','2026-07-31T12:00:00.000Z',12),
    rec(2,'Ana','2026-07-31T13:00:00.000Z',20),
  ]);
  ok(JSON.stringify(sheet._d[CAB-1]) === JSON.stringify(HDR10), 'cabeçalho intacto',
     JSON.stringify(sheet._d[CAB-1]));
  ok(sheet._d.length === CAB + 2, 'nenhuma linha de painel foi inserida de novo',
     sheet._d.length - CAB);
  ok(resp.saved === 1 && resp.ignorados === 1, 'dedup continua valendo', JSON.stringify(resp));
  ok(sheet._d[D0+1][1] === 'Ana', 'só a Ana entrou', JSON.stringify(sheet._d[D0+1][1]));
}

console.log('\n【D】 Registro sem precisão (versão antiga do app ainda instalada)');
{
  const r = rec(5,'Pedro','2026-07-31T14:00:00.000Z',undefined);
  delete r.accuracy;
  const { sheet, resp } = rodar(null, [r]);
  ok(resp.saved === 1, 'grava mesmo assim');
  ok(sheet._d[D0][8] === '', 'precisão fica vazia, sem quebrar', JSON.stringify(sheet._d[D0][8]));
  ok(sheet._d[D0][9] === 'Pedro|2026-07-31T14:00:00.000Z', 'chave no lugar certo', sheet._d[D0][9]);
}

console.log('\n【D2】 Registro sem localização (aparelho fora de rede)');
{
  const r = rec(7,'Ana','2026-07-31T16:00:00.000Z',null);
  r.lat = null; r.lon = null; r.semLocal = true;
  const { sheet, resp } = rodar(null, [r]);
  ok(resp.saved === 1, 'grava o ponto assim mesmo');
  ok(sheet._d[D0][6] === '' && sheet._d[D0][7] === '', 'latitude e longitude vazias na planilha',
     JSON.stringify([sheet._d[D0][6], sheet._d[D0][7]]));
  ok(sheet._d[D0][8] === '', 'precisão vazia', JSON.stringify(sheet._d[D0][8]));
  ok(sheet._d[D0][3] === '31/07/2026' && sheet._d[D0][5] === 'Fazenda Exemplo',
     'data e local continuam preenchidos', JSON.stringify([sheet._d[D0][3], sheet._d[D0][5]]));
  ok(sheet._d[D0][9] === 'Ana|2026-07-31T16:00:00.000Z', 'chave de dedup normal', sheet._d[D0][9]);
}

console.log('\n【E】 Lock');
{
  const { locks } = rodar(null, [rec(1,'X','2026-07-31T15:00:00.000Z',5)]);
  ok(locks.join(',') === 'lock,unlock', 'lock adquirido e liberado', locks.join(','));
}

console.log('\n【F】 Abrir a planilha já desenha o painel');
{
  // Foi o furo relatado: colar o código e recarregar mostrava o menu e mais
  // nada. O painel só nascia no primeiro clique de um item do menu.
  const atual = [
    HDR10.slice(),
    [1,'Maria','Entrada','31/07/2026','09:00:00','Fazenda',-19.9,-43.9,12,'Maria|2026-07-31T12:00:00.000Z'],
  ];
  const sheet = abrir(novaPlanilha(atual));
  ok(sheet._d[0][0] === 'M\u00eas de refer\u00eancia', 'o painel está desenhado só de abrir',
     JSON.stringify(sheet._d[0][0]));
  ok(sheet._caixas.includes('2,1') && sheet._caixas.includes('3,1'),
     'com as duas caixinhas', JSON.stringify(sheet._caixas));
  ok(String(sheet._d[0][3]).indexOf('Preparar planilha') > 0,
     'a D1 avisa que falta armar as caixinhas', String(sheet._d[0][3]));
  ok(sheet._d[D0][9] === 'Maria|2026-07-31T12:00:00.000Z',
     'e a linha da Maria desceu inteira', sheet._d[D0][9]);
}

console.log('\n' + (falhas ? `❌ ${falhas} falha(s)` : '✅ todos os testes passaram'));
process.exit(falhas ? 1 : 0);
