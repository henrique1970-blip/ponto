// Ponto Saída — webhook do Google Sheets
//
// Como instalar:
//   1. Crie uma planilha no Google Sheets.
//   2. Extensões → Apps Script. Apague o conteúdo e cole este arquivo inteiro.
//   3. Implantar → Nova implantação → tipo "App da Web".
//   4. "Executar como": sua conta.  "Quem pode acessar": Qualquer pessoa.
//   5. Copie a URL /exec e cole no campo "URL do Webhook" do app (tela de admin).
//
// Ao reimplantar depois de editar: Implantar → Gerenciar implantações → ✏️ →
// Versão: Nova versão. Se criar uma implantação NOVA, a URL muda e o app para
// de enviar até você colar a URL nova.
//
// ⚠ ATUALIZANDO DE UMA VERSÃO ANTERIOR: esta versão grava a FOTO do registro no
// Google Drive, o que exige uma permissão nova. Ao reimplantar, rode uma vez a
// função `autorizar` no editor (▶ Executar) e aceite o acesso ao Drive — senão
// os registros continuam entrando, mas sem foto.

const TZ    = 'America/Sao_Paulo';
const ABA   = 'Saidas';

// A 'Chave' precisa continuar na coluna 10: linhas antigas já foram gravadas com
// ela ali, e é por ela que a deduplicação reconhece um reenvio. Colunas novas
// entram DEPOIS dela.
const COLS  = ['ID','Nome','Tipo','Data','Hora','Local','Confirmacao',
               'Latitude','Longitude','Chave','Foto','Distancia','Margem','Rigor','Conferido'];
const CHAVE = 10;   // coluna da chave de deduplicação (A=1 … J=10)
const FOTO  = 11;   // coluna da miniatura
const DIST  = 12;   // coluna da distância do reconhecimento
const CONF  = 15;   // coluna da caixinha "conferido"

// Acima desta distância o reconhecimento passou "raspando" — não está errado,
// mas é onde o erro mora. A planilha destaca essas linhas para conferência.
const DIST_REVISAO = 0.40;

// Pasta do Drive onde as fotos ficam. É criada sozinha no primeiro registro.
const FOTO_PASTA = 'Ponto Saida - Fotos';

// true  → a foto aparece DENTRO da célula (=IMAGE). Exige tornar cada arquivo
//         visível a "qualquer pessoa com o link" — quem tiver o link vê a foto.
// false → grava só o link do Drive; a foto continua privada, mas não aparece
//         na planilha (é preciso clicar).
const FOTO_PUBLICA = true;

const ALTURA_LINHA = 64;   // px — sem isso a imagem sai espremida na célula

function doPost(e) {
  // O app reenvia tudo que não foi confirmado. Se dois envios chegarem juntos,
  // o lock evita que os dois leiam a planilha antes de qualquer um escrever.
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);

    const records = (JSON.parse(e.postData.contents).records) || [];
    const sheet   = getSheet_();
    const vistos  = chavesExistentes_(sheet);
    const linhas  = [];

    records.forEach(function (r) {
      // Chave estável: o mesmo registro reenviado tem nome e timestamp iguais.
      // Não usar r.id — ele é sequencial POR APARELHO, então dois celulares
      // geram ids repetidos para saídas diferentes.
      const chave = r.userName + '|' + r.timestamp;
      if (vistos[chave]) return;          // já está na planilha: reenvio, ignora
      vistos[chave] = true;

      const dt = new Date(r.timestamp);
      linhas.push([
        r.id,
        r.userName,
        'Saída',
        Utilities.formatDate(dt, TZ, 'dd/MM/yyyy'),
        Utilities.formatDate(dt, TZ, 'HH:mm:ss'),
        r.locationName,
        r.method === 'gesto' ? 'Gesto 👍' : 'Botão',
        r.lat != null ? r.lat : '',
        r.lon != null ? r.lon : '',
        chave,
        celulaFoto_(r.foto, r.userName, dt),
        r.dist   != null ? r.dist   : '',
        r.margem != null ? r.margem : '',
        r.rigor  || '',
        false                              // Conferido — caixinha desmarcada
      ]);
    });

    if (linhas.length) {
      const inicio = sheet.getLastRow() + 1;
      sheet.getRange(inicio, 1, linhas.length, COLS.length).setValues(linhas);
      sheet.setRowHeights(inicio, linhas.length, ALTURA_LINHA);
      sheet.getRange(inicio, CONF, linhas.length, 1).insertCheckboxes();
    }

    return json_({ ok: true, saved: linhas.length, ignorados: records.length - linhas.length });

  } catch (err) {
    return json_({ ok: false, error: err.message });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return ContentService.createTextOutput('Ponto Saida OK')
    .setMimeType(ContentService.MimeType.TEXT);
}

// Rode esta função uma vez no editor para conceder o acesso ao Drive.
function autorizar() {
  pastaFotos_();
  SpreadsheetApp.getActiveSpreadsheet().getName();
}

// ─── CONFERÊNCIA ─────────────────────────────────────────────────────────────
// A foto só serve se alguém olhar. Este menu transforma "temos as fotos" em uma
// rotina: destaca o que passou raspando e mostra quanto falta conferir.
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Ponto Saída')
    .addItem('Destacar registros a conferir', 'formatarPlanilha')
    .addItem('Quantos faltam conferir?', 'resumoConferencia')
    .addToUi();
}

// Formatação condicional: as regras ficam gravadas na planilha e valem também
// para as linhas que chegarem depois — não é preciso rodar de novo.
function formatarPlanilha() { formatar_(getSheet_()); }

function formatar_(sheet) {
  // As regras precisam alcançar as linhas que ainda não existem; a grade nova do
  // Sheets já vem com 1000, mas uma planilha enxuta pode ter menos.
  const faltamLinhas = 1000 - sheet.getMaxRows();
  if (faltamLinhas > 0) sheet.insertRowsAfter(sheet.getMaxRows(), faltamLinhas);

  const faixa  = sheet.getRange(2, 1, sheet.getMaxRows() - 1, COLS.length);
  const colD   = colLetra_(DIST), colC = colLetra_(CONF);

  // $ nas colunas para a regra pintar a LINHA inteira, não só a célula testada.
  const suspeito = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($' + colD + '2<>"", $' + colD + '2>=' + DIST_REVISAO +
                          ', NOT($' + colC + '2))')
    .setBackground('#FFE8CC')
    .setRanges([faixa])
    .build();

  const conferido = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$' + colC + '2=TRUE')
    .setBackground('#E6F4EA')
    .setRanges([faixa])
    .build();

  // Substitui só as nossas regras se formatarPlanilha for rodada duas vezes.
  const outras = sheet.getConditionalFormatRules()
    .filter(function (r) {
      const b = r.getBooleanCondition();
      const v = b && b.getCriteriaValues()[0];
      return !(typeof v === 'string' && v.indexOf('$' + colC + '2') >= 0);
    });
  sheet.setConditionalFormatRules(outras.concat([suspeito, conferido]));

  const n = sheet.getLastRow() - 1;
  if (n > 0) sheet.getRange(2, CONF, n, 1).insertCheckboxes();

  SpreadsheetApp.getActive().toast(
    'Linhas com Distancia ≥ ' + DIST_REVISAO + ' ficam em laranja até a caixinha ' +
    '"Conferido" ser marcada.', 'Ponto Saída', 8);
}

function resumoConferencia() {
  const sheet = getSheet_();
  const n = sheet.getLastRow() - 1;
  if (n < 1) { SpreadsheetApp.getActive().toast('Nenhum registro ainda.', 'Ponto Saída', 5); return; }

  const dados = sheet.getRange(2, 1, n, COLS.length).getValues();
  let suspeitos = 0, pendentes = 0;
  dados.forEach(function (l) {
    const d = l[DIST - 1];
    if (d === '' || d === null || d < DIST_REVISAO) return;
    suspeitos++;
    if (l[CONF - 1] !== true) pendentes++;
  });

  SpreadsheetApp.getActive().toast(
    suspeitos + ' registro(s) com Distancia ≥ ' + DIST_REVISAO + '. ' +
    pendentes + ' ainda sem conferir.', 'Ponto Saída', 10);
}

function colLetra_(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - 1 - r) / 26; }
  return s;
}

// ─── FOTO ────────────────────────────────────────────────────────────────────
// A foto chega como data URL (base64) junto do registro. Ela é a prova de quem
// realmente estava na câmera — se o reconhecimento errar a pessoa, é aqui que o
// erro aparece.
function celulaFoto_(dataUrl, nome, dt) {
  if (!dataUrl) return '';
  try {
    const m = /^data:(image\/[\w+.-]+);base64,(.+)$/.exec(String(dataUrl));
    if (!m) return '';

    const arquivo = String(nome).replace(/[^\w]+/g, '_') + '_' +
                    Utilities.formatDate(dt, TZ, 'yyyyMMdd_HHmmss') + '.jpg';
    const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], arquivo);
    const file = pastaFotos_().createFile(blob);

    if (!FOTO_PUBLICA) return 'https://drive.google.com/file/d/' + file.getId() + '/view';

    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    // lh3 renderiza dentro do =IMAGE; o /uc?export=view costuma falhar.
    // Um argumento só: o separador (,/;) muda com o idioma da planilha.
    return '=IMAGE("https://lh3.googleusercontent.com/d/' + file.getId() + '")';

  } catch (err) {
    // Sem permissão do Drive ou cota estourada: o ponto não pode deixar de ser
    // registrado por causa da foto.
    return 'erro: ' + err.message;
  }
}

function pastaFotos_() {
  const achou = DriveApp.getFoldersByName(FOTO_PASTA);
  return achou.hasNext() ? achou.next() : DriveApp.createFolder(FOTO_PASTA);
}

// ─── PLANILHA ────────────────────────────────────────────────────────────────
function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(ABA);
  if (!sheet) {
    sheet = ss.insertSheet(ABA);
    sheet.appendRow(COLS);
    sheet.setFrozenRows(1);
    sheet.hideColumns(CHAVE);          // a chave é uso interno, não polui a vista
    sheet.setColumnWidth(FOTO, ALTURA_LINHA);
    formatar_(sheet);                  // direto, para não reentrar em getSheet_()
  } else {
    // Uma planilha antiga pode ter menos colunas do que a grade precisa agora —
    // sem isso, tanto o cabeçalho quanto o setValues das linhas estourariam.
    const falta = COLS.length - sheet.getMaxColumns();
    if (falta > 0) sheet.insertColumnsAfter(sheet.getMaxColumns(), falta);
    ajustarCabecalho_(sheet);
  }
  return sheet;
}

// Planilhas criadas antes desta versão têm 10 colunas. Completa o cabeçalho sem
// mexer nas linhas já gravadas (a Chave continua na coluna 10, então a
// deduplicação do histórico segue funcionando).
function ajustarCabecalho_(sheet) {
  const atual = sheet.getRange(1, 1, 1, COLS.length).getValues()[0];
  let falta = false;
  for (let i = 0; i < COLS.length; i++) if (atual[i] !== COLS[i]) falta = true;
  if (!falta) return;

  sheet.getRange(1, 1, 1, COLS.length).setValues([COLS]);
  sheet.setFrozenRows(1);
  sheet.hideColumns(CHAVE);
  sheet.setColumnWidth(FOTO, ALTURA_LINHA);
}

function chavesExistentes_(sheet) {
  const n = sheet.getLastRow() - 1;    // desconta o cabeçalho
  const vistos = {};
  if (n < 1) return vistos;
  sheet.getRange(2, CHAVE, n, 1).getValues().forEach(function (linha) {
    if (linha[0]) vistos[linha[0]] = true;
  });
  return vistos;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
