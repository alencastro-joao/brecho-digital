// Vitrine do dia — o mural orgânico do brechó.
//
// O estoque é do dia e de cada pessoa: o sorteio usa a data e o id da conta
// como semente (db.sementeDaLoja), então cada um tem a sua arara, com as mesmas
// roupas do primeiro ao último acesso do dia. A *arrumação* é
// outra história — ela é sorteada a cada carregamento da página, como se o dono
// remexesse a arara toda vez que abre a porta. A cápsula do ilustrador não entra
// aqui: ela é conquistada por missões.
//
// A arara é cheia de propósito: as peças se encavalam, e quem fica por baixo da
// pilha é justamente a mais rara. Achar a épica é garimpo — tirar de cima a
// roupa que a tapa até ela aparecer. Quantas raras vêm por dia é sorteado por raridade
// (`naLoja`, em config.js): na maioria dos dias uma épica, às vezes duas, às
// vezes nenhuma. E peça pega *sai* da loja: some do mural na hora e não volta
// na próxima abertura, que é o que o resgate significa.

import {
  ADMIN, CONFIG, COLLAB, FICHAS, RARIDADE, RARIDADES, CATEGORIAS, chanceNaLoja, tamanhoNoMural,
  COLECOES, normalizarMarca,
} from './config.js';
import { catalogo, item as pecaDoCatalogo, nomeDaPeca, proporcao, aplicarContorno,
         imagemDaPeca, trocarImagem } from './catalog.js';
import * as db from './db.js';
import * as estoque from './estoque.js';
import { falar, falarDe } from './npc.js';
import { instalarPassThrough, precarregarAlpha } from './alpha.js';
import { criarAura } from './aura.js';
import { abrirEditar } from './editar.js';
import { avisarColecaoDaPeca, colecoesDaPeca, chipDaColecao, rendeEscolha } from './colecoes.js';
import { avisarLojaReposta, conferirWishlist } from './avisos.js';
import {
  el, $, clamp, mulberry32, shuffle, hojeISO,
  msAteMeiaNoite, formatarContagem, toast,
} from './util.js';
import { emo, ico } from './icones.js';
import { botaoDesejo } from './usuario.js';
import { confirmar, mostrar } from './janela.js';
import { irPara } from './router.js';
import { chegarNaArara, voar } from './movimento.js';
import { tocar } from './sons.js';

let mural, passThroughInstalado = false, resizeTimer;

// Com que tamanho de mural a vitrine na tela foi montada. Remontar só vale a
// pena quando esse tamanho muda: trocar de tela e voltar não pode reembaralhar
// a arara no meio do garimpo.
let tamanhoMontado = { w: 0, h: 0 };

// Peça que você *pega* sobe para o topo e fica lá — o que você mexeu por último
// está por cima. Só passar o mouse não basta: se a ponta da rara subisse no
// hover, ninguém precisaria tirar roupa de cima para chegar nela.
let zTopo = 100;
const trazerParaFrente = (no) => { no.style.zIndex = String(++zTopo); };

// A arrumação do mural é sorteada a cada carregamento da página e não vai para o
// save: recarregar embaralha as roupas de novo. Dentro da mesma página ela fica
// fixa, para trocar de tela ou girar o celular não reembaralhar a arara.
//
// O estoque fora do sorteio do dia (`dia.estoque`) é o que o botão de repor
// (admin) usa para trocar a arara sem esperar a meia-noite. Também fica no save,
// senão a loja reposta voltava a ser a do dia no próximo login. `null` = loja do dia.
// Os dois somem sozinhos na virada do dia, junto com o resto de `state.dia`.
const novaSemente = () => (Math.random() * 0x100000000) >>> 0;
let sementeArrumacao = novaSemente();
const sementeEstoque = () => db.state.dia.estoque ?? null;
let posicoesLimpas = false;

// Quanto mais raro, mais embaixo da pilha. RARIDADES já vem da mais comum para
// a mais rara, então o índice serve de nível direto.
const NIVEL = Object.fromEntries(RARIDADES.map((r, i) => [r.id, i]));
const nivelDe = (id) => NIVEL[id] ?? 0;
const NIVEL_RARO = NIVEL.rare;            // daqui para cima, a peça é escondida

// Quantas peças de uma raridade a arara leva hoje, na tabela `naLoja` dela.
function sortearQuantidade(tabela, rnd) {
  const opcoes = Object.entries(tabela).map(([n, pct]) => [Number(n), pct]);
  let x = rnd() * opcoes.reduce((s, [, pct]) => s + pct, 0);
  for (const [n, pct] of opcoes) {
    if (x < pct) return n;
    x -= pct;
  }
  return opcoes.at(-1)?.[0] ?? 0;
}

// Saiu da arara hoje pelas suas mãos. Ela continua ocupando a vaga da sua
// raridade no sorteio do dia: sem isso, pegar a épica e recarregar a página
// punha *outra* épica no lugar — a loja se reabastecia de raridade sozinha.
function levadaHoje(id, iso) {
  const p = db.pecaDoInventario(id);
  return p?.origem === 'vitrine' && !!p.obtidoEm && hojeISO(new Date(p.obtidoEm)) === iso;
}

// As peças do dia são sorteadas uma vez e ficam no save (`dia.vitrine`). O
// sorteio embaralha o acervo inteiro, e o acervo cresce várias vezes por dia
// pela esteira: uma peça nova cadastrada mudava a loja toda no próximo login.
// Agora a lista do dia vale até a meia-noite (ou até o admin repor a loja);
// peça tirada do acervo só some dela.
export function poolDoDia(iso = hojeISO()) {
  const dia = db.state.dia;
  const marca = sementeEstoque() ?? 'dia';
  const doDia = dia.data === iso;
  if (doDia && dia.vitrine?.marca === marca) {
    const lista = dia.vitrine.ids.map(pecaDoCatalogo).filter(Boolean);
    if (lista.length) return lista;
  }
  const lista = sortearArara(iso);
  if (doDia && lista.length) {
    dia.vitrine = { marca, ids: lista.map(i => i.id) };
    db.salvar();
  }
  return lista;
}

function sortearArara(iso) {
  const rnd = mulberry32(sementeEstoque() ?? db.sementeDaLoja(iso));
  const { naLoja } = db.modificadoresDaLoja();
  const raridade = (i) => {
    const r = db.raridadeDoDia(i.id, iso);
    return RARIDADE[r] ? r : 'common';
  };

  // Peça do guarda-roupa fica de fora — menos a que saiu daqui hoje, que guarda
  // a vaga até a meia-noite.
  const candidatas = catalogo.itens.filter(i =>
    !COLLAB.itens.includes(i.id)
    && (!db.temPeca(i.id) || levadaHoje(i.id, iso))
    // Tiragem esgotada: todas as cópias já estão em algum guarda-roupa.
    && !estoque.esgotada(i.id, raridade(i)));

  // Separa por raridade (cada grupo já embaralhado) e tira de cada um a
  // quantidade que a tabela `naLoja` sorteou para hoje. A raridade manda na
  // loja, não no acervo: ter 10 épicas cadastradas não põe mais épica na arara.
  const grupos = Object.fromEntries(RARIDADES.map(r => [r.id, []]));
  // Congelada com fichas entra antes de tudo e não sai no repor. Ela conta na
  // vaga da raridade dela, para a loja não ganhar uma rara a mais por isso.
  const presas = db.congeladas(iso);
  const congeladas = candidatas.filter(i => presas.includes(i.id));
  for (const i of shuffle(candidatas, rnd)) if (!presas.includes(i.id)) grupos[raridade(i)].push(i);

  const arara = [...congeladas];
  for (const r of [...RARIDADES].reverse()) {
    const tabela = naLoja[r.id] ?? r.naLoja;
    const presasDaRaridade = congeladas.filter(i => raridade(i) === r.id).length;
    if (tabela) arara.push(...grupos[r.id].splice(0,
      Math.max(0, sortearQuantidade(tabela, rnd) - presasDaRaridade)));
  }

  // Efeitos de coleção vestida (ver db.modificadoresDaLoja). Têm sorteio
  // próprio, com outra semente: sem efeito nenhum, a arara é exatamente a de
  // sempre. O bônus vestido (+5% a +20%) vale 3× aqui — uma rara a mais ou uma
  // peça da marca a mais é coisa rara de acontecer com 5%.
  const { marcas, maisRaras } = db.modificadoresDaLoja();
  const sorte = mulberry32(((sementeEstoque() ?? db.sementeDaLoja(iso)) ^ 0x5EED) >>> 0);
  if (maisRaras && grupos.rare.length && sorte() < maisRaras * 3 / 100) arara.push(grupos.rare.shift());

  // Comum completa o resto; faltando comum, a incomum que sobrou. Rara para cima
  // nunca entra de recheio — ela só vem pela própria tabela.
  // A peça levada hoje continua na lista do dia: é a montagem do mural que deixa
  // de pendurá-la. Tirá-la aqui fazia o recheio puxar uma peça nova para cada
  // resgate, e a arrumação mudava porque o mural tinha menos peças para espalhar.
  let recheio = [...grupos.common, ...grupos.uncommon];
  if (marcas.length) {
    const daMarca = (i) => marcas.find(m =>
      m.marcas.some(x => normalizarMarca(x) === normalizarMarca(i.marca)));
    const frente = recheio.filter(i => { const m = daMarca(i); return m && sorte() < m.pct * 3 / 100; });
    recheio = [...frente, ...recheio.filter(i => !frente.includes(i))];
  }
  return [...arara, ...recheio.slice(0, Math.max(0, CONFIG.PECAS_NA_VITRINE - arara.length))];
}


// O que a peça ocupa no mural é mais que a imagem: o botão "Pegar" (ou o selo
// "no closet") continua no layout mesmo invisível — só a opacidade muda no hover
// — e ele é mais largo que um anel ou um relógio. É essa caixa, e não a imagem,
// que precisa caber no mural.
const RODAPE_PECA = 48;         // botão + margem + a folga da flutuação
// Na borda de baixo, porém, o rodapé pode sobrar para fora do mural: o botão é
// invisível até o hover e a ficha também tem "Pegar". Contá-lo ali travava uma
// faixa vazia de ~50px embaixo da arara, onde nenhuma roupa podia ficar.
const fundoDaPeca = (caixa) => caixa.h - RODAPE_PECA;
const LARGURA_MIN_PECA = 116;   // largura do botão: a caixa nunca é mais estreita
const ALTURA_LIVRE = 0.72;      // quanto da altura do mural a maior peça pode ocupar
// Teto de pano na arara: a soma das caixas pode passar da área do mural (é o
// que empilha as roupas), mas não muito — acima disso a pilha deixa de ser
// garimpo e vira mancha. Na tela pequena é ele que encolhe o estoque inteiro.
const OCUPACAO_MAX = 1.35;
// O giro e o crescimento do hover incham a peça para os dois lados, e a caixa
// medida no layout não conta isso. Parar alguns pixels antes da borda é mais
// barato que refazer a conta com a matriz de transformação.
const FOLGA_BORDA = 8;
// No celular as roupas aparecem 20% maiores que a conta do aperto daria: a tela
// é pequena e a peça miúda não dava para ver. Elas se sobrepõem mais, e só.
const ESCALA_CELULAR = 1.2;
// Quanto a flutuação sobe e gira (ver @keyframes peca-flutuar) e quanto o
// hover cresce (.item-roupa:hover).
const FLUTUA_SOBE = 9, FLUTUA_GIRO = 1, CRESCE_HOVER = 1.06;

// O que a peça, girada e flutuando, passa da própria caixa em cada lado. O
// giro é em volta do centro da caixa toda (imagem + rodapé), então numa calça
// comprida um giro de 5° já joga a barra uns 30px para o lado — bem mais que
// a FOLGA_BORDA. Sem essa conta, a peça encostada na borda flutuava para fora.
function sobraDoGiro(w, h, caixa, giroGraus) {
  const t = (Math.abs(giroGraus) + FLUTUA_GIRO) * Math.PI / 180;
  const sen = Math.sin(t), cos = Math.cos(t);
  const meiaAltura = caixa.h / 2;
  const lado = CRESCE_HOVER * (w / 2 * cos + meiaAltura * sen) - caixa.w / 2;
  const topo = CRESCE_HOVER * (meiaAltura * cos + w / 2 * sen) - meiaAltura + FLUTUA_SOBE;
  // Embaixo conta só a imagem: o rodapé (botão) pode sobrar para fora.
  const fundoImg = meiaAltura - RODAPE_PECA;
  const fundo = CRESCE_HOVER * (fundoImg * cos + w / 2 * sen) - fundoImg;
  return { lado: Math.max(0, lado), topo: Math.max(0, topo), fundo: Math.max(0, fundo) };
}

function medidasDoMural(pecas, largura, altura, escala = 1) {
  const cruas = pecas.map(p => tamanhoNoMural(p, proporcao(p)));

  // Teto do que cabe: a largura entre as margens e a altura entre o cabeçalho e
  // o botão. O `ALTURA_LIVRE` guarda uma faixa de sobra para as peças poderem
  // ficar em alturas diferentes — com a peça ocupando a altura toda, o único
  // lugar possível para todas é o mesmo, e o mural vira varal.
  const tetoW = Math.max(80, largura - 52);
  const tetoH = Math.max(120, Math.min(altura - 88 - 26 - RODAPE_PECA, altura * ALTURA_LIVRE));

  // Com 25 peças na arara, o que limita não é só a peça maior: é o pano todo.
  // Se a soma das caixas passa do teto de ocupação, a arara inteira encolhe até
  // sobrar sobreposição legível.
  const areaMural = Math.max(1, (largura - 52) * Math.max(1, altura - 114));
  const somaCaixas = cruas.reduce((s, m) =>
    s + Math.max(m.w, LARGURA_MIN_PECA) * (m.h + RODAPE_PECA), 0) || 1;
  const fatorAperto = Math.min(1, Math.sqrt((areaMural * OCUPACAO_MAX) / somaCaixas));

  // Um fator só para todo mundo: o tamanho no mural é a medida real da peça, e
  // duas camisas de mesma medida têm que sair iguais na loja. Ou a arara
  // inteira encolhe junto, ou não encolhe ninguém.
  const tetoCabe = Math.min(...cruas.map(m => Math.min(tetoW / m.w, tetoH / m.h)));
  const fatorBase = clamp(Math.min(1, fatorAperto, tetoCabe), 0.34, 1);
  // A escala do celular passa por cima do aperto, mas nunca do que cabe no mural.
  const fator = Math.min(fatorBase * escala, Math.max(fatorBase, tetoCabe));

  return cruas.map(({ w, h }) => {
    const pw = Math.round(w * fator), ph = Math.round(h * fator);
    return { w: pw, h: ph, caixa: { w: Math.max(pw, LARGURA_MIN_PECA), h: ph + RODAPE_PECA } };
  });
}

// Peça rara no meio do mural, à mostra, não é achado — é vitrine. O Poisson
// espalha bem demais para isso, então aqui a arrumação é corrigida à mão: cada
// peça rara ganha uma comum puxada por cima, encostada o bastante para tapar
// boa parte dela e deixar só uma ponta de fora. Como a rara entrou antes na
// pilha, ela já está por baixo — só faltava alguém em cima.
//
// Quem cobre é sempre a comum *mais perto*: mover a vizinha é o que menos
// estraga o espalhamento que o Poisson achou.
function encobrirAsRaras(estoque, pontos, medidas, mural, rnd) {
  // A peça que sobe para tapar continua presa às mesmas regras do mural: não
  // passa da borda, não sobe atrás do cabeçalho e não cai em cima do NPC.
  const acomodar = (p, caixa) => ({
    x: clamp(p.x, FOLGA_BORDA, Math.max(FOLGA_BORDA, mural.w - caixa.w - FOLGA_BORDA)),
    y: clamp(p.y, mural.topo, Math.max(mural.topo, mural.h - fundoDaPeca(caixa) - FOLGA_BORDA)),
  });
  const proibido = (p, caixa) => mural.zonas.some(z =>
    p.x + caixa.w > z.x0 && p.x < z.x1 && p.y + caixa.h > z.y0 && p.y < z.y1);

  const raras = [], comuns = [];
  estoque.forEach((e, i) => (nivelDe(e.raridade) >= NIVEL_RARO ? raras : comuns).push(i));

  const jaCobriu = new Set();
  for (const i of raras) {
    const alvo = pontos[i];
    if (!alvo) continue;

    let escolhida = -1, perto = Infinity;
    for (const j of comuns) {
      if (jaCobriu.has(j) || !pontos[j]) continue;
      const d = Math.hypot(pontos[j].x - alvo.x, pontos[j].y - alvo.y);
      if (d < perto) { perto = d; escolhida = j; }
    }
    if (escolhida < 0) break;            // acabaram as comuns: o resto fica à vista
    jaCobriu.add(escolhida);

    // O deslocamento é uma fração da caixa da rara: com esse intervalo a comum
    // sempre invade a peça, nunca a some inteira. O lado é sorteado para as
    // pilhas não saírem todas iguais.
    const cx = medidas[i].caixa, cj = medidas[escolhida].caixa;
    const dx = (rnd() < 0.5 ? -1 : 1) * (0.18 + rnd() * 0.32) * cx.w;
    const dy = (rnd() < 0.35 ? -1 : 1) * (0.12 + rnd() * 0.30) * cx.h;

    // O lado espelhado é o plano B: perto do cabeçalho ou da borda, cobrir por
    // baixo resolve o que cobrir por cima não resolveria. Sem saída, a comum
    // fica onde estava — mural torto é pior que uma rara à mostra.
    const tentativas = [
      { x: alvo.x + dx, y: alvo.y + dy },
      { x: alvo.x - dx, y: alvo.y - dy },
    ].map(p => acomodar(p, cj));
    const boa = tentativas.find(p => !proibido(p, cj));
    if (boa) pontos[escolhida] = boa;
  }
}

// Na vitrine a aura e a etiqueta de raridade só aparecem com o mouse em cima:
// parado, o mural é a arara de roupa; o brilho é a resposta a quem se
// interessou pela peça. (No guarda-roupa a aura continua sempre visível — lá
// ela é a marca do que você já tem.)
// Espalha as peças pelo mural inteiro. A área livre (abaixo do cabeçalho, entre
// as bordas) é cortada numa grade com uma célula por peça, e cada peça cai
// perto do meio da sua célula, com um tremido para não parecer prateleira.
// Antes era um Poisson (Bridson): ele cresce a partir de uma semente e pára ao
// completar a conta, então a arara toda nascia em volta de um ponto — no
// celular, um bolo de roupa no meio ou embaixo e o resto da tela vazio. Aqui a
// conta é pelo *centro* da peça, e toda faixa da tela recebe alguém.
//
// O encavalamento continua: a peça é maior que a célula, e as raras ainda
// ganham alguém por cima em `encobrirAsRaras`.
function espalharPeloMural(caixas, mural, rnd) {
  const n = caixas.length;
  if (!n) return [];
  const x0 = FOLGA_BORDA, x1 = mural.w - FOLGA_BORDA;
  // Faixa do topo tomada quase de lado a lado (os botões de admin no celular):
  // a grade começa abaixo dela, senão a primeira linha inteira seria empurrada
  // para cima da segunda.
  const y0 = mural.zonas.reduce((topo, z) =>
    z.y0 <= topo && z.x1 - z.x0 > mural.w / 2 ? Math.max(topo, z.y1) : topo, mural.topo);
  const y1 = mural.h - FOLGA_BORDA;
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);

  // Colunas e linhas na proporção da área, com o mínimo de células sobrando.
  let cols = clamp(Math.round(Math.sqrt(n * w / h)), 1, n);
  let linhas = Math.ceil(n / cols);
  while (cols > 1 && (cols - 1) * linhas >= n) cols--;
  const cw = w / cols, ch = h / linhas;

  // Sobrando célula, a vaga sai sorteada — e não sempre a última linha, que
  // deixaria o rodapé vazio de novo.
  const celulas = shuffle([...Array(cols * linhas).keys()], rnd).slice(0, n);

  const acomodar = (p, t) => ({
    x: clamp(p.x, x0, Math.max(x0, x1 - t.w)),
    y: clamp(p.y, y0, Math.max(y0, y1 - t.h)),
  });
  const proibido = (p, t) => mural.zonas.some(z =>
    p.x + t.w > z.x0 && p.x < z.x1 && p.y + t.h > z.y0 && p.y < z.y1);

  return caixas.map((t, i) => {
    const cel = celulas[i];
    const cx = x0 + (cel % cols + 0.5) * cw;
    const cy = y0 + (Math.floor(cel / cols) + 0.5) * ch;
    let melhor = null;
    for (let tent = 0; tent < 12; tent++) {
      const p = acomodar({
        x: cx + (rnd() - 0.5) * cw * 0.8 - t.w / 2,
        y: cy + (rnd() - 0.5) * ch * 0.8 - t.h / 2,
      }, t);
      melhor = melhor || p;
      if (!proibido(p, t)) return p;
    }
    // Célula colada no cabeçalho ou no NPC: desce (ou sobe) até sair da zona.
    for (const z of mural.zonas) {
      if (!proibido(melhor, t)) break;
      const abaixo = acomodar({ x: melhor.x, y: z.y1 }, t);
      const acima = acomodar({ x: melhor.x, y: z.y0 - t.h }, t);
      melhor = !proibido(abaixo, t) ? abaixo : !proibido(acima, t) ? acima : melhor;
    }
    return melhor;
  });
}

function caixaDeAura(raridade, src) {
  const aura = criarAura(raridade, src);
  return aura ? el('span', { class: 'aura-cx', 'aria-hidden': 'true' }, aura) : null;
}

// As peças caem na arara na primeira vez que o mural aparece e quando a loja
// é reposta ou o dia vira; remontar no mesmo dia (redimensionar, desfazer)
// não repete a chegada.
let jaChegou = false;
function chegar() {
  if (!mural?.offsetParent) return;      // vitrine escondida: chega quando abrir
  jaChegou = true;
  chegarNaArara([...mural.querySelectorAll('.item-roupa')]);
}

// As roupas do dia começam a baixar antes de a loja ser montada: o boot ainda
// espera quem você segue e monta as outras telas, e cada segundo disso era um
// segundo a mais de mural vazio. O tamanho é o mesmo que o mural vai pedir
// (mesma conta de medidasDoMural), então o navegador escolhe a mesma imagem do
// srcset e a <img> da vitrine já nasce com ela no cache.
const preCarregadas = [];                // segura as Image (são só as do dia)
export function precarregarVitrine() {
  const caixa = $('#vitrine-mural');
  const largura = caixa?.clientWidth || window.innerWidth;
  const altura = caixa?.clientHeight || window.innerHeight;
  const celular = matchMedia('(max-width: 900px)').matches;
  const pecas = poolDoDia(hojeISO()).slice(0, CONFIG.PECAS_NA_VITRINE);
  const medidas = medidasDoMural(pecas, largura, altura, celular ? ESCALA_CELULAR : 1);
  pecas.forEach((peca, i) => {
    if (db.temPeca(peca.id)) return;
    const { src, srcset, sizes } = imagemDaPeca(peca, medidas[i].w);
    const img = new Image();
    img.decoding = 'async';
    if (srcset) { img.sizes = sizes; img.srcset = srcset; }
    img.src = src;
    preCarregadas.push(img);
  });
}

export function montarVitrine({ entrada = false } = {}) {
  mural = $('#vitrine-mural');
  if (!mural) return;

  // Dia novo desfaz a reposição do admin: a loja volta a ser a do dia.
  db.virarODiaSeNecessario();
  ligarAdmin();

  const iso = db.state.dia.data;
  const rnd = mulberry32(sementeArrumacao);

  // Peça arrastada volta para o lugar sorteado quando a página recarrega: a
  // posição é em pixels da tela em que foi arrastada, e no celular ela cairia
  // fora do lugar.
  if (!posicoesLimpas) { db.limparPosicoes(); posicoesLimpas = true; }

  mural.innerHTML = '';
  fecharFicha();

  const largura = mural.clientWidth || window.innerWidth;
  const altura = mural.clientHeight || window.innerHeight;
  tamanhoMontado = { w: largura, h: altura };
  observarMural();
  const qtd = CONFIG.PECAS_NA_VITRINE;

  // A raridade do dia é decidida aqui, antes de pendurar: é ela que dá a ordem
  // da pilha. Rara primeiro — quem entra antes no mural fica embaixo, e a
  // comum, que entra depois, cai por cima.
  const estoque = poolDoDia(iso).slice(0, qtd)
    .map(peca => ({ peca, raridade: db.raridadeDoDia(peca.id, iso) }))
    .sort((a, b) => nivelDe(b.raridade) - nivelDe(a.raridade));
  const pecas = estoque.map(e => e.peca);

  // Mede todo mundo antes de espalhar: o Poisson precisa do tamanho de cada
  // peça para saber onde ela ainda cabe inteira.
  const celular = matchMedia('(max-width: 900px)').matches;
  const medidas = medidasDoMural(pecas, largura, altura, celular ? ESCALA_CELULAR : 1);

  // Não deixa peça cair atrás do cabeçalho — nem em cima do dono da loja,
  // quando ele está na tela. A faixa do cabeçalho é medida, não chutada: no
  // modo admin ela carrega os botões de administração e fica bem mais larga.
  // A altura também é medida: no celular os botões de admin quebram linha e o
  // bloco desce bem além dos 104px de sempre.
  const caixaAcoes = $('.vitrine-acoes')?.getBoundingClientRect();
  const topoMural = mural.getBoundingClientRect().top;
  const acoes = caixaAcoes?.width;
  const fundoAcoes = caixaAcoes?.height ? caixaAcoes.bottom - topoMural + 10 : 0;
  // No celular não há faixa de cabeçalho: o contador fica num canto e o sino
  // e o perfil no outro, flutuando sobre o mural. Só os três viram zona
  // proibida (medidos, com folga) e o resto do topo é das peças.
  const zonaDe = (no, folga = 8) => {
    const r = no?.getBoundingClientRect();
    if (!r?.width) return null;
    const esq = mural.getBoundingClientRect().left;
    return { x0: r.left - esq - folga, y0: 0, x1: r.right - esq + folga, y1: r.bottom - topoMural + folga };
  };
  const zonasProibidas = celular
    ? [$('.vitrine-acoes'), $('.avisos-btn'), $('#perfil-atalho')].map(no => zonaDe(no)).filter(Boolean)
    : [{ x0: largura - (acoes ? acoes + 48 : 210), y0: 0, x1: largura, y1: Math.max(104, fundoAcoes) }];
  if (CONFIG.NPC_VISIVEL) {
    zonasProibidas.push({ x0: 0, y0: altura - 290, x1: 320, y1: altura });
  }

  const areaLivre = { w: largura, h: altura, topo: celular ? FOLGA_BORDA : 88, zonas: zonasProibidas };
  const pontos = espalharPeloMural(
    medidas.map(m => ({ w: m.caixa.w, h: fundoDaPeca(m.caixa) })), areaLivre, rnd);

  encobrirAsRaras(estoque, pontos, medidas, areaLivre, rnd);

  const nos = [];
  estoque.forEach(({ peca, raridade }, i) => {
    // Já é sua: a vaga e o lugar dela no mural ficam, a peça não.
    if (db.temPeca(peca.id)) return;
    // O tamanho é só a medida da peça — sem variação aleatória. O mural ganha
    // vida no giro e na flutuação, não no tamanho: sorteá-lo fazia duas
    // camisas de mesma medida aparecerem com tamanhos diferentes na loja.
    const { w, h, caixa } = medidas[i];
    const giro = (rnd() - 0.5) * 11;

    const img = el('img', {
      ...imagemDaPeca(peca, w), alt: nomeDaPeca(peca), loading: 'eager', decoding: 'async',
      style: { width: `${Math.round(w)}px`, height: `${Math.round(h)}px` },
    });
    const temContorno = aplicarContorno(img, peca);
    if (!temContorno) precarregarAlpha(img);

    // A raridade do dia já vale na vitrine: a peça brilha antes de ser resgatada,
    // e é exatamente essa que entra no guarda-roupa.
    const r = RARIDADE[raridade];

    // Peça arrastada fica onde você deixou, enquanto a página estiver aberta.
    // O clamp é a rede de segurança: nem ponto sorteado nem posição guardada de
    // uma janela maior pode deixar a roupa pendurada para fora do mural.
    const guardada = db.posicaoGuardada(peca.id);
    const bruta = guardada || pontos[i] || { x: 26, y: 88 };
    const sobra = sobraDoGiro(w, h, caixa, giro);
    const xMin = FOLGA_BORDA + sobra.lado, yMin = FOLGA_BORDA + sobra.topo;
    const pos = {
      x: clamp(bruta.x, xMin, Math.max(xMin, largura - caixa.w - xMin)),
      y: clamp(bruta.y, yMin,
        Math.max(yMin, altura - fundoDaPeca(caixa) - FOLGA_BORDA - sobra.fundo)),
    };

    const no = el('div', {
      class: 'item-roupa',
      dataset: { id: peca.id, raridade },
      style: {
        left: `${Math.round(pos.x)}px`,
        top: `${Math.round(pos.y)}px`,
        '--rot': `${giro.toFixed(1)}deg`,
        '--peca-w': `${Math.round(w)}px`,
        '--peca-h': `${Math.round(h)}px`,
        zIndex: String(10 + i),
      },
    },
      // Aura e imagem no mesmo invólucro: o brilho fica colado na peça e
      // acompanha qualquer movimento dela. A aura vai dentro de uma caixa
      // própria porque quem revela no hover é ela: a opacidade da aura é
      // animada pelo keyframe do brilho, e um fade aplicado direto nela
      // não teria como vencer a animação.
      el('div', {
        class: 'peca-flutua',
        style: { '--flutua-atraso': (-Math.random() * 5).toFixed(2) + 's' },
      }, caixaDeAura(raridade, peca.src), img, db.estaCongelada(peca.id) ? seloDeCongelada() : null),
      el('span', { class: 'item-tag' },
        nomeDaPeca(peca),
        r.aura ? el('span', { class: 'raridade', style: { color: r.aura === 'arco-iris' ? '#b8860b' : r.aura } },
          ' · ' + r.nome) : null),
      el('button', {
        class: 'btn-pegar',
        onclick: (ev) => { ev.stopPropagation(); pegar(peca.id, no); },
      }, 'Pegar')
    );

    ligarPeca(no, peca, raridade);
    nos.push(no);
  });

  // Entra no mural de cima para baixo: quem está por cima pede a imagem
  // primeiro. Na ordem do estoque a rara vinha antes, carregava antes e passava
  // um instante sozinha na mesa — o garimpo entregue antes de começar.
  mural.append(...nos.sort((a, b) => Number(b.style.zIndex) - Number(a.style.zIndex)));

  if (!nos.length) {
    mural.append(el('div', { class: 'mural-vazio' },
      el('strong', {}, 'A loja está sem estoque.'),
      el('p', {}, catalogo.itens.length
        ? 'Tudo que estava na arara já está no seu guarda-roupa.'
        : 'O acervo ainda não tem peças. Publique pela esteira para elas aparecerem aqui.')
    ));
  }

  if (!catalogo.temContorno && !passThroughInstalado) {
    instalarPassThrough(mural);          // plano B só quando não há contorno
    passThroughInstalado = true;
  }

  if (entrada || !jaChegou) chegar();
  atualizarBadge();
  conferirWishlist();
}

// Arrastar para reorganizar o mural; clique simples abre a ficha. A diferença
// entre os dois é só distância: até 4px o gesto ainda é um clique.
function ligarPeca(no, peca, raridade) {
  no.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.btn-pegar')) return;   // o botão cuida do próprio clique
    e.preventDefault();
    trazerParaFrente(no);

    const area = mural.getBoundingClientRect();
    const inicio = { x: e.clientX, y: e.clientY };
    const base = { x: parseFloat(no.style.left), y: parseFloat(no.style.top) };
    const caixa = no.getBoundingClientRect();
    let arrastou = false;

    no.setPointerCapture(e.pointerId);

    const mover = (ev) => {
      const dx = ev.clientX - inicio.x;
      const dy = ev.clientY - inicio.y;
      if (!arrastou) {
        if (Math.hypot(dx, dy) < 4) return;
        arrastou = true;
        no.classList.add('arrastando');
        fecharFicha();
      }
      // O mural corta o que passa da borda, e peça cortada é peça perdida: o
      // arrasto pára na moldura em vez de deixar a roupa sair da tela.
      const limiteX = Math.max(FOLGA_BORDA, area.width - caixa.width - FOLGA_BORDA);
      const limiteY = Math.max(FOLGA_BORDA, area.height - (caixa.height - RODAPE_PECA) - FOLGA_BORDA);
      no.style.left = Math.round(clamp(base.x + dx, FOLGA_BORDA, limiteX)) + 'px';
      no.style.top = Math.round(clamp(base.y + dy, FOLGA_BORDA, limiteY)) + 'px';
    };

    const soltar = () => {
      no.classList.remove('arrastando');
      no.removeEventListener('pointermove', mover);
      no.removeEventListener('pointerup', soltar);
      no.removeEventListener('pointercancel', soltar);
      if (arrastou) db.guardarPosicao(peca.id, parseFloat(no.style.left), parseFloat(no.style.top));
      else abrirFicha(peca, raridade, no);
    };

    no.addEventListener('pointermove', mover);
    no.addEventListener('pointerup', soltar);
    no.addEventListener('pointercancel', soltar);
  });
}

// --------------------------------- Ficha ---------------------------------
let pecaNaFicha = null;

export function fecharFicha() {
  const ficha = $('#ficha-peca');
  if (ficha) ficha.hidden = true;
  const editar = $('#ficha-editar');
  if (editar) editar.hidden = true;
  pecaNaFicha = null;
}

function abrirFicha(peca, raridade, no) {
  const ficha = $('#ficha-peca');
  if (!ficha) return;
  const r = RARIDADE[raridade];
  pecaNaFicha = peca.id;

  // 116 px de altura é o teto da imagem na ficha (vitrine.css).
  trocarImagem($('#ficha-img'), peca, 116 * proporcao(peca));
  $('#ficha-img').alt = nomeDaPeca(peca);
  $('#ficha-nome').textContent = nomeDaPeca(peca);

  const tag = $('#ficha-rar');
  tag.textContent = r.nome;
  tag.classList.toggle('arco', r.aura === 'arco-iris');
  tag.style.setProperty('--rar-cor', r.aura && r.aura !== 'arco-iris' ? r.aura : '#b3aaa0');

  const partes = [CATEGORIAS[peca.cat]?.nome ?? '—'];
  if (peca.cor?.trim()) partes.push(peca.cor.trim());
  if (peca.marca?.trim()) partes.push(peca.marca.trim());
  $('#ficha-meta').textContent = partes.join(' · ');
  // Raridade que vem todo dia não precisa de chance: só a que pode faltar.
  const chance = chanceNaLoja(r);
  $('#ficha-chance').textContent = [
    estoque.temContador()
      ? `restam ${estoque.restantes(peca.id, raridade)} de ${r.tiragem}`
      : `tiragem de ${r.tiragem}`,
    chance < 100 ? `${r.nome.toLowerCase()} aparece em ${chance}% das lojas` : null,
  ].filter(Boolean).join(' · ');

  // As coleções da peça: um toque leva até elas. Peça que você ainda não tem
  // e que falta numa coleção começada é motivo para pegar.
  const cols = colecoesDaPeca(peca.id);
  const nova = !db.temPeca(peca.id);
  const premio = nova && cols.find(rendeEscolha);
  const falta = nova && cols.some(c => c.tem > 0);
  $('#ficha-colecoes').replaceChildren(
    // O título só aparece quando diz algo: a peça falta numa coleção começada.
    ...(premio || falta ? [el('span', { class: 'col-chips-titulo' },
      premio ? [emo('🎁'), ` Pegue e escolha um item de ${premio.marca}`] : 'Falta na sua coleção')] : []),
    ...cols.map(chipDaColecao));

  const acao = $('#ficha-acao');
  const possuida = db.temPeca(peca.id);
  // O ♡ da wishlist: a loja é um dos poucos lugares onde ela enche.
  $('#ficha-desejo')?.replaceChildren(...(possuida ? [] : [botaoDesejo(peca)]));
  acao.textContent = possuida ? 'Já está no seu closet' : 'Pegar';
  acao.disabled = possuida;
  acao.onclick = () => { pegar(peca.id, no); fecharFicha(); };
  renderCongelar(peca, possuida, no);

  // Admin: editar a ficha da peça sem sair da vitrine — útil para arrumar
  // nome, cor ou tamanho de algo que ficou estranho no mural.
  const editar = $('#ficha-editar');
  if (editar) {
    editar.hidden = !(ADMIN && peca.permanente);
    editar.onclick = () => {
      fecharFicha();
      abrirEditar(pecaDoCatalogo(peca.id), () => montarVitrine());
    };
  }

  ficha.hidden = false;
  posicionarFicha(ficha, no);
}

const seloDeCongelada = () => el('span', { class: 'peca-presa', title: 'Congelada até amanhã' }, ico('cadeado'));

// Congelar: FICHAS.porCongelar fichas prendem a peça na loja até o fim de
// amanhã, mesmo que ela seja reposta. Peça que já é sua não tem o que congelar.
function renderCongelar(peca, possuida, no) {
  const botao = $('#ficha-congelar');
  if (!botao) return;
  botao.hidden = possuida;
  const presa = db.estaCongelada(peca.id);
  const custo = FICHAS.porCongelar;
  botao.disabled = presa;
  botao.replaceChildren(ico('cadeado'), presa ? ' Congelada até amanhã' : ` Congelar · ${custo} fichas`);
  botao.onclick = () => {
    if (!db.podeCongelar()) {
      toast(`Congelar custa ${custo} fichas. Faltam ${custo - db.fichas()}.`);
      return;
    }
    if (!db.congelarPeca(peca.id)) return;
    no.querySelector('.peca-flutua')?.append(seloDeCongelada());
    renderCongelar(peca, possuida, no);
    atualizarBadge();
    toast('Peça congelada: ela fica na loja até o fim de amanhã, mesmo se a loja for reposta.', 'rare');
  };
}

// Encosta a ficha ao lado da peça, virando de lado quando não cabe.
function posicionarFicha(ficha, no) {
  const p = no.getBoundingClientRect();
  const f = ficha.getBoundingClientRect();
  const margemDireita = 110;              // não passa por baixo da barra lateral

  let x = p.right + 14;
  if (x + f.width > window.innerWidth - margemDireita) x = p.left - f.width - 14;
  x = clamp(x, 12, window.innerWidth - f.width - margemDireita);

  const y = clamp(p.top + p.height / 2 - f.height / 2, 12, window.innerHeight - f.height - 12);

  ficha.style.left = Math.round(x) + 'px';
  ficha.style.top = Math.round(y) + 'px';
}

function ligarFicha() {
  $('#ficha-x')?.addEventListener('click', fecharFicha);
  document.addEventListener('pointerdown', (e) => {
    if ($('#ficha-peca')?.hidden) return;
    if (e.target.closest('#ficha-peca') || e.target.closest('.item-roupa')) return;
    fecharFicha();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') fecharFicha();
  });
}

// Peças com pedido de reserva em andamento: clique duplo não gasta dois resgates.
const pegando = new Set();

async function pegar(id, noDOM) {
  const peca = pecaDoCatalogo(id);
  if (!peca || pegando.has(id)) return;

  if (db.temPeca(id)) {
    falarDe('jaTem');
    return;
  }
  if (db.resgatesRestantes(CONFIG.RESGATES_POR_DIA) <= 0) {
    falarDe('acabou');
    toast(db.podeTrocarFichas()
      ? `Resgates de hoje esgotados. Dá para trocar ${FICHAS.porResgate} fichas por mais um em Tarefas.`
      : `Resgates de hoje esgotados. Volta em ${formatarContagem(msAteMeiaNoite())}.`, 'aviso');
    $('#picks-badge')?.classList.add('shake');
    setTimeout(() => $('#picks-badge')?.classList.remove('shake'), 500);
    return;
  }

  // Efeito de coleção vestida: a peça pode vir uma raridade acima (nunca
  // lendária: a tiragem dela é o que dá valor a ela).
  const ef = db.efeitosDoGarimpo();
  let raridade = db.raridadeDoDia(id);
  let subiu = false;
  if (ef.acima && Math.random() < ef.acima / 100) {
    const acima = RARIDADES[RARIDADES.findIndex(r => r.id === raridade) + 1]?.id;
    if (acima && acima !== 'legendary' && !estoque.esgotada(id, acima)) { raridade = acima; subiu = true; }
  }

  // A cópia é reservada no servidor antes de entrar no guarda-roupa: a última
  // lendária disputada por duas pessoas vai para uma só.
  pegando.add(id);
  const reserva = await estoque.levar([{ id, raridade, origem: 'vitrine' }]);
  pegando.delete(id);
  if (estoque.barradaPelaCota(id, raridade)) {
    toast('Você já pegou o máximo de peças de hoje.', 'aviso');
    return;
  }
  if (!estoque.conseguiu(reserva, id, raridade)) {
    toast(`${nomeDaPeca(peca)} esgotou — as ${RARIDADE[raridade].tiragem} cópias já têm dona.`, 'aviso');
    sairDaLoja(noDOM);
    return;
  }
  if (db.temPeca(id)) return;

  const foto = db.fotografarResgate();
  const nova = db.adicionarPeca(peca, { origem: 'vitrine', raridade });
  if (nova) estoque.numerar([nova]);
  const gratis = ef.gratis && Math.random() < ef.gratis / 100;
  const ficha = ef.fichas && Math.random() < ef.fichas / 100;
  if (!gratis) db.state.dia.resgates += 1;
  if (ficha) db.ganharFicha(1);
  db.state.stats.resgates += 1;
  db.progredirMissao('resgates');
  if (['rare', 'epic', 'legendary'].includes(raridade)) db.progredirMissao('raras');
  db.salvar();

  voarParaOCloset(noDOM);
  sairDaLoja(noDOM);
  tocar('pegou', nova.raridade);

  const r = RARIDADE[nova.raridade];
  if (nova.raridade === 'legendary') falarDe('lendario');
  else if (nova.raridade === 'epic' || nova.raridade === 'rare') falarDe('raro');
  else falarDe('pegou');

  avisoComDesfazer(nova.raridade, () => desfazerResgate(nova, foto));
  avisarColecaoDaPeca(id, noDOM);
  if (subiu) toast(`Efeito ${marcaDoEfeito('raridade-acima')}: a peça veio ${r.nome.toLowerCase()}, uma raridade acima.`, nova.raridade);
  if (gratis) toast(`Efeito ${marcaDoEfeito('resgate-gratis')}: este resgate não gastou o limite do dia.`, 'rare');
  if (ficha) toast(`Efeito ${marcaDoEfeito('fichas')}: +1 ficha.`, 'rare');
  atualizarBadge();
}

// Pegou sem querer: 10 segundos para devolver. O aviso do resgate é só o
// botão e a contagem (os segundos e uma barrinha que esvazia): a peça voando
// para o closet já diz o que aconteceu. Tocar devolve a cópia para a loja (no
// servidor, ver estoque.desfazer) e volta o save à foto de antes do toque.
const TEMPO_DE_DESFAZER = 10e3;

function avisoComDesfazer(tipo, desfazer) {
  const stack = document.getElementById('toasts');
  if (!stack) return;
  // Um resgate novo encerra o Desfazer do anterior: dois juntos só empilham.
  for (const velho of stack.querySelectorAll('.toast.desfazer')) velho.fechar?.();
  let feito = false;
  let falta = Math.round(TEMPO_DE_DESFAZER / 1000);
  const segundos = el('span', { class: 'desfazer-seg' }, `${falta}s`);
  const relogio = setInterval(() => { falta = Math.max(0, falta - 1); segundos.textContent = `${falta}s`; }, 1000);
  const sair = () => { clearInterval(relogio); t.classList.remove('show'); setTimeout(() => t.remove(), 300); };
  const t = el('div', { class: `toast desfazer ${tipo}`, style: { '--tempo': TEMPO_DE_DESFAZER + 'ms' } },
    segundos,
    el('button', {
      type: 'button', class: 'desfazer-btn',
      onclick: async (e) => {
        if (feito) return;
        feito = true;
        e.currentTarget.disabled = true;
        await desfazer();
        sair();
      },
    }, 'Desfazer'),
    el('i', { class: 'desfazer-barra', 'aria-hidden': 'true' }));
  t.fechar = () => { feito = true; sair(); };
  stack.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(t.fechar, TEMPO_DE_DESFAZER);
}

async function desfazerResgate(peca, foto) {
  if (!await estoque.desfazer(peca)) {
    toast('Não deu para desfazer: o tempo acabou.', 'aviso');
    return;
  }
  if (!db.desfazerResgate(peca.id, foto)) return;
  montarVitrine();
  atualizarBadge();
  tocar('desfazer');
  toast(`${nomeDaPeca(pecaDoCatalogo(peca.id))} voltou para a loja.`);
}

// O nome da marca no aviso do efeito ("Efeito Puma: ...").
const marcaDoEfeito = (tipo) =>
  COLECOES.filter(c => c.efeito.tipo === tipo).map(c => c.marca).join(' / ') || 'de coleção';

// Resgatar é tirar a peça da arara: o cabide fica vazio. Ela some do mural
// junto com o voo para o closet e não volta no próximo carregamento — o sorteio
// do dia já a exclui. O que ficava aqui antes era a peça apagada com o selo "no
// closet", e a loja terminava o dia cheia de roupa que não estava mais à venda.
function sairDaLoja(no) {
  if (!no) return;
  no.classList.add('saindo');
  no.style.pointerEvents = 'none';
  setTimeout(() => no.remove(), 420);
}

// Animação da peça indo para o ícone do closet na sidebar.
function voarParaOCloset(noDOM) {
  const img = noDOM.querySelector('img');
  const alvo = document.querySelector('.sidebar-btn.inventario');
  if (!img || !alvo) return;
  const acender = () => {
    alvo.classList.add('recebeu');
    setTimeout(() => alvo.classList.remove('recebeu'), 700);
  };
  // Com GSAP a peça vai num arco e o botão acende quando ela chega.
  if (voar(img, alvo, acender)) return;

  const de = img.getBoundingClientRect();
  const para = alvo.getBoundingClientRect();
  const voo = img.cloneNode();
  Object.assign(voo.style, {
    position: 'fixed', left: `${de.left}px`, top: `${de.top}px`,
    width: `${de.width}px`, height: `${de.height}px`,
    margin: '0', zIndex: '9999', pointerEvents: 'none',
    transition: 'all .75s cubic-bezier(.5,-0.1,.4,1)',
  });
  document.body.append(voo);
  requestAnimationFrame(() => {
    Object.assign(voo.style, {
      left: `${para.left + para.width / 2 - 18}px`,
      top: `${para.top + para.height / 2 - 18}px`,
      width: '36px', height: '36px', opacity: '0.2',
      transform: 'rotate(160deg)',
    });
  });
  setTimeout(() => voo.remove(), 800);
  acender();
}

// --------------------------- Ferramentas de admin -------------------------
// Testar o garimpo esbarra em duas esperas: os 3 resgates do dia e a vitrine
// que só troca à meia-noite. Os dois botões pulam as duas, por caminhos
// diferentes — e nenhum deles apaga peça do jogo.

// Repor: estoque novo, sorteado fora da semente do dia. As peças que você já
// pegou continuam suas e não voltam para a arara; a loja se completa com o que
// ainda está à venda no acervo.
export function reporLoja() {
  db.state.dia.resgates = 0;
  db.salvar();
  db.limparPosicoes();
  db.state.dia.estoque = novaSemente();
  sementeArrumacao = novaSemente();
  db.salvar();
  montarVitrine({ entrada: true });
  falarDe('boasVindas');
  toast('Loja reposta: estoque novo e resgates liberados.');
  avisarLojaReposta();
}

// Repor a loja: estoque novo, sorteado fora da semente do dia. Os resgates do
// dia continuam contados e as peças congeladas ficam na arara.
function reporNaLoja() {
  db.limparPosicoes();
  db.state.dia.estoque = novaSemente();
  sementeArrumacao = novaSemente();
  db.salvar();
}

// Ficha de repor a loja (prêmio da trilha de níveis): gasta a ficha e repõe.
export function reporComFicha() {
  if (!db.gastarFichaDeRepor()) return;
  reporNaLoja();
  montarVitrine({ entrada: true });
  falarDe('boasVindas');
  toast('Loja reposta!', 'rare');
}

// Troca FICHAS.porRepor fichas por uma loja nova. Mora em Tarefas, ao lado das
// fichas, como o resgate extra. Leva para a vitrine para ver a arara nova.
export async function trocarFichasPorRepor() {
  if (!db.podeReporComFichas()) {
    toast(`Repor a loja custa ${FICHAS.porRepor} fichas. Faltam ${FICHAS.porRepor - db.fichas()}.`);
    return false;
  }
  const presas = db.congeladas().length;
  const custo = FICHAS.porRepor;
  if (!await confirmar(`Trocar ${custo} das suas ${db.fichas()} fichas por uma arara nova?`
    + (presas ? ' As peças congeladas continuam na loja.' : ''),
    { titulo: 'Repor a loja', sim: `Repor · ${custo} fichas` })) return false;
  if (!db.gastarFichasNoRepor()) return false;
  reporNaLoja();
  irPara('vitrine');
  montarVitrine({ entrada: true });
  falarDe('boasVindas');
  toast('Loja reposta!', 'rare');
  return true;
}

function renderFichaDeRepor() {
  // Só o prêmio da trilha aparece aqui; a troca por fichas mora em Tarefas.
  const botao = $('#btn-repor-ficha');
  if (!botao) return;
  const n = db.fichasDeRepor();
  botao.hidden = !n;
  botao.classList.remove('com-fichas', 'pronto');
  botao.querySelector('b').textContent = n;
  botao.onclick = reporComFicha;
}

// Devolver: o contrário do resgate. As roupas saem do guarda-roupa e voltam a
// ser estoque — as mesmas peças, com a mesma ficha, disponíveis para pegar de
// novo. Nada sai do acervo, e os looks e colagens montados com elas continuam
// de pé (ver db.devolverTudoParaALoja).
export function devolverRoupas() {
  estoque.devolver(db.state.inventario.map(p => ({ id: p.id, raridade: p.raridade })));
  const qtd = db.devolverTudoParaALoja();
  db.limparPosicoes();
  sementeArrumacao = novaSemente();
  db.salvar();
  montarVitrine();
  toast(qtd
    ? `${qtd} ${qtd === 1 ? 'peça devolvida' : 'peças devolvidas'} para a loja — resgates liberados.`
    : 'O guarda-roupa já estava vazio; resgates liberados.');
}

// Os botões são de administração, como o "+ Adicionar peça": quem não entrou
// numa conta de administrador nem os vê. Religar a cada montagem é de graça e
// mantém o estado certo quando o mural é remontado por outra tela.
function ligarAdmin() {
  for (const [sel, acao] of [['#btn-repor', reporLoja], ['#btn-devolver', devolverRoupas]]) {
    const botao = $(sel);
    if (!botao) continue;
    botao.hidden = !ADMIN;
    botao.onclick = acao;
  }
}

export function atualizarBadge() {
  renderFichaDeRepor();
  const restantes = db.resgatesRestantes(CONFIG.RESGATES_POR_DIA);
  const campo = $('#picks-left');
  if (campo) campo.textContent = restantes;
  const badge = $('#picks-badge');
  if (!badge) return;
  // O total é sempre o fixo do dia; o resgate extra aparece só em cima (4/3).
  badge.querySelector('.picks-total').textContent = '/' + CONFIG.RESGATES_POR_DIA;
  badge.classList.toggle('esgotado', restantes === 0);
  // Só fala quando esgota (quando volta); fora isso o número basta.
  badge.querySelector('small').textContent = restantes === 0
    ? `volta em ${formatarContagem(msAteMeiaNoite())}`
    : '';
  badge.onclick = abrirJanelaDosResgates;
  badge.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirJanelaDosResgates(); }
  };
}

// Tocar no contador: quanto falta para os resgates do dia voltarem e de onde
// vieram os que sobraram (os do dia são gastos antes dos das fichas).
function abrirJanelaDosResgates() {
  if (document.querySelector('.resgates-janela')) return;
  db.virarODiaSeNecessario();
  const limite = CONFIG.RESGATES_POR_DIA;
  const restantes = db.resgatesRestantes(limite);
  const deFichas = Math.min(restantes, db.resgatesDeFichas());
  const doDia = restantes - deFichas;
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const linha = (rotulo, valor, extra) => el('div', { class: 'rj-linha' },
    el('span', { class: 'rj-rotulo' }, rotulo),
    el('b', { class: 'rj-valor' }, valor),
    extra ? el('small', {}, extra) : null);

  const conteudo = el('div', { class: 'resgates-janela' },
    el('div', { class: 'rj-relogio' },
      el('small', {}, restantes === 0 ? 'Próximo resgate em' : `Os ${limite} do dia voltam em`),
      el('strong', {}, formatarContagem(msAteMeiaNoite()))),
    el('div', { class: 'rj-lista' },
      linha('Do dia', `${doDia}/${limite}`, 'renovam à meia-noite'),
      linha('Das fichas', String(deFichas), deFichas ? 'não vencem' : 'troque fichas nas missões')),
    el('p', { class: 'rj-total' },
      restantes ? `Você tem ${plural(restantes, 'resgate', 'resgates')} agora.` : 'Seus resgates acabaram por hoje.'));
  mostrar(conteudo, { titulo: 'Seus resgates' });
}

let fichaLigada = false;

export function aoEntrarNaVitrine() {
  if (!fichaLigada) { ligarFicha(); fichaLigada = true; }
  const virou = db.virarODiaSeNecessario();
  // Conta peça, não filho: o aviso de loja vazia também é filho do mural e
  // fazia a vitrine se achar montada.
  if (virou || !mural?.querySelector('.item-roupa')) montarVitrine({ entrada: virou });
  else {
    if (!jaChegou) chegar();
    atualizarBadge();
  }
  falarDe(db.resgatesRestantes(CONFIG.RESGATES_POR_DIA) ? 'boasVindas' : 'acabou');
}

// Quem manda na remontagem é o tamanho do mural, não o da janela. São coisas
// diferentes em dois momentos que importam: no boot, a vitrine é montada antes
// de o navegador fechar o layout, e um mural medido baixo demais espalha as
// peças como se a tela fosse outra — era assim que a roupa acabava pendurada
// para fora. E ao voltar de outra tela, o mural pode ter mudado de tamanho sem
// nenhum `resize` de janela ter acontecido enquanto a vitrine estava escondida.
let observador;
function observarMural() {
  if (observador || typeof ResizeObserver === 'undefined') return;
  observador = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!mural?.offsetParent) return;                   // vitrine escondida
      const { clientWidth: w, clientHeight: h } = mural;
      if (w === tamanhoMontado.w && h === tamanhoMontado.h) return;
      montarVitrine();
    }, 160);
  });
  observador.observe(mural);
}
