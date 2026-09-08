// Testa o Apps Script (apps-script.gs) contra um mock do SpreadsheetApp.
// O que importa: a migração da planilha de 9 colunas não pode perder as chaves
// já gravadas, senão tudo que estiver pendente nos celulares volta duplicado.
const fs = require('fs');
const vm = require('vm');

const SRC = fs.readFileSync(require('path').join(__dirname,'..','apps-script.gs'), 'utf8');

function novaPlanilha(grid) {
  const d = grid ? grid.map(r => r.slice()) : null;
  const sheet = {
    _d: d || [],
    _frozen: 0,
    _hidden: [],
    getLastRow(){ return this._d.length; },
    getLastColumn(){ return this._d.reduce((m,r)=>Math.max(m,r.length),0); },
    setFrozenRows(n){ this._frozen = n; },
    getMaxColumns(){ return Math.max(this.getLastColumn(), 11); },
    deleteRows(lin, quantas){ this._d.splice(lin-1, quantas); },
    deleteColumn(c){ this._d.forEach(row => row.splice(c-1, 1)); },
    _regras: [],
    getConditionalFormatRules(){ return this._regras; },
    setConditionalFormatRules(rs){ this._regras = rs; return this; },
    hideColumns(c){ if(!this._hidden.includes(c)) this._hidden.push(c); },
    appendRow(r){ this._d.push(r.slice()); },
    insertColumnBefore(c){
      // igual ao Sheets: empurra a coluna c e as seguintes para a direita,
      // levando os dados junto.
      this._d.forEach(row => { while(row.length < c-1) row.push(''); row.splice(c-1, 0, ''); });
      this._hidden = this._hidden.map(h => h >= c ? h+1 : h);
    },
    getRange(lin, col, nl=1, nc=1){
      const s = this;
      return {
        getValue(){ const r = s._d[lin-1]; return r && r[col-1] !== undefined ? r[col-1] : ''; },
        getValues(){
          const out = [];
          for (let i=0;i<nl;i++){
            const r = s._d[lin-1+i] || [];
            const linha = [];
            for (let j=0;j<nc;j++) linha.push(r[col-1+j] !== undefined ? r[col-1+j] : '');
            out.push(linha);
          }
          return out;
        },
        setValues(vals){
          vals.forEach((v,i)=>{
            const idx = lin-1+i;
            while (s._d.length <= idx) s._d.push([]);
            const r = s._d[idx];
            v.forEach((x,j)=>{ r[col-1+j] = x; });
          });
        },
        setValue(v){ const r = s._d[lin-1] || (s._d[lin-1] = []); r[col-1] = v; },
      };
    },
  };
  return sheet;
}

function rodar(sheetInicial, records) {
  const ss = {
    _s: sheetInicial,
    getSheetByName(){ return this._s; },
    insertSheet(){ this._s = novaPlanilha([]); return this._s; },
  };
  const locks = [];
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    LockService: { getScriptLock: () => ({ waitLock(){ locks.push('lock'); }, releaseLock(){ locks.push('unlock'); } }) },
    Utilities: {
      formatDate(dt, tz, fmt){
        const p = n => String(n).padStart(2,'0');
        return fmt === 'dd/MM/yyyy'
          ? `${p(dt.getUTCDate())}/${p(dt.getUTCMonth()+1)}/${dt.getUTCFullYear()}`
          : `${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}:${p(dt.getUTCSeconds())}`;
      },
    },
    ContentService: {
      MimeType: { JSON:'json', TEXT:'text' },
      createTextOutput(t){ return { _t:t, setMimeType(){ return this; } }; },
    },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const res = ctx.doPost({ postData: { contents: JSON.stringify({ records }) } });
  return { sheet: ss._s, resp: JSON.parse(res._t), locks };
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
  ok(JSON.stringify(sheet._d[0]) === JSON.stringify(HDR10), 'cabeçalho com 10 colunas', JSON.stringify(sheet._d[0]));
  ok(sheet._hidden.includes(10), 'coluna Chave (J) oculta', JSON.stringify(sheet._hidden));
  ok(sheet._d[1][8] === 12, 'precisão gravada na coluna I', sheet._d[1][8]);
  ok(sheet._d[1][9] === 'Maria|2026-07-31T12:00:00.000Z', 'chave na coluna J', sheet._d[1][9]);
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
  ok(JSON.stringify(sheet._d[0]) === JSON.stringify(HDR10), 'cabeçalho migrado para 10 colunas', JSON.stringify(sheet._d[0]));
  ok(sheet._d[1][9] === 'Maria|2026-07-30T11:00:00.000Z', 'chave antiga preservada em J', sheet._d[1][9]);
  ok(sheet._d[1][8] === '', 'precisão vazia nas linhas antigas', JSON.stringify(sheet._d[1][8]));
  ok(sheet._d[1][7] === -43.9, 'longitude antiga continua em H', sheet._d[1][7]);
  ok(resp.saved === 1 && resp.ignorados === 1, 'reenvio da Maria ignorado, João gravado',
     JSON.stringify(resp));
  ok(sheet._d.length === 4, 'a planilha ficou com 3 linhas de dados', sheet._d.length-1);
  ok(sheet._d[3][8] === 8, 'precisão do novo registro em I', sheet._d[3][8]);
  ok(sheet._hidden.includes(10), 'Chave oculta após migrar', JSON.stringify(sheet._hidden));
}

console.log('\n【C】 Planilha já migrada — roda de novo sem estragar nada');
{
  const atual = [
    HDR10.slice(),
    [1,'Maria','Entrada','31/07/2026','09:00:00','Fazenda',-19.9,-43.9,12,'Maria|2026-07-31T12:00:00.000Z'],
  ];
  const { sheet, resp } = rodar(novaPlanilha(atual), [
    rec(1,'Maria','2026-07-31T12:00:00.000Z',12),
    rec(2,'Ana','2026-07-31T13:00:00.000Z',20),
  ]);
  ok(JSON.stringify(sheet._d[0]) === JSON.stringify(HDR10), 'cabeçalho intacto', JSON.stringify(sheet._d[0]));
  ok(resp.saved === 1 && resp.ignorados === 1, 'dedup continua valendo', JSON.stringify(resp));
  ok(sheet._d.length === 3, 'só a Ana entrou', sheet._d.length-1);
}

console.log('\n【D】 Registro sem precisão (versão antiga do app ainda instalada)');
{
  const r = rec(5,'Pedro','2026-07-31T14:00:00.000Z',undefined);
  delete r.accuracy;
  const { sheet, resp } = rodar(null, [r]);
  ok(resp.saved === 1, 'grava mesmo assim');
  ok(sheet._d[1][8] === '', 'precisão fica vazia, sem quebrar', JSON.stringify(sheet._d[1][8]));
  ok(sheet._d[1][9] === 'Pedro|2026-07-31T14:00:00.000Z', 'chave no lugar certo', sheet._d[1][9]);
}

console.log('\n【D2】 Registro sem localização (aparelho fora de rede)');
{
  const r = rec(7,'Ana','2026-07-31T16:00:00.000Z',null);
  r.lat = null; r.lon = null; r.semLocal = true;
  const { sheet, resp } = rodar(null, [r]);
  ok(resp.saved === 1, 'grava o ponto assim mesmo');
  ok(sheet._d[1][6] === '' && sheet._d[1][7] === '', 'latitude e longitude vazias na planilha',
     JSON.stringify([sheet._d[1][6], sheet._d[1][7]]));
  ok(sheet._d[1][8] === '', 'precisão vazia', JSON.stringify(sheet._d[1][8]));
  ok(sheet._d[1][3] === '31/07/2026' && sheet._d[1][5] === 'Fazenda Exemplo',
     'data e local continuam preenchidos', JSON.stringify([sheet._d[1][3], sheet._d[1][5]]));
  ok(sheet._d[1][9] === 'Ana|2026-07-31T16:00:00.000Z', 'chave de dedup normal', sheet._d[1][9]);
}

console.log('\n【E】 Lock');
{
  const { locks } = rodar(null, [rec(1,'X','2026-07-31T15:00:00.000Z',5)]);
  ok(locks.join(',') === 'lock,unlock', 'lock adquirido e liberado', locks.join(','));
}

console.log('\n【F】 Volta do painel — as 3 linhas saem, os registros ficam');
{
  // A planilha de quem chegou a colar a versão com painel de botões: 3 linhas no
  // topo, cabeçalho na 4, e uma coluna "Anulado" a mais no fim. Aquela versão
  // saiu; o caminho de volta tem que existir no código, senão o cabeçalho fica
  // na linha 4 enquanto tudo lê a partir da 2.
  const cab = HDR10.concat(['Anulado']);
  const p = n => [n,'','','','','','','','','',''];
  const antiga = [
    p('Mês de referência'), p(false), p(false),
    cab,
    [1,'Maria','Entrada','31/07/2026','09:00:00','Fazenda',-19.9,-43.9,12,'Maria|2026-07-31T12:00:00.000Z',false],
    [2,'João', 'Entrada','31/07/2026','09:05:00','Fazenda',-19.9,-43.9,12,'João|2026-07-31T12:05:00.000Z',false],
  ];
  const sheet = novaPlanilha(antiga);
  sheet._regras = [{ getBooleanCondition: () => ({ getCriteriaValues: () => ['=$K5=TRUE'] }) }];

  const { resp } = rodar(sheet, [rec(9,'Ana','2026-07-31T13:00:00.000Z',8)]);

  ok(JSON.stringify(sheet._d[0]) === JSON.stringify(HDR10),
     'o cabeçalho voltou para a linha 1, sem a coluna Anulado',
     JSON.stringify(sheet._d[0]));
  ok(sheet._d[1][9] === 'Maria|2026-07-31T12:00:00.000Z' &&
     sheet._d[2][9] === 'João|2026-07-31T12:05:00.000Z',
     'as duas chaves antigas continuam lá, na ordem',
     JSON.stringify([sheet._d[1][9], sheet._d[2][9]]));
  ok(sheet._d[1].length === 10, 'a coluna Anulado saiu das linhas de dados também',
     String(sheet._d[1].length));
  ok(!sheet._regras.length, 'e a regra que apontava para a linha 5 não ficou',
     JSON.stringify(sheet._regras.length));
  ok(resp.saved === 1 && sheet._d.length === 4,
     'o registro novo entra na linha certa, depois dos dois',
     JSON.stringify(resp) + ' / ' + sheet._d.length);
}

console.log('\n【G】 As duas cópias do Apps Script não podem divergir');
{
  // A raiz é autossuficiente: a tela de Admin mostra e copia o código SEM REDE,
  // então ele vive embutido no index.html além do arquivo .gs. Duas cópias é o
  // preço de não depender de rede — este teste é o que impede que se separem.
  const html = fs.readFileSync(require('path').join(__dirname,'..','index.html'), 'utf8');
  const abre  = html.indexOf('const APPS_SCRIPT = `');
  const fecha = html.indexOf('`;', abre);
  ok(abre >= 0 && fecha > abre, 'o literal APPS_SCRIPT existe no index.html');

  const embutido  = html.slice(abre + 'const APPS_SCRIPT = `'.length, fecha);
  const doArquivo = SRC.slice(SRC.indexOf('const TZ'));
  const limpa = t => t.replace(/\r/g, '').trim();
  ok(limpa(embutido) === limpa(doArquivo),
     'o embutido é igual ao apps-script.gs (do `const TZ` em diante)',
     `embutido ${limpa(embutido).length} bytes × arquivo ${limpa(doArquivo).length} bytes`);
  ok(!embutido.includes('`') && !embutido.includes('${'),
     'e não tem crase nem ${…}, que quebrariam o literal');
}

console.log('\n' + (falhas ? `❌ ${falhas} falha(s)` : '✅ todos os testes passaram'));
process.exit(falhas ? 1 : 0);
