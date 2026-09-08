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
// A aba nasceu "Saidas", de quando o app só registrava saída. Agora ela guarda
// entrada e saída, e o nome passou a ser "Registros" — igual ao da raiz.
const ABA         = 'Registros';
const ABA_ANTIGA  = 'Saidas';

// Selo da versao implantada. Colar o codigo neste editor NAO muda o que a URL
// /exec executa -- a implantacao aponta para uma versao congelada, e so
// "Gerenciar implantacoes -> editar -> Nova versao" a move. Sem este selo nao
// havia como saber, de fora, qual codigo estava no ar: a /exec respondia a
// mesma coisa nas duas versoes.
//
// Abrir a /exec no navegador passa a mostrar este texto. Suba o numero sempre
// que mexer em algo que a /exec faz.
const VERSAO = 'v3 - Aba Registros';

// A 'Chave' precisa continuar na coluna 10: linhas antigas já foram gravadas com
// ela ali, e é por ela que a deduplicação reconhece um reenvio. Colunas novas
// entram DEPOIS dela.
const COLS  = ['ID','Nome','Tipo','Data','Hora','Local','Confirmacao',
               'Latitude','Longitude','Chave','Foto','Distancia','Margem','Rigor',
               'Conferido','Vivacidade'];
const CHAVE = 10;   // coluna da chave de deduplicação (A=1 … J=10)
const FOTO  = 11;   // coluna da miniatura
const DIST  = 12;   // coluna da distância do reconhecimento
const CONF  = 15;   // coluna da caixinha "conferido"
const VIVO  = 16;   // como a vivacidade foi provada — 'nao confirmada' pede atenção

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
        // O app nasceu só de saída; desde 08/09/2026 todo o quadro alterna e
        // manda type='entry' ou 'exit'. Registro antigo não traz o campo — e
        // era saída, então o padrão do ternário mantém o histórico correto.
        r.type === 'entry' ? 'Entrada' : 'Saída',
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
        false,                             // Conferido — caixinha desmarcada
        r.vivacidade || ''                 // piscada/boca/movimento ou 'nao confirmada'
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
  return ContentService.createTextOutput('Ponto Saida OK - ' + VERSAO)
    .setMimeType(ContentService.MimeType.TEXT);
}

// Rode esta função uma vez no editor para conceder o acesso ao Drive.
// ⚠ Ela precisa ABRIR a tela de consentimento do Google. Se rodar em silêncio e
// a foto continuar falhando, a autorização não foi concedida a esta conta —
// use diagnostico() para confirmar antes de mexer na implantação.
function autorizar() {
  pastaFotos_();
  SpreadsheetApp.getActiveSpreadsheet().getName();
}

// Rode no editor e veja o resultado no Registro de execuções (Ctrl+Enter).
// Responde de forma direta se a coluna Foto vai funcionar — sem ter que
// registrar um ponto de verdade para descobrir.
function diagnostico() {
  const linhas = [];
  linhas.push('Versao:   ' + VERSAO);
  linhas.push('Planilha: ' + SpreadsheetApp.getActiveSpreadsheet().getName());
  linhas.push('Conta:    ' + (Session.getEffectiveUser().getEmail() || '(oculta)'));
  try {
    const pasta = pastaFotos_();
    linhas.push('Drive:    OK — pasta "' + pasta.getName() + '" (' + pasta.getId() + ')');
    const t = pasta.createFile(Utilities.newBlob('teste', 'text/plain', 'teste.txt'));
    t.setTrashed(true);
    linhas.push('Escrita:  OK — a coluna Foto vai funcionar.');
  } catch (err) {
    linhas.push('Drive:    FALHOU — ' + err.message);
    linhas.push('');
    linhas.push('A autorização do Drive NÃO está concedida para esta conta.');
    linhas.push('No editor: selecione a função autorizar → ▶ Executar → aceite');
    linhas.push('o acesso (se aparecer "O Google não verificou este app", clique');
    linhas.push('em Avançado → Acessar <nome do projeto>). Depois rode isto de novo.');
  }
  const txt = linhas.join('\n');
  Logger.log(txt);
  return txt;
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
  const colD   = colLetra_(DIST), colC = colLetra_(CONF), colV = colLetra_(VIVO);

  // $ nas colunas para a regra pintar a LINHA inteira, não só a célula testada.
  const suspeito = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND(OR(AND($' + colD + '2<>"", $' + colD + '2>=' + DIST_REVISAO + '), ' +
                          '$' + colV + '2="nao confirmada"), NOT($' + colC + '2))')
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
    'Ficam em laranja, até a caixinha "Conferido" ser marcada: Distancia ≥ ' +
    DIST_REVISAO + ' e Vivacidade = "nao confirmada".', 'Ponto Saída', 8);
}

function resumoConferencia() {
  const sheet = getSheet_();
  const n = sheet.getLastRow() - 1;
  if (n < 1) { SpreadsheetApp.getActive().toast('Nenhum registro ainda.', 'Ponto Saída', 5); return; }

  const dados = sheet.getRange(2, 1, n, COLS.length).getValues();
  let raspou = 0, semVida = 0, pendentes = 0;
  dados.forEach(function (l) {
    const d = l[DIST - 1];
    const perto = d !== '' && d !== null && d >= DIST_REVISAO;
    const vivo  = String(l[VIVO - 1]) === 'nao confirmada';
    if (perto)  raspou++;
    if (vivo)   semVida++;
    if ((perto || vivo) && l[CONF - 1] !== true) pendentes++;
  });

  SpreadsheetApp.getActive().toast(
    raspou + ' com Distancia ≥ ' + DIST_REVISAO + ' · ' +
    semVida + ' sem prova de vida · ' +
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
    // registrado por causa da foto. A mensagem do Google tem 200 caracteres de
    // link e jargão — na célula cabe o que dá para AGIR.
    const msg = String(err && err.message);
    if (/permission|autoriza|scope/i.test(msg)) {
      return 'sem permissão do Drive — rode a função autorizar() no editor';
    }
    return 'erro: ' + msg;
  }
}

// O id fica guardado nas Propriedades do Script: além de evitar uma busca no
// Drive a cada registro, impede que uma segunda pasta de mesmo nome (criada à
// mão, ou por outra planilha) passe a receber as fotos.
function pastaFotos_() {
  const props = PropertiesService.getScriptProperties();
  const id    = props.getProperty('FOTO_PASTA_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (_) { /* apagada: recria */ }
  }
  const achou = DriveApp.getFoldersByName(FOTO_PASTA);
  const pasta = achou.hasNext() ? achou.next() : DriveApp.createFolder(FOTO_PASTA);
  props.setProperty('FOTO_PASTA_ID', pasta.getId());
  return pasta;
}

// ─── PLANILHA ────────────────────────────────────────────────────────────────
function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = migrarNome_(ss);

  if (!sheet) {
    sheet = ss.insertSheet(ABA);
    sheet.appendRow(COLS);
    sheet.setFrozenRows(1);
    sheet.hideColumns(CHAVE);          // a chave é uso interno, não polui a vista
    sheet.setColumnWidth(FOTO, ALTURA_LINHA);
    formatar_(sheet);                  // direto, para não reentrar em getSheet_()
    return sheet;
  }

  // Uma planilha antiga pode ter menos colunas do que a grade precisa agora —
  // sem isso, tanto o cabeçalho quanto o setValues das linhas estourariam.
  const falta = COLS.length - sheet.getMaxColumns();
  if (falta > 0) sheet.insertColumnsAfter(sheet.getMaxColumns(), falta);

  // Voltou do painel? As regras de conferência precisam ser refeitas na linha 2.
  if (removerPainel_(sheet)) formatar_(sheet);
  ajustarCabecalho_(sheet);
  return sheet;
}

// Renomear a aba à mão não bastava: o código continuava procurando por "Saidas",
// não achava, e criava uma "Saidas" nova a cada registro — daí a aba repetida
// com um dado só. A troca de nome tem que acontecer AQUI, no código.
function migrarNome_(ss) {
  const nova  = ss.getSheetByName(ABA);
  const velha = ss.getSheetByName(ABA_ANTIGA);
  if (!velha) return nova;
  if (!nova)  { velha.setName(ABA); return velha; }

  // As duas existem: quem renomeou à mão ficou com a história na "Registros" e
  // os registros novos na "Saidas" recriada. Absorve o que falta pela chave e
  // aposenta a aba antiga — nada é apagado.
  removerPainel_(nova);
  const n = velha.getLastRow() - 1;
  if (n > 0) {
    // A aba recriada pode ter menos colunas do que a grade de hoje; ler além do
    // que ela tem estoura, e escrever menos do que COLS.length também.
    const larg   = Math.min(COLS.length, velha.getMaxColumns());
    const faixa  = velha.getRange(2, 1, n, larg);
    const vals   = faixa.getValues();
    const forms  = faixa.getFormulas();
    const vistos = chavesExistentes_(nova);
    const novas  = [];
    vals.forEach(function (l, i) {
      const linha = l.map(function (c, j) { return forms[i][j] ? forms[i][j] : c; });
      while (linha.length < COLS.length) linha.push('');
      const chave = String(linha[CHAVE - 1] || '');
      if (!chave || vistos[chave]) return;
      vistos[chave] = true;
      novas.push(linha);
    });
    if (novas.length) {
      const ini = nova.getLastRow() + 1;
      nova.getRange(ini, 1, novas.length, COLS.length).setValues(novas);
      nova.setRowHeights(ini, novas.length, ALTURA_LINHA);
      nova.getRange(ini, CONF, novas.length, 1).insertCheckboxes();
    }
  }
  velha.setName(ABA_ANTIGA + ' (migrada ' +
                Utilities.formatDate(new Date(), TZ, 'dd-MM-yyyy HH.mm') + ')');
  return nova;
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
