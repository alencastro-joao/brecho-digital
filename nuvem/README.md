# O brechó na AWS

O que foi criado, por quê, e como mexer depois. Conta `108826053014`, região
`us-east-1`, tudo etiquetado com `projeto=brecho`.

**Site:** <https://dufkck3bmeh9v.cloudfront.net>

## O desenho

```
CloudFront  EENWH23ZOF7U2   dufkck3bmeh9v.cloudfront.net
│
├── /*      →  S3  brecho-site-108826053014      (privado, só o OAC lê)
│                 index.html · css/ · js/ · assets/cloths/ · assets/*.json
│
└── /api/*  →  Lambda  brecho-api  (Function URL, arm64, python3.13)
                 ├── DynamoDB  brecho         contas, sessões, rate limit
                 ├── S3  brecho-dados-…       estado/<uid>.json.gz  (o save)
                 └── S3  brecho-dados-…       mestres/<id>.png      (os másters)
```

Uma distribuição só, duas origens. É o que permite `const API = ''` continuar
valendo em `js/auth.js`: site e API na mesma origem significa **sem CORS**, sem
`SameSite=None`, e sem pagar API Gateway (US$ 1 por milhão de requisições).

## Por que cada peça é essa e não outra

| Escolha | Alternativa descartada | Motivo |
|---|---|---|
| Lambda Function URL | API Gateway HTTP API | US$ 1/milhão a menos, e o CloudFront já faz o roteamento |
| Cabeçalho secreto na origem | OAC com SigV4 | O OAC não assina o **corpo** de um POST para Function URL: login e upload quebrariam |
| Save no S3 | Save no DynamoDB | Item do DynamoDB para em 400 KB; save com miniaturas passa disso |
| Itens `EMAIL#`/`HANDLE#` | Índice secundário (GSI) | GSI é eventualmente consistente — dois cadastros simultâneos criariam duas contas com o mesmo e-mail |
| `versao_senha` na conta | GSI de sessões por usuário | Derrubar as outras sessões sem varrer tabela nem pagar escrita de índice todo dia |
| `PriceClass_All` | `PriceClass_100` | Inclui as bordas da América do Sul. Com 1 TB/mês de franquia, não muda o preço |
| arm64 | x86_64 | 20% mais barato por GB-s, caso um dia passe da franquia |
| Sem WAF | WAF do console | US$ 5–6/mês por WebACL. Ver "A pegadinha do WAF" no fim |

## Publicar uma mudança do front

```bash
bash nuvem/infra/publicar.sh
```

Sobe só o que mudou. Não precisa invalidar cache: HTML, CSS e JS vão
com `no-cache`, então o CloudFront revalida por ETag e a
mudança aparece na hora. As imagens das peças vão imutáveis por um ano, porque
o nome do arquivo é o id da peça.

O `acervo.json` **não** sobe daqui: quem escreve nele é a Lambda, quando a
esteira publica uma peça. Subir o do disco apagaria as peças publicadas depois
do último `python App/tools/sincronizar.py`.

## Publicar uma mudança da API

```bash
bash nuvem/infra/publicar-api.sh
```

## A esteira de peças

Pilha CloudFormation `brecho-esteira` (`infra/esteira.yaml`): a fila, a fila de
mortas, a regra do EventBridge, a função `brecho-esteira` (x86_64, 3 GB, 5 min,
camada `brecho-ciencia` com numpy + onnxruntime + Pillow) e as permissões
novas do papel da API. Publicar:

```bash
bash nuvem/infra/publicar-esteira.sh
```

O script empacota `nuvem/esteira/` com o `bgbatch.py` e o `pipeline.py` do App
(o mesmo recorte e o mesmo contorno da máquina do admin), monta a camada a
partir de wheels prontos, liga o EventBridge e o CORS no bucket de dados e faz
o `cloudformation deploy`. Os pacotes levam o hash no nome: sem mudança, nada
é trocado.

**Por que x86_64 e não arm64 como a API.** Em ARM o onnxruntime descobre a CPU
lendo `/sys/devices/system/cpu`, que a Lambda não expõe, e o processo morre com
"Attempt to use DefaultLogger but none has been registered". Em x86 ele usa a
instrução `cpuid`. Pelo mesmo motivo de sandbox, `BGBATCH_THREADS=2` fixa o
número de threads (no automático ele tenta prender thread a núcleo).

**Modelo de recorte: `isnet`, por enquanto.** Conta nova da AWS tem teto de
3008 MB por função, e o BiRefNet não cabe: medido, o `birefnet-lite` chega a
6,4 GB de pico mesmo no modo econômico. O `isnet` usa ~1 GB e recorta uma foto
em ~12 s; perde em detalhe fino (alça, renda). Quando a cota for aumentada
(Service Quotas → AWS Lambda → memória da função → 10240), troque:

```bash
MODELO_FUNDO=birefnet-general MEMORIA_MB=10240 bash nuvem/infra/publicar-esteira.sh
```

O modelo vem do Hugging Face na primeira foto e fica guardado em
`modelos/` no bucket de dados; cada função nova copia de lá para o `/tmp`.

O palpite da ficha é o Claude Haiku 4.5 no Bedrock (`nuvem/esteira/ficha_ia.py`).
Se o Bedrock recusar, a peça entra sem palpite e nada trava.

**Custo**: ~US$ 0,0007 de Lambda por foto (3 GB × ~15 s), coberto pela
franquia gratuita de 400 mil GB-s/mês; ~US$ 0,001 de Bedrock por foto;
centavos por mês para guardar os modelos.

**Foto que mata o processo** (memória, tempo) não consegue gravar "erro". O
trabalhador anota `iniciadoEm` ao começar, e a API mostra como travada a que
passa de 15 min em "processando".

**Foto que falhou três vezes** vai para a fila `brecho-esteira-mortas` e aparece
com erro na tela, com o botão "Tentar de novo". O log está em
`/aws/lambda/brecho-esteira` (30 dias).

## Publicar sozinho pelo GitHub

`.github/workflows/publicar.yml` publica a cada push no `main`, só o pedaço que
mudou (site, API ou esteira), depois de checar Python e JS. As credenciais vêm
de um papel da AWS assumido por OIDC (`infra/github.yaml`): nenhuma chave fica
guardada no GitHub, e o papel só aceita o branch `main` do repositório
informado. Para ligar:

1. Criar o repositório no GitHub e dar push.
2. `aws cloudformation deploy --stack-name brecho-github --template-file nuvem/infra/github.yaml --capabilities CAPABILITY_NAMED_IAM --parameter-overrides Repositorio=<dono>/<repo>`
3. Pôr o ARN que sai em `Outputs.Papel` no secret `AWS_ROLE_ARN` do
   repositório, e criar o environment `producao` (dá para exigir aprovação
   antes de cada publicação).

## As contas

A primeira conta criada vira **admin** — é ela que vê "+ Adicionar peça",
"Repor loja" e "Devolver roupas". Isso é decidido pelo item `META#instalacao`
no DynamoDB: existindo ele, todo mundo entra como usuário comum.

Para conferir quem é admin:

```bash
aws dynamodb scan --table-name brecho --filter-expression "papel = :p" --expression-attribute-values '{":p":{"S":"admin"}}' --query "Items[].{id:id.S,email:email.S}"
```

## Pessoas: achar gente, seguir, o perfil público

`lambda/pessoas.py` (espelho de `App/tools/pessoas.py`, em SQLite). Sem índice
novo: o que é de pessoa mora no próprio item da conta.

```
USER#<id>   ganha três atributos:
    seguindo    conjunto (SS) de ids que esta conta segue
    seguidores  conjunto (SS) de ids que seguem esta conta
    perfil      { bio, avatar, equipado } — a parte pública do save
```

| Rota | O que faz |
|---|---|
| `GET /api/usuarios?q=` | procura por nome, sobrenome, @ ou bio (sem `q`, as mais novas) |
| `GET /api/usuarios/<id>` | a página pública |
| `POST /api/seguir` | `{ id, segue }` |
| `GET /api/social` | quem eu sigo e quem me segue |
| `PUT /api/perfil` | o que os outros leem de mim |

- **Seguir é uma transação de duas pontas**: `ADD` no `seguindo` de quem segue e
  no `seguidores` de quem é seguido, juntos. Conjunto do DynamoDB é idempotente
  (seguir duas vezes não duplica) e não há contador para dessincronizar — o
  número na tela é o tamanho do conjunto.
- **O cartão nunca leva e-mail, papel nem senha.** A busca ainda projeta só os
  campos do cartão, então a senha nem entra na memória da Lambda.
- **O perfil público é enviado pelo dono**, e não lido do save: o save é um
  objeto de megabytes no S3 e outra conta não tem por que abri-lo.

**A busca é uma varredura (`Scan`) da tabela**, filtrada em Python. Com a tabela
minúscula e cobrada por uso, isso custa miúdos; quando passar de alguns milhares
de itens, o caminho é um item `BUSCA#` por conta (ou um índice), e só a função
`buscar()` muda — as rotas e o front continuam iguais.

**Permissão.** O papel `brecho-lambda` precisa de `dynamodb:Scan` na tabela
`brecho` para a busca. Nada mais: o resto usa `GetItem`/`UpdateItem`/
`TransactWriteItems`, que ele já tinha (a lista de quem eu sigo é um `GetItem`
por conta, e não `BatchGetItem`, justamente para não pedir mais uma).

```bash
aws iam put-role-policy --role-name brecho-lambda --policy-name brecho-varrer-contas --policy-document '{"Version":"2012-10-17","Statement":[{"Sid":"BuscarPessoas","Effect":"Allow","Action":"dynamodb:Scan","Resource":"arn:aws:dynamodb:us-east-1:108826053014:table/brecho"}]}'
```

Sem ela a Lambda responde 500 em `GET /api/usuarios` e o front segue só com os
perfis de exemplo — nada quebra, mas ninguém acha uma conta real.

## O feed compartilhado — 04/10/2026

`lambda/feed.py` (espelho de `App/tools/feed.py`, em SQLite). Antes, cada post
morava só no save de quem publicou: o amigo abria o feed e não via nada.

```
POST#<id>   id, autor, tipo, nome, criado_em, thumb, pecas, origem,
            curtidas (SS de quem curtiu), comentarios (lista de mapas)
```

| Rota | O que faz |
|---|---|
| `GET /api/feed[?autor=]` | os posts, mais novos primeiro, com os cartões de quem aparece |
| `POST /api/feed` | publica `{ chave, tipo, nome, thumb, pecas, origem }` |
| `DELETE /api/feed/<id>` | o dono apaga |
| `POST /api/feed/<id>/curtir` | `{ curte }` |
| `POST /api/feed/<id>/comentarios` | `{ texto }` |
| `DELETE /api/feed/<id>/comentarios/<cid>` | quem comentou (ou o dono do post) apaga |

- **A miniatura vai para `assets/posts/` no bucket do site**, imutável por um
  ano (o nome leva o hash do conteúdo). O `publicar.sh` não toca nessa pasta.
- **Publicar é idempotente**: o id sai de (autor, look ou colagem de origem).
  Os posts antigos, que só existiam no save, sobem sozinhos na primeira leitura
  do feed — com a data original.
- **A listagem é um `Scan`**, como a busca de pessoas. Nenhuma permissão nova:
  o papel já tinha `Scan`, `PutItem`/`UpdateItem`/`DeleteItem` e escrita em
  `assets/*` do site.
- Os perfis de exemplo continuam locais (no save de cada navegador).

## O que ficou de fora

**Confirmação de e-mail e "esqueci a senha"** continuam pendentes, como no
protótipo. Os dois pedem e-mail transacional (SES sai de graça até 3.000
mensagens/mês pela Lambda). A coluna `email_confirmado` já existe esperando.

## O save que nunca chegava na nuvem — 25/09/2026

**Sintoma:** `estado/` não existe no bucket de dados. Nenhuma conta, nenhum
save, desde o primeiro dia. Na tela, o toast "Sem conexão com o servidor:
jogando no save deste navegador" em toda abertura — e o guarda-roupa some ao
abrir a mesma conta em outro navegador ou aparelho.

**Causa:** o papel `brecho-lambda` tinha `s3:GetObject` em `estado/*`, mas não
tinha `s3:ListBucket` no bucket. Quando falta `ListBucket`, o S3 responde
**403 AccessDenied** — e não 404 — para uma chave que **não existe**, de
propósito: sem permissão de listar, dizer "essa chave não existe" já seria
vazar o conteúdo do bucket. O `ler()` do `estado.py` só trata `NoSuchKey`/`404`
como "ainda não gravou", então o 403 subia como erro, o `GET /api/estado`
respondia 500, e o `sincronizarDaNuvem()` do `db.js` caía em `offline`. E aí
vem o efeito dominó: `offline` deixa `sincronizado = false`, que é a trava que
impede escrever na nuvem sem ter lido — então o `PUT` nunca acontecia. Um save
nunca lido nunca é gravado.

No log da Lambda, o erro diz tudo — repare que é um `GetObject` reclamando de
`ListBucket`:

```
falha em GET /api/estado: AccessDenied(... is not authorized to perform:
s3:ListBucket on resource: "arn:aws:s3:::brecho-dados-108826053014" ...)
```

**Correção** — uma statement no papel da Lambda:

```bash
aws iam put-role-policy --role-name brecho-lambda --policy-name brecho-listar-dados --policy-document '{"Version":"2012-10-17","Statement":[{"Sid":"SaberQueOSaveAindaNaoExiste","Effect":"Allow","Action":"s3:ListBucket","Resource":"arn:aws:s3:::brecho-dados-108826053014"}]}'
```

Sem condição de prefixo de propósito: o `s3:prefix` só existe no contexto de um
`ListObjectsV2` de verdade. Na decisão 403-ou-404 de um `GetObject` ele não
existe, então uma condição sobre ele reprovaria — e o bug continuaria de pé. O
bucket só guarda `estado/` e `mestres/`, que são da própria Lambda.

**Aplicada em 28/09/2026.** Até então a correção estava só escrita aqui: o papel
seguia sem `ListBucket` e o log mostrava o mesmo 403 em toda abertura.

**Conferir depois de aplicar:** entrar na conta uma vez e ver o objeto nascer.

```bash
aws s3 ls s3://brecho-dados-108826053014/estado/
```

## O save que apagava o outro aparelho — 06/10/2026

O `PUT /api/estado` gravava por cima, sem perguntar. Uma aba esquecida aberta
no celular, depois de uma tarde de jogo no computador, subia o guarda-roupa da
manhã na primeira mexida, e a tarde sumia.

Agora cada save tem **versão**, que é o ETag do objeto no S3. O `GET` devolve
a versão, e o `PUT` manda `{ estado, versao }` com a versão em que a edição se
baseou. O S3 só grava se o objeto ainda for aquele (`IfMatch`; `versao: null`
vira `IfNoneMatch: *`). Quando a nuvem andou, a resposta é **409** e nada é
gravado. Um `PUT` sem `versao` (aba aberta antes desta mudança) continua
gravando por cima, como antes.

| Rota | O que faz |
|---|---|
| `GET /api/estado` | `{ estado, atualizadoEm, versao }` |
| `GET /api/estado?so=versao` | só `{ versao, atualizadoEm }`, um `HeadObject` sem baixar o save |
| `PUT /api/estado` | `{ estado, versao }` → 200 com a versão nova, ou 409 |

Do lado do `js/db.js`:

- **Nota ao lado do save** (`bd:v1:estado:<id>:nuvem`): `{ versao, pendente }`.
  No login, ela decide sem depender de relógio. Versão igual e nada pendente:
  os dois saves são o mesmo. Versão igual e algo pendente: o daqui está adiante
  e sobe. Versão diferente: a nuvem andou, e o save de lá entra. Save antigo,
  sem nota, decide pela data, como antes.
- **Ao voltar para a aba**, ela pergunta `?so=versao`. Se a nuvem andou, traz o
  save de lá e recarrega a tela com um aviso.
- **No conflito, a nuvem ganha.** Perder os segundos da aba velha é melhor do
  que perder a tarde do outro aparelho. O aviso diz quando algo feito aqui não
  foi guardado.
- O `keepalive` ao fechar a aba só vai com corpo abaixo de 64 KB, o limite do
  navegador. Antes, save maior falhava calado; agora o `pendente` na nota faz a
  mudança subir no próximo login.

## A pegadinha do WAF — resolvida em 25/09/2026

Ao criar uma distribuição **pelo console**, a CloudFront oferece assinar um
*plano flat-rate* — e o plano, mesmo no tier **FREE**, exige um WebACL do WAF
associado. O WebACL não entra no plano: é cobrado à parte, **US$ 5 por ACL mais
US$ 1 por regra, por mês**. Duas distribuições desta conta estavam assim, com
três regras gerenciadas cada uma:

```
2 ACLs x US$ 5  +  6 regras x US$ 1  =  US$ 16/mês
```

Confirmado na fatura: US$ 15,43 (jun), US$ 16,02 (jul), US$ 16,01 (ago) — e
sem nenhum crédito compensando (`NetUnblendedCost` igual ao bruto).

O que foi feito, nesta ordem obrigatória:

1. `pricing-plan-manager cancel-subscription` nos dois planos. Plano FREE
   cancela na hora; plano pago só no fim do ciclo de faturamento.
2. `WebACLId: ""` nas duas distribuições. **Antes de cancelar o plano isto é
   recusado** com *"Distributions with a pricing plan subscription must have a
   web ACL resource"* — foi assim que o plano apareceu.
3. `wafv2 delete-web-acl` nos dois WebACLs.

As duas distribuições voltaram para CloudFront pay-as-you-go, o que para elas é
de graça: somam ~19 mil requisições/mês contra a franquia permanente de 10
milhões. Os dois sites continuaram respondendo 200 durante e depois.

**A distribuição do brechó nunca teve plano nem WAF** — foi criada pela CLI com
`WebACLId: ""`, que é o padrão quando não se passa nada. A pegadinha só existe
no caminho do console.

## Orçamento

`conta-teto-5-usd` avisa `oliveijao@gmail.com` em 50%, em 100% e quando a
previsão do mês passa de 100%.

O teto é 5 porque, sem os WAFs, a conta inteira deve fechar em torno de
US$ 1/mês: Route 53 (0,50) + S3 (0,32) + o brechó (~0,10) + imposto. Setembro
vai fechar alto ainda (US$ 13,81 até o dia 25) porque o WAF rodou 25 dias antes
de ser apagado — outubro é o primeiro mês limpo.

A etiqueta `projeto` foi posta em tudo, mas a AWS leva até 24 h para reconhecê-la
para rateio de custo. Depois disso, dá para ligar o orçamento só deste projeto:

```bash
aws ce update-cost-allocation-tags-status --cost-allocation-tags-status TagKey=projeto,Status=Active
```

## Apagar tudo

Na ordem — o bucket precisa estar vazio, e a distribuição precisa estar
desabilitada antes de sair.

```bash
bash nuvem/infra/derrubar.sh
```
