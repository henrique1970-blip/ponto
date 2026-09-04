# Ponto Saída (ponto2)

Variante do **Ponto Digital** que registra **apenas a saída**, com uma etapa de
confirmação explícita após o reconhecimento facial.

Desde 04/09/2026 há uma exceção por funcionário: quem for marcado como
**"registra entrada e saída"** no cadastro alterna entre as duas marcações neste
mesmo aparelho. Todo o resto do quadro continua **só na saída** — ver
*[Entrada e saída para funcionários específicos](#entrada-e-saída-para-funcionários-específicos)*.

## O que muda em relação ao app original (`../index.html`)

| | Ponto Digital | Ponto Saída (este) |
|---|---|---|
| Tipo de registro | Entrada **e** saída | **Saída** — e entrada só para quem for marcado no cadastro |
| Após reconhecer o rosto | Registrava direto no toque do botão | Abre uma **tela de confirmação** |
| Formas de confirmar | Botão | Botão **ou gesto 👍** (polegar para cima) |
| Tela do celular | Apaga normalmente | **Fica sempre ligada** (Wake Lock) |

## Fluxo

1. **Escaneando** — a câmera procura e reconhece o rosto cadastrado. Só avança
   para quem **chega perto e fica parado ~2 s** (ver *Gatilho de intenção*);
   quem apenas passa na frente não aciona nada.
2. **Confirmando** — aparece o nome + botão verde `✔ CONFIRMAR SAÍDA`
   (`✔ CONFIRMAR ENTRADA` para quem registra os dois, quando é a entrada que falta).
   O funcionário confirma de duas formas:
   - tocando no botão, **ou**
   - mostrando o **polegar para cima ao lado do próprio rosto** por ~0,4 s.
   A janela expira em 20 s (ou o funcionário toca em *Cancelar*).
3. **Registrado** — tela de sucesso com nome e horário; volta a escanear.

A planilha recebe uma coluna `Confirmacao` indicando se foi `Botão` ou `Gesto 👍`.

## Identificação equivocada — como o app se protege

O descritor do face-api é um vetor de 128 números; "parecer com" é distância
euclidiana pequena. O `findBestMatch` responde **"de quem é o cadastro mais
parecido"** — nunca *"essa pessoa está cadastrada?"*. Um desconhecido **sempre**
tem um vizinho mais próximo; se ele cair abaixo do limiar, vira falso positivo.

Sete travas independentes atacam isso, todas antes de a tela de confirmação abrir:

| Trava | O que faz |
|---|---|
| **Limiar absoluto** | Distância precisa ser pequena em termos absolutos (0,42–0,55 conforme o rigor). |
| **Teste de margem** | O 1º colocado precisa ser *claramente* melhor que o 2º. Empate → "não sei", em vez de desempate por milésimos. |
| **Consistência temporal** | 2 a 4 detecções seguidas precisam apontar o mesmo nome. Falso positivo costuma ser quadro isolado. |
| **Qualidade do rosto** | Recusa rosto pequeno, escuro, de lado ou torto — descritor ruim cai perto do cadastro de qualquer um. |
| **Rosto único no quadro** | Se há dois rostos de tamanho parecido, não dá para saber de quem é a saída. |
| **Lista de visitantes** | Quem passa na frente do totem sem ser do quadro pode ser cadastrado como *visitante* — o rosto sai da disputa em vez de cair sempre no funcionário mais parecido. |
| **Gatilho de intenção** | A confirmação só abre para quem **chegou perto, ficou parado e permaneceu**. Quem apenas passa na frente nunca chega a ver a tela (nem o nome). |

Além disso:

- A tela de confirmação mostra a **foto do cadastro** ao lado do nome — se o app
  errar a pessoa, quem está na câmera vê outro rosto e toca em **✖ Não sou eu**
  (que ainda bloqueia aquele nome por 30 s, para o loop não reabrir a mesma tela).
- No **cadastro**, as mesmas exigências de qualidade valem, e o app recusa salvar
  um rosto quase idêntico ao de outro funcionário (distância < 0,45) — dois
  cadastros parecidos demais deixariam o sistema permanentemente ambíguo.

Ajustável em **Admin → Configurações → Rigor do reconhecimento facial**
(Alto / **Médio** / Baixo). Se alguém legítimo deixar de ser reconhecido,
recadastre com boa luz **antes** de baixar o rigor.

### Gatilho de intenção — quem passa na frente não aciona nada

Antes, bastava um rosto conhecido aparecer para a tela de confirmação abrir
sozinha. Alguém que só passava na frente do celular disparava o registro e tinha
que cancelar. Registrar é um **ato deliberado**, e um ato deliberado tem
assinatura própria no vídeo — três medidas que já vinham na caixa do rosto, sem
modelo novo e sem download extra:

| Sinal | Exigência | Passante × quem registra |
|---|---|---|
| **Proximidade** | rosto ≥ 26% da largura do quadro (≈ 60 cm da câmera) | a 1,5 m um rosto mede 10%; a 1,8 m, 9% |
| **Estabilidade** | o centro do rosto não anda mais que 12% da largura | quem atravessa o quadro (0,08 a 1,2 m/s) marca **0,41 a 0,81** |
| **Permanência** | 2 s contínuos, medidos em relógio | ninguém passa 2 s a 60 cm da câmera sem parar |

As três somadas, e nesta ordem — a comparação de rostos só acontece depois. Quem
passa na frente **não vê nome nenhum na tela**, nem o próprio nem o de terceiro.

Nenhuma delas falha em silêncio: a tela diz o que fazer
(*👋 Aproxime-se para registrar* → *✋ Fique parado de frente* → *Verificando ●●○*),
então um limiar apertado demais vira instrução, não bloqueio.

> Calibrado por simulação com geometria de câmera real (640×480, FOV 60°). O
> limiar de estabilidade é **0,12 e não 0,08** porque uma pessoa em pé balançando
> 3 cm marca 0,117 — 0,08 barraria gente legítima, enquanto qualquer um que
> atravesse o quadro fica uma ordem de grandeza acima. Os quatro números ficam
> juntos no topo do `index.html` (`INTENT_TAM`, `INTENT_DERIVA`, `INTENT_MS`,
> `INTENT_GAP`); se o aparelho ficar longe do ponto onde as pessoas param,
> `INTENT_TAM` é o primeiro a ajustar.

### O 👍 tem que ser de quem está registrando

O reconhecedor devolve **todas** as mãos do quadro, e o código pegava a primeira:
um polegar para cima de alguém ao fundo confirmava a saída de quem estava na
frente. Como o índice da mão corresponde ao do gesto, dá para exigir que a mão
seja **daquela pessoa** — por posição (a poucas larguras de rosto) e por escala.

A escala é o que separa de fato: mão e rosto encolhem juntos com a distância, então
mão ÷ rosto é praticamente constante (**0,89** em simulação, em qualquer pose da
própria pessoa) e cai com 1/k para quem está *k* vezes mais longe. O limiar de
0,45 barra quem estiver do **dobro da distância para trás** e ainda tolera um
bbox de mão 2× menor que o modelo antes de recusar por engano.

> Limite honesto: isso barra quem está do outro lado da sala, **não** quem está
> ombro a ombro (a 1,8× a distância ainda passa). E se recusar por engano, o
> botão verde continua ali — degrada, não trava.

### Visitantes (não-funcionários)

No cadastro, marque **"Visitante — não registra ponto"**. O rosto passa a ser
reconhecido e explicitamente recusado (`Cadastrado como visitante`), em vez de
virar o vizinho mais próximo de algum funcionário. É a resposta mais direta para
"fulano sempre é confundido com beltrano": cadastre fulano como visitante.

## Galeria adaptativa

O cadastro é tirado num dia, numa luz. O rosto aparece o ano inteiro em luzes
diferentes — e é essa diferença que empurra a distância para perto do limiar.

Cada saída **confirmada pela própria pessoa** é um exemplo rotulado de graça. O
app guarda até **6 leituras extras** por funcionário, e só quando o
reconhecimento foi folgado (distância < 0,30 **e** margem > 0,15) e a leitura
acrescenta variação nova (> 0,20 de tudo que já existe). Num teste com
descritores sintéticos, a mesma pessoa numa condição não coberta pelo cadastro
caiu de **0,450 → 0,225** de distância, sem aproximar ninguém de outra pessoa.

É o que permite manter o limiar apertado sem passar a recusar gente legítima.
Desligável em **Admin → Configurações**, com **"Esquecer o que foi aprendido"**
como escape se algo derivar (volta todo mundo ao cadastro original, sem apagar
ninguém).

## Prova de vida

Impede confirmar o ponto segurando uma foto impressa ou a tela de outro celular.
Durante a janela de confirmação o app procura **três evidências independentes** —
basta uma:

- **piscada** — o olho precisa fechar *e* abrir de novo (Eye Aspect Ratio);
- **abrir a boca** — amplitude de abertura acima de 0,25 (Mouth Aspect Ratio);
- **movimento de cabeça** — amplitude de pose acima de 0,18.

> ⚠ **Quem usa óculos precisa da boca.** Testado em campo: a armação prende os
> landmarks da pálpebra, o EAR não chega perto de 0,19 e a piscada **nunca** é
> detectada — sobrava só o giro de cabeça, cujo limiar é apertado. Por isso a
> dica na tela muda aos 3 s de *"pisque"* para **"😮 Abra bem a boca"**: a pessoa
> não tem como adivinhar qual evidência o app consegue ler no rosto dela.
> O reconhecimento em si funciona normalmente com óculos — o que travava era só
> a prova de vida.

A pose é medida por geometria relativa (a ponta do nariz equidistante dos olhos),
que é **invariante a posição e escala**: tremer a mão segurando uma foto não
altera o número, girar a cabeça altera. O sinal ainda passa por média móvel e é
avaliado numa janela deslizante de ~3 s — sem isso, o ruído dos landmarks se
acumula e, com tempo suficiente, uma foto tremendo "vira" movimento.

Testado em simulação com landmarks sintéticos (7 cenários): foto parada, foto
tremendo e tremor extremo ficam em 0,024 / 0,089 / 0,160 — todos abaixo do
limiar; piscada e giro de cabeça liberam em 1–3 s.

A abertura de boca passa pelo **mesmo tratamento do movimento de cabeça** — média
móvel e janela deslizante de ~3 s — e pela mesma razão: medido no cru, o tremor
de landmark se acumula no min/max e uma foto tremendo atinge 0,347 em 20 s.
Suavizado e em janela, cai para **0,119**, contra **0,427** de uma boca aberta de
verdade. É a amplitude que conta, não o estado: a foto de alguém **de boca
aberta**, parada, vale zero.

### Os dois escapes (e por que não são o mesmo)

| Situação | O que acontece |
|---|---|
| A câmera não mede **nada** (contraluz, rosto fora do quadro) | libera tudo em 4 s |
| Mede, mas **nenhuma evidência aparece** em 9 s | libera **só o botão**, e marca o registro |

O primeiro existe porque insistir seria travar alguém por limitação da câmera. O
segundo existe porque, sem ele, **o funcionário fica trancado**: a confirmação
exige vivacidade *também no botão*, então quem não produz nenhuma das três
evidências não registra de jeito nenhum — foi exatamente o que aconteceu em campo
antes da boca entrar (quatro tentativas até conseguir).

O gesto 👍 **continua exigindo prova de vida** nos dois casos: liberar por tempo é
o escape do caso legítimo, não um caminho mãos-livres. E o registro liberado pelo
segundo escape vai para a planilha com `Vivacidade = nao confirmada`, que a rotina
de conferência pinta de laranja.

Não substitui antifraude de verdade: barra o caso casual (foto no celular),
não um ataque dedicado. Desligável em **Admin → Configurações**.

## Foto do registro na planilha (auditoria)

Nenhum reconhecimento é infalível — então o app guarda a prova. A cada saída
confirmada ele recorta uma **miniatura 200×200 do rosto** e envia junto do
registro. O Apps Script salva o arquivo numa pasta do Drive
(`Ponto Saida - Fotos`) e põe a imagem na coluna `Foto` (**K**) da planilha, ao
lado de `Distancia`, `Margem`, `Rigor`, `Conferido` e `Vivacidade` — dá para
achar registros "no limite" e corrigir o cadastro.

A foto é capturada **antes** da leitura de GPS (a pessoa ainda está enquadrada),
funciona offline (fica no IndexedDB) e é **apagada do aparelho** assim que
sincroniza. Pode ser desligada em **Admin → Configurações**.

> ⚠ Exige **reautorizar o Apps Script**: ao reimplantar, abra o editor, execute a
> função `autorizar` uma vez e aceite o acesso ao Google Drive. Sem isso os
> registros continuam entrando, só que a coluna Foto vem
> `sem permissão do Drive — rode a função autorizar() no editor`.
>
> Se a tela de consentimento mostrar *"O Google não verificou este app"*, é
> preciso clicar em **Avançado → Acessar `<nome do projeto>`** — fechar essa tela
> não concede nada, e o sintoma é idêntico ao de não ter rodado a função.
> Para conferir sem precisar registrar um ponto de verdade, rode **`diagnostico()`**
> no editor: ele diz em qual conta está, se o Drive responde e se a escrita
> funciona.
>
> Em `apps-script.gs`, `FOTO_PUBLICA = true` faz a imagem aparecer dentro da
> célula (cada arquivo vira "qualquer pessoa com o link"). Com `false` a foto
> continua privada e a planilha guarda só o link.

### Rotina de conferência

A foto só serve se alguém olhar. A planilha ganha um menu **Ponto Saída**:

- **Destacar registros a conferir** — pinta de laranja toda linha ainda não
  conferida que tenha `Distancia ≥ 0,40` (reconhecimento que passou raspando)
  **ou** `Vivacidade = nao confirmada`, e verde quando a caixinha `Conferido` é
  marcada. A regra fica gravada e vale para as linhas futuras — roda uma vez só.
- **Quantos faltam conferir?** — quantos passaram raspando, quantos foram sem
  prova de vida e quantos ainda não foram olhados.

Assim o erro deixa de ser invisível: em vez de auditar tudo, olha-se a foto das
poucas linhas laranja.

## Entrada e saída para funcionários específicos

O padrão do app continua sendo **só a saída**. Para liberar a entrada para
alguém, marque no cadastro (**Admin → + Cadastrar funcionário**) a caixa
**"Registra entrada e saída neste aparelho"**. Na lista de funcionários eles
aparecem com a etiqueta `entrada+saída`, e o título da tela passa de
*Registro de Saída* para *Registro de Ponto* assim que existir alguém marcado.

Para essas pessoas o app decide sozinho qual marcação falta:

| Situação | Próxima marcação |
|---|---|
| Sem jornada aberta | **Entrada** |
| Entrada em aberto, dentro da jornada | **Saída** |
| Entrada em aberto há mais que a jornada máxima | **Entrada** (a saída foi esquecida) |

A decisão **não é por dia civil** — é pela jornada aberta. Quem entra às 23:00
sai às 04:00 do dia seguinte, e uma regra por data ofereceria "entrada" de novo
de madrugada. Duas configurações governam isso, em **Admin → Configurações**:

- **Duração máxima da jornada (horas)** — padrão **16**. É o prazo em que uma
  entrada em aberto ainda pode ser fechada por uma saída. Passado o prazo, o app
  entende que a saída foi esquecida e volta a oferecer entrada, em vez de deixar
  a pessoa presa em "saída" para sempre. A jornada não encerrada continua
  aparecendo na planilha — que é o registro honesto do que aconteceu.
- **Intervalo mínimo entre a entrada e a saída (minutos)** — padrão **5**. A
  tela de sucesso some em ~3 s e a pessoa ainda está enquadrada; sem esse prazo
  o 👍 seguinte fecharia a jornada recém-aberta.

> ⚠️ **A planilha precisa do Apps Script novo.** A coluna `Tipo` era literal
> `'Saída'`; agora segue o tipo do registro. Sem reimplantar o
> `apps-script.gs`, as entradas chegam rotuladas como saída.
> Registros antigos, que não trazem o campo, continuam sendo lidos como saída.

## Trava de 12 horas

Um funcionário **não consegue registrar uma nova saída antes de 12h** da última.
Enquanto estiver travado, o app mostra o nome e
`Saída já registrada às HH:MM · libera em 11h56` — o botão de confirmar nem aparece.

Para quem registra **entrada e saída**, a mesma trava passa a separar uma
jornada da seguinte: conta a partir da **última saída** e segura a **próxima
entrada**. Entre a entrada e a sua saída vale o intervalo curto (5 min).

A regra é verificada em **dois pontos**: ao reconhecer o rosto (não abre a
confirmação) e de novo **imediatamente antes de gravar** — ou seja, ela não
depende da tela para valer.

Ajustável em **Admin → Configurações → Intervalo mínimo entre saídas do mesmo
funcionário (horas)**.
Padrão **12**, aceita 0–24. **`0` desliga a trava** (útil só para testes).

> Para descartar registros de teste que estejam segurando a trava, use
> **Admin → 🧪 Apagar registros locais**. Isso apaga o histórico deste aparelho,
> inclusive pendentes não enviados; o que já subiu para a planilha continua lá.

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

O Service Worker (`CACHE` no topo de `sw.js` — suba a versão a cada mudança em
arquivo cacheado, senão o celular continua com o antigo) pré-cacheia o núcleo do app, os modelos do
face-api e os assets do MediaPipe (~17 MB no total).

> **A primeira abertura precisa de internet** e baixa ~17 MB (o modelo de gestos
> sozinho tem 8 MB). Faça a primeira carga no Wi-Fi. Depois disso, funciona 100%
> offline — os registros ficam no IndexedDB e sobem para o Sheets quando houver rede.

## Dados

Armazenamento local próprio, **independente do app original**:
IndexedDB `PontoSaida` (o original usa `PontoDigital`). Os funcionários precisam
ser cadastrados de novo aqui — os dois apps não compartilham cadastro.

Vale para a marca de entrada+saída também: ela é **deste aparelho**. Se a pessoa
bate a entrada no app da raiz e a saída aqui, não marque a caixa — os dois apps
não se enxergam, e a entrada acabaria registrada em duas planilhas.
