# Brechó Digital — guia rápido para o Claude

Jogo/app de brechó: vitrine diária, guarda-roupa, Stylist do avatar, colagem,
feed e perfil. Tudo em português (código, comentários, commits).

## Economizar contexto

- Comece por `grep`/`rg` no nome da função ou do texto da tela. Não leia arquivo
  inteiro: `db.js`, `roupinhas.js`, `board.js`, `config.js` e `esteira.js` têm
  mais de 1.000 linhas cada; leia só o trecho.
- `App/README.md` (1.340 linhas) e `nuvem/README.md` (416) são referência: busque
  a seção, não leia tudo.
- Nunca abra imagens nem pastas de arte: `Cloths/` (25 MB), `Prototipos/`,
  `Rasculhos/`, `Refs/`, `App/assets/cloths/` (18 MB). `App/assets/acervo.json`
  é grande e escrito pela Lambda: leia com `jq`, nunca inteiro.
- Print de tela só quando o João pedir ou for decidir algo visual; um por vez.

## Stack

- Front: HTML + CSS + JS puro (ES modules), **sem build, sem dependências**.
  `App/index.html` carrega `css/*.css` e `js/app.js` (boot).
- Nuvem (AWS, `us-east-1`): CloudFront → S3 (site) e `/api/*` → Lambda Python
  `brecho-api`; DynamoDB `brecho`; save do jogo em S3. Detalhes e custos em
  `nuvem/README.md`.
- Local: `python App/tools/servidor.py 5173` (SQLite). `App/tools/*.py` espelha
  `nuvem/lambda/*.py` (contas, feed, pessoas, estoque): mudou um, veja o outro.

## Onde fica cada coisa

Telas (`App/js/` + o `.css` de mesmo nome em `App/css/`):

| Tela / assunto | Arquivo |
|---|---|
| Boot, rotas `#/...` | `app.js`, `router.js` |
| Vitrine do dia, dono da loja | `vitrine.js`, `npc.js`, `sorteio.js` |
| Guarda-roupa, organizar | `closet.js`, `ordenacao.js`, `agrupamento.js`, `deslizar.js` |
| Stylist (avatar), personagem | `stylist.js`, `avatar.js`, `render.js`, `personagem.js`, `proporcao.js` |
| Inventário / roupinhas desenhadas | `vestiario.js`, `roupinhas.js` |
| Colagem | `board.js`, `boardgeo.js` |
| Feed, posts | `social.js`, `publicacoes.js` |
| Perfil próprio / de outra pessoa | `perfil.js`, `usuario.js`, `minhavitrine.js`, `favoritos.js` |
| Pessoas, busca, seguir | `pessoas.js`, `busca.js` |
| Tarefas, baús, nível, tutorial | `tarefas.js`, `baus.js`, `nivel.js`, `tutorial.js`, `presente.js` |
| Coleções (marcas) | `colecoes.js` (logos em `App/assets/marcas/`, gerados por `tools/logos.py`) |
| Avisos, janelas, ícones, paleta | `avisos.js`, `janela.js`, `icones.js`, `paleta.js` |
| Login | `auth.js`, `telaauth.js` |
| Instagram/Pinterest | `conexoes.js` |
| Admin, esteira de peças, editar peça | `admin.js`, `painel.js`, `esteira.js` (+ `App/esteira.html`), `editar.js` |
| Catálogo, tiragem | `catalog.js`, `estoque.js` |
| Save / persistência | `db.js` |
| Regras de negócio e números | `config.js` |

API (`nuvem/lambda/`): `app.py` roteia; `contas.py` login/sessão; `estado.py`
save; `acervo.py`/`esteira.py` peças do admin; `feed.py`, `pessoas.py`,
`estoque.py`, `painel.py`, `redes.py`/`pinterest.py` (OAuth), `gerador.py`
(posts dos perfis de exemplo), `limpeza.py`. Fila de imagens:
`nuvem/esteira/`. Infra e scripts de publicação: `nuvem/infra/`.

## Verificar e publicar

- Antes de subir: `python -m pyflakes nuvem/lambda nuvem/esteira App/tools` e
  `for f in App/js/*.js App/sw.js; do node --check "$f"; done` (é o que o CI roda).
- Push direto no `main` é barrado: abra PR e faça merge pelo GitHub. O merge no
  `main` publica sozinho na AWS (`.github/workflows/publicar.yml`), só a parte
  que mudou. O João autorizou publicar sempre que estiver testado, sem perguntar.
- CSS/JS sobem com `no-cache`: a mudança aparece na hora, sem invalidar CloudFront.
