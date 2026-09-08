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

// ─── MENU ────────────────────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Ponto Digital')
    .addItem('Recalcular jornadas e horas', 'recalcularJornadas')
    .addToUi();
}

// ─── JORNADAS E CÁLCULO DE HORAS ─────────────────────────────────────────────
// A aba "Registros" é o registro BRUTO e não muda: uma linha por marcação. É o
// que se audita. Esta seção lê aquilo e escreve, em outra aba, uma linha por
// JORNADA — com os pares de entrada/saída e as horas já separadas por tipo.
// Nada aqui grava na aba de origem.
//
// Por jornada, e não por dia civil: quem entra às 22:00 e sai às 06:00
// trabalhou um turno só. Quebrado por data, esse turno vira duas linhas — uma
// terminando sem saída, outra começando com uma — e nenhuma conta a história.
//
// O app da raiz alterna DENTRO do dia civil: virada a meia-noite, ele volta a
// oferecer entrada. A operação contorna isso cortando a jornada antes das
// 00:00 e reabrindo depois; a pausa curta faz os dois pedaços voltarem a ser
// uma jornada só aqui. Se alguém esquecer de cortar, a linha sai com "jornada
// aberta" na Observação em vez de somar errado — é o sinal de conferir.
//
// As HORAS, essas sim, são atribuídas ao dia em que foram trabalhadas. Uma
// jornada que começa no sábado e entra no domingo tem a parte do domingo paga a
// 100%. Por isso cada par entrada/saída é fatiado na virada do dia antes de ser
// classificado.

const ABA_CALC = 'Jornadas';
const ABA_FER  = 'Feriados';

const PARES_MAX   = 5;   // pares de entrada/saída que cabem numa linha
const PAUSA_MAX_H = 4;   // pausa maior que isto começa uma jornada NOVA
//                       Aqui é decisão só da planilha: o app da raiz não trava
//                       a volta de intervalo nenhum, então este número não
//                       precisa casar com nada do lado do celular.
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
// O instante vem da coluna Chave ("nome|ISO"), não de Data+Hora: aquelas duas
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
