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
const VERSAO = 'v3 - Painel de botoes, calculo por mes, coluna Anulado';
const COLS  = ['ID','Nome','Tipo','Data','Hora','Local','Latitude','Longitude','Precisão (m)','Chave','Anulado'];
const PREC  = 9;   // raio de erro do GPS informado pelo aparelho (A=1 … I=9)
const CHAVE = 10;  // coluna da chave de deduplicação, oculta (J=10)
const ANULADO = 11; // marcada, a linha sai do cálculo sem sair da planilha

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
        chave,
        false                              // Anulado — só a mão de alguém marca
      ]);
    });

    if (linhas.length) {
      const inicio = sheet.getLastRow() + 1;
      sheet.getRange(inicio, 1, linhas.length, COLS.length).setValues(linhas);
      sheet.getRange(inicio, ANULADO, linhas.length, 1).setDataValidation(caixa_());
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
    sheet.getRange(LIN_CAB, 1, 1, COLS.length).setValues([COLS]);
    sheet.hideColumns(CHAVE);          // a chave é uso interno, não polui a vista
    montarPainel_(sheet);
    return sheet;
  }

  // Planilha do layout de 9 colunas (Chave na I, sem Precisão): abre espaço na I.
  // insertColumnBefore arrasta a coluna Chave inteira — COM os dados — para a J,
  // então as chaves já gravadas continuam valendo e nada volta em duplicata.
  const linCab = temPainel_(sheet) ? LIN_CAB : 1;
  if (sheet.getRange(linCab, PREC).getValue() === 'Chave') sheet.insertColumnBefore(PREC);

  abrirEspacoPainel_(sheet);
  ajustarCabecalho_(sheet);
  return sheet;
}

// O painel é identificado pelo rótulo da A1 — não pelo cabeçalho, que pode estar
// quebrado. Assim inserir as linhas nunca acontece duas vezes.
function temPainel_(sheet) {
  return String(sheet.getRange(1, 1).getValue()) === 'Mês de referência';
}

// Insere as linhas do painel acima do cabeçalho. O Sheets empurra os dados
// junto — nenhum registro se perde; o que muda é só de que linha em diante ler.
function abrirEspacoPainel_(sheet) {
  if (temPainel_(sheet)) return;
  if (sheet.getLastRow() > 0) sheet.insertRowsBefore(1, PAINEL_LIN);
  montarPainel_(sheet);
}

// Cabeçalho fora do padrão (planilha antiga de 8 colunas, ou a migração acima
// que deixou a I sem título): reescreve a linha do cabeçalho inteira.
function ajustarCabecalho_(sheet) {
  const atual = sheet.getRange(LIN_CAB, 1, 1, COLS.length).getValues()[0];
  if (atual.join('|') !== COLS.join('|')) {
    sheet.getRange(LIN_CAB, 1, 1, COLS.length).setValues([COLS])
         .setFontWeight('bold').setBackground('#F1F5F9');
    sheet.hideColumns(CHAVE);
  }
  if (!temPainel_(sheet)) montarPainel_(sheet);
  sheet.setFrozenRows(LIN_CAB);
}

function chavesExistentes_(sheet) {
  const n = sheet.getLastRow() - LIN_CAB;   // desconta painel e cabeçalho
  const vistos = {};
  if (n < 1) return vistos;
  sheet.getRange(LIN_DADOS, CHAVE, n, 1).getValues().forEach(function (linha) {
    if (linha[0]) vistos[linha[0]] = true;
  });
  return vistos;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── MENU ────────────────────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Ponto Digital')
    .addItem('① Preparar planilha (painel de botões)', 'prepararPlanilha')
    .addItem('Verificar (o script está autorizado?)', 'verificar')
    .addSeparator()
    .addItem('Calcular horas do mês', 'calcularHoras')
    .addItem('Mover dados do mês', 'moverDados')
    .addSeparator()
    .addItem('Anular linhas selecionadas', 'anularSelecao')
    .addItem('Reativar linhas selecionadas', 'reativarSelecao')
    .addToUi();

  // O painel é desenhado AQUI, ao abrir — não só quando alguém roda um item do
  // menu. Sem isto, quem colava o código e recarregava a planilha via o menu
  // aparecer e mais nada: as caixinhas só nasciam no primeiro clique.
  //
  // Gatilho simples roda sem autorização, então dá para escrever na própria
  // planilha, mas NÃO dá para instalar o gatilho das caixinhas — isso continua
  // sendo o "① Preparar planilha", e a D1 avisa enquanto ele não rodar. O
  // try/catch é para que uma falha aqui nunca leve o menu junto.
  try { desenharPainel_(); } catch (_) { /* modo restrito: o menu já está lá */ }
}

function desenharPainel_() {
  const ss = SpreadsheetApp.getActive();
  if (!ss.getSheetByName(ABA)) return;   // planilha ainda sem registro nenhum: não há o que mostrar

  const sheet = getSheet_();
  if (temPainel_(sheet) && cel_(sheet, CEL_STATUS).getValue()) return;
  status_(sheet, 'Painel criado. Rode "Ponto Digital → ① Preparar planilha" ' +
                 'para as caixinhas passarem a funcionar (o Google vai pedir autorização uma vez).');
}

// ─── PAINEL DE BOTÕES ────────────────────────────────────────────────────────
// O Apps Script não consegue criar um desenho e amarrar uma função a ele — isso
// só existe pelo menu do Sheets, à mão, e some se a planilha for copiada. O que
// ele CONSEGUE criar sozinho é uma caixa de seleção, e marcar uma caixa dispara
// o gatilho de edição. É o botão que vem junto com o código, sem passo manual.
//
// O painel ocupa as PAINEL_LIN primeiras linhas. O cabeçalho desceu para a
// LIN_CAB e os dados começam na LIN_DADOS: toda leitura da aba passa por essas
// duas constantes, não há "linha 2" solta em lugar nenhum.
//
//      A                      B                     D
//  1   Mês de referência      [setembro/2026 ▾]     (resposta da última ação)
//  2   [ ]                    Calcular horas do mês
//  3   [ ]                    Mover os dados do mês
//  4   ID   Nome   Tipo   Data   Hora   ...            ← cabeçalho
//  5   ...                                              ← primeiro registro

const PAINEL_LIN = 3;
const LIN_CAB    = PAINEL_LIN + 1;
const LIN_DADOS  = LIN_CAB + 1;

const CEL_MES    = [1, 2];   // B1 — mês de referência (lista suspensa)
const CEL_STATUS = [1, 4];   // D1 — resposta da última ação
const CEL_CALC   = [2, 1];   // A2 — caixa "calcular horas"
const CEL_MOVER  = [3, 1];   // A3 — caixa "mover dados"

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
               'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function cel_(sheet, par) { return sheet.getRange(par[0], par[1]); }

function status_(sheet, txt) {
  cel_(sheet, CEL_STATUS).setValue(txt);
  try { SpreadsheetApp.getActive().toast(txt, 'Ponto', 10); } catch (_) { /* sem UI */ }
}

// Reconstrói o painel. Chamado quando ele não está lá (planilha nova, ou vinda
// da versão sem painel) e sempre que o menu é usado — a lista de meses precisa
// enxergar o que chegou depois.
function montarPainel_(sheet) {
  const ss = sheet.getParent();

  cel_(sheet, [1, 1]).setValue('Mês de referência').setFontWeight('bold');
  cel_(sheet, [2, 2]).setValue('◀  Calcular horas do mês');
  cel_(sheet, [3, 2]).setValue('◀  Mover os dados do mês');

  [CEL_CALC, CEL_MOVER].forEach(function (p) {
    const c = cel_(sheet, p);
    if (c.getValue() !== true && c.getValue() !== false) c.insertCheckboxes();
    c.setValue(false);
  });

  sheet.getRange(1, 1, PAINEL_LIN, sheet.getMaxColumns()).setBackground('#EEF2FF');
  sheet.getRange(1, 2, PAINEL_LIN, 1).setFontWeight('bold');
  cel_(sheet, CEL_STATUS).setFontStyle('italic').setFontColor('#475569');
  sheet.setFrozenRows(LIN_CAB);

  atualizarMeses_(ss, sheet);
}

// A lista suspensa só oferece meses que TÊM registro — assim "escolher um mês
// vazio" quase não acontece, e quando acontece (mês cujos dados já foram
// movidos e a aba apagada) a mensagem diz quais existem.
function atualizarMeses_(ss, sheet) {
  const meses = mesesComDados_(ss);
  const c = cel_(sheet, CEL_MES);
  if (!meses.length) { c.clearDataValidations(); return; }

  const rotulos = meses.map(rotuloMes_);
  c.setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(rotulos, true).setAllowInvalid(false).build());

  if (rotulos.indexOf(String(c.getValue())) < 0) c.setValue(rotulos[0]);
}

// Meses presentes na aba de registros e em qualquer arquivo já movido.
function mesesComDados_(ss) {
  const vistos = {};
  ss.getSheets().forEach(function (sh) {
    const nome = sh.getName();
    const ehArquivo = nome.length > 10 &&
                      nome.substring(nome.length - 10) === '_registros';
    if (nome !== ABA && !ehArquivo) return;
    const cab = (nome === ABA) ? LIN_CAB : 1;
    const n = sh.getLastRow() - cab;
    if (n < 1) return;
    sh.getRange(cab + 1, CHAVE, n, 1).getValues().forEach(function (r) {
      const ym = mesDaChave_(String(r[0] || ''));
      if (ym) vistos[ym] = true;
    });
  });
  return Object.keys(vistos).sort().reverse();
}

function mesDaChave_(chave) {
  const corte = chave.lastIndexOf('|');
  if (corte < 0) return null;
  const d = new Date(chave.substring(corte + 1));
  return isNaN(d.getTime()) ? null : fmt_(d, 'yyyy-MM');
}

function rotuloMes_(ym) {
  const p = ym.split('-');
  return MESES[+p[1] - 1] + '/' + p[0];
}

function mesDoRotulo_(rot) {
  const p = String(rot).split('/');
  if (p.length !== 2) return null;
  const i = MESES.indexOf(p[0].trim().toLowerCase());
  if (i < 0 || !/^[0-9]{4}$/.test(p[1].trim())) return null;
  return p[1].trim() + '-' + ('0' + (i + 1)).slice(-2);
}

// Nome da aba do mês. O exemplo pedido é "agosto_calculos" — sem ano, porque no
// uso normal só existe um agosto em jogo. O ano entra apenas quando o mês NÃO é
// do ano corrente, para dois agostos não caírem na mesma aba na virada.
function nomeAba_(ym, sufixo) {
  const p = ym.split('-');
  const base = MESES[+p[1] - 1];
  const nome = (p[0] === fmt_(new Date(), 'yyyy')) ? base : base + '_' + p[0];
  return nome + '_' + sufixo;
}

// Lê o mês do painel. Devolve null (já tendo avisado) se não houver escolha.
function mesEscolhido_(ss, sheet) {
  atualizarMeses_(ss, sheet);
  const ym = mesDoRotulo_(cel_(sheet, CEL_MES).getValue());
  if (ym) return ym;

  const lista = mesesComDados_(ss).map(rotuloMes_);
  status_(sheet, lista.length
    ? 'Escolha o mês de referência em B1. Com registros: ' + lista.join(', ') + '.'
    : 'Nenhum registro na planilha ainda.');
  return null;
}

// ─── GATILHO DAS CAIXAS ──────────────────────────────────────────────────────
// Precisa ser INSTALÁVEL: o gatilho simples onEdit roda sem autorização e não
// poderia criar abas nem apagar linhas. Por isso a função tem outro nome — se
// ela se chamasse onEdit, o Sheets a chamaria também como gatilho simples e
// metade das execuções falharia sem explicação.
function aoEditar(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== ABA || e.range.getValue() !== true) return;

  const l = e.range.getRow(), c = e.range.getColumn();
  if (l === CEL_CALC[0] && c === CEL_CALC[1]) {
    e.range.setValue(false);
    calcularHoras();
  } else if (l === CEL_MOVER[0] && c === CEL_MOVER[1]) {
    e.range.setValue(false);
    moverDados();
  }
}

// Menu → roda uma vez por planilha. Repetir é inofensivo: apaga o gatilho
// anterior antes de criar, então nunca ficam dois disparando a mesma ação.
function prepararPlanilha_() {
  const ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'aoEditar') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('aoEditar').forSpreadsheet(ss).onEdit().create();

  const sheet = getSheet_();
  montarPainel_(sheet);
  formatarAnulados_(sheet);
  lerFeriados_(ss);
  status_(sheet, 'Painel pronto. Escolha o mês em B1 e marque a caixinha da ação.');
}

// ─── JORNADAS E CÁLCULO DE HORAS ─────────────────────────────────────────────
// A aba de registros é o material BRUTO e não muda: uma linha por marcação. É o
// que se audita. Esta seção lê aquilo e escreve, numa aba por MÊS, uma linha por
// JORNADA — com os pares de entrada/saída e as horas já separadas por tipo.
//
// Por jornada, e não por dia civil: quem entra às 22:00 e sai às 06:00
// trabalhou um turno só. Quebrado por data, esse turno vira duas linhas — uma
// terminando sem saída, outra começando com uma — e nenhuma conta a história.
//
// As HORAS, essas sim, são atribuídas ao dia em que foram trabalhadas. Uma
// jornada que começa no sábado e entra no domingo tem a parte do domingo paga a
// 100%. Por isso cada par entrada/saída é fatiado na virada do dia antes de ser
// classificado.

const ABA_FER = 'Feriados';

const PARES_MAX   = 5;   // pares de entrada/saída que cabem numa linha
const PAUSA_MAX_H = 4;   // pausa maior que isto começa uma jornada NOVA
//                       Aqui é decisão só da planilha: o app da raiz não trava
//                       a volta de intervalo nenhum, então este número não
//                       precisa casar com nada do lado do celular.

// Jornada normal: 8h de segunda a sexta, 4h no sábado. O que passa disso no dia
// é hora extra 50%. Domingo e feriado não têm parte normal — é tudo 100%.
const NORMAIS_SEG_SEX_H = 8;
const NORMAIS_SAB_H     = 4;

const NOT_INI_H    = 21;  // adicional noturno das 21:00 …
const NOT_FIM_H    = 5;   // … às 05:00
const ADIC_NOT_PCT = 20;  // percentual do adicional noturno

// Feriados de Unaí/MG em 2026. O .docx de origem trazia só data e dia da
// semana, sem o nome de cada um — a coluna Descrição nasce vazia de propósito,
// para ser preenchida na planilha em vez de inventada aqui.
const FERIADOS_PADRAO = [
  '01/01/2026', '15/01/2026', '03/04/2026', '20/04/2026', '21/04/2026',
  '01/05/2026', '04/06/2026', '13/06/2026', '07/09/2026', '12/10/2026',
  '30/10/2026', '02/11/2026', '15/11/2026', '20/11/2026', '08/12/2026',
  '25/12/2026', '31/12/2026',
];

const CAB_CALC = ['Nome', 'Data', 'Dia', 'Tipo de dia'];
const CAB_FIM  = ['Pausas', 'Total de horas', 'Normais', 'HE 50%', 'HE 100%',
                  'Adic. noturno ' + ADIC_NOT_PCT + '%', 'Observação', 'Anotação'];

// ─── AÇÃO 1: CALCULAR HORAS ──────────────────────────────────────────────────
function calcularHoras_() {
  const ss    = SpreadsheetApp.getActive();
  const sheet = getSheet_();
  const ym    = mesEscolhido_(ss, sheet);
  if (!ym) return;

  // Lê a aba viva E o arquivo do mês, se ele já tiver sido movido: quem calcula
  // depois de mover não pode receber "nenhum registro".
  const marcacoes = lerTudo_(ss, ym);
  if (!marcacoes.some(function (m) { return fmt_(m.t, 'yyyy-MM') === ym; })) {
    const lista = mesesComDados_(ss).map(rotuloMes_);
    status_(sheet, 'Nenhum registro em ' + rotuloMes_(ym) + '. Escolha outro mês em B1' +
      (lista.length ? ' — com registros: ' + lista.join(', ') + '.' : '.'));
    return;
  }

  const feriados = lerFeriados_(ss);
  // Agrupa sobre TODAS as marcações e só depois filtra pelo mês: cortar antes
  // partiria ao meio a jornada que atravessa a virada do mês.
  const jornadas = agruparJornadas_(marcacoes).filter(function (j) {
    return fmt_(inicioDe_(j), 'yyyy-MM') === ym;
  });

  const linhas = calcularLinhas_(jornadas, feriados);
  const nome   = nomeAba_(ym, 'calculos');
  escreverCalc_(ss, nome, linhas);

  status_(sheet, linhas.length + ' jornada(s) de ' + rotuloMes_(ym) +
          ' na aba "' + nome + '".');
}

// ─── AÇÃO 2: MOVER DADOS ─────────────────────────────────────────────────────
// Tira do caminho o mês já fechado sem perder nada: copia para a aba do mês,
// confere que chegou, e só então apaga da origem.
function moverDados_() {
  const ss    = SpreadsheetApp.getActive();
  const sheet = getSheet_();
  const ym    = mesEscolhido_(ss, sheet);
  if (!ym) return;

  const n = sheet.getLastRow() - LIN_CAB;
  const rng   = n > 0 ? sheet.getRange(LIN_DADOS, 1, n, COLS.length) : null;
  const vals  = rng ? rng.getValues()   : [];
  const forms = rng ? rng.getFormulas() : [];

  // A foto vive numa fórmula =IMAGE. getValues devolveria o resultado dela, que
  // não se pode colar de volta — a fórmula tem que viajar como fórmula.
  const linhas = vals.map(function (v, i) {
    return v.map(function (c, j) { return forms[i][j] ? forms[i][j] : c; });
  });

  const escolhidas = [];
  linhas.forEach(function (l, i) {
    const chave = String(l[CHAVE - 1] || '');
    if (mesDaChave_(chave) !== ym) return;
    escolhidas.push({ linha: l, i: i, t: new Date(chave.substring(chave.lastIndexOf('|') + 1)) });
  });

  if (!escolhidas.length) {
    const lista = mesesComDados_(ss).map(rotuloMes_);
    status_(sheet, 'Nada a mover em ' + rotuloMes_(ym) + '. Escolha outro mês em B1' +
      (lista.length ? ' — com registros: ' + lista.join(', ') + '.' : '.'));
    return;
  }

  escolhidas.sort(function (a, b) {
    const na = String(a.linha[1]), nb = String(b.linha[1]);
    return na === nb ? a.t - b.t : (na < nb ? -1 : 1);
  });

  const destino = abaArquivo_(ss, nomeAba_(ym, 'registros'));
  const ini = destino.getLastRow() + 1;
  destino.getRange(ini, 1, escolhidas.length, COLS.length)
         .setValues(escolhidas.map(function (x) { return x.linha; }));
  posMover_(destino, ini, escolhidas.length);
  SpreadsheetApp.flush();

  // Só apaga depois que a escrita foi confirmada na planilha.
  if (destino.getLastRow() < ini + escolhidas.length - 1) {
    status_(sheet, 'A cópia não fechou — nada foi apagado. Tente de novo.');
    return;
  }

  apagarLinhas_(sheet, escolhidas.map(function (x) { return LIN_DADOS + x.i; }));
  const vazias = limparVazias_(sheet);

  status_(sheet, escolhidas.length + ' registro(s) de ' + rotuloMes_(ym) +
          ' movidos para "' + destino.getName() + '"' +
          (vazias ? ' · ' + vazias + ' linha(s) em branco removida(s)' : '') + '.');
}

function abaArquivo_(ss, nome) {
  let sh = ss.getSheetByName(nome);
  if (sh) return sh;
  sh = ss.insertSheet(nome);
  sh.getRange(1, 1, 1, COLS.length).setValues([COLS])
    .setFontWeight('bold').setBackground('#F1F5F9');
  sh.setFrozenRows(1);
  prepararArquivo_(sh);
  return sh;
}

// Apaga de baixo para cima e em blocos: apagar de cima empurraria os índices
// seguintes, e uma chamada por linha estoura o tempo em mês cheio.
function apagarLinhas_(sheet, linhas) {
  const ord = linhas.slice().sort(function (a, b) { return b - a; });
  let i = 0;
  while (i < ord.length) {
    let j = i;
    while (j + 1 < ord.length && ord[j + 1] === ord[j] - 1) j++;
    sheet.deleteRows(ord[j], j - i + 1);
    i = j + 1;
  }
}

function limparVazias_(sheet) {
  const n = sheet.getLastRow() - LIN_CAB;
  if (n < 1) return 0;
  const dados = sheet.getRange(LIN_DADOS, 1, n, COLS.length).getValues();
  const vazias = [];
  dados.forEach(function (l, i) {
    const temAlgo = l.some(function (c) { return c !== '' && c !== null && c !== false; });
    if (!temAlgo) vazias.push(LIN_DADOS + i);
  });
  if (vazias.length) apagarLinhas_(sheet, vazias);
  return vazias.length;
}

// ─── Leitura ─────────────────────────────────────────────────────────────────
// O instante vem da coluna Chave ("nome|ISO"), não de Data+Hora: aquelas duas
// são texto formatado e o Sheets pode reinterpretá-las conforme o idioma da
// planilha. O ISO da chave é o mesmo que o app gravou, sem ambiguidade.
function lerMarcacoes_(sheet, primeiraLinha) {
  const cab = primeiraLinha - 1;
  const n = sheet.getLastRow() - cab;
  if (n < 1) return [];
  const dados = sheet.getRange(primeiraLinha, 1, n, COLS.length).getValues();
  const out = [];

  dados.forEach(function (r) {
    const chave = String(r[CHAVE - 1] || '');
    const corte = chave.lastIndexOf('|');
    if (corte < 0) return;                       // linha sem chave: ignora
    if (anulado_(r[ANULADO - 1])) return;        // linha anulada: fora do cálculo

    const quando = new Date(chave.substring(corte + 1));
    if (isNaN(quando.getTime())) return;

    out.push({
      nome : chave.substring(0, corte) || String(r[1] || ''),
      tipo : String(r[2]) === 'Entrada' ? 'entry' : 'exit',
      t    : quando,
      chave: chave,
    });
  });
  return out;
}

// Aba viva + arquivo do mês, sem repetir o que estiver nos dois.
function lerTudo_(ss, ym) {
  const sheets = [ss.getSheetByName(ABA)];
  const arq = ss.getSheetByName(nomeAba_(ym, 'registros'));
  if (arq) sheets.push(arq);

  const vistos = {}, out = [];
  sheets.forEach(function (sh, i) {
    if (!sh) return;
    lerMarcacoes_(sh, i === 0 ? LIN_DADOS : 2).forEach(function (m) {
      if (vistos[m.chave]) return;
      vistos[m.chave] = true;
      out.push(m);
    });
  });

  out.sort(function (a, b) {
    return a.nome === b.nome ? a.t - b.t : (a.nome < b.nome ? -1 : 1);
  });
  return out;
}

// ─── Agrupamento em jornadas ─────────────────────────────────────────────────
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

function inicioDe_(j) { return j.marcacoes[0].t; }

// ─── Cálculo ─────────────────────────────────────────────────────────────────
// A cota de horas normais (8h de segunda a sexta, 4h no sábado) é POR PESSOA e
// POR DIA — mas contada no dia em que a JORNADA COMEÇOU, não em cada dia que ela
// atravessa. As duas leituras divergem no turno da noite: quem entra 16:00 e sai
// 08:00 do dia seguinte fez 15h45 de um fôlego só. Fatiado por dia civil daria
// 7h50 numa data e 7h55 na outra — nenhuma passa de 8h, e o turno inteiro sairia
// sem hora extra. Contado pelo dia de início, dá as 7h45 de extra que ele é.
//
// Duas jornadas no mesmo dia dividem a MESMA cota: a primeira gasta primeiro, e
// a segunda só encontra o que sobrou. Por isso o mapa "usado" atravessa o
// map — as jornadas chegam em ordem cronológica dentro de cada pessoa.
function calcularLinhas_(jornadas, feriados) {
  const usado = {};
  return jornadas.map(function (j) { return linhaJornada_(j, feriados, usado); });
}

function limiteDoDia_(dataISO) {
  return (dataObj_(dataISO).getDay() === 6 ? NORMAIS_SAB_H : NORMAIS_SEG_SEX_H) * 60;
}

function linhaJornada_(j, feriados, usado) {
  const marc  = j.marcacoes;
  const pares = [];
  let aberta  = null;
  let orfa    = false;

  marc.forEach(function (m) {
    if (m.tipo === 'entry') { aberta = m.t; return; }
    if (aberta) { pares.push([aberta, m.t]); aberta = null; }
    else        { orfa = true; }
  });

  let trabalhado = 0, noturno = 0, he100 = 0;

  // Domingo e feriado são classificados pela data REAL de cada fatia: a parte de
  // sábado de um turno que vira o domingo continua a 50%, só a parte do domingo
  // é que vai a 100%.
  pares.forEach(function (p) {
    fatiar_(p[0], p[1]).forEach(function (f) {
      trabalhado += f.minutos;
      noturno    += f.noturnos;
      if (ehDomingoOuFeriado_(f.data, feriados)) he100 += f.minutos;
    });
  });

  // Pausa é o vão entre uma saída e a entrada seguinte — nunca conta como hora
  // trabalhada; entra na linha só para a conferência bater na leitura.
  let pausas = 0;
  for (let i = 1; i < pares.length; i++) pausas += (pares[i][0] - pares[i - 1][1]) / 60e3;

  const inicio  = pares.length ? pares[0][0] : marc[0].t;
  const dInicio = parteLocal_(inicio).data;

  // O que não é 100% disputa a cota do dia em que a jornada começou.
  const uteis   = trabalhado - he100;
  const ja      = usado[j.nome + '|' + dInicio] || 0;
  const normais = Math.min(uteis, Math.max(0, limiteDoDia_(dInicio) - ja));
  const he50    = uteis - normais;
  usado[j.nome + '|' + dInicio] = ja + uteis;

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
  ].concat(horarios).concat([
    dur_(pausas),
    dur_(trabalhado),
    dur_(normais),
    dur_(he50),
    dur_(he100),
    dur_(noturno),
    obs.join(' · '),
    '',
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
  const d = dataObj_(dataISO).getDay();
  return d === 0 ? 'Domingo' : (d === 6 ? 'Sábado' : 'Útil');
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

// ─── Feriados ────────────────────────────────────────────────────────────────
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

// ─── Escrita ─────────────────────────────────────────────────────────────────
// A aba do mês é refeita do zero a cada cálculo — é o que garante que corrigir
// um registro na origem se reflita aqui. A única coluna que sobrevive é a
// "Anotação": ela é do humano, o script nunca escreve nada nela.
function escreverCalc_(ss, nome, linhas) {
  let sh = ss.getSheetByName(nome);
  if (!sh) sh = ss.insertSheet(nome);

  const cab = CAB_CALC.slice();
  for (let i = 1; i <= PARES_MAX; i++) { cab.push('E' + i); cab.push('S' + i); }
  const cabecalho = cab.concat(CAB_FIM);
  const COL_ANOT  = cabecalho.length;

  const guardadas = anotacoesAtuais_(sh, cabecalho.length);
  sh.clear();

  sh.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho])
    .setFontWeight('bold').setBackground('#F1F5F9');
  sh.setFrozenRows(1);
  sh.setFrozenColumns(2);

  if (!linhas.length) return;

  linhas.forEach(function (l) {
    const g = guardadas[chaveLinha_(l)];
    if (g) l[COL_ANOT - 1] = g;
  });

  sh.getRange(2, 1, linhas.length, cabecalho.length).setValues(linhas);

  // As seis colunas de tempo: duração somável, não texto.
  const iniDur = CAB_CALC.length + PARES_MAX * 2 + 1;
  sh.getRange(2, iniDur, linhas.length, 6).setNumberFormat('[h]:mm');

  sh.setColumnWidth(1, 160);
  sh.getRange(1, 1, linhas.length + 1, cabecalho.length).setVerticalAlignment('middle');
}

function chaveLinha_(l) { return l[0] + '|' + l[1] + '|' + l[CAB_CALC.length]; }

function anotacoesAtuais_(sh, largura) {
  const n = sh.getLastRow() - 1;
  const mapa = {};
  if (n < 1 || sh.getLastColumn() < largura) return mapa;
  sh.getRange(2, 1, n, largura).getValues().forEach(function (l) {
    if (l[largura - 1]) mapa[chaveLinha_(l)] = l[largura - 1];
  });
  return mapa;
}

// ─── Ajustes desta planilha ─────────────────────────────────────────
// A raiz grava só texto e número: nada de foto nem caixinha, então a aba de
// arquivo não precisa de tratamento depois da cópia.
function prepararArquivo_(sh) {
  sh.hideColumns(CHAVE);
}

function posMover_(sh, ini, n) {
}

// As três ações do menu passam por comAviso_: nenhuma delas pode falhar calada.
function calcularHoras()    { comAviso_('Calcular horas', calcularHoras_); }
function moverDados()       { comAviso_('Mover dados', moverDados_); }
function prepararPlanilha() { comAviso_('Preparar planilha', prepararPlanilha_); }

// ─── VERIFICAÇÃO ─────────────────────────────────────────────────────────────
// "Cliquei no menu e não aconteceu nada" tem quase sempre uma causa só: a
// autorização do Google não foi concedida, e aí NENHUMA função de menu chega a
// rodar. O painel aparece assim mesmo, porque quem o desenha é o onOpen — que é
// gatilho simples e roda sem autorização. Os dois fatos juntos parecem bug no
// código e não são.
//
// Esta função é a prova: se ela responder alguma coisa, o script ESTÁ
// autorizado e o problema é outro — e ela diz qual.
function verificar() {
  const ss = SpreadsheetApp.getActive();
  const l  = [];

  l.push('Planilha: ' + ss.getName());
  l.push('Versão do código: ' + VERSAO);
  l.push('');

  const sheet = ss.getSheetByName(ABA);
  if (!sheet) {
    l.push('Aba "' + ABA + '": NÃO EXISTE.');
  } else {
    l.push('Aba "' + ABA + '": ' + Math.max(0, sheet.getLastRow() - LIN_CAB) + ' registro(s)');
    l.push('Painel desenhado: ' + (temPainel_(sheet) ? 'sim' : 'NÃO'));
    l.push('Mês escolhido (B1): ' + (cel_(sheet, CEL_MES).getValue() || '(vazio)'));
  }

  const meses = mesesComDados_(ss).map(rotuloMes_);
  l.push('Meses com registro: ' + (meses.length ? meses.join(', ') : 'nenhum'));

  let gat = 'NÃO instalado — rode "① Preparar planilha"';
  try {
    const n = ScriptApp.getProjectTriggers().filter(function (t) {
      return t.getHandlerFunction() === 'aoEditar';
    }).length;
    if (n) gat = n + ' instalado(s) — as caixinhas funcionam';
  } catch (err) {
    gat = 'não deu para verificar (' + err.message + ')';
  }
  l.push('Gatilho das caixinhas: ' + gat);

  l.push('');
  l.push('Abas: ' + ss.getSheets().map(function (s) { return s.getName(); }).join(' · '));

  const txt = l.join('\n');
  Logger.log(txt);
  try {
    const ui = SpreadsheetApp.getUi();
    ui.alert('Verificação', txt, ui.ButtonSet.OK);
  } catch (_) { /* sem interface: fica no Registro de execuções */ }
  return txt;
}

// Erro em ação de menu costuma sumir: o Sheets mostra um aviso vermelho que
// passa sozinho e não deixa rastro na planilha. Aqui ele vira um alerta que
// exige OK e um texto na D1, que fica — e continua subindo para o Registro de
// execuções, que é onde está a pilha.
function comAviso_(nome, fn) {
  try {
    fn();
  } catch (err) {
    const msg = nome + ' falhou: ' + ((err && err.message) ? err.message : String(err));
    try {
      const ui = SpreadsheetApp.getUi();
      ui.alert(nome, msg + '\n\nDetalhes em Extensões → Apps Script → Execuções.',
               ui.ButtonSet.OK);
    } catch (_) { /* sem interface */ }
    try { status_(SpreadsheetApp.getActive().getSheetByName(ABA), msg); } catch (_) {}
    throw err;
  }
}

// ─── ANULAR REGISTRO ─────────────────────────────────────────────────────────
// Anular é MARCAR, não apagar. Duas razões, as duas com consequência real:
//
//   • O registro bruto é a prova de quem bateu o quê e quando. Folha de ponto
//     que perde linha perde o valor de prova — o que se quer é dizer "este não
//     conta", e continuar podendo mostrar que ele existiu e foi anulado.
//
//   • A coluna Chave é o que impede o celular de reenviar o mesmo ponto. Apagada
//     a linha, o aparelho que ainda tiver aquele registro pendente manda de novo
//     e ele REAPARECE. É por isso que apagar à mão costuma "não dar certo".
//
// Linha anulada some do cálculo (lerMarcacoes_ a ignora) e fica cinza e riscada
// na aba. Reativar desfaz.
function anularSelecao()   { comAviso_('Anular seleção',   function () { marcarSelecao_(true);  }); }
function reativarSelecao() { comAviso_('Reativar seleção', function () { marcarSelecao_(false); }); }

function marcarSelecao_(valor) {
  const ss    = SpreadsheetApp.getActive();
  const alvo  = ss.getSheetByName(ABA);
  const sheet = ss.getActiveSheet();

  if (!sheet || sheet.getName() !== ABA) {
    status_(alvo, 'Selecione as linhas na aba "' + ABA + '" e rode de novo.');
    return;
  }

  let total = 0;
  ss.getActiveRangeList().getRanges().forEach(function (sel) {
    // O painel não é registro: a seleção que o pega por cima é aparada aqui.
    const ini = Math.max(sel.getRow(), LIN_DADOS);
    const fim = Math.min(sel.getLastRow(), sheet.getLastRow());
    if (fim < ini) return;

    const faixa = sheet.getRange(ini, ANULADO, fim - ini + 1, 1);
    faixa.setDataValidation(caixa_());
    faixa.setValue(valor);
    total += fim - ini + 1;
  });

  if (!total) {
    status_(sheet, 'Nenhuma linha de registro na seleção — selecione a partir da ' +
                   'linha ' + LIN_DADOS + '.');
    return;
  }
  status_(sheet, total + ' linha(s) ' + (valor ? 'anulada(s)' : 'reativada(s)') +
          '. Recalcule o mês para o efeito aparecer nas horas.');
}

// Caixinha por validação, e não por insertCheckboxes: aquele método ZERA o valor
// de todas as células da faixa. Aplicado numa coluna que já tem anulações, ele
// desanularia tudo em silêncio.
function caixa_() {
  return SpreadsheetApp.newDataValidation().requireCheckbox().build();
}

// Aceita a caixinha marcada e também um "x" digitado: quem corrige a planilha com
// pressa digita, não procura a caixinha.
function anulado_(v) {
  if (v === true) return true;
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'x' || s === 'sim' || s === 'true' || s === 'anulado';
}

// Linha anulada tem que saltar aos olhos: cinza e riscada. Ela continua ali —
// é a diferença entre corrigir e sumir com a prova.
function formatarAnulados_(sheet) {
  const col   = colLetra_(ANULADO);
  const faixa = sheet.getRange(LIN_DADOS, 1,
                              Math.max(1, sheet.getMaxRows() - LIN_CAB), COLS.length);

  const regra = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$' + col + LIN_DADOS + '=TRUE')
    .setBackground('#F1F5F9')
    .setFontColor('#94A3B8')
    .setStrikethrough(true)
    .setRanges([faixa])
    .build();

  // Substitui só a nossa regra, se formatarAnulados_ rodar duas vezes.
  const outras = sheet.getConditionalFormatRules().filter(function (r) {
    const b = r.getBooleanCondition();
    const v = b && b.getCriteriaValues()[0];
    return !(typeof v === 'string' && v.indexOf('$' + col) >= 0);
  });
  sheet.setConditionalFormatRules(outras.concat([regra]));

  const n = sheet.getLastRow() - LIN_CAB;
  if (n > 0) sheet.getRange(LIN_DADOS, ANULADO, n, 1).setDataValidation(caixa_());
}

function colLetra_(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - 1 - r) / 26; }
  return s;
}
