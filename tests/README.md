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
