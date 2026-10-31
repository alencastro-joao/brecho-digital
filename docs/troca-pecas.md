# Troca de peças entre usuários — plano

Status: **planejamento** (nada implementado). As decisões marcadas com ❓ são
do João; o resto é proposta técnica que segue a escolha recomendada e muda se
ele escolher outra.

## 1. Como as coisas funcionam hoje (o que a troca precisa respeitar)

| Assunto | Onde | O que importa para a troca |
|---|---|---|
| Guarda-roupa | `state.inventario` em `App/js/db.js` (`{ id, cat, raridade, obtidoEm, origem, ordem, numero? }`) | Mora no **save**, que é o navegador quem escreve (`PUT /api/estado`, um objeto gzip por conta no S3, com versão/ETag). O servidor não confia nele. |
| Uma cópia por peça | `adicionarPeca` em `App/js/dbinventario.js` (`if (temPeca(item.id)) return null`) | Ninguém tem duas cópias da mesma peça. Não existe "repetida" para trocar, e receber uma peça que já se tem é impossível hoje. |
| Tiragem limitada | `nuvem/lambda/estoque.py`, item `ESTOQUE#mapa` (`levadas["<id>\|<raridade>"]`) | Contador global por peça+raridade (1000 comuns … 25 lendárias). Troca **não pode** criar nem destruir cópia: o total tem que ficar igual. |
| Histórico da cópia | `COPIA#<id>\|<raridade>#<n>` → `donos: [{ uid, handle, como, em }]` | Já foi pensado para troca ("quando existir troca e doação, quem recebe entra do mesmo jeito"). O **último dono** da lista é a única fonte de verdade sobre de quem é a cópia que o servidor tem. |
| Peças sem número | `numerarAntigas` em `App/js/estoque.js` | Peça antiga pode não ter `numero`; sem número não há `COPIA#`, então não dá para provar dono. |
| Contas e sessão | `nuvem/lambda/contas.py` (`usuario_da_sessao`, `_transacao` = `TransactWriteItems`) | Toda rota nova já recebe o usuário logado; a transação de duas pontas já é usada no seguir. |
| Perfil público | `nuvem/lambda/pessoas.py` (`perfil.guardaRoupa`, até 600 ids, enviado pelo dono) | Dá para ver o guarda-roupa do outro e escolher o que pedir, mas a lista é declarada pelo dono: serve para a tela, não para validar. |
| Amizade | `pessoas.py`: amigo = sigo e me segue | Já existe, sem pedido/aceite. |
| Avisos | `avisos.js` / sino, tudo local no save | Não há notificação no servidor; a pessoa só fica sabendo do que o próprio navegador descobre. |
| Cota anti-abuso | `estoque.py` (`COTA_VITRINE`, `COTA_TOTAL`, item de cota por conta/dia) | Modelo pronto para limitar trocas por dia. |
| Local | `App/tools/estoque.py`, `App/tools/servidor.py` (SQLite) | Tudo que entrar na Lambda precisa do espelho local. |

**Conclusão central:** a troca tem que ser decidida no servidor, em cima do
`COPIA#` (quem é o dono da cópia nº N), e o save de cada um só *aplica* o
resultado. Se a troca mexesse só no save, bastava não tirar a peça do próprio
guarda-roupa para "duplicar".

## 2. Fluxo proposto (recomendação: oferta 1 por 1 ou N por M, com aceite)

1. **Escolher.** Na página de outra pessoa (`usuario.js`), botão **Propor troca**.
   Abre uma janela com duas colunas: "Você dá" (suas peças) e "Você recebe" (o
   guarda-roupa público dela). Peças que não podem ir aparecem apagadas com o
   motivo (sem número, você já tem, presa num look publicado etc., ver §4).
2. **Ofertar.** `POST /api/trocas` `{ para, dou: [cópias], quero: [cópias] }`.
   O servidor confere, para cada cópia, que o último dono do `COPIA#` é quem
   diz ser, que o destinatário não tem a mesma peça e os limites (§5). Grava
   `TROCA#<id>` com estado `aberta`, validade de 48 h. **Nada sai do
   guarda-roupa ainda** (recomendação: sem "reserva", ver ❓ Q6).
3. **Responder.** A outra pessoa vê a oferta (sino + aba Trocas) e escolhe
   **Aceitar**, **Recusar** ou (fase 2) **Contrapropor**. Quem ofertou pode
   **Cancelar** enquanto estiver aberta.
4. **Aceitar = uma transação só.** `POST /api/trocas/<id>/aceitar` faz um
   `TransactWriteItems` com:
   - `TROCA#<id>`: `estado = aberta` → `feita` (condição: ainda aberta e não vencida);
   - cada `COPIA#…`: condição "último dono = quem dá" e `list_append` do dono
     novo com `como: 'troca'` e `de: <handle>`;
   - os dois itens de cota do dia.
   Se qualquer condição falhar (alguém já deu a peça em outra troca, a oferta
   venceu), nada acontece e a oferta vira `invalida` com o motivo. O contador
   `ESTOQUE#mapa` **não é tocado**: a cópia muda de dono, o total é o mesmo.
5. **Aplicar no save.** Cada navegador, ao abrir o jogo (e ao abrir a aba
   Trocas), chama `GET /api/trocas` e recebe as trocas `feitas` que ainda não
   aplicou. Para cada uma: tira do `state.inventario` o que deu, põe o que
   recebeu (`adicionarPeca` com `origem: 'troca'`, mesma raridade e `numero`),
   salva e marca como aplicada (`POST /api/trocas/<id>/aplicada`). Aplicar duas
   vezes não faz mal (tirar o que não está e pôr o que já está são no-op).
6. **Conferência (anti-trapaça).** Quem tentar manter no save uma cópia que já
   deu não ganha nada: a ficha da peça mostra outro dono, ela não pode ser
   oferecida de novo (o servidor recusa), e o passo 5 tira ela no próximo boot.

## 3. Estados da troca

`aberta` → `feita` | `recusada` | `cancelada` | `vencida` | `invalida`.
Só `aberta` muda de estado; os outros são finais e ficam no histórico.

## 4. O que pode (e não pode) ser trocado — proposta

- ✅ Peças do guarda-roupa **com número** (cópia de tiragem).
- ❌ Peça que o outro **já tem** (regra de uma cópia por id).
- ❌ Peça sem número até ser numerada (o jogo já numera as antigas sozinho).
- ❌ Peças de origem `teste` e `propria` (do admin/criação própria), e as de
  `collab` se o João quiser que sejam exclusivas. ❓ Q4
- ⚠️ **Favoritas**: podem ir, com aviso "essa está nos seus favoritos". ❓ Q4
- ⚠️ **Peça usada em looks/colagens**: o look salvo é desenhado da lista de
  peças. Proposta: pode trocar, e o look continua existindo como foto (a
  miniatura salva), mas some do Stylist para editar. ❓ Q5
- ⚠️ Peça vestida no avatar: sai do avatar ao trocar (avatar volta à base
  naquela categoria).
- Raridade e número **vão junto**: a lendária nº 12 continua sendo a nº 12, e o
  histórico ganha mais um dono.

## 5. Limites anti-abuso (números para o João ajustar)

| Regra | Proposta | Por quê |
|---|---|---|
| Ofertas abertas por pessoa | 5 enviadas, 10 recebidas | Evita spam de ofertas. |
| Trocas concluídas por dia | 5 | Mesmo item de cota de `estoque.py`, nova chave. |
| Peças por oferta | até 3 de cada lado | Tela simples, transação pequena (o limite do DynamoDB é 100 itens). |
| Conta nova | só troca depois de X dias ou nível Y ❓ Q7 | Corta contas-fantasma criadas para passar peça para a conta principal. |
| Mesma cópia | não volta para quem deu antes de 7 dias | Evita "lavar" peça / farmar missão de troca. |
| Validade da oferta | 48 h | Oferta velha vira `vencida` na leitura. |
| Lendária/épica | opcional: 1 por dia ❓ Q7 | Tiragem pequena; segura concentração. |

Todas as checagens moram no servidor; a tela só repete para avisar antes.

## 6. Modelo de dados (DynamoDB `brecho`, sem índice novo)

```
TROCA#<id>        de, para, dou:[{id,raridade,numero}], quero:[...],
                  estado, criada, vence, resolvida, motivo, aplicada:{uid: bool}
TROCAS#<uid>      abertas: SS de ids (enviadas e recebidas), recentes: L (últimas 50)
COTA#<uid>#<dia>  ganha o campo trocas (já existe para o estoque)
COPIA#...         donos ganha { uid, handle, como: 'troca', de, em }
```

`TROCAS#<uid>` é a "caixa" de cada um, lida em `GET /api/trocas` sem varrer a
tabela. Ela entra na mesma transação da oferta e do aceite. Fica ao lado de
`COMO` em `estoque.py` a origem nova `'troca'`.

## 7. API nova (`nuvem/lambda/trocas.py` + espelho `App/tools/trocas.py`)

| Rota | O que faz |
|---|---|
| `GET /api/trocas` | Minhas abertas (enviadas/recebidas), recentes e as feitas ainda não aplicadas. |
| `POST /api/trocas` | Cria oferta `{ para, dou, quero }`. |
| `POST /api/trocas/<id>/aceitar` | Transação do §2.4. |
| `POST /api/trocas/<id>/recusar` · `/cancelar` | Fecha a oferta. |
| `POST /api/trocas/<id>/aplicada` | Marca que o meu save já aplicou. |

Roteamento em `app.py`, como `/api/estoque/*`. Testes em `nuvem/testes/`
com moto: duas ofertas brigando pela mesma cópia (só uma passa), aceitar
vencida, aceitar oferta cuja peça já mudou de dono, total da tiragem igual
antes e depois.

## 8. Interface

- **Página de outra pessoa** (`usuario.js`): botão **Propor troca** ao lado de
  Seguir (aparece só se a regra de amizade permitir ❓ Q3).
- **Janela de proposta** (`janela.js`): "Você dá" × "Você recebe", com as
  peças em grade, filtro por categoria e o resumo embaixo (raridade e nº de
  cada cópia). Botão **Enviar proposta**.
- **Aba Trocas** (no perfil próprio ou em Tarefas, ❓ Q8): três listas —
  Recebidas (Aceitar/Recusar), Enviadas (Cancelar) e Histórico (feitas,
  recusadas, vencidas).
- **Sino**: aviso "@fulana quer trocar com você" e "@fulana aceitou sua troca"
  — gerado localmente a partir do `GET /api/trocas` no boot e a cada X minutos
  com o jogo aberto (não há push no servidor hoje).
- **Ficha da peça**: o histórico já existente mostra "veio de @fulana por troca".
- **Animação de chegada**: reaproveitar a do baú (peça pula com a aura).
- Opcional: missão de mural "Faça uma troca" ❓ Q9.

## 9. Fases sugeridas

1. **Servidor**: `trocas.py` + espelho local + testes (oferta, aceite,
   recusa, cancelar, vencer, aplicar). Sem tela.
2. **Tela mínima**: Propor troca, aba Trocas, aplicar no boot, sino.
3. **Extras** (só se o João quiser): contraproposta, presente, missão, mural
   de "procuro/ofereço".

## 10. Perguntas em aberto (decisão do João)

- **Q1. Formato:** só 1 por 1, ou N por M (até 3 de cada lado)? *Recomendo N por M até 3.*
- **Q2. Presente:** pode dar peça sem receber nada em troca? *Recomendo não na
  primeira versão, por ser o caminho mais fácil para passar peças de contas
  fantasmas para a principal.*
- **Q3. Quem pode trocar:** qualquer pessoa, só quem eu sigo, ou só amigos
  (seguem um ao outro)? *Recomendo só amigos.*
- **Q4. O que fica de fora:** favoritas, peças de collab, lendárias? *Recomendo tudo numerado pode, com aviso nas favoritas.*
- **Q5. Peça usada em look/colagem salva:** pode trocar (o look fica como foto) ou bloqueia até tirar do look?
- **Q6. Reserva:** ao ofertar, a peça fica presa até a resposta, ou continua
  livre e a troca falha se ela já tiver saído? *Recomendo livre (mais simples, sem peça presa).*
- **Q7. Limites:** os números do §5 servem? Conta nova precisa de tempo/nível mínimo? Lendária tem limite próprio?
- **Q8. Onde fica a aba Trocas:** no perfil, em Tarefas ou um botão novo na barra?
- **Q9. Recompensa:** trocar dá XP/fichas ou conta para missão? (Cuidado: prêmio por troca incentiva troca combinada entre duas contas da mesma pessoa.)
- **Q10. Moeda:** troca é só peça por peça, ou entra ficha como parte da oferta?
- **Q11. Desfazer:** depois de aceita, tem prazo para desfazer (como os 10 s da loja) ou é definitiva?
