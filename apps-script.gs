// Ponto Digital — webhook do Google Sheets
//
// Como instalar:
//   1. Crie uma planilha no Google Sheets.
//   2. Extensões → Apps Script. Apague o conteúdo e cole este arquivo inteiro.
//   3. Implantar → Nova implantação → tipo "App da Web".
//   4. "Executar como": sua conta.  "Quem pode acessar": Qualquer pessoa.
//   5. Copie a URL /exec e cole no campo "URL do Webhook" do app (tela de Admin).
//
// Ao reimplantar depois de editar: Implantar → Gerenciar implantações → ✏️ →
// Versão: Nova versão. Se criar uma implantação NOVA, a URL muda e o app para
// de enviar até você colar a URL nova.

const TZ    = 'America/Sao_Paulo';
const ABA   = 'Registros';

// Selo da versao implantada. Colar o codigo neste editor NAO muda o que a URL
// /exec executa -- a implantacao aponta para uma versao congelada, e so
// "Gerenciar implantacoes -> editar -> Nova versao" a move. Abrir a /exec no
// navegador mostra este texto: e assim que se sabe, de fora, qual codigo esta
// no ar. Suba o numero sempre que mexer em algo que a /exec faz.
const VERSAO = 'v2 - registro puro (sem calculos na planilha)';
const COLS  = ['ID','Nome','Tipo','Data','Hora','Local','Latitude','Longitude','Precisão (m)','Chave'];
const PREC  = 9;   // raio de erro do GPS informado pelo aparelho (A=1 … I=9)
const CHAVE = 10;  // coluna da chave de deduplicação, oculta (J=10)

function doPost(e) {
  // O app reenvia tudo que ainda não foi confirmado. Se dois envios chegarem
  // juntos, o lock evita que os dois leiam a planilha antes de alguém escrever.
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
      // geram ids repetidos para registros diferentes.
      const chave = r.userName + '|' + r.timestamp;
      if (vistos[chave]) return;          // já está na planilha: reenvio, ignora
      vistos[chave] = true;

      const dt = new Date(r.timestamp);
      linhas.push([
        r.id,
        r.userName,
        r.type === 'entry' ? 'Entrada' : 'Saída',
        Utilities.formatDate(dt, TZ, 'dd/MM/yyyy'),
        Utilities.formatDate(dt, TZ, 'HH:mm:ss'),
        r.locationName,
        r.lat != null ? r.lat : '',
        r.lon != null ? r.lon : '',
        r.accuracy != null ? r.accuracy : '',
        chave
      ]);
    });

    if (linhas.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, linhas.length, COLS.length).setValues(linhas);
    }

    return json_({ ok: true, saved: linhas.length, ignorados: records.length - linhas.length });

  } catch (err) {
    return json_({ ok: false, error: err.message });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return ContentService.createTextOutput('Ponto Digital OK - ' + VERSAO)
    .setMimeType(ContentService.MimeType.TEXT);
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(ABA);
  if (!sheet) {
    sheet = ss.insertSheet(ABA);
    sheet.getRange(1, 1, 1, COLS.length).setValues([COLS]);
    sheet.setFrozenRows(1);
    sheet.hideColumns(CHAVE);          // a chave é uso interno, não polui a vista
    return sheet;
  }

  // Quem chegou a colar a versão com painel tem 3 linhas a mais no topo: tira
  // primeiro, senão tudo abaixo lê a linha errada.
  removerPainel_(sheet);

  // Planilha do layout de 9 colunas (Chave na I, sem Precisão): abre espaço na I.
  // insertColumnBefore arrasta a coluna Chave inteira — COM os dados — para a J,
  // então as chaves já gravadas continuam valendo e nada volta em duplicata.
  if (sheet.getRange(1, PREC).getValue() === 'Chave') sheet.insertColumnBefore(PREC);

  // Cabeçalho fora do padrão (planilha antiga de 8 colunas, ou a migração acima
  // que deixou a I sem título): reescreve a linha 1 inteira.
  const atual = sheet.getRange(1, 1, 1, COLS.length).getValues()[0];
  if (atual.join('|') !== COLS.join('|')) {
    sheet.getRange(1, 1, 1, COLS.length).setValues([COLS]);
    sheet.setFrozenRows(1);
    sheet.hideColumns(CHAVE);
  }
  return sheet;
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

// ─── VOLTA DO PAINEL DE BOTÕES ───────────────────────────────────────────────
// Houve uma versão com um painel nas 3 primeiras linhas — escolha de mês e
// caixinhas para calcular horas e arquivar o mês. Ela empurrava o cabeçalho para
// a linha 4. Aquilo saiu: a planilha voltou a ser só o registro bruto.
//
// Este é o caminho de volta, e ele tem que existir no código porque a planilha
// de quem chegou a colar aquela versão continua com as 3 linhas lá. Sem apagá-las,
// o cabeçalho seguiria na linha 4 enquanto o código lê a partir da 2 — e o painel
// seria lido como se fosse registro.
//
// Só as 3 linhas do painel saem. Elas não contêm marcação nenhuma; todo o resto
// sobe junto, intacto, com fórmulas e formatação.
function removerPainel_(sheet) {
  if (String(sheet.getRange(1, 1).getValue()) !== 'Mês de referência') return false;

  sheet.deleteRows(1, PAINEL_ANTIGO);
  sheet.setFrozenRows(1);

  // A coluna "Anulado" nasceu junto com os cálculos e sai com eles. Só é apagada
  // se o cabeçalho dela estiver exatamente onde aquela versão a criava — logo
  // depois da última coluna de hoje.
  const extra = COLS.length + 1;
  if (sheet.getMaxColumns() >= extra &&
      String(sheet.getRange(1, extra).getValue()) === 'Anulado') {
    sheet.deleteColumn(extra);
  }

  // As regras de formatação condicional daquela versão apontavam para a linha 5,
  // que agora é registro. Deixá-las pintaria a linha errada para sempre.
  sheet.setConditionalFormatRules([]);
  return true;
}

const PAINEL_ANTIGO = 3;   // linhas que o painel ocupava
