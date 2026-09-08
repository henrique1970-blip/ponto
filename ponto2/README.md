# Ponto (ponto2)

Variante do **Ponto Digital** que registra **entrada e saída**, com uma etapa de
confirmação explícita após o reconhecimento facial.

Nasceu como app **só de saída**. Desde 08/09/2026 o quadro inteiro registra as
duas marcações: a primeira da jornada é a entrada, a seguinte é a saída — ver
*[Entrada e saída](#entrada-e-saída)*. A marca por funcionário que valeu entre
04/09 e 08/09 (*"registra entrada e saída"*) deixou de existir: virou o
comportamento de todo mundo, e nenhum cadastro precisou ser refeito.

## O que muda em relação ao app original (`../index.html`)

| | Ponto Digital | Ponto (este) |
|---|---|---|
| Tipo de registro | Entrada **e** saída | Entrada **e** saída |
| Como decide a marcação | Por **dia civil** | Pela **jornada aberta** — atravessa a meia-noite |
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

## Entrada e saída

Todo funcionário registra as duas marcações — não há nada a marcar no cadastro.
O app decide sozinho qual marcação falta:

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

### Plantão — várias entradas e saídas por dia

Quem sai e volta durante o turno (ronda de pivô, chamado noturno) marca no
cadastro a caixa **"Plantão — várias entradas e saídas por dia"** e aparece na
lista de funcionários com a etiqueta `plantão`.

Para essas pessoas a trava de 12h entre jornadas **não se aplica**: sair e
voltar é o trabalho, não uma jornada nova. Vale só o intervalo curto (5 min),
que continua barrando o toque duplo. Uma noite típica:

```
19:00 Entrada · 21:30 Saída · 22:40 Entrada
00:10 Saída   · 01:20 Entrada · 05:30 Saída
```

Sem a marca, a trava de 12h recusaria a volta das 22:40 — e, pior, a marcação
seguinte entraria com o **tipo trocado** (o app ofereceria "entrada" para quem
estava saindo), porque a sequência de alternância teria sido quebrada. Quem não
é plantão continua com uma jornada por dia.

### Cortar a jornada na meia-noite

A operação pode preferir encerrar a jornada antes das 00:00 e reabri-la depois,
para que **cada dia da planilha feche com os pares completos** — é a política
usada no app da raiz, onde o pareamento é por data. Exemplo: entrada 16:00,
saída 23:50, entrada 00:05, saída 08:00.

Isso é **uma jornada partida em dois dias**, não duas jornadas — por isso a
trava de 12h entre jornadas vale só **dentro do mesmo dia civil**. Virando o
dia, a reabertura é liberada na hora, respeitando apenas o intervalo curto
(5 min), que continua impedindo a reabertura acidental logo depois da tela de
sucesso. Sem essa exceção a noite inteira se perderia: a pessoa não conseguiria
nem reabrir às 00:05 nem bater a saída às 08:00.

**Cortar é opcional.** Quem não cortar continua fechando o turno pela jornada
aberta (`23:00 → 04:00` funciona sem nenhum corte). A regra aceita as duas
operações, então esquecer de cortar não quebra par nenhum.

> ⚠️ **A planilha precisa do Apps Script `v2` ou mais novo.** A coluna `Tipo`
> era literal `'Saída'`; desde o v2 ela segue o tipo do registro. Com uma
> implantação anterior ao v2, **todas** as entradas chegam rotuladas como
> saída — agora que o quadro inteiro bate entrada, isso corromperia a folha.
> Para conferir o que está no ar, abra a URL do webhook no navegador: ela
> responde `Ponto Saida OK - v2 - Tipo dinamico (Entrada/Saida)`.
> Registros antigos, que não trazem o campo, continuam sendo lidos como saída.

## A aba passou a se chamar `Registros`

Ela nasceu `Saidas`, de quando o app só registrava saída. Agora que todo o
quadro bate entrada e saída, o nome virou `Registros` — o mesmo do app da raiz.

**Renomear à mão não bastava, e é por isso que aparecia uma `Saidas` repetida
com um registro só:** o código continuava procurando pelo nome antigo, não
achava, e criava a aba de novo a cada ponto batido. A troca acontece agora no
próprio código, ao colar a versão nova:

- só existe `Saidas` → ela é **renomeada**, com histórico, formatação e fotos;
- existem as duas → o que estiver na `Saidas` e faltar na `Registros` é
  **absorvido pela chave**, e a aba antiga é aposentada como
  `Saidas (migrada dd-MM-aaaa HH.mm)`. **Nada é apagado** — confira e apague à
  mão quando quiser.

## Painel de botões

O Apps Script não consegue criar um desenho e amarrar uma função a ele — isso
só existe pelo menu do Sheets, à mão, e some se a planilha for copiada. O que
ele consegue criar sozinho é uma **caixa de seleção**, e marcar uma caixa
dispara o script. É o botão que vem junto com o código.

O painel ocupa as **3 primeiras linhas** da `Registros`; o cabeçalho desceu
para a linha 4 e os registros começam na 5. A migração **empurra** as linhas
para baixo — nenhum registro se perde.

|  | A | B |
|---|---|---|
| **1** | Mês de referência | `setembro/2026` ▾ — e, na D1, a resposta da última ação |
| **2** | ☐ | ◀ Calcular horas do mês |
| **3** | ☐ | ◀ Mover os dados do mês |

O painel é desenhado sozinho ao ABRIR a planilha, na primeira vez depois de
colar o código — não é preciso rodar nada para ele aparecer.

A lista suspensa da B1 só oferece **meses que têm registro**, e se atualiza
sozinha. Marcada a caixinha, ela se desmarca e a ação roda; o resultado aparece
na D1 e num aviso flutuante.

> **Rode uma vez: menu Ponto → ① Preparar planilha (painel de botões).** É o
> que instala o gatilho das caixinhas — sem ele o painel aparece, mas marcar a
> caixa não faz nada. O Google vai pedir autorização na primeira vez. Os dois
> botões também estão no menu, se preferir.

### Botão 1 — Calcular horas do mês

Escreve a aba **`<mês>_calculos`** (`agosto_calculos`), criada se não existir e
**refeita do zero** a cada execução: corrigir um registro na origem e recalcular
sempre bate. Uma linha por **jornada**, ordenada por funcionário.

Lê a `Registros` **e** a `<mês>_registros`, se o mês já tiver sido movido — o
botão continua funcionando depois do arquivamento.

### Botão 2 — Mover os dados do mês

Tira do caminho o mês fechado: copia para **`<mês>_registros`**
(`agosto_registros`) ordenado por funcionário, **confere que a cópia chegou**, e
só então apaga da origem, eliminando de passagem as linhas em branco. A foto
viaja como fórmula e a caixinha *Conferido* é recriada como caixinha.

Calcule **antes** de mover: assim a jornada que atravessa a virada do mês
enxerga as duas pontas.

> As abas levam só o nome do mês (`agosto_calculos`), como pedido. Se o mês
> escolhido **não** for do ano corrente, o ano entra junto
> (`agosto_2025_calculos`) — dois agostos não podem cair na mesma aba.

## A aba do mês — horas calculadas

A `Registros` continua sendo o registro bruto e auditável — uma linha por
marcação, com foto e prova de vida — e **não é tocada** pelos cálculos.

Uma linha por **jornada**, não por dia civil. Quem entra às 22:00 e sai às
06:00 trabalhou um turno só; quebrado por data, esse turno viraria duas linhas
— uma terminando sem saída, outra começando com uma — e nenhuma contaria a
história. Marcação que caiu no dia seguinte vem com `+1` ao lado da hora.

| Coluna | O que traz |
|---|---|
| Nome · Data · Dia · Tipo de dia | identificação da jornada; *Tipo de dia* é Útil, Sábado, Domingo ou Feriado |
| `E1 S1 … E5 S5` | até **5 pares** de entrada/saída — o vão entre `S1` e `E2` é o almoço, o café, a ronda |
| Pausas | soma dos vãos entre os pares. **Não conta como hora trabalhada** |
| Total de horas | soma dos pares |
| Normais · HE 50% · HE 100% · Adic. noturno 20% | o cálculo, abaixo |
| Observação | jornada aberta, saída órfã, pares além do limite |
| Anotação | **coluna sua** — o script nunca escreve nela, e o que você digitar sobrevive ao próximo recálculo |

As colunas de tempo são **duração de verdade** (formato `[h]:mm`), não texto —
somam numa célula de total.

### Como as horas são classificadas

Cada par entrada/saída é **fatiado na virada do dia** antes de ser
classificado. Sem isso, uma jornada que começa no sábado e entra no domingo
seria julgada inteira pelo dia em que começou.

- **HE 100%** — horas caídas em **domingo ou feriado**, todas elas.
- **HE 50%** — o que passa da jornada normal: **8h de segunda a sexta**, **4h
  no sábado**.
- **Normais** — o restante.
- **Adicional noturno 20%** — horas entre **21:00 e 05:00**, de qualquer dia.
  É um adicional que **se soma** aos outros: a mesma hora pode ser extra e
  noturna.

`Normais + HE 50% + HE 100% = Total de horas` — há teste garantindo que fecha.

**A cota de 8h (ou 4h) é por pessoa e por dia, contada no dia em que a jornada
COMEÇOU.** As duas leituras divergem no turno da noite: quem entra 16:00 e sai
08:00 fez 15h45 de um fôlego só; fatiado por dia civil daria 7h50 numa data e
7h55 na outra — nenhuma passa de 8h, e o turno inteiro sairia **sem hora
extra**. Contado pelo dia de início, dá as 7h45 de extra que ele é. E duas
jornadas no mesmo dia **dividem a mesma cota**: a primeira gasta primeiro.

> ⚠️ O percentual de 20% e a faixa 21:00–05:00 vieram da especificação da
> operação, não da lei — a CLT urbana usa 20% sobre 22:00–05:00 com hora
> reduzida de 52'30", e a lei rural usa 25% sobre 21:00–05:00 sem redução.
> Confira contra a convenção coletiva. Os valores estão em constantes no topo
> da seção (`NOT_INI_H`, `NOT_FIM_H`, `ADIC_NOT_PCT`, `NORMAIS_SEG_SEX_H`,
> `NORMAIS_SAB_H`).

### O que separa duas jornadas

Voltar de uma pausa de até **4h** (`PAUSA_MAX_H`) continua a mesma jornada.
Uma pausa maior começa jornada nova. É a mesma leitura que o app faz do corte
de meia-noite: os 15 min entre a saída 23:50 e a entrada 00:05 são pausa, não
um turno novo.

### Feriados

Ficam na aba **`Feriados`**, criada na primeira execução já preenchida com os
17 de Unaí/MG em 2026. Virar o ano é editar a planilha, não o código. O
documento de origem trazia só data e dia da semana, então a coluna *Descrição*
nasce vazia — preencha se quiser.

> ⚠️ **Desta vez PRECISA reimplantar o app da web.** O `doPost` mudou — é ele
> que grava na aba, e agora ela se chama `Registros` e tem o cabeçalho na linha
> 4. Colar o código no editor **não** muda o que a URL `/exec` executa: a
> implantação aponta para uma versão congelada. Sem reimplantar, os pontos
> batidos no celular continuam criando a `Saidas` velha.
>
> 1. Cole o `apps-script.gs` novo e **salve**.
> 2. **Implantar → Gerenciar implantações → ✏️ → Versão: Nova versão.**
>    (Não crie uma implantação NOVA: a URL mudaria e o app pararia de enviar.)
> 3. **Recarregue a planilha** — é o que faz o menu e o painel aparecerem.
> 4. Menu **Ponto → ① Preparar planilha**, e aceite a autorização.
>
> Para conferir o que está no ar, abra a URL do webhook no navegador: ela
> responde `Ponto Saida OK - v3 - Aba Registros, painel de botoes, calculo por
> mes`. O menu e as caixinhas, esses sim, rodam sempre o código salvo no editor.

## Intervalo dentro da jornada

Sair e voltar dentro da **pausa máxima** (padrão **4h**) é *intervalo* — almoço,
café — e não abre jornada nova. Na volta, a trava de 12h não se aplica: vale só
o intervalo curto (5 min), que segue barrando o toque duplo na tela de sucesso.

Sem isso, quem saísse para o almoço às 11:30 só voltaria a bater às 23:30, e a
coluna `E2` da aba do mês nunca encheria. Foi essa trava que motivou a mudança.

Passada a pausa máxima, voltar é começar **outra jornada**, e a trava de 12h
volta a valer. Quem está marcado como **plantão** não tem esse limite: para
quem faz ronda, a volta pode demorar mais que a pausa e ainda ser o mesmo turno.

| Situação (funcionário comum) | Volta |
|---|---|
| Saiu 11:30, volta 12:30 (1h) | **liberada** — intervalo |
| Saiu 09:00, volta 15:00 (6h) | **travada 12h** — jornada nova |
| Saiu 09:00, volta 09:02 | **travada 5 min** — toque duplo |

Ajustável em **Admin → Configurações → Pausa máxima que continua a mesma
jornada (horas)**. Use **0** para não permitir intervalo — volta o
comportamento anterior.

> ⚠️ **Esse número tem que ser igual ao `PAUSA_MAX_H` do `apps-script.gs`.** É
> o mesmo limite dos dois lados: o app decide se aceita a volta, a planilha
> decide se agrupa na mesma jornada. Se a planilha usar um limite menor, ela
> parte em duas o que o app registrou como uma.

## Trava de 12 horas

A trava separa uma jornada da seguinte: conta a partir da **última saída** e
segura a **próxima entrada**. Enquanto estiver travado, o app mostra o nome e
`Saída já registrada às HH:MM · libera em 11h56` — o botão de confirmar nem
aparece. Entre a entrada e a sua saída vale o intervalo curto (5 min).

Ela **não vale na volta de um intervalo** — veja a seção acima. Almoçar não
começa jornada nova.

A regra é verificada em **dois pontos**: ao reconhecer o rosto (não abre a
confirmação) e de novo **imediatamente antes de gravar** — ou seja, ela não
depende da tela para valer.

Ajustável em **Admin → Configurações → Intervalo mínimo entre jornadas do mesmo
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

## Instalar no aparelho

O botão **⬇ Instalar** aparece no cabeçalho enquanto o app estiver rodando na
aba do navegador, e some sozinho depois de instalado. O mesmo comando está em
**Admin → 📱 Instalar no aparelho**, junto com o estado atual.

No Android o navegador entrega um diálogo pronto (`beforeinstallprompt`), que o
app guarda para disparar no clique — abrir o diálogo fora de um clique do
usuário é bloqueado. No iPhone esse evento não existe: o atalho é criado pelo
menu **Compartilhar** do Safari, e o botão mostra o passo a passo.

### Remover

**Nenhuma página consegue se desinstalar.** Não existe API para isso — o botão
*"Como remover o app"* só ensina o caminho do sistema (segurar o ícone →
Desinstalar, ou Remover App no iOS).

> ⚠️ **Sincronize antes de remover.** O cadastro e os registros ainda não
> enviados moram no IndexedDB **deste aparelho**; desinstalar apaga os dois. O
> que já subiu para a planilha permanece lá.

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

Vale também para a alternância entrada/saída: ela é contada **neste aparelho**.
Se a pessoa bate a entrada no app da raiz e vem aqui bater a saída, os dois apps
não se enxergam — este vai oferecer *entrada* de novo, e a jornada acaba partida
em duas planilhas. Cada pessoa usa um app só.
