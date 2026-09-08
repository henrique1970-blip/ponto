# Testes do Ponto Digital

Rodam no PC, sem celular e sem internet. Nada aqui é carregado pelo app —
o `index.html` não conhece esta pasta.

```bash
cd tests
npm install
npm test
```

## `smoke.js`

Carrega o **`index.html` de verdade** num navegador simulado (jsdom) e troca só
o que não roda no Node: o face-api do CDN, a câmera, a geolocalização, o
`navigator.onLine` e o `fetch`. Depois dirige o app — finge um rosto
reconhecido, aperta o botão, lê o IndexedDB.

Cobre a política de localização inteira:

| Cenário | Esperado |
|---|---|
| Com rede, sem localização | bloqueia; nada é gravado |
| Localização funcionando | grava com lat/lon/precisão |
| Toque duplo | o segundo é ignorado (carência) |
| Sem rede, sem localização | grava com `lat`/`lon` nulos e `semLocal: true` |
| Permissão negada, mesmo sem rede | bloqueia |
| `navigator.onLine` mentindo | a sondagem de rede desempata |

O último grupo confere que **nenhum erro apareceu no console**. É a rede de
segurança mais importante: em 07/2026 um `SyntaxError` de um parêntese faltando
no `esc()` deixou o app inteiro morto, sem nada visível na tela. Este teste pega
isso em segundos.

## `ponto2-smoke.js`

O mesmo tratamento do `smoke.js`, mas para o **`ponto2/index.html`**: carrega o
app inteiro em jsdom (com face-api, câmera, GPS e canvas trocados por dublês) e
dirige o registro até o fim — abre a confirmação, aperta o botão, lê o
IndexedDB.

| Cenário | Esperado |
|---|---|
| Ninguém marcado como entrada+saída | o título continua "Registro de Saída" |
| Alguém marcado | título vira "Registro de Ponto" |
| 1ª marcação de quem está marcado | tela e botão dizem ENTRADA; grava `type:'entry'` |
| Logo depois da entrada | saída travada pelo intervalo curto |
| Meia hora depois | grava `type:'exit'` |
| Funcionário sem a marca | só saída, com a trava de 12h |

## `ponto2-regra.test.js`

Recorta do **`ponto2/index.html` de verdade** a seção `planoDoRegistro` — a
regra que decide se a próxima marcação da pessoa é entrada ou saída — e a roda
numa VM do Node contra um histórico de ponto falso. Não precisa de jsdom nem de
câmera.

O ponto2 é um app de **saída**: quem não estiver marcado como "entrada e saída"
no cadastro continua registrando só a saída, com a trava de 12h de sempre. O
teste cobre as duas metades:

| Cenário | Esperado |
|---|---|
| Sem a marca, saída há 2h | Saída, travada (12h) |
| Sem a marca, saída há 13h | Saída, liberada |
| Com a marca, sem histórico | Entrada |
| Com a marca, entrada há 1min | Saída, travada (intervalo curto) |
| Com a marca, entrada de ontem 23:00 | Saída — o turno noturno fecha |
| Com a marca, entrada além da janela | Entrada; a saída esquecida não prende ninguém |
| Cadastro antigo, sem o campo `duplo` | só saída |

## `apps-script.test.js` — a planilha da raiz

Executa o **`apps-script.gs` de verdade** numa VM do Node, contra um
`SpreadsheetApp` falso que imita o comportamento real do `insertColumnBefore` e
do `insertRowsBefore`.

O que importa: nenhuma migração pode perder as **chaves de deduplicação já
gravadas**. Se perdesse, tudo que estivesse pendente nos celulares voltaria
duplicado na planilha. São duas, empilhadas:

| Migração | O que ela faz |
|---|---|
| 9 → 10 colunas | a `Precisão (m)` entrou antes da `Chave`; a coluna inteira é empurrada para a direita, com os dados |
| cabeçalho linha 1 → linha 4 | abre espaço para o painel de botões; as linhas descem inteiras |

## `ponto2-planilha.test.js` — a planilha do ponto2

Mesma técnica, com um mock de **várias abas**, para o que os botões novos fazem.
Três coisas aqui são irreversíveis se derem errado:

| Cenário | Esperado |
|---|---|
| Só existe a `Saidas` antiga | vira `Registros`, com histórico e painel |
| Existem `Registros` e `Saidas` | o que falta é absorvido pela chave; a antiga é **aposentada, não apagada** |
| Mover dados de agosto | copia ordenado por funcionário, confere, apaga a origem, limpa linhas em branco; a foto viaja como **fórmula** |
| Calcular horas de agosto | cria `agosto_calculos` sem tocar na `Registros` |
| Mês escolhido sem registro | avisa quais meses têm, e não cria aba nenhuma |

## `jornadas.test.js` e `raiz-jornadas.test.js` — as horas

Carregam a seção de cálculo dos dois `apps-script.gs` numa VM e conferem o que
vira dinheiro na folha. Um erro aqui não aparece na tela de ninguém: aparece no
contracheque. Cada um imprime, ao final, a **aba do mês como sairia na
planilha** — dá para conferir a olho.

| Cenário | Esperado |
|---|---|
| Dia útil 07:00–17:00 com 1h de almoço | 9h, 8h normais + 1h a 50%; a pausa não conta |
| Sábado, mesmo horário | 9h, mas só **4h** normais + 5h a 50% |
| Turno 16:00 → 08:00 do dia seguinte | uma jornada só; a cota é do dia em que ela **começou**, então há 7h45 a 50% |
| Duas jornadas na mesma sexta | dividem **uma** cota de 8h |
| Jornada começando em feriado | só a parte do feriado a 100% |
| Domingo | tudo a 100% |
| Saída esquecida | jornada aberta e sinalizada, sem inventar hora |
| — | `Normais + HE 50% + HE 100% = Total de horas` |

O da raiz cobre ainda duas coisas só dela: o turno noturno **sem** o corte de
meia-noite tem que aparecer como jornada aberta em vez de somar errado, e as
**duas cópias** do Apps Script (o arquivo e o literal embutido no `index.html`)
não podem divergir.

## Se um teste quebrar depois de mexer no app

Os testes acessam variáveis internas do `index.html` por um gancho
(`window.__t`) injetado antes do `</body>`. Renomear uma variável exposta ali
quebra o teste sem que o app tenha problema nenhum — nesse caso, ajuste o
gancho no topo do `smoke.js`.
