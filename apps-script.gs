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
  return ContentService.createTextOutput('Ponto Digital OK')
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
