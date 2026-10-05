# Brechó Digital — protótipo unificado

Vitrine, guarda-roupa, Stylist do avatar, colagem livre, feed e perfil numa
aplicação só.
HTML + CSS + JavaScript puro (ES modules), sem build e sem dependências.

## Rodar

Dois cliques em **`iniciar.bat`**, ou pelo terminal, dentro da pasta `App`:

```bash
python tools/servidor.py 5173
```

(É o `http.server` com `Cache-Control: no-store` — sem isso o navegador guarda os
módulos JS e você edita um arquivo mas continua vendo a versão antiga na tela.
Ele também atende as contas, pessoas e estoque num SQLite local.)

Para **colocar peça no jogo**, dois cliques em **`esteira.bat`** (ou
`python tools/servidor.py --nuvem`): a página é servida daqui e a `/api/*` vai
para a nuvem, com a sua conta de verdade. Ver "Esteira de peças" abaixo.

**A primeira conta criada é a do administrador.** É ela que vê "+ Adicionar
peça", "Repor loja" e "Devolver roupas"; as seguintes entram como usuário comum,
e o servidor recusa qualquer escrita no acervo vinda delas.

Depois abra <http://localhost:5173>.

Precisa ser por servidor: abrir o `index.html` direto do disco (`file://`) bloqueia o
carregamento do catálogo e a exportação de imagem. A página avisa se isso acontecer.

## O que cada tela faz

| Tela | O que já funciona |
|---|---|
| **Entrar** | Primeira tela: entrar ou criar conta. Senha com `scrypt` no servidor, sessão em cookie `HttpOnly` de 30 dias — voltar amanhã não pede senha de novo |
| **Vitrine** | Mural orgânico com 25 peças soltas (distribuição Poisson-disc), a rara por baixo de uma comum, sorteio diário com semente na data e cota por raridade, peças flutuando no tamanho real medido, aura de raridade no hover, arrastar para reorganizar, clique abre a ficha, limite de 3 resgates por dia |
| **Guarda-roupa** | Abre em **Todas as peças**; botão de adicionar peça própria; categorias com contador, raridade identificada pela cor do slot, arrastar para reordenar (persiste), destaque com ficha da peça |
| **Stylist** | Palco 600×1200 com o avatar base, paleta com aba "todas", uma peça por categoria (escolher outra troca), botão de sortear look com as suas peças, peça entra encaixada no ponto de ancoragem da categoria, mover/girar/redimensionar/espelhar/camada, salvar, publicar, exportar Story 1080×1920 e Post 1080×1350 |
| **Colagem** | A colagem livre estilo board de moda, sempre em fundo branco: botão de sortear colagem, réguas e guias, ímã de alinhamento, assinatura, etiquetas de texto, seleção múltipla, undo/redo e exportação |
| **Feed** | Abas Seguindo/Descobrir, 32 perfis fictícios publicando looks **e colagens** geradas na hora, com comentários, curtir, comentar, seguir, compartilhar, player da trilha do mês. A coluna "Quem seguir" procura por nome, sobrenome, @ ou bio — **contas reais incluídas**, é assim que se acha um amigo |
| **Tarefas** | As missões do dia com barra de progresso, a trilha de níveis (XP, quanto falta, o que cada nível abre) e a cápsula do ilustrador |
| **Inventário** | O personagem no meio da metade da esquerda, com uma coluna de lugares do corpo de cada lado dele (Cabeça, Tronco, Pernas · Acessório, Cintura, Pés); à direita a mochila, uma página fixa de 5×5 casas com o passador embaixo. Um clique abre a peça, dois vestem; arrastar veste, tira e arruma o saco. As 66 peças aparecem soltas na casa, como item, e não recortadas do corpo. É o que o perfil veste |
| **Perfil** | A sua página, com o mesmo desenho da página pública: avatar, bio, desde quando, números, amigos e três vitrines curadas — looks, colagens e roupas que você favoritou. Mais editar identidade e personagem, contas conectadas e botões de teste |
| **Perfil de alguém** | A página pública de quem aparece no feed: avatar, bio, redes ligadas, desde quando, seguidores, as colagens dela (com curtir e comentar no lugar), as peças que ela veste e um atalho para os outros perfis |
| **Personagem** | Tom de pele, corte e cor do cabelo do avatar que veste os seus looks |

## Estrutura

```
App/
  index.html            todas as telas; o roteador mostra uma por vez (#/vitrine, #/closet, ...)
                        telas com alvo levam parâmetro na hash (#/usuario/u-lia)
  css/                  base + um arquivo por tela
  dados/
    usuarios.sqlite     contas e sessões (não é servido: /dados responde 404)
  js/
    auth.js             cliente da API de contas: entrar, criar, sair, trocar senha
    telaauth.js         a tela de entrada, única que roda antes do app existir
    config.js           regras do jogo: limites, raridades, âncoras por categoria, missões, níveis, collab
    catalog.js          carrega assets/catalog.json e monta os <clipPath> de cada peça
    db.js               persistência (localStorage no formato que vai para o DynamoDB)
    presente.js         o brinde de conta nova: 2 tops, 2 calças e 2 calçados, comuns e incomuns
    vitrine.js          mural do dia, resgate, NPC
    closet.js           inventário
    stylist.js           editor de colagem sobre o avatar
    board.js            editor da colagem (colagem livre)
    sorteio.js          monta um look plausível — ou uma colagem — a partir de um acervo
    boardgeo.js         geometria da colagem, compartilhada entre tela e exportação
    render.js           desenha o look num canvas (miniatura e exportação)
    avatar.js           manequim SVG + guia de ancoragem
    roupinhas.js        catálogo das roupas desenhadas: arte, slot e desbloqueio
    vestiario.js        a tela de vestir o avatar com elas
    social.js           feed, abas, curtir, comentar, posts fictícios
    usuario.js          perfil público de outra pessoa (#/usuario/<id>)
    busca.js            busca de pessoas: o campo da coluna do feed e o modal do perfil
    pessoas.js          contas reais: procurar, seguir e publicar o próprio perfil no servidor
    conexoes.js         Instagram e Pinterest ligados ao perfil
    perfil.js           a sua página: identidade, vitrines de favoritos, amigos
    tarefas.js          missões do dia, trilha de níveis e cápsula
    favoritos.js        a estrela que escolhe o que vai para o perfil
    nivel.js            nível na interface: selo da sidebar, barra de XP, travas
    aura.js             brilho de raridade recortado na silhueta da peça
    alpha.js            hit-test por pixel (plano B, quando não há contorno vetorial)
    paineis.js          puxadores que redimensionam as colunas laterais
    util.js             semente diária, Poisson-disc, helpers de DOM, toasts
  tools/
    bgbatch.py          foto com fundo → recorte PNG em alta (o máster)
    pipeline.py         PNG → WebP + contorno vetorial + catálogo
    servidor.py         servidor local sem cache
    contas.py           contas e sessões: SQLite, scrypt, cookie de sessão
    pessoas.py          achar gente, seguir e o perfil público: SQLite (espelho de nuvem/lambda/pessoas.py)
  assets/
    catalog.json        59 peças: imagem, categoria, dimensões e path SVG
    cloths/*.webp       imagens otimizadas (2,2 MB no total, contra 27 MB dos PNGs)
    mestres/*.png       recortes em alta das peças subidas pelo admin
    audio/              vazio: solte base.mp3 e collab-01.mp3 aqui para ligar o player
```

## Contas

O login é de verdade, não é casca: a senha vai para o servidor, volta como hash
`scrypt` com sal por usuário, e o que o navegador recebe é um cookie `HttpOnly`
— JavaScript não lê o token, então um XSS não leva a sessão embora. No banco
fica o SHA-256 do token, e não o token: vazar `dados/usuarios.sqlite` não dá
sessão a ninguém.

| Rota | O que faz |
|---|---|
| `POST /api/auth/registrar` | cria a conta e já entra |
| `POST /api/auth/entrar` | login; erro idêntico para e-mail inexistente e senha errada |
| `POST /api/auth/sair` | encerra a sessão e limpa o cookie |
| `GET /api/auth/eu` | quem está logado (é o que o app pergunta ao abrir) |
| `PUT /api/auth/eu` | muda nome e @ (o @ é único entre todo mundo) |
| `POST /api/auth/senha` | troca a senha e derruba as outras sessões |

Detalhes que já são de produção, e não de protótipo: 8 tentativas erradas por
IP + e-mail em 15 minutos; login de e-mail inexistente gasta o mesmo tempo de um
`scrypt`, para ninguém descobrir quem tem conta aqui cronometrando a resposta; e
o custo do hash está gravado dentro do próprio hash, então dá para endurecê-lo
depois sem invalidar senha nenhuma (quem entra com o custo velho é regravado).

Criar conta pede o e-mail e a senha **duas vezes**. É o único momento em que os
dois são digitados às cegas: e-mail com letra trocada é conta que nunca vai
receber recuperação nenhuma, e senha com letra trocada é conta em que ninguém
entra mais — e as duas só apareceriam no próximo login, quando não há mais o que
fazer. A conferência é da tela (`js/telaauth.js`), acontece antes da requisição
e devolve o cursor para o campo que não bate; o e-mail é comparado sem caixa
(o servidor guarda normalizado), a senha é comparada exatamente como digitada.

Repetir o e-mail **não** é o mesmo que confirmá-lo: isto pega erro de digitação,
não prova que o endereço existe. Continuam faltando a confirmação por link e o
"esqueci a senha" — os dois pedem e-mail transacional, que é decisão da nuvem
(SES, Resend). A coluna `email_confirmado` já existe esperando.

### O presente de boas-vindas

Conta nova entra com **duas camisas, duas calças e dois calçados** no
guarda-roupa (`js/presente.js`, regra em `PRESENTE` no `js/config.js`). Sem
isso, a primeira sessão é um closet vazio, um Stylist sem o que arrastar e um
personagem pelado: seis peças é o mínimo para um look fechar (top + calça +
calçado) e ainda sobrar troca em cada categoria.

Só sai peça **comum ou incomum**, e o sorteio é o do jogo: a faixa é tirada nos
pesos de `RARIDADES` (60 contra 25), então a incomum aparece em ~3 de cada 10
peças do presente, a mesma proporção da arara. Rara para cima continua sendo
coisa de quem apareceu na loja — o presente não compete com o garimpo.

Três detalhes que a implementação resolve:

- **A faixa é sorteada antes da peça.** Peça do acervo já nasce com a raridade
  escrita na ficha; carimbar outra no presente faria a mesma peça ser rara no
  mural e comum no closet de quem entrou. Então sorteia-se a faixa e escolhe-se
  entre as peças que *já são* dela hoje. Se a categoria não tiver nenhuma da
  faixa sorteada, entra a da outra — melhor a comum do que o presente faltando peça.
- **Entra antes de a vitrine ser montada.** O sorteio do dia exclui o que você
  já tem, então a loja abre sem as seis — o que já é seu não está mais à venda.
- **Ninguém ganha duas vezes.** A data da entrega fica no save
  (`state.boasVindas`), e é ela que decide, não "o inventário está vazio":
  devolver tudo para a loja no modo administrador não gera presente novo.
- **Nem duas peças do mesmo modelo.** O acervo tem famílias — quatro moletons
  Hollister (branco, verde, cinza e rosa), dois Gel-Nimbus, dois Wing Skull —,
  peças distintas de verdade, mas que lado a lado leem como a mesma roupa. E
  elas se concentram justamente na faixa do presente: das oito calças
  elegíveis, **quatro são o mesmo moletom**. Sem trava, um em cada sete
  presentes saía com duas calças praticamente iguais. `modeloDa()` (categoria +
  nome + marca; peça sem nome é o próprio id) tira a família inteira do sorteio
  depois que uma peça dela sai.

Uma coisa que o presente **não** faz, e que é fácil confundir: ele não muda o
que a loja mostra além do óbvio. A peça exata que você ganhou nunca reaparece
no mural — `poolDoDia()` filtra `temPeca`, e isso vale para o presente como
vale para o resgate. O que pode aparecer é uma *irmã* dela: o moletom rosa
continua à venda depois de você ganhar o branco, porque são duas peças
diferentes. Se um dia a peça exata reaparecer, o problema não é o sorteio da
loja — é o save ter sido perdido (guarda-roupa vazio é guarda-roupa que não
possui nada), e aí o lugar de olhar é a sincronização com a nuvem.

O presente não gasta resgate nem conta como missão: é da casa, não é garimpo —
o primeiro dia continua com os três resgates inteiros.

### Onde cada coisa mora

O **estado do jogo** — inventário, looks, colagens, feed, XP — continua no
`localStorage`, agora com uma chave por conta (`bd:v1:estado:<id>`): duas pessoas
no mesmo computador têm dois guarda-roupas. Quem já jogava antes das contas não
perde nada — a primeira conta criada nesta máquina adota o save antigo. A adoção
**muda a chave, não copia**: uma partida com as miniaturas dos looks e das
colagens chega perto da cota do navegador sozinha, e manter duas cópias, ainda
que por um instante, estoura a cota no meio do primeiro login.

O que identifica a pessoa — nome, @, e-mail, papel — mora no banco, não no save:
trocar o nome no perfil é um `PUT /api/auth/eu`, e vale em qualquer navegador. O
resto do perfil (bio, avatar, assinatura, preferências) é do save.

A consequência é a de sempre: entrar da mesma conta em outro computador ainda
mostra um guarda-roupa vazio, porque o save é local. É exatamente esse buraco
que a nuvem fecha, e `db.js` foi deixado pronto para isso — nenhuma tela chama
`localStorage`, todas passam por `carregar()`/`salvar()`.

### Quando subir para a nuvem

| Hoje | Lá |
|---|---|
| `const API = ''` em `js/auth.js` | a URL da API (e CORS com `Allow-Credentials`, cookie `SameSite=None; Secure`) |
| `tools/contas.py` sobre SQLite | as mesmas cinco funções sobre DynamoDB (ou Cognito) |
| `dados/usuarios.sqlite` | tabela `usuarios` + tabela `sessoes` com TTL nativo |
| `carregar()`/`salvar()` em `js/db.js` | `GET`/`PUT /api/estado` — o registro já tem o formato de item |
| tentativas por IP em memória | rate limit do API Gateway |
| cookie sem `Secure` em localhost | `Secure` entra sozinho: o servidor já olha o `X-Forwarded-Proto` |

## A Colagem

É a aba do board de moda: peças recortadas soltas sobre o fundo branco, enquadradas e
assinadas — diferente do Stylist, que veste o avatar. As duas convivem.

O board tem **1000 unidades de largura** e a altura vem do formato, então o que está
na tela sai idêntico no PNG, em qualquer resolução ou zoom.

**Enquadramento**
- Formato fixo de post (4:5). Os outros formatos continuam no renderizador
  (`BOARD.FORMATOS` em `js/config.js`), só não aparecem na interface
- Fundo sempre branco, sem textura e sem moldura: a colagem é só as peças
- Margem regulável: é ela que define a área útil das peças e serve de alvo para o ímã
- Réguas nas duas bordas: arraste de dentro delas para criar guias; arraste a guia para
  fora para descartar, ou dê dois cliques nela
- Ímã (snap) nas guias, na margem, no centro e nas bordas das outras peças, com as
  linhas-guia aparecendo durante o arrasto; segure Alt para ignorar
- Sobreposição de grade e de margem de segurança, ligáveis na barra de cima

**Assinatura**
- Texto, fonte (5 famílias), tamanho, espaçamento, cor e posição (embaixo, em cima ou nos cantos)
- "Usar como minha assinatura" grava o padrão: toda colagem nova já nasce assinada

**Peças e etiquetas**
- Clique na paleta para soltar; a peça cai na próxima casa livre do enquadramento
- Mover, girar (Shift trava de 15 em 15 graus), redimensionar por qualquer uma das quatro
  quinas ou pela roda do mouse, espelhar, opacidade, sombra, travar, duplicar e remover
- A sombra é preferência sua: o que estiver marcado vale para a seleção e fica gravado
  como padrão das próximas peças, em qualquer colagem
- Camadas: frente, fundo, uma acima, uma abaixo (ou `[` e `]`)
- Etiquetas de texto com fonte e cor próprias, para título, preço ou recado
- Seleção múltipla: Shift+clique, laço no vazio ou Ctrl+A
- Organizar em grade e espalhar
- Undo/redo (Ctrl+Z / Ctrl+Shift+Z), setas para empurrar, Del para remover, Ctrl+D para duplicar

**Saída**
- Salvar, publicar no feed e exportar (PNG ou 2×) ficam na barra de baixo, sempre visíveis
- Enquadramento, assinatura e biblioteca são blocos recolhíveis no painel da direita:
  abre só o que for mexer e nada exige rolagem

## Remoção de fundo (`tools/bgbatch.py`)

O pipeline abaixo assume PNG com fundo transparente. O `bgbatch.py` é o passo
antes dele: pega a foto crua — JPG de estúdio, print de e-commerce, foto de
celular — e devolve o recorte em PNG com alpha no tamanho grande, o **máster**.

Instalação (uma vez):

```bash
python -m pip install onnxruntime pillow numpy
python tools/bgbatch.py --baixar
```

Os modelos ficam fora do projeto, em `%LOCALAPPDATA%\brecho-bgbatch\modelos`
(`BGBATCH_MODELOS` muda a pasta):

| `--modelo` | disco | licença | observação |
|---|---|---|---|
| `birefnet-general` | 973 MB | MIT | **o padrão.** A melhor borda |
| `birefnet-lite` | 224 MB | MIT | quase tão bom, ~30% mais rápido |
| `isnet` | 179 MB | Apache 2.0 | rápido, perde alça fina e renda |
| `birefnet-general-fp16` | 490 MB | MIT | **não use em CPU** — veja abaixo |

**O fp16 é uma armadilha em CPU.** Parece a escolha esperta: metade do disco,
mesma rede. Só que o onnxruntime não executa meia precisão nativamente na CPU —
ele insere nós de conversão e expande os pesos, e o resultado gasta *mais*
memória que o fp32 original. Numa máquina de 16 GB o fp16 não carregou, e o
modelo de 973 MB carregou sem reclamar. Tamanho em disco não é consumo de RAM.

Medido contra alpha conhecido — peça real do acervo achatada sobre fundo de
estúdio e recortada de volta, comparando o alpha recuperado com o original:

| peça | IoU | erro-α | área | seg (CPU) |
|---|---|---|---|---|
| top | 0,993 | 0,0037 | +0,6% | 73 |
| tênis | 0,992 | 0,0033 | −0,2% | 49 |
| bolsa | 0,989 | 0,0045 | −1,1% | 48 |
| acessório | 0,993 | 0,0042 | −0,7% | 46 |
| **média** | **0,9917** | **0,0039** | | |

O `birefnet-lite` fica em IoU 0,990 / erro 0,0045 nas mesmas peças, em ~35 s.
A diferença é pequena o bastante para valer a troca quando a máquina apertar.

**Se faltar memória**, o script se vira sozinho, em dois degraus. Primeiro
refaz a sessão sem a arena do onnxruntime e com otimização de grafo básica, e
refaz a passada. São dois picos diferentes — a arena estoura *entre* as
passadas, o otimizador estoura *ao carregar*, antes de recortar qualquer coisa.
Fica mais lento e termina.

Se nem assim couber, desce um degrau da escada `birefnet-general` →
`birefnet-lite` → `isnet` e refaz a passada no modelo mais leve. O recuo fica
registrado: vale para as outras passadas da mesma foto — senão a global sairia
de um modelo e a de detalhe de outro — e para as peças seguintes, que não
tentam os 973 MB de novo. O fp16 fica fora da escada de propósito: em CPU ele
gasta *mais* RAM que o fp32, então seria um degrau para cima. Só quando nem o
`isnet` cabe é que vem o erro, dizendo isso — em vez de um `bad allocation`
seco.

### O que a máquina precisa ter

| Variável | Para quê |
|---|---|
| `BGBATCH_MODELO` | qual modelo o servidor usa (padrão `birefnet-general`) |
| `BGBATCH_MODELOS` | pasta do cache dos `.onnx` — aponte para outro disco se o C: estiver apertado |
| `BGBATCH_FOLGA_MB` | espaço que o download nunca encosta (padrão 250) |
| `BGBATCH_POUCA_MEMORIA=1` | desliga a arena do onnxruntime: mais lento, pico de memória menor |
| `BGBATCH_MAX` | maior lado do máster gerado pelo servidor (padrão 2048) |
| `BGBATCH_PREAQUECER=0` | não carrega o modelo ao subir o servidor |

**Disco.** O download vigia o espaço do começo ao fim e para antes de encostar
na folga, deixando o `.parte` para retomar depois. Um disco de sistema em zero
byte não é um download que falhou — é o Windows sem onde escrever.

**Memória.** No Windows o teto de alocação é o *commit*, e o commit depende do
pagefile — que não cresce com o disco cheio. Disco cheio, então, derruba o
recorte por dois caminhos ao mesmo tempo: nega o espaço do modelo **e** trava o
teto de memória. Vale saber disso antes de sair investigando o segundo.

Em lote:

```bash
python tools/bgbatch.py                       # ../Cloths/brutas → ../Cloths
python tools/bgbatch.py --tiles 2 --max 3000  # borda em alta, máster maior
python tools/pipeline.py --force              # e então o catálogo
```

O recorte sai em alta porque são três passadas, não uma:

1. **Global** — o modelo roda na foto inteira reduzida a 1024² e devolve uma
   máscara grosseira. Serve para achar *onde* está a peça, não para recortá-la.
2. **Detalhe** — a peça é recortada da foto em resolução plena pela caixa da
   passada 1 e volta ao modelo. Agora ela ocupa os 1024² inteiros: uma alça de
   6 px na foto original chega ao modelo com 40 px. É daqui que sai a borda.
3. **Ladrilhos** (`--tiles N`, opcional) — a faixa de incerteza da máscara é
   refeita em pedaços, cada um em 1024². Cada ladrilho é uma passada inteira,
   então isso é coisa de lote, não da tela.

Depois vem a **limpeza de borda**, que é o que separa um recorte que cai bem na
prancheta branca de um que não cai. O pixel semitransparente da silhueta
carrega cor do fundo que acabou de ser removido: a imagem é `I = a·F + (1-a)·B`
e o que se quer guardar é o `F`. O `B` sai da média da vizinhança onde o alpha
é ~0, e o `F` se isola por conta.

Só que isolar o `F` assim supõe que o pixel de fato *misturou* peça e fundo — e
a máscara, esticada de 1024², erra a silhueta por um ou dois pixels com
frequência, jogando a faixa semitransparente em cima de fundo puro. Ali a conta
acerta e devolve fundo, que recomposto vira de novo o halo. Por isso são duas
estimativas: onde a observação ainda se distingue do fundo ela manda; onde ela
é o próprio fundo, a cor vem do tecido logo ao lado. O resultado é uma borda
serrilhada de verdade em vez de uma franja clara.

## Pipeline de imagens

`tools/pipeline.py` é a versão local (e executável) do processo descrito em
*Anotações/upload e formatação das imagens.txt*:

```bash
python tools/pipeline.py            # lê ../Cloths, escreve assets/
python tools/pipeline.py --force    # reprocessa tudo
```

Para cada PNG ele recorta pelo alpha, converte para WebP, traça o contorno do objeto
(Moore neighborhood), simplifica os pontos (Douglas-Peucker) e grava o path SVG
normalizado no catálogo. O frontend aplica esse path como `clip-path`, e então o próprio
navegador passa a ignorar os pixels transparentes **também no clique e no hover** —
sem ler pixel por pixel. Peças com duas partes (um par de botas) viram dois subpaths.

O hit-test por canal alpha do protótipo antigo continua em `alpha.js` e entra
automaticamente se o catálogo não existir e as imagens vierem do S3.

## Guia do avatar (para os ilustradores)

O palco tem **600×1200** unidades e o corpo ocupa 8 cabeças. Cada categoria tem um ponto
de ancoragem (`CATEGORIAS[*].anchor` em `js/config.js`): `x`/`y` é onde o centro da peça
encosta, `w` é a largura alvo em unidades de palco e `z` é a camada.

No Stylist, o botão **Guia do avatar** desenha esses pontos sobre o manequim — é o material
que o ilustrador convidado precisa para entregar arte que encaixa sozinha.

A ordem das camadas (`z`) segue o corpo: calça 20, calçado 28, top 30, casaco 40, bolsa 50,
relógio/anel 55, acessório 60, chapéu 65. O calçado fica **acima** da calça — é a bota por
cima da barra, e não o contrário.

## Vestir no Stylist

Cada categoria é um lugar no corpo, não uma pilha: o palco tem **uma peça de cada**.
Escolher outra calça troca a que está lá, e clicar de novo na peça que já está vestida tira
ela do palco. A peça vestida fica marcada com ✓ na paleta, para a troca não ser surpresa.
Quando a peça nova entra, ela herda a camada da que saiu — se você tinha subido ou descido
aquela camada, a substituta entra na mesma altura.

A paleta abre na aba **✦ todas**, com o guarda-roupa inteiro em ordem de categoria; as abas
seguintes filtram por categoria e só aparecem quando há peça nelas.

## Dados

Tudo fica em `localStorage`, na chave `bd:v1:estado`, num formato que já imita o registro
do DynamoDB: usuário, inventário, estado do dia, looks, feed, missões, XP e cápsula.
Trocar por uma API é substituir `carregar()` e `salvar()` em `js/db.js`.

Em **Perfil → Testes** há como liberar os resgates do dia, ganhar 10 peças e apagar tudo.
As missões e o XP ficam na aba **Tarefas**.


## Níveis e XP

As missões são **do dia**: zeram na virada da meia-noite, junto com a vitrine
(`db.virarODiaSeNecessario`). Cada missão paga XP uma vez por dia e fechar as
cinco paga um bônus (`XP_BONUS_DIA`). O XP nunca zera — é ele que dá o nível.

O nível não fica salvo: é **derivado** do XP acumulado por `nivelPorXP()`. Mexer
na curva em `config.js` recalcula o nível de todo mundo, sem migração de save.

```js
NIVEL = { XP_BASE: 120, XP_PASSO: 40, MAX: 40 }   // nível n → n+1 custa 120 + (n-1)*40
```

As missões e tudo que é progresso moram na aba **Tarefas**; o perfil ficou sendo
quem você é.

Onde o nível aparece: selo fixo no rodapé da sidebar (número + barra do
progresso), barra completa no topo das Tarefas (nível, apelido da faixa e quanto
falta) e como chip ao lado do seu nome, no feed e no perfil.

### Ferramentas por nível

`config.FERRAMENTAS` diz o nível mínimo de cada tela. Hoje está tudo em `1`
(nada travado). Subir o número já tranca sozinho:

* o botão da sidebar fica cinza com cadeado (`nivel.js`);
* `irPara()` recusa a entrada e avisa o nível que falta (`router.js`);
* as Tarefas listam o que abre em cada nível;
* ao subir de nível, o que abriu naquele momento vira toast.

Quem quiser reagir ao XP escuta `db.onXP(fn)` — `db` não conhece a interface.

## Raridades

Cinco níveis. Quantas peças de cada um a loja do dia leva é sorteado pela tabela
`naLoja` de cada raridade (`RARIDADES` em `js/config.js`, em %):

| Nível | Peças na loja do dia | Aura |
|---|---|---|
| Comum | o que sobrar até 25 | nenhuma |
| Incomum | 4 (25%) · 5 (45%) · 6 (30%) | verde |
| Rara | 1 (20%) · 2 (50%) · 3 (30%) | azul |
| Épica | 0 (25%) · 1 (63%) · 2 (12%) | roxa |
| Lendária | 0 (93%) · 1 (7%) | colorida, com matiz girando |

É a cota, e não o acervo, que manda: antes as 25 peças eram sorteadas sem olhar
raridade, e com 10 épicas em ~100 peças cadastradas vinham ~2 épicas todo dia. Se a
raridade não tem peça suficiente disponível (a lendária, hoje, não tem nenhuma no
acervo), a loja vem com menos dela — comum nunca é promovida para cobrir a cota. Peça
que você pegou hoje continua ocupando a vaga dela até a meia-noite: pegar a épica e
recarregar não põe outra épica no lugar.

O `peso` continua valendo para a peça **sem ficha** (catálogo base e presente de
boas-vindas): é ele que sorteia a raridade dela no dia — comum 60, incomum 25, rara
11, épica 3, lendária 1.

A raridade da peça sem ficha é sorteada **por peça e por dia**, com a mesma semente da vitrine. Ou seja:
a peça já brilha no mural antes de ser resgatada, e o que você vê é exatamente o que
entra no guarda-roupa. Depois de resgatada, o valor fica gravado com a peça e não
muda mais.

A aura não é um retângulo atrás da roupa: a silhueta é recortada da própria imagem com
`mask-image`, então o brilho acompanha o contorno — mesmo princípio do `clip-path` que
resolve o clique. Cada peça respira no seu tempo, com atraso aleatório, para o mural não
pulsar em uníssono. Quem tem `prefers-reduced-motion` ligado vê a aura parada.

Aura e imagem ficam dentro do mesmo invólucro (`.peca-flutua` na vitrine,
`.preview-moldura` no closet), e é o invólucro que se move. Por isso o brilho nunca
descola da peça: as duas coisas são um bloco só, tanto na flutuação quanto no hover.

Na loja a aura e a etiqueta de raridade **só acendem com o mouse em cima da peça**.
Parado, o mural é a arara: roupa em cima de papel, sem néon. O brilho é a resposta a
quem se interessou por aquela peça — e, com ele ligado o tempo todo, o que era destaque
virava ruído de fundo. Quem faz o fade é `.aura-cx`, uma caixa em volta da aura: a
opacidade da aura em si é animada pelo keyframe do brilho, e um `opacity` aplicado
direto nela não teria como vencer a animação.

A aura vive **só na loja**, onde serve para a peça saltar no meio do mural. No
guarda-roupa a raridade é identificada só pela **cor do slot** — borda e fundo —, que é
mais legível numa grade cheia: borda verde para incomum, azul para rara, roxa para
épica e borda em arco-íris para lendária (feita com dois fundos empilhados, sem imagem).
Stylist, colagem, feed e imagens exportadas não têm nem uma coisa nem outra.

O código está em `js/aura.js` e as cores em `RARIDADES` (`js/config.js`).

## Mexer no mural da loja

O mural não é só vitrine — dá para remexer, como numa arara:

- **Arrastar** qualquer peça para onde quiser. A posição fica guardada até a vitrine
  virar no dia seguinte (`dia.posicoes` no estado)
- **Passar o mouse** traz a peça para frente e ela *fica* lá — o que você mexeu por
  último está por cima. Isso resolve a peça escondida embaixo de outra
- **Clicar** abre a ficha: imagem, nome, raridade com a chance de sorteio, categoria,
  marca e o botão de pegar. Fecha no X, no Esc ou clicando fora

Arrastar e clicar se distinguem pela distância: até 4px o gesto ainda conta como clique,
então não tem risco de abrir a ficha sem querer ao mover uma peça.

## Sortear colagem

Os dois editores têm um botão que monta uma composição sozinho com as peças que você
tem: **🎲 Gerar look** no Stylist e **🎲 gerar** na barra de baixo da Colagem.

O critério é o mesmo nos dois (e é o mesmo que povoa os perfis do feed): vestido *ou*
top + calça, um calçado, e acessórios por chance — chapéu 55%, bolsa 50%, óculos 40%,
casaco 35%, relógio 25%, anel 20%. Guarda-roupa pequeno completa com o que houver.

- No Stylist as peças entram encaixadas nos pontos de ancoragem, com uma variação leve
- Na Colagem elas são espalhadas dentro do enquadramento, com inclinação leve — é a
  mesma `colagemAleatoria()` de `js/sorteio.js` que monta as colagens do feed, então
  o que os perfis fictícios publicam sai com o mesmo critério que o seu botão
- Sortear na Colagem troca as peças, não o enquadramento: a margem e a
  assinatura que você escolheu ficam
- Clicar de novo sorteia outro. Na Colagem, Ctrl+Z volta; no Stylist, ele só pergunta
  antes de trocar se houver trabalho seu no palco que não veio de sorteio

A regra mora em `js/sorteio.js`.

## Tamanho das peças nas grades

A célula onde uma peça aparece tem tamanho **fixo**, não elástico, e é **a mesma em
todas as telas**: guarda-roupa, paleta do Stylist, paleta da Colagem e cápsula do
perfil. A peça fica do mesmo tamanho em qualquer largura de painel ou de tela — o que
muda é quantas colunas cabem.

A medida é uma variável só, `--cel-peca` (140px), em `:root` no `css/base.css`. Mudar
esse número aumenta as peças em todos os lugares de uma vez.

A imagem preenche a célula com `object-fit: contain`, então peça alta e peça larga
ocupam a mesma caixa sem distorcer e sem vazar. As grades reservam o espaço da barra
de rolagem (`scrollbar-gutter: stable`) para não perder uma coluna quando a lista
cresce.

### O mural da vitrine

O mural não usa a célula fixa: lá a peça tem o tamanho dela, e **quem manda é a
largura**. `tamanhoNoMural()` (em `js/config.js`) faz `largura = LARGURA_MURAL ×
escalaMural(peça)` — 252px para uma peça de tamanho 1, o casaco — e a altura sai da
proporção da imagem, com teto em `ALTURA_MAX_MURAL` (540px) para a peça absurda não
virar cartaz. Esse teto precisa ficar **acima da peça longa legítima**: quando ele
aperta, quem encolhe é a largura, e aí a calça — a peça mais alta do acervo — sairia
menor que a camisa, que é exatamente o oposto do esperado.

A largura manda porque é ela que foi medida no molde (`ancora.w`). Antes o mural
dimensionava pelo **maior lado**, e o resultado é o que se via na loja: duas camisas
medidas iguais saíam de tamanhos diferentes, porque a recortada mais alta encolhia de
largura para caber na mesma caixa. Pelo mesmo motivo o mural não sorteia mais um
tamanho por peça — a variação orgânica fica no giro e na flutuação, que não mentem
sobre o tamanho da roupa.

Peça maior significa menos peça na tela: `densidade()` calcula quantas cabem
(uma a cada ~70.000px² de mural) e a distância mínima entre elas no Poisson-disc.
`CONFIG.PECAS_NA_VITRINE` continua sendo o teto.

Peça rara fica por baixo de uma comum (`encobrirAsRaras`), e chegar nela é tirar a de
cima. Por isso **passar o mouse não puxa a peça para a frente** — só pegar (arrastar
ou clicar) puxa — e **só a silhueta da roupa recebe o mouse** (`.item-roupa` tem
`pointer-events: none`; a `<img>`, recortada pelo contorno, tem `auto`): a caixa
transparente e o botão "Pegar" invisível da peça de cima não tapam a ponta da rara.

## Personagem

O botão **Editar personagem** no perfil abre uma tela própria (`#/personagem`) com a
prévia grande de um lado e as escolhas do outro:

- **6 tons de pele** — cada um leva junto a cor do traço, para o contorno não destoar
- **8 cortes de cabelo** — raspado, curto, franja, chanel, longo, coque, cacheado e
  tranças. Cada opção mostra o próprio corte na cor escolhida, então dá para escolher
  olhando em vez de lendo
- **12 cores de cabelo**, das naturais às inventadas

O avatar é SVG desenhado em código (`js/avatar.js`), então a aparência são três valores
em `usuario.avatar`. A prévia não é uma versão especial: é exatamente o mesmo desenho que
o Stylist, o molde de dimensionar e as imagens exportadas usam — muda num lugar, muda em
todos. Cabelo comprido tem uma camada atrás do corpo e outra na frente da cabeça, e o
rosto é desenhado por último para o cabelo nunca cobrir os olhos.

Novos cortes entram em `CABELOS` (`js/config.js`): é um par de trechos de SVG (`atras` e
`frente`) com `{cor}` no lugar da cor.

### Os outros também têm personagem

Cada perfil fictício tem a própria aparência, sorteada a partir do **id** dele
(`aparenciaSorteada` em `js/avatar.js`). Como a semente é o id, a mesma pessoa tem sempre
o mesmo rosto — entre renders e entre sessões — e perfil novo já nasce com cara própria
sem ninguém cadastrar nada. Um perfil pode trazer `aparencia` explícita quando você quiser
dirigir a aparência de alguém.

Isso vale em dois lugares: o **retrato redondo** ao lado do nome (o mesmo avatar recortado
na cabeça, em vez da bolinha com a inicial) e a **miniatura do post**, que passa a
renderizar o look no corpo de quem postou. Antes todos os posts do feed usavam o *seu*
personagem — o que ficou errado assim que o avatar virou customizável.

## Procurar pessoas

Com dez perfis, "quem seguir" era o diretório inteiro e achar alguém era ler a
lista. Com gente de verdade no app isso não vale mais, e a busca mora em
`js/busca.js`. Ela junta duas fontes na mesma lista, **contas reais primeiro**:

- **Contas reais** — quem criou conta no brechó. Só o servidor conhece, então
  `js/pessoas.js` pergunta a `GET /api/usuarios?q=` (com uma espera de 250 ms
  depois da última tecla: cada pergunta é uma varredura da tabela) e devolve
  cada conta no mesmo formato dos fictícios, com `real: true`.
- **Perfis de exemplo** (`PERFIS_MOCK`, em `js/config.js`) — os 32 do feed,
  filtrados no próprio navegador.

A tela nunca espera o servidor: pinta os exemplos na hora e repinta quando a
resposta chega, dizendo "procurando…" no intervalo (sem isso a lista diria
"ninguém com esse nome" sobre uma coisa que ainda não se sabe). Sem servidor, ou
sem a rota, a busca segue só com os exemplos. São duas entradas para a mesma
coisa:

- **O campo na coluna do feed.** Sem termo mostra 8 sugestões, quem você ainda
  não segue primeiro; com termo mostra o achado. O termo sobrevive ao repinte
  do feed (seguir alguém repinta tudo), e Esc limpa.
- **O modal "Procurar pessoas"**, pelo botão da seção **Amigos** do perfil. Sem
  termo lista quem você ainda não seguia *quando abriu* — a lista é fixada na
  abertura, senão quem você acabou de seguir sairia dela e o selo de amigos
  nunca daria para ver. Ao fechar, o perfil se refaz.

As duas usam a mesma linha (`linhaDePessoa`) e mexem no mesmo lugar,
`usuario.seguindo`, por `alternarSeguir`: seguir de um lado aparece do outro.

**O casamento** ignora acento e caixa (`jo` acha "Jô", `leo` acha "Léo") e
tira o `@` do termo. Casa em nome, sobrenome, @ e bio, e ordena por onde casou:
@ e nome que *começam* com o termo vêm antes de quem só o contém, e o nome vem
antes da bio. Sem isso, procurar `lia` devolveria primeiro quem tem "família"
na bio.

**Amigo** continua sendo mão dupla (seguir e ser seguido de volta, ver
`segueDeVolta` em `js/usuario.js`). Não há pedido nem aceite: seguir quem já
segue você basta. O selo **amigos** só aparece depois que você segue. Num
perfil de exemplo isso é essencial — `segueDeVolta` é um sorteio que diz quem
retribui *quando você segue*, e mostrar antes entregaria a resposta. Numa conta
real "segue você" é um fato, então a página dela o mostra desde já.

Perfil de exemplo novo é uma linha em `PERFIS_MOCK`: rosto, roupa, números, data
de entrada e colagens saem da semente do id. Os dez primeiros ficam no topo,
com os mesmos ids — o save guarda o id, então quem já seguia não perde ninguém.

### Contas reais: o que é diferente

`js/pessoas.js` é a ponte, e o resto do app trata as duas espécies do mesmo
jeito; só olha `p.real` onde os dados de fato diferem:

- **Os números** (seguidores, seguindo) vêm do servidor, não da semente do id, e
  não há selo de nível: o nível mora no save de cada um, que outra conta não lê.
- **Rosto e roupa** são os que a pessoa escolheu. O save dela é dela, então o
  próprio front publica o pedaço público (`PUT /api/perfil`: bio, aparência,
  roupa vestida) sempre que ele muda, com 3 s de espera e comparando com o
  último enviado. Enquanto ela nunca publicou, cai no sorteio do id.
- **Quem você segue é do servidor.** Ao abrir o app, `sincronizarSocial()` casa a
  lista local com `GET /api/social`: os fictícios só existem no save, as contas
  reais o servidor decide — seguir de um aparelho vale no outro, e deixar de
  seguir também. Seguir pela tela muda na hora; se o servidor recusar, volta
  atrás e avisa.
- **Não há colagens de conta real no seu feed.** O feed de cada um ainda é local:
  o que uma conta publica não chega às outras. É o próximo passo do grafo
  social, e por isso a página de uma conta real diz "ainda não publicou nada".

As rotas (mesmas na Lambda e no `tools/servidor.py`), todas exigem login:

| Rota | O que faz |
|---|---|
| `GET /api/usuarios?q=` | procura por nome, sobrenome, @ ou bio; sem `q`, as contas mais novas. Até 20, nunca você |
| `GET /api/usuarios/<id>` | a página pública de uma pessoa |
| `POST /api/seguir` | `{ id, segue }` — segue ou deixa de seguir; devolve o cartão atualizado |
| `GET /api/social` | quem você segue e quem segue você |
| `PUT /api/perfil` | `{ bio, avatar, equipado }` — o que os outros leem de você |

O cartão de uma pessoa nunca leva e-mail, papel nem senha: é o que qualquer
pessoa logada pode saber de outra. Tudo que vem do navegador em `PUT /api/perfil`
passa por validação (bio até 140 letras; aparência e roupa só como texto curto).

## Inventário — as roupinhas

São duas roupas diferentes no mesmo avatar, e a diferença é o ponto:

| | Peças do Stylist | Roupinhas do vestiário |
|---|---|---|
| O que são | recorte de roupa real, fotografada | desenho, no traço do personagem |
| De onde vêm | garimpo na vitrine, acervo, upload | nível e missão — não se compra nem se acha |
| Onde aparecem | Stylist, colagem, feed, exportação | perfil, perfil público e o retrato do feed |
| Como o avatar entra | **pelado**, para a foto cair no corpo | vestido |

O Stylist continua com o avatar pelado de propósito: ali a roupa é uma colagem
sobre o corpo, e uma segunda roupa embaixo apareceria pela gola e pela barra da
primeira. Quem mostra as roupinhas é quem mostra *a pessoa* — o perfil.

### A tela

A tela se chama **Inventário**; o id interno dela continua `vestiario`, e o
arquivo também. `state.inventario` já é outra coisa — o guarda-roupa das peças
de verdade —, e dois inventários com o mesmo nome no mesmo estado seria pedir
para trocar um pelo outro.

Duas metades. À esquerda o **personagem vestido**, grande, no meio, com uma
coluna de lugares do corpo de cada lado dele — Cabeça, Tronco e Pernas à
esquerda; Acessório, Cintura e Pés à direita. Em cima o "Tirar tudo" e,
embaixo, a ficha da peça aberta: ela fica desse lado porque é sobre a peça que
você está olhando, e o corpo que ela vai vestir está logo acima.

Os lugares do corpo ficam **em volta** do personagem, não numa fileira: cada
coluna espalha as suas três caixas na altura toda, então a da Cabeça acaba na
altura da cabeça e a da Pés na altura dos pés, sem ninguém posicionar nada à
mão. Quem manda na posição é a ordem de `SLOTS` (`js/roupinhas.js`): a primeira
metade vai para a coluna da esquerda, a segunda para a da direita.

À direita a **mochila**: título com régua dos dois lados, as abas de lugar do
corpo, a página de casas e o passador embaixo. Ela não repete o retrato do
personagem — ele está grande do lado — nem o nível, que tem o selo dele na
barra lateral, em todas as telas.

### Vestir

Não tem botão de vestir. Botão de confirmar num gesto que não destrói nada é um
passo a mais sem nada em troca:

| Gesto | O que faz |
|---|---|
| Um clique na peça | abre ela na ficha, embaixo do personagem |
| Dois cliques | veste — e dois cliques de novo tiram |
| Dois cliques no lugar do corpo | tira o que está lá |
| Arrastar do saco para o corpo | veste |
| Arrastar do corpo para o saco | tira, e a peça pousa na casa onde você soltou |
| Arrastar dentro do saco | arruma o saco, e a ordem fica gravada |

O caminho de volta é o mesmo gesto da ida, que é o que deixa dispensar o botão.

**Tudo se arrasta, e nos três sentidos.** O mesmo gesto tem três destinos, e
quem decide o que fazer é o alvo, não a peça — por isso a peça carrega de onde
saiu (`arrastando.de`, em `js/vestiario.js`). Indo para o corpo, **o corpo
inteiro é alvo**, não só o quadradinho do lugar: mirar em 80px é trabalho, e a
peça já sabe onde ela vai. Voltando para o saco, o alvo é o saco inteiro,
casas vazias incluídas — soltar numa casa vazia manda a peça para o fim da
fila.

Quem está com uma peça na mão vê aceso só onde ela pode pousar: saindo do
saco, os lugares do corpo que não servem apagam; saindo do corpo, a grade
inteira se acende. Não há como errar a mira.

A ordem do saco é sua e fica gravada em `state.vestiario.ordem`, uma lista de
ids. Quem não está nela entra atrás, na ordem dos lugares do corpo — peça que
abriu hoje não embaralha o que você arrumou ontem. A lista gravada é a ordem
**inteira**, não só o que mudou: assim ela continua valendo quando o filtro de
categoria esconde metade das peças.

### O saco de casas

A grade é **o que você tem**, não o catálogo: peça que ainda não abriu não
aparece ali. Quem avisa que ela abriu é o toast, e daí ela entra no saco como
qualquer outra. As abas seguem junto — um lugar do corpo sem nenhuma peça sua
não ganha aba, mesma regra da paleta do Stylist, porque aba vazia é um caminho
que não leva a lugar nenhum.

O saco é um retângulo fixo de casas — 5 colunas por 5 fileiras —, cada uma com
peça ou vazia. O que não cabe não estica a página: vai para a **próxima**, e o
passador embaixo leva até lá. Quem corta a lista em páginas é o JS (`COLUNAS` e
`LINHAS`), que passa os dois números para o CSS: se os dois palpitassem,
sobraria peça fora da página ou casa fora da conta.

A última página tem tantas casas quanto a primeira, e o passador fica na tela
mesmo quando só há uma página — o que some é a seta, não o rodapé. Saco que
encolhe no fim não é saco, e rodapé que aparece e desaparece empurra a grade
para cima e para baixo a cada aba trocada.

A casa tem lado em **px**, nos dois eixos, e não `1fr` com `aspect-ratio`. A
linha do grid não sabe deduzir a altura de um `aspect-ratio`: ela se dimensiona
pelo conteúdo, que aqui é um SVG de altura relativa, e cada fileira sai com um
terço da altura do item — os quadrados transbordam por cima da fileira de baixo
e a grade vira uma bagunça. Com os dois eixos em px o quadrado é quadrado.

### Os lugares do corpo

Seis slots, um de cada, como o Stylist faz com as categorias: vestir outra
troca a que está lá. `SLOTS` em `js/roupinhas.js` diz o nome, o ícone, a camada
e o enquadramento da miniatura. O enquadramento mora em caixa quadrada — no
slot e na célula da grade —, então recorte muito alto ou muito largo vira uma
tira fina no meio do quadrado.

| Slot | Coluna | Camada | Peças |
|---|---|---|---|
| Cabeça | esquerda | 65 | boné, viseira, gorro, bucket, palha, boina, tiara, fones, coroa |
| Tronco | esquerda | 30 | camiseta, regata, cropped, polo, camisa, gola alta, suéter, moletom, colete, xadrez, corta-vento, jaqueta, vestido, blazer, kimono, sobretudo, manto |
| Pernas | esquerda | 20 | calça, jeans, bermuda, short jeans, saia, legging, alfaiataria, calça de moletom, cargo, plissada, flare, saia longa |
| Acessório | direita | 62 no rosto, 58 no pescoço, 55 no pulso | óculos, óculos escuros, antifaz, bandana, cachecol, corrente, gravata, luvas, pulseiras, relógio |
| Cintura | direita | 24 o cinto, 31 os suspensórios, 36 a pochete, 40 a tiracolo, atrás do corpo o resto | cinto, suspensórios, pochete, tiracolo, mochila, capa, asas, cauda |
| Pés | direita | 28 | tênis, cano alto, sapatilha, chinelo, pantufa, sapato social, galocha, bota, salto, coturno |

Acessório junta o que antes eram dois lugares (rosto e mãos), e por isso é um
só: óculos e luvas disputam a mesma casa — vestir um tira o outro. Slot que
junta coisas diferentes deixa a **peça** mandar: `z` na própria peça vence o do
slot, e é por isso que o óculos continua desenhado na frente do rosto, o
cachecol por cima da camisa e a luva na mão. O cinto usa o mesmo mecanismo ao
contrário: `z: 24` o põe por cima da calça e **por baixo** da peça de cima, que
é onde um cinto fica — camiseta comprida o esconde, camisa por dentro não.
Save antigo entra migrado (`rosto` e `maos` viram `acessorio`, `costas` vira
`cintura`) em `js/db.js`.

São 66 peças nas mesmas cinco raridades das roupas de verdade, e a cor do slot
segue a escala do guarda-roupa — borda em arco-íris na lendária.

Cada peça tem **uma cor**, e ela é da peça: o desenho e a cor são a mesma
decisão de quem desenhou, como em qualquer item de coleção. Por isso o que fica
gravado em quem está vestindo é só o id — `{ torso: 'camiseta' }`.

### A peça na casa do inventário

A casa mostra a peça **solta**, fora do corpo (`svgRoupinha`), e não um recorte
do avatar vestido. Item é item: no recorte a manga some atrás do braço, a bota
vira um pedaço de perna e duas peças parecidas ficam idênticas, porque o que
aparece é o corpo, não a roupa.

Continua existindo **um desenho só** — o que veste o avatar. O que muda é que
ninguém veste: o corpo entra só como medida, porque a manga é o braço
engordado e é o braço de quem está vestindo que dá a largura certa a ela.

O enquadramento é **medido do próprio desenho**, não escrito à mão: peça nova
entra centrada sozinha e mexer numa peça não deixa um recorte velho para trás.
A medida sai de `getBoundingClientRect`, não de `getBBox` — metade da coleção é
traço grosso (manga, calça, cano de bota) e o `getBBox` mede a linha do meio,
sem a grossura, o que cortaria a manga ao meio. A caixa vira quadrada em volta
do centro da peça, que é o formato da casa.

Duas peças fogem da medida com `caixa` na própria peça: as luvas e as
pulseiras. Elas moram nos dois pulsos, a 256 unidades uma da outra, e a medida
honesta dava um quadrado enorme com dois pingos nos cantos — a `caixa` mostra
um dos dois, de perto. O relógio já nasce num pulso só, pela mesma razão.

### A folga tem limite

As duas pernas do corpo passam a **18 unidades** uma da outra na canela, e cada
unidade de folga que a peça ganha come metade desse vão pelos dois lados. Peça
de perna larga demais fecha o vão, as duas pernas viram um bloco só e a calça lê
como saia — aconteceu com a calça de alfaiataria (24 de folga) e com a galocha
(22). O teto prático é 18, e o que distingue a alfaiataria da calça comum é o
vinco, não a largura. A mesma conta vale para a manga e o braço.

### O ombro e o cabelo

Duas regras que valem para a coleção inteira, e que existem porque roupa e
corpo são desenhos separados que têm que combinar.

**A roupa segue a linha do ombro do corpo.** O ombro sai do pescoço em y≈207 e
cai até a junta do braço em y=262 (`CORPOS[*].arte`, em js/config.js). Gola que
ia reta do pescoço até a junta passava por baixo dessa linha, e o ombro do
avatar aparecia por cima da roupa — dava para ver a pele nos dois ombros de
qualquer camisa, jaqueta ou blazer, e ficava gritante em pele de cor viva.
`linhaDoOmbro` refaz a curva do corpo a partir das medidas (`ombro * .54`,
`peito + 7`), com a folga da peça por fora, e as duas silhuetas de cima —
`tronco` (fechada) e `frenteAberta` — passam por ela. A regata é a exceção de
propósito: alça é alça, e o ombro dela é para aparecer mesmo.

**Chapéu corta o cabelo.** A peça de cabeça declara `cabelo: <y>` — a altura a
partir da qual o cabelo ainda aparece —, e o avatar recorta o cabelo nessa
linha (`clipPath` em js/avatar.js). Sem isso o espetado atravessava o boné por
cima e o comprido saía por fora do gorro. O corte pega as duas camadas do
cabelo, a da frente e a de trás, então o cabelo longo continua caindo por baixo
da aba — o que some é só o que estaria por dentro do chapéu. Quem só apoia em
cima do cabelo não declara nada, e aí ele fica inteiro: é o caso da coroa e dos
fones de ouvido.

Vale para corte novo e para chapéu novo sem ninguém conferir um contra o outro:
são doze cortes e seis peças de cabeça, e a alternativa era desenhar uma versão
"de chapéu" de cada corte.

### Como abrem

Nada fica gravado como desbloqueado: a condição é lida do progresso na hora, do
mesmo jeito que o nível é lido do XP. Mexer numa meta em `ROUPINHAS` revale
para todo mundo, sem migração de save — e nada que abriu fecha de novo, porque
tudo que alimenta isso só sobe.

```js
desbloqueio: { tipo: 'nivel',       meta: 6 }   // chegue ao nível 6
desbloqueio: { tipo: 'resgates',    meta: 30 }  // garimpe 30 peças na vitrine
desbloqueio: { tipo: 'looks',       meta: 5 }   // monte 5 looks no Stylist
desbloqueio: { tipo: 'publicacoes', meta: 6 }   // publique 6 colagens
desbloqueio: { tipo: 'dias',        meta: 3 }   // feche as missões do dia 3×
desbloqueio: { tipo: 'inicial' }                // já vem com você
```

Os tipos moram em `METAS`, no mesmo arquivo, e cada um sabe escrever a própria
frase — é ela que a ficha mostra como procedência da peça ("✓ Chegue ao nível
6"), que é metade do valor de um item de coleção. Peça que ainda não abriu não
aparece em lugar nenhum da tela: o inventário é o que é seu.

As metas de missão são as acumuladas (`state.stats`), não as do dia: missão
diária zera à meia-noite, e um desbloqueio que fechasse junto não seria um
desbloqueio. Fechar as cinco do dia conta em `dias`.

Quando alguma abre, o toast avisa em qualquer tela e o botão da sidebar pisca.
Quem ganhou o XP não sabe que o vestiário existe — `db` avisa por `onChange`. A
primeira carga do save só *aprende* o que já estava aberto, sem anunciar, senão
o jogador levaria seis toasts de uma vez na primeira tela que abrisse.

O jogador começa vestido: camiseta, calça e tênis (`VESTIARIO_PADRAO`). Save
anterior ao vestiário entra com elas também, em vez de pelado.

### Como a roupa é desenhada

Mesmo contrato do corpo: `arte(m, extra)` devolve as formas, `extra` é o quanto
elas engordam para virar contorno, e nada pinta a si mesmo — a cor vem do grupo
que envolve tudo. São duas passadas, como o corpo: a peça inteira engordada na
cor do contorno, depois na cor dela por cima. Dar contorno forma a forma
mostraria as costuras por dentro da silhueta, e roupa é feita de formas
sobrepostas. O que precisa de cor própria — bolso, botão, zíper, pena — vai em
`detalhe`, desenhado por cima das duas.

Uma peça serve os **dois corpos** porque não tem coordenada fixa de cintura:
ela lê `CORPOS[*].medidas`, a meia-largura do corpo em cada linha (pescoço,
ombro, peito, cintura, barra, quadril, virilha) mais a espessura de braço e de
perna. A camiseta se estreita sozinha no corpo estreito.

Manga e calça são o **próprio membro do corpo**, engordado: o mesmo caminho do
braço e da perna, traço mais grosso, cortado na altura que a peça pede (de
Casteljau). Manga curta, bermuda, cano de bota e punho de luva são o mesmo
desenho cortado em lugares diferentes — e nenhum deles descola do membro, em
nenhum dos dois corpos.

Três coisas que o desenho aprendeu batendo a cabeça, e que vale saber antes de
mexer nas medidas:

- **A ponta redonda do traço, saindo da junta do ombro, vira ombreira.** Toda
  manga nasce em `MANGA_TOPO` (y=288), já debaixo do ombro da roupa.
- **As duas pernas passam a 18 unidades uma da outra**, e toda folga que a
  calça ganha sai desse vão pelos dois lados — o contorno come o resto. Acima
  de ~14 elas se encostam e a calça vira saia. Por isso existe a costura da
  entreperna, desenhada por cima: é ela que faz o olho ler duas pernas. E é por
  isso que o que distingue a cargo da calça é o bolso, não a largura.
- **De frente, uma mochila do tamanho das costas some inteira**: o corpo cobre
  o meio, a peça de cima cobre a lateral e o braço cobre o resto. A daqui passa
  dos três de propósito, e sobe acima da linha do ombro.

Peça nova é uma entrada em `ROUPINHAS` (`js/roupinhas.js`) com slot, raridade,
cor, condição e a arte. Nada mais precisa saber que ela existe: a grade, os
slots, o sorteio, o perfil e o retrato do feed leem o catálogo. Peça que só
existe atrás do corpo — as asas — usa `atras` em vez de `arte`.

### Os outros também andam vestidos

Perfil fictício também tem roupinha, sorteada pela semente do id
(`roupasSorteadas`), como a aparência dele. Mesma pessoa, mesma roupa, em
qualquer navegador — e o feed não vira uma fila de gente pelada ao lado do seu
avatar de roupa. Só peça comum e incomum entra, e acessório entra por chance.

A miniatura do post é o **look do Stylist**, e continua sem roupinha: ali a
roupa é a foto.

## De onde vêm as peças

Existem duas fontes, e dá para desligar a primeira:

| Fonte | Onde mora | Quem gera |
|---|---|---|
| **Acervo da pasta** | `assets/catalog.json` + `assets/cloths/*.webp` (disco) | `tools/pipeline.py`, a partir de `../Cloths` (e `tools/bgbatch.py` antes dele, se a foto tiver fundo) |
| **Acervo do administrador** | `assets/acervo.json` + `assets/cloths/*.webp` (disco) | o botão **+ Adicionar peça**, em modo admin |
| **Peças suas (legado)** | `pecasProprias` em `localStorage` | migração de dados antigos |

As duas primeiras são permanentes e valem para todo mundo. `acervo.json` é um arquivo
separado de propósito: rodar `tools/pipeline.py` regenera o `catalog.json` inteiro, e as
peças subidas pela ferramenta não podem sumir nisso.

Em **Perfil → Testes**, o botão **Usar só as minhas peças / Usar também o acervo da pasta**
alterna entre os dois modos (recarrega a página, porque o catálogo é lido no boot). Ele
vale só para o `catalog.json` da pasta: o `acervo.json` do administrador é carregado sempre,
nos dois modos — peça subida pela ferramenta não some por causa de preferência.

Com "só as minhas" ligado — que é o padrão — o `catalog.json` **nem é requisitado**: os
arquivos continuam no disco, intactos, mas o app não os lê. Voltar atrás é um clique.

Nesse modo as suas peças passam a ser o estoque da loja: a vitrine sorteia entre elas, e
as que já estão no guarda-roupa aparecem marcadas como "no closet". Por isso o passo 1 de
adicionar peça ganhou a opção **"já entra no meu guarda-roupa"** — desmarcando, a peça
fica só como estoque, para ser garimpada na loja como qualquer outra.

O que depende do acervo da pasta e se comporta bem sem ele: a vitrine avisa que a loja
está sem estoque, os perfis fictícios só postam quando houver roupa para vestir, e a
cápsula do mês explica que as peças dela vêm da pasta desligada.

## Esteira de peças (como a peça entra no jogo)

O caminho único para peça nova. Abre pelo **+ Adicionar peça** do guarda-roupa,
ou direto em `esteira.html` (no ar: <https://dufkck3bmeh9v.cloudfront.net/esteira.html>,
que funciona no celular).

```
foto ──► S3 entrada/ ──► EventBridge ──► fila SQS ──► Lambda brecho-esteira
  (POST assinado,            (foto nova)    (2 por vez,     recorta o fundo (isnet/BiRefNet),
   direto do navegador)                      3 tentativas)  prévia WebP + contorno,
                                                            ficha palpitada pelo Claude
                                     ◄── esteira.html revisa, mede e publica ◄──┘
```

- **Entrada**: soltar arquivos, colar (Ctrl+V), "Fotografar" no celular, ou uma
  pasta inteira com `python tools/enviar.py <pasta> [--vigiar]`.
- **Revisão**: cada foto vira um cartão com a prévia já recortada e a ficha
  (categoria, cor, nome, marca) preenchida pela IA. Edite no cartão. A edição é
  guardada na nuvem: dá para fotografar no celular e revisar no computador.
- **Lote**: selecione as prontas, aplique categoria, raridade ou marca a todas,
  e publique de uma vez. Peça sem medida entra com a medida padrão da categoria.
- **Medir**: o molde do avatar, por cartão. "Usar nas da mesma categoria" leva a
  medida para as outras.
- **Atalhos no cartão**: Ctrl+Enter publica, Ctrl+M mede, Ctrl+Del descarta.

Quem escreve o `assets/acervo.json` é só a Lambda. Para trazer as peças
publicadas para o disco (jogo local sem `--nuvem`): `python tools/sincronizar.py`.
O código da nuvem está em `nuvem/esteira/` e `nuvem/lambda/esteira.py`.

## Editar peça (ferramenta do administrador)

O modal descrito abaixo continua sendo o de **editar** uma peça que já existe
(botão Editar no guarda-roupa e na vitrine). A parte de subir peça nova por ele
foi substituída pela esteira, acima.

Subir peça **não é função do jogo**: é ferramenta de administração. O usuário final não vê
o botão. Ele só aparece com o modo admin ligado:

```
http://localhost:5173/?admin=1     # liga (fica gravado no navegador)
http://localhost:5173/?admin=0     # desliga
```

A peça salva aqui vai para o disco e passa a existir no jogo permanentemente, para todos:
a imagem WebP em `assets/cloths/` e a ficha em `assets/acervo.json`. Quem grava é o
`tools/servidor.py` (`POST /api/pecas`) — com o servidor fora do ar o salvar falha e avisa,
em vez de guardar a peça só neste navegador. Se o Pillow estiver instalado, o servidor ainda
traça o contorno vetorial da peça na hora, igual ao pipeline.

O botão **+ Adicionar peça** no guarda-roupa abre um fluxo de dois passos:

1. **Ficha** — solta a foto (ou várias, ou arrasta), escolhe categoria, raridade, marca, cor e nome.
   As marcas que você já usou viram atalho: aparecem como chips abaixo do campo (mais
   usadas primeiro) e completam enquanto você digita.
   A **cor** funciona igual — campo livre, com chips e autocomplete —, só que já começa
   povoada pela paleta de `CONFIG.CORES` (preto, bege, estampado…). Cor conhecida ganha a
   bolinha da cor no chip; cor inventada entra do mesmo jeito, com a bolinha neutra. A cor
   fica gravada na peça e aparece na ficha da vitrine e no guarda-roupa.

   **A cor vem reconhecida da imagem.** Assim que a peça termina de processar, ela chega
   com a cor já escolhida entre as da paleta, e uma linha abaixo dos chips diz qual foi —
   trocar no campo ou num chip encerra o palpite, que não volta. Quem faz a leitura é
   `corDoPixel` em `config.js`: cada pixel opaco vota na cor mais próxima dele, comparada
   em Lab com o tom pesando mais que saturação e claridade (nomear cor não é medir cor —
   uma calça mauve é "rosa", não "cinza levemente quente"). Os votos vão para duas urnas,
   colorido e neutro, e a dos coloridos ganha a partir de 25% dos pixels: peça colorida
   sempre tem dobra escura e brilho lavado votando neutro, enquanto peça preta de verdade
   quase não tem pixel colorido. Duas cores distantes dividindo a peça sem nenhuma dominar
   saem como **Estampado**. Dourado e Prateado ficam fora da leitura — na foto são só um
   amarelo escuro e um cinza claro — e continuam à mão.

   O **nome** começa vazio: nome de arquivo não é nome de peça. Peça sem nome é mostrada
   como "Jaqueta Nike" (tipo + marca) ou "Top verde" (tipo + cor), via `nomeDaPeca`.
   A imagem é recortada pelo alpha, reduzida para 460px e convertida para WebP aqui
   no navegador — o mesmo tratamento que `tools/pipeline.py` faz do lado do servidor.
   Um PNG de 3 MB vira ~40 KB.

   **Foto com fundo entra igual.** Quando a imagem chega sem transparência
   nenhuma, ela sobe inteira para `POST /api/fundo` e volta recortada — é o
   `tools/bgbatch.py` do outro lado. O que fica na tela é a prévia leve de
   sempre; o recorte em alta vai para `assets/mestres/<id>.png` e não trafega
   pelo fio. Ele é gravado no instante do recorte, como rascunho, e só ganha o
   nome da peça quando ela é salva: o que o modelo levou meio minuto para
   calcular não depende de a ficha ser preenchida até o fim. Rascunho não
   reclamado some sozinho em 6 horas.

   A chave **tirar o fundo automaticamente** desliga isso quando as fotos já
   vêm recortadas. Sem modelo baixado, sem `onnxruntime` ou sem memória, a
   rota responde 503, a chave trava desligada mostrando o motivo, e a tela
   volta a pedir PNG transparente — a peça entra do mesmo jeito, só com o
   aviso de "sem fundo transparente" que já existia. A primeira recusa desliga
   a tentativa para a fila inteira: vinte fotos não esperam vinte vezes pelo
   mesmo erro.

   **O que a tela diz fazer depende do código da recusa**, porque as saídas são
   opostas. `503` é o servidor certo dizendo que não conseguiu: modelo que
   falta se resolve baixando, memória se resolve liberando RAM e disco. `404`
   não é nada disso — é um servidor **anterior a esta rota** ainda no ar, e
   nenhum download conserta: tem que fechá-lo e subir de novo. Mandar baixar o
   modelo nos dois casos manda o administrador caçar um problema que ele não
   tem, com o modelo já no disco.
2. **Dimensionar no molde** — a peça aparece sobre o manequim do Stylist. Você arrasta
   para posicionar e puxa qualquer quina (ou usa a roda do mouse) para o tamanho.
   O rodapé mostra a medida em unidades e em % dos ombros.
   Neste passo a caixa do modal muda de forma: o molde tem proporção 1:2, então ela fica
   estreita e usa toda a altura da janela (`.modal-caixa.medindo`). Medir peça em molde
   pequeno é adivinhação.

O rodapé do passo 2 **avisa quando a medida foge da categoria** (mais de 1,55× ou menos
de 0,6× a largura padrão): *"2,3× a largura padrão de Tops, confira"*. Não impede nada —
peça exagerada existe —, mas pega o engano mais comum, que é dimensionar a roupa para
preencher o molde em vez de encostar no corpo. O erro não aparece na hora: aparece
depois, com a camisa maior que a calça na loja.

Essa medida é o ponto principal: ela vira a **âncora da peça** (`x`, `y`, `w`) e passa a
valer em todo lugar — é onde a peça encosta no corpo no Stylist e de onde sai o tamanho
dela nas grades e na colagem. Medir no molde é a única forma confiável de saber "quão
grande isso é no corpo", já que o recorte não carrega escala.

Cada marca digitada fica registrada em `state.marcas` como `{ nome, usos, em }` — já é uma
lista de objetos para receber depois o que a marca precisar carregar (logo, descrição,
país, link). Marca repetida não duplica: só incrementa o contador, ignorando maiúsculas.

A peça entra no mesmo catálogo das outras: dali em diante closet, Stylist, colagem e
exportação a tratam como qualquer peça do acervo. A raridade escolhida na ficha fica
gravada com ela — não é re-sorteada por dia como a das peças do `catalog.json`.

A opção **"já entra no meu guarda-roupa"** decide só o que acontece no inventário de quem
está subindo: desmarcada, a peça fica de estoque na loja, para ser garimpada na vitrine.

### Subir um lote

Soltar (ou escolher) vários arquivos de uma vez enfileira todos. A **tira de miniaturas**
no alto do passo 1 é a fila: cada miniatura é uma peça com a ficha dela, clicar troca a
peça em edição e o ✕ tira da fila. As imagens são processadas em sequência — o recorte é
pesado, e em paralelo trava a tela —, e a primeira que fica pronta já aparece, então dá
para ir preenchendo enquanto o resto termina. O arquivo que entra herda a ficha do
anterior — menos o nome, que começa vazio, e a cor, que cada uma lê da própria imagem.

Três atalhos evitam repetir trabalho:

- **Usar esta ficha nas outras N** (passo 1) — leva categoria, marca e raridade para a
  fila inteira. O nome de cada peça fica, que é o que as distingue, e a cor também: cada
  uma já tem a sua, lida da imagem ou escolhida na mão. Esta cor só preenche quem ainda
  estiver sem nenhuma.
- **Aplicar às demais** (passo 2) — a medida desta peça vira a das outras da mesma
  categoria que ainda não foram salvas. Um par de tênis medido resolve os outros nove.
- **Salvar as N com tamanho padrão** (passo 1) — grava tudo de uma vez, usando a medida
  que cada peça já tiver e, para quem não passou pelo molde, a âncora padrão da categoria
  em `CONFIG.CATEGORIAS`. Uma por vez, para o servidor não engasgar; se alguma falhar, o
  aviso diz quantas entraram e em qual parou, e as que faltam continuam na fila.

Salvando uma a uma (o **Salvar peça** do passo 2), a fila anda sozinha: grava, tira da
fila e abre a próxima no passo 1. O modal só fecha quando a fila acaba.

## Apagar dados (Perfil → Testes)

São dois botões, e a diferença importa:

- **Apagar meus dados** zera a *partida* — inventário, looks, colagens, feed, XP, missões,
  conexões. É `db.resetar()`.
- **Apagar peças guardadas aqui** zera o *cadastro* guardado no navegador: `pecasProprias`,
  `marcas` e `cores`. É `db.apagarAcervoLocal()`, e não volta.

O primeiro **preserva o cadastro** de propósito. Peça adicionada, marca e cor são conteúdo,
não progresso: um dia migram para a base oficial do site, e perder isso num botão de teste
seria perder trabalho de verdade. As peças gravadas em `assets/acervo.json` nem são tocadas
por nenhum dos dois — elas vivem em disco, fora do `localStorage`.

## Escala das peças

O recorte não carrega escala nenhuma: o arquivo de um anel (504×334) tem praticamente o
mesmo tamanho do de um casaco (512×335). Sem uma tabela, qualquer tela que faça a peça
"preencher a caixa" acaba com relógio do tamanho de calça.

Peça dimensionada no molde usa a medida dela. Para as outras — as 59 do acervo, que
vieram do pipeline — vale `TAMANHO` em `js/config.js`, o tamanho relativo de cada
categoria no mundo real, com casaco = 1:

| Categoria | Tamanho | | Categoria | Tamanho |
|---|---|---|---|---|
| Casacos | 1,00 | | Calçados | 0,58 |
| Vestidos | 0,94 | | Bolsas | 0,52 |
| Calças | 0,90 | | Chapéus | 0,46 |
| Tops | 0,78 | | Acessórios | 0,34 |
| | | | Relógios | 0,24 |
| | | | Anéis | 0,11 |

Desse número saem duas curvas, porque grade e composição têm necessidades diferentes:

- **`escalaGrade`** (guarda-roupa, paletas, cápsula) — comprimida. Na proporção real um
  anel viraria um grão na célula; aqui ele fica visivelmente menor que o casaco, mas
  ainda dá para ver o que é. Vai de 0,51 (anel) a 1,0 (casaco).
- **`escalaMural`** (vitrine e colagem) — solta. Ali a peça convive com as outras numa
  composição, então vale respeitar mais a proporção de verdade. Vai de 0,38 a 1,0.

Para exceções que fogem da média da categoria — um casaco extra-longo, um brinco
minúsculo — existe `ESCALA_PECA` no mesmo arquivo: `{ '39': 1.3 }` multiplica só aquela
peça, e sobrevive a rodar o pipeline de novo (diferente de editar o `catalog.json`).

A conta é a mesma nos dois casos: `tamanhoDaPeca()` devolve a medida da peça quando ela
existe e o padrão da categoria quando não — as telas não precisam saber a diferença.

## Social: feed, comentários e contas

O feed tem duas abas. **Seguindo** mostra só quem você segue (mais o que é seu) —
é o que dá sentido ao botão de seguir. **Descobrir** mostra tudo.

Cada post traz autor, tempo relativo, curtir, comentar e compartilhar. A thread abre
com os dois últimos comentários e um "ver os N comentários"; você escreve no campo e
manda com Enter ou no botão. Comentário seu tem um ✕ para apagar.

O feed nasce povoado: **10 perfis fictícios** — cada um com personagem próprio — e 12 posts
sorteados pelo mesmo motor dos botões de gerar, cada um com 0 a 3 comentários.

Os posts são dos dois tipos que o app produz: **look no avatar** e **colagem**
(40% deles, `CHANCE_COLAGEM` em `js/social.js`). A colagem sai inteira — as peças
espalhadas no fundo branco —, assinada com o @ de quem postou, e fica
guardada no post em `post.colagem`, que é o equivalente das camadas do look: é de lá
que o perfil da pessoa tira as peças que ela veste. No feed as duas se distinguem
sozinhas, porque o look é vertical e a colagem é um post 4:5.

Em **Perfil → Testes**,
o botão **+3 posts fictícios** gera mais e ainda faz alguém curtir e comentar no que
você publicou — para ter o que testar sem depender de gente de verdade.

A semente do feed é versionada (`VERSAO_SEED` em `js/social.js`): subindo o número,
quem já tinha o feed antigo recebe o novo sem perder o que publicou.

### O seu perfil

O perfil é a mesma página da pessoa que você visita — avatar, bio, desde quando,
números, seções — só que montada com os seus dados. O que muda é que a sua é
**curada**: as três vitrines mostram só o que você marcou com a estrela.

| Seção | O que aparece | Onde se favorita |
|---|---|---|
| **Stylists** | Looks montados no Stylist | ★ na lista "Meus looks" |
| **Colagens** | Colagens montadas na aba Colagem | ★ na lista de colagens |
| **Roupas favoritas** | Peças do guarda-roupa | "☆ Favoritar" no painel da peça |
| **Amigos** | Quem você segue **e** segue você de volta | seguir no feed |

Ter 60 peças não vira uma parede de 60 peças: o perfil é o que você escolheu
mostrar, e a estrela é a escolha. A marca fica gravada na própria coisa (campo
`favorito` na peça do inventário, no look, na colagem — ver `js/db.js`), então
apagar um look leva o favorito junto e save antigo entra sem migração.

Amizade é mão dupla. Sem grafo social de verdade, quem retribui o seguir sai da
mesma semente do id da pessoa (`segueDeVolta` em `js/usuario.js`): @liamoreno
sempre segue você de volta, em qualquer navegador. Quem você segue e não
retribui continua no feed, mas não entra em Amigos.

O avatar do perfil é um dos três lugares — com o perfil público e o retrato do
feed — onde as **roupinhas** do vestiário aparecem. Ver *Vestiário*, acima.

O cabeçalho tem as redes ligadas em selo, **Abrir vestiário** (as roupinhas),
**Editar perfil** (nome, @ e bio, que é o que os outros leem) e
**Editar personagem** (o avatar). Embaixo ficam as contas conectadas e os
botões de teste — isso não existe na página que os outros veem.

### O perfil de quem você vê no feed

Clicar no nome ou no retrato de alguém — num post, num comentário ou na coluna "quem
seguir" — abre a página pública da pessoa, em `#/usuario/<id>`. O seu próprio nome
leva para o seu perfil: mesmo desenho, mais o que só o dono da conta vê (editar,
contas conectadas, testes).

A página tem o avatar da pessoa, a bio, as redes de fora que ela ligou, desde quando
ela está no brechó, os números (colagens, curtidas recebidas, seguidores, seguindo), o
botão de seguir, as colagens dela e as peças que aparecem nelas.

As redes aparecem como selo embaixo da bio — **não é link**. Os perfis são fictícios, e
mandar alguém para um @ de verdade levaria a uma pessoa que não tem nada a ver com
isso; quando houver OAuth, é esse selo que ganha o endereço real. Nem todo mundo tem
conta ligada (`redesDoPerfil` em `js/usuario.js`, sorteada pela semente do id): é o que
faz a informação valer alguma coisa quando ela aparece. No **seu** perfil o mesmo selo
mostra o que está ligado de verdade em "Contas conectadas". No rodapé, atalhos para os outros perfis —
dá para pular de um para o outro sem voltar ao feed.

Os cards das colagens são **os mesmos do feed**: curtir ou comentar aqui é curtir e
comentar lá, e as duas telas se repintam juntas (`aoAtualizarFeed` em `js/social.js`).

Os números são sorteados a partir do id da pessoa, como o avatar dela (ver
`js/avatar.js`): mesma semente, mesma pessoa — @liamoreno tem sempre os mesmos
seguidores e a mesma data de entrada, em qualquer navegador. Visitar alguém que o
sorteio do feed nunca escolheu monta duas colagens dela na hora, também com a semente
do id, e elas passam a existir no feed de todo mundo. Quando houver backend, é essa
parte que some — o resto da tela já lê de `db.state`.

### Contas conectadas

No perfil, dois cartões. Os papéis são diferentes de propósito:

| Serviço | Papel | O que faz |
|---|---|---|
| **Instagram** | Publicar | Colagem direto no feed/stories, seu @ e foto no perfil, marcação do brechó |
| **Pinterest** | Publicar e importar | Salva a colagem como pin **e** traz pins de um board para virar peça no acervo |

O Pinterest tem o caminho de volta porque é de lá que a curadoria das roupas sai hoje:
conectado, ele ganha um botão **Importar pins** que cai no mesmo fluxo de adicionar peça.

Com uma conta ligada, o **compartilhar** de cada post abre um menu com os destinos
disponíveis mais "Baixar PNG".

**Sobre a ligação ser simulada:** sem conta de usuário não existe OAuth. O modal explica
o que a conexão vai fazer, pede só o seu @ e guarda isso em `state.conexoes` — nenhuma
senha é pedida e nada sai do navegador. Quando o backend existir, é esse registro que
passa a guardar o token; a interface não muda.

## Painéis ajustáveis

Toda coluna lateral pode ser puxada: passe o mouse na borda interna dela e um puxador
fino aparece.

| Tela | O que dá para esticar |
|---|---|
| Guarda-roupa | trilho de categorias e a coluna de destaque |
| Stylist | paleta de peças e a caixa de ferramentas |
| Colagem | paleta de peças e a caixa de ferramentas |
| Feed | a coluna da direita (sugestões e player) |

- A largura fica gravada por painel e volta assim na próxima vez
- Duplo clique no puxador devolve o tamanho padrão
- O miolo nunca fica com menos de 300px: se a janela encolher, as laterais devolvem
  espaço sozinhas e voltam ao tamanho que você escolheu quando houver folga de novo
- As grades acompanham: a paleta e o guarda-roupa ganham colunas conforme você alarga

As medidas ficam em `js/paineis.js` (`PAINEIS`), separadas do estado do jogo — são
preferência de tela, não dado de usuário.

## Personagem da loja

O dono da loja (NPC com balão de fala) está pronto em `js/npc.js`, mas desligado por
`CONFIG.NPC_VISIVEL = false` em `js/config.js` enquanto o personagem é redesenhado.
Virando a chave para `true` ele volta ao canto da vitrine, com as falas por contexto, e o
mural volta a reservar aquele espaço — nenhuma outra mudança é necessária.

## O que ainda não existe

- Backend real (Lambda + DynamoDB), login e social graph de verdade
- Coleção do ilustrador convidado: a cápsula usa 5 peças do acervo como marcador
- Trilha sonora: o player está pronto, faltam os arquivos em `assets/audio/`
- Compartilhamento direto no Instagram (hoje exporta o PNG no formato certo)
- Na colagem: colar imagem de fora e modelos prontos de enquadramento
