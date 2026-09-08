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

// Selo da versao implantada. Colar o codigo neste editor NAO muda o que a URL
// /exec executa -- a implantacao aponta para uma versao congelada, e so
// "Gerenciar implantacoes -> editar -> Nova versao" a move. Sem este selo nao
// havia como saber, de fora, qual codigo estava no ar: a /exec respondia a
// mesma coisa nas duas versoes.
//
// Abrir a /exec no navegador passa a mostrar este texto. Suba o numero sempre
// que mexer em algo que a /exec faz.
const VERSAO = 'v2 - Tipo dinamico (Entrada/Saida)';

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
    .addSeparator()
    .addItem('Recalcular jornadas e horas', 'recalcularJornadas')
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

// ─── JORNADAS E CÁLCULO DE HORAS ─────────────────────────────────────────────
// A aba `Saidas` é o registro BRUTO e não muda: uma linha por marcação, com
// foto e prova de vida. É o que se audita. Esta seção lê aquilo e escreve, em
// outra aba, uma linha por JORNADA — com os pares de entrada/saída e as horas
// já separadas por tipo. Nada aqui grava na aba de origem.
//
// Por jornada, e não por dia civil: quem entra às 22:00 e sai às 06:00
// trabalhou um turno só. Quebrado por data, esse turno vira duas linhas — uma
// terminando sem saída, outra começando com uma — e nenhuma conta a história.
//
// As HORAS, essas sim, são atribuídas ao dia em que foram trabalhadas. Uma
// jornada que começa no sábado e entra no domingo tem a parte do domingo paga a
// 100%. Por isso cada par entrada/saída é fatiado na virada do dia antes de ser
// classificado.

const ABA_CALC = 'Jornadas';
const ABA_FER  = 'Feriados';

const PARES_MAX   = 5;   // pares de entrada/saída que cabem numa linha
const PAUSA_MAX_H = 4;   // pausa maior que isto começa uma jornada NOVA
//                       ⚠ tem que ser o MESMO valor de "Pausa máxima que
//                       continua a mesma jornada" no Admin do app. Se a
//                       planilha usar um limite menor, ela parte em duas
//                       jornadas um intervalo que o app aceitou como um só.
const NORMAIS_H   = 8;   // jornada normal; o que passa disso é hora extra 50%
const NOT_INI_H   = 21;  // adicional noturno das 21:00 …
const NOT_FIM_H   = 5;   // … às 05:00
const ADIC_NOT_PCT = 20; // percentual do adicional noturno

// Feriados de Unaí/MG em 2026. O .docx de origem trazia só data e dia da
// semana, sem o nome de cada um — a coluna Descrição nasce vazia de propósito,
// para ser preenchida na planilha em vez de inventada aqui.
const FERIADOS_PADRAO = [
  '01/01/2026', '15/01/2026', '03/04/2026', '20/04/2026', '21/04/2026',
  '01/05/2026', '04/06/2026', '13/06/2026', '07/09/2026', '12/10/2026',
  '30/10/2026', '02/11/2026', '15/11/2026', '20/11/2026', '08/12/2026',
  '25/12/2026', '31/12/2026',
];

const CAB_CALC = ['Nome', 'Início', 'Dia', 'Tipo de dia', 'Fim'];
const CAB_FIM  = ['Pares', 'Pausas', 'Total trabalhado', 'Normais',
                  'HE 50%', 'HE 100%', 'Adic. noturno ' + ADIC_NOT_PCT + '%',
                  'Observação'];

function recalcularJornadas() {
  const ss     = SpreadsheetApp.getActive();
  const origem = ss.getSheetByName(ABA);
  if (!origem || origem.getLastRow() < 2) {
    ss.toast('Nenhum registro em "' + ABA + '" para calcular.', 'Jornadas', 6);
    return;
  }

  const feriados  = lerFeriados_(ss);
  const marcacoes = lerMarcacoes_(origem);
  const jornadas  = agruparJornadas_(marcacoes);
  const linhas    = jornadas.map(function (j) { return linhaJornada_(j, feriados); });

  escreverCalc_(ss, linhas);
  ss.toast(jornadas.length + ' jornada(s) a partir de ' + marcacoes.length +
           ' marcação(ões).', 'Jornadas', 8);
}

// ── Leitura ──────────────────────────────────────────────────────────────────
// O instante vem da coluna Chave (`nome|ISO`), não de Data+Hora: aquelas duas
// são texto formatado e o Sheets pode reinterpretá-las conforme o idioma da
// planilha. O ISO da chave é o mesmo que o app gravou, sem ambiguidade.
function lerMarcacoes_(sheet) {
  const n = sheet.getLastRow() - 1;
  if (n < 1) return [];
  const dados = sheet.getRange(2, 1, n, COLS.length).getValues();
  const out = [];

  dados.forEach(function (r) {
    const chave = String(r[CHAVE - 1] || '');
    const corte = chave.lastIndexOf('|');
    if (corte < 0) return;                       // linha sem chave: ignora

    const quando = new Date(chave.substring(corte + 1));
    if (isNaN(quando.getTime())) return;

    out.push({
      nome : chave.substring(0, corte) || String(r[1] || ''),
      tipo : String(r[2]) === 'Entrada' ? 'entry' : 'exit',
      t    : quando,
    });
  });

  out.sort(function (a, b) {
    return a.nome === b.nome ? a.t - b.t : (a.nome < b.nome ? -1 : 1);
  });
  return out;
}

// ── Agrupamento em jornadas ──────────────────────────────────────────────────
// Uma entrada abre a jornada; a saída fecha o par. Voltar de uma pausa CURTA
// (até PAUSA_MAX_H) continua a mesma jornada — é o café, o almoço, a ronda.
// Voltar depois de uma pausa longa é jornada nova. É a mesma leitura que o app
// faz da meia-noite: os 15 min entre a saída 23:50 e a entrada 00:05 são pausa,
// não um turno novo.
function agruparJornadas_(marcacoes) {
  const jornadas = [];
  let atual = null;

  function fecha() { if (atual) { jornadas.push(atual); atual = null; } }

  marcacoes.forEach(function (m) {
    if (atual && atual.nome !== m.nome) fecha();

    if (m.tipo === 'entry') {
      const ultima = atual ? atual.marcacoes[atual.marcacoes.length - 1] : null;
      const pausaH = ultima ? (m.t - ultima.t) / 3600e3 : Infinity;
      // Entrada seguida de entrada é marcação perdida (saída esquecida): a
      // jornada anterior fecha em aberto e esta começa outra.
      if (!atual || ultima.tipo === 'entry' || pausaH > PAUSA_MAX_H) {
        fecha();
        atual = { nome: m.nome, marcacoes: [] };
      }
      atual.marcacoes.push(m);
      return;
    }

    // Saída sem jornada aberta: registro órfão (o par ficou noutro aparelho ou
    // a entrada nunca chegou). Fica numa jornada só dela, sinalizada — grudá-la
    // na jornada seguinte inventaria um par que ninguém bateu.
    if (!atual) { jornadas.push({ nome: m.nome, marcacoes: [m] }); return; }
    atual.marcacoes.push(m);
  });

  fecha();
  return jornadas;
}

// ── Cálculo ──────────────────────────────────────────────────────────────────
function linhaJornada_(j, feriados) {
  const marc  = j.marcacoes;
  const pares = [];
  let aberta  = null;
  let orfa    = false;

  marc.forEach(function (m) {
    if (m.tipo === 'entry') { aberta = m.t; return; }
    if (aberta) { pares.push([aberta, m.t]); aberta = null; }
    else        { orfa = true; }
  });

  let trabalhado = 0, noturno = 0, domFer = 0;

  pares.forEach(function (p) {
    fatiar_(p[0], p[1]).forEach(function (f) {
      trabalhado += f.minutos;
      noturno    += f.noturnos;
      if (ehDomingoOuFeriado_(f.data, feriados)) domFer += f.minutos;
    });
  });

  // Pausa é o vão entre uma saída e a entrada seguinte — nunca conta como hora
  // trabalhada; entra na linha só para a conferência bater na leitura.
  let pausas = 0;
  for (let i = 1; i < pares.length; i++) pausas += (pares[i][0] - pares[i - 1][1]) / 60e3;

  const uteis = trabalhado - domFer;
  const he100 = domFer;                                     // domingo/feriado: tudo a 100%
  const he50  = Math.max(0, uteis - NORMAIS_H * 60);        // seg–sáb: o que passa de 8h
  const normais = uteis - he50;

  const inicio = pares.length ? pares[0][0] : marc[0].t;
  const fim    = aberta ? null : (pares.length ? pares[pares.length - 1][1] : marc[0].t);
  const dInicio = parteLocal_(inicio).data;

  const obs = [];
  if (aberta)                   obs.push('jornada aberta — falta a saída');
  if (orfa)                     obs.push('saída sem entrada correspondente');
  if (pares.length > PARES_MAX) obs.push((pares.length - PARES_MAX) + ' par(es) além do limite de ' + PARES_MAX);

  const horarios = [];
  for (let i = 0; i < PARES_MAX; i++) {
    horarios.push(pares[i] ? hhmm_(pares[i][0], dInicio) : '');
    horarios.push(pares[i] ? hhmm_(pares[i][1], dInicio) : '');
  }
  if (aberta && pares.length < PARES_MAX) horarios[pares.length * 2] = hhmm_(aberta, dInicio);

  return [
    j.nome,
    fmt_(inicio, 'dd/MM/yyyy'),
    diaCurto_(dInicio),
    tipoDeDia_(dInicio, feriados),
    fim ? fmt_(fim, 'dd/MM/yyyy') : '',
  ].concat(horarios).concat([
    pares.length,
    dur_(pausas),
    dur_(trabalhado),
    dur_(normais),
    dur_(he50),
    dur_(he100),
    dur_(noturno),
    obs.join(' · '),
  ]);
}

// Fatia [ini, fim) em pedaços que não atravessam a meia-noite LOCAL, e mede
// dentro de cada pedaço quanto caiu na faixa noturna. Sem fatiar, uma jornada
// de sábado para domingo seria classificada inteira pelo dia em que começou.
function fatiar_(ini, fim) {
  const out = [];
  let t = ini.getTime();
  const alvo = fim.getTime();

  while (t < alvo) {
    const p     = parteLocal_(new Date(t));
    const desde = p.h * 60 + p.m + p.s / 60;             // minuto do dia local
    const resto = 1440 - desde;
    const passo = Math.min(resto, (alvo - t) / 60e3);
    const ate   = desde + passo;

    out.push({
      data    : p.data,
      minutos : passo,
      noturnos: inter_(desde, ate, NOT_INI_H * 60, 1440) +
                inter_(desde, ate, 0, NOT_FIM_H * 60),
    });
    t += passo * 60e3;
  }
  return out;
}

function inter_(a, b, c, d) { return Math.max(0, Math.min(b, d) - Math.max(a, c)); }

function ehDomingoOuFeriado_(dataISO, feriados) {
  if (feriados[dataISO]) return true;
  return dataObj_(dataISO).getDay() === 0;
}

function tipoDeDia_(dataISO, feriados) {
  if (feriados[dataISO]) return 'Feriado';
  return dataObj_(dataISO).getDay() === 0 ? 'Domingo' : 'Útil';
}

const DIAS_CURTOS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];
function diaCurto_(dataISO) { return DIAS_CURTOS[dataObj_(dataISO).getDay()]; }
function dataObj_(dataISO) {
  const p = dataISO.split('-');
  return new Date(+p[0], +p[1] - 1, +p[2]);
}

function parteLocal_(d) {
  const s = fmt_(d, 'yyyy-MM-dd HH:mm:ss');
  return { data: s.substring(0, 10), h: +s.substring(11, 13),
           m: +s.substring(14, 16), s: +s.substring(17, 19) };
}

// Horário na coluna. Marcação que caiu noutro dia leva o deslocamento junto,
// senão "07:00" numa jornada que começou ontem não diz de que dia é.
function hhmm_(d, dataBase) {
  const p = parteLocal_(d);
  const dif = Math.round((dataObj_(p.data) - dataObj_(dataBase)) / 864e5);
  return fmt_(d, 'HH:mm') + (dif > 0 ? ' +' + dif : '');
}

// Duração em fração de dia: é o que o Sheets soma como hora com o formato
// [h]:mm. Guardar "8:30" como texto daria uma coluna que não fecha total.
function dur_(minutos) { return minutos / 1440; }

function fmt_(d, padrao) { return Utilities.formatDate(d, TZ, padrao); }

// ── Feriados ─────────────────────────────────────────────────────────────────
// Ficam numa aba, não no código: virar o ano é editar a planilha. A primeira
// execução cria a aba já preenchida com 2026.
function lerFeriados_(ss) {
  let sh = ss.getSheetByName(ABA_FER);
  if (!sh) {
    sh = ss.insertSheet(ABA_FER);
    sh.getRange(1, 1, 1, 2).setValues([['Data', 'Descrição']]).setFontWeight('bold');
    sh.getRange(2, 1, FERIADOS_PADRAO.length, 1)
      .setValues(FERIADOS_PADRAO.map(function (d) { return [d]; }));
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 110);
    sh.setColumnWidth(2, 260);
  }

  const n = sh.getLastRow() - 1;
  const mapa = {};
  if (n < 1) return mapa;

  sh.getRange(2, 1, n, 1).getValues().forEach(function (r) {
    const v = r[0];
    if (!v) return;
    // A célula pode ter virado data de verdade ao ser digitada, ou continuar
    // texto dd/MM/yyyy — as duas formas caem no mesmo yyyy-MM-dd.
    if (v instanceof Date) { mapa[fmt_(v, 'yyyy-MM-dd')] = true; return; }
    const p = String(v).trim().split('/');
    if (p.length === 3) {
      mapa[p[2] + '-' + ('0' + p[1]).slice(-2) + '-' + ('0' + p[0]).slice(-2)] = true;
    }
  });
  return mapa;
}

// ── Escrita ──────────────────────────────────────────────────────────────────
function escreverCalc_(ss, linhas) {
  let sh = ss.getSheetByName(ABA_CALC);
  if (!sh) sh = ss.insertSheet(ABA_CALC);
  sh.clear();

  const cab = CAB_CALC.slice();
  for (let i = 1; i <= PARES_MAX; i++) { cab.push('E' + i); cab.push('S' + i); }
  const cabecalho = cab.concat(CAB_FIM);

  sh.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho])
    .setFontWeight('bold').setBackground('#F1F5F9');
  sh.setFrozenRows(1);
  sh.setFrozenColumns(2);

  if (!linhas.length) return;

  sh.getRange(2, 1, linhas.length, cabecalho.length).setValues(linhas);

  // As sete colunas de tempo do fim: duração somável, não texto.
  const iniDur = CAB_CALC.length + PARES_MAX * 2 + 2;      // após Nome…Fim, pares e "Pares"
  sh.getRange(2, iniDur, linhas.length, 6).setNumberFormat('[h]:mm');

  sh.setColumnWidth(1, 160);
  sh.getRange(1, 1, linhas.length + 1, cabecalho.length).setVerticalAlignment('middle');
}
