# Ponto Saída (ponto2)

Variante do **Ponto Digital** que registra **apenas a saída**, com uma etapa de
confirmação explícita após o reconhecimento facial.

## O que muda em relação ao app original (`../index.html`)

| | Ponto Digital | Ponto Saída (este) |
|---|---|---|
| Tipo de registro | Entrada **e** saída (alternava sozinho) | **Somente saída** |
| Após reconhecer o rosto | Registrava direto no toque do botão | Abre uma **tela de confirmação** |
| Formas de confirmar | Botão | Botão **ou gesto 👍** (polegar para cima) |
| Tela do celular | Apaga normalmente | **Fica sempre ligada** (Wake Lock) |

## Fluxo

1. **Escaneando** — a câmera procura e reconhece o rosto cadastrado.
2. **Confirmando** — aparece o nome + botão verde `✔ CONFIRMAR SAÍDA`.
   O funcionário confirma de duas formas:
   - tocando no botão, **ou**
   - mostrando o **polegar para cima** por ~0,4 s para a câmera.
   A janela expira em 20 s (ou o funcionário toca em *Cancelar*).
3. **Registrado** — tela de sucesso com nome e horário; volta a escanear.

A planilha recebe uma coluna `Confirmacao` indicando se foi `Botão` ou `Gesto 👍`.

Para não duplicar o registro enquanto a pessoa continua na frente da câmera, o
mesmo rosto não é reproposto por **1 minuto** após uma saída (mostra
"Saída já registrada às HH:MM").

## Tela sempre ligada

Usa a [Screen Wake Lock API](https://developer.mozilla.org/docs/Web/API/Screen_Wake_Lock_API).
Requer **HTTPS** (ou localhost) e o app **aberto e visível**. O lock é reobtido
sozinho quando o app volta ao primeiro plano.

Pode ser desligado em **Admin → Configurações → Manter a tela sempre ligada**.

> Um navegador não consegue alterar o timeout de tela do sistema — só impedir que
> ele atue **enquanto o app está aberto**. Para um totem de verdade, mantenha o
> aparelho **na tomada** e, no Android, considere também
> *Configurações → Tela → Tempo limite de tela*.

## Reconhecimento de gestos

Usa **MediaPipe Tasks Vision** (`GestureRecognizer`, gesto pré-treinado `Thumb_Up`).
É **opcional e degrada com elegância**: se o modelo não carregar, o app continua
funcionando normalmente com o botão, e a dica na tela muda para "Confirme no botão
verde abaixo". Pode ser desligado em **Admin → Configurações**.

## Offline

O Service Worker (`ponto-saida-v1`) pré-cacheia o núcleo do app, os modelos do
face-api e os assets do MediaPipe (~17 MB no total).

> **A primeira abertura precisa de internet** e baixa ~17 MB (o modelo de gestos
> sozinho tem 8 MB). Faça a primeira carga no Wi-Fi. Depois disso, funciona 100%
> offline — os registros ficam no IndexedDB e sobem para o Sheets quando houver rede.

## Dados

Armazenamento local próprio, **independente do app original**:
IndexedDB `PontoSaida` (o original usa `PontoDigital`). Os funcionários precisam
ser cadastrados de novo aqui — os dois apps não compartilham cadastro.
