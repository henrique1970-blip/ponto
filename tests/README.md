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

## `apps-script.test.js`

Executa o **`apps-script.gs` de verdade** numa VM do Node, contra um
`SpreadsheetApp` falso que imita o comportamento real do `insertColumnBefore`.

O que importa: a migração da planilha de 9 para 10 colunas **não pode perder as
chaves de deduplicação já gravadas**. Se perdesse, tudo que estivesse pendente
nos celulares voltaria duplicado na planilha.

## Se um teste quebrar depois de mexer no app

Os testes acessam variáveis internas do `index.html` por um gancho
(`window.__t`) injetado antes do `</body>`. Renomear uma variável exposta ali
quebra o teste sem que o app tenha problema nenhum — nesse caso, ajuste o
gancho no topo do `smoke.js`.
