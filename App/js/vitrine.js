// Vitrine do dia — o mural orgânico do brechó.
//
// O estoque é do dia: o sorteio das peças usa a data como semente, então a loja
// tem as mesmas roupas do primeiro ao último acesso do dia. A *arrumação* é
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

import { ADMIN, CONFIG, COLLAB, RARIDADE, RARIDADES, CATEGORIAS, chanceNaLoja, tamanhoNoMural } from './config.js';
import { catalogo, item as pecaDoCatalogo, nomeDaPeca, proporcao, aplicarContorno } from './catalog.js';
import * as db from './db.js';
import * as estoque from './estoque.js';
import { falar, falarDe } from './npc.js';
import { instalarPassThrough, precarregarAlpha } from './alpha.js';
import { criarAura } from './aura.js';
import { abrirEditar } from './editar.js';
import {
  el, $, clamp, pontosPoisson, mulberry32, sementeDoDia, shuffle, hojeISO,
  dataExtenso, msAteMeiaNoite, formatarContagem, toast,
} from './util.js';

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

// A arrumação do mural é sorteada uma vez por carregamento da página: recarregar
// remexe a arara. Dentro da mesma sessão a semente é fixa, senão redimensionar a
// janela (que remonta o mural) jogaria tudo para outro lugar no meio do garimpo.
const novaSemente = () => (Math.random() * 0x100000000) >>> 0;
let sementeArrumacao = novaSemente();
let posicoesLimpas = false;

// Estoque fora do sorteio do dia: é o que o botão de repor (admin) usa para
// trocar a arara sem esperar a virada da meia-noite. `null` = loja do dia.
let sementeEstoque = null;

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

export function poolDoDia(iso = hojeISO()) {
  const rnd = mulberry32(sementeEstoque ?? sementeDoDia(iso));
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
  for (const i of shuffle(candidatas, rnd)) grupos[raridade(i)].push(i);

  const arara = [];
  for (const r of [...RARIDADES].reverse()) {
    if (r.naLoja) arara.push(...grupos[r.id].splice(0, sortearQuantidade(r.naLoja, rnd)));
  }

  // Comum completa o resto; faltando comum, a incomum que sobrou. Rara para cima
  // nunca entra de recheio — ela só vem pela própria tabela.
  const aVenda = (i) => !db.temPeca(i.id);
  const recheio = [...grupos.common, ...grupos.uncommon].filter(aVenda);
  const loja = arara.filter(aVenda);
  return [...loja, ...recheio.slice(0, Math.max(0, CONFIG.PECAS_NA_VITRINE - loja.length))];
}

// A loja tem sempre o mesmo estoque: quantas peças o dono pendurou é regra de
// negócio (CONFIG.PECAS_NA_VITRINE), não conta de quanto cabe na tela. O que a
// janela decide é o *aperto* — a distância mínima entre as âncoras.
//
// Ela nasce do espaçamento natural de 25 âncoras nesta área (a raiz da área por
// peça), com um desconto pequeno. O desconto grande é tentador — quanto menor a
// distância, mais as roupas se encavalam — mas o Bridson cresce a partir de uma
// semente e pára ao completar a conta: com a distância bem abaixo do
// espaçamento natural, as 25 peças cabem todas em volta da semente e o mural
// vira um amontoado num canto, com metade da arara vazia. O encavalamento vem
// de outro lugar: a peça é mais larga que a distância entre as âncoras, e as
// raras ainda ganham alguém por cima em `encobrirAsRaras`.
function apertoDoMural(largura, altura) {
  const area = largura * altura * 0.86;            // desconta cabeçalho e NPC
  const qtd = CONFIG.PECAS_NA_VITRINE;
  const minDist = clamp(Math.sqrt(area / qtd) * 0.92, 118, 230);
  return { qtd, minDist };
}

// O que a peça ocupa no mural é mais que a imagem: o botão "Pegar" (ou o selo
// "no closet") continua no layout mesmo invisível — só a opacidade muda no hover
// — e ele é mais largo que um anel ou um relógio. É essa caixa, e não a imagem,
// que precisa caber no mural.
const RODAPE_PECA = 48;         // botão + margem + a folga da flutuação
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

function medidasDoMural(pecas, largura, altura) {
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
  const fator = clamp(
    Math.min(1, fatorAperto, ...cruas.map(m => Math.min(tetoW / m.w, tetoH / m.h))), 0.34, 1);

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
    y: clamp(p.y, mural.topo, Math.max(mural.topo, mural.h - caixa.h - FOLGA_BORDA)),
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
function caixaDeAura(raridade, src) {
  const aura = criarAura(raridade, src);
  return aura ? el('span', { class: 'aura-cx', 'aria-hidden': 'true' }, aura) : null;
}

export function montarVitrine() {
  mural = $('#vitrine-mural');
  if (!mural) return;

  // Dia novo desfaz a reposição do admin: a loja volta a ser a do dia.
  if (db.virarODiaSeNecessario()) sementeEstoque = null;
  $('#vitrine-data').textContent = dataExtenso(db.state.dia.data);
  ligarAdmin();

  const iso = db.state.dia.data;
  // A arrumação vem da semente da sessão, não da data: quem recarrega a página
  // encontra as mesmas roupas do dia espalhadas de outro jeito.
  const rnd = mulberry32(sementeArrumacao);

  // Peça arrastada volta ao sorteio quando a página recarrega — é justamente o
  // gesto que pede arara nova.
  if (!posicoesLimpas) { db.limparPosicoes(); posicoesLimpas = true; }

  mural.innerHTML = '';
  fecharFicha();

  const largura = mural.clientWidth || window.innerWidth;
  const altura = mural.clientHeight || window.innerHeight;
  tamanhoMontado = { w: largura, h: altura };
  observarMural();
  const { qtd, minDist } = apertoDoMural(largura, altura);

  // A raridade do dia é decidida aqui, antes de pendurar: é ela que dá a ordem
  // da pilha. Rara primeiro — quem entra antes no mural fica embaixo, e a
  // comum, que entra depois, cai por cima.
  const estoque = poolDoDia(iso).slice(0, qtd)
    .map(peca => ({ peca, raridade: db.raridadeDoDia(peca.id, iso) }))
    .sort((a, b) => nivelDe(b.raridade) - nivelDe(a.raridade));
  const pecas = estoque.map(e => e.peca);

  // Mede todo mundo antes de espalhar: o Poisson precisa do tamanho de cada
  // peça para saber onde ela ainda cabe inteira.
  const medidas = medidasDoMural(pecas, largura, altura);

  // Não deixa peça cair atrás do cabeçalho — nem em cima do dono da loja,
  // quando ele está na tela. A faixa do cabeçalho é medida, não chutada: no
  // modo admin ela carrega os botões de administração e fica bem mais larga.
  const acoes = $('.vitrine-acoes')?.getBoundingClientRect().width;
  const zonasProibidas = [
    { x0: largura - (acoes ? acoes + 48 : 210), y0: 0, x1: largura, y1: 104 },
  ];
  if (CONFIG.NPC_VISIVEL) {
    zonasProibidas.push({ x0: 0, y0: altura - 290, x1: 320, y1: altura });
  }

  const pontos = pontosPoisson(pecas.length, largura, altura, {
    padding: 26, paddingTop: 88, itemW: 210, itemH: 250,
    minDist, rnd, excluir: zonasProibidas,
    tamanhos: medidas.map(m => m.caixa),
  });

  encobrirAsRaras(estoque, pontos, medidas,
    { w: largura, h: altura, topo: 88, zonas: zonasProibidas }, rnd);

  const nos = [];
  estoque.forEach(({ peca, raridade }, i) => {
    // O tamanho é só a medida da peça — sem variação aleatória. O mural ganha
    // vida no giro e na flutuação, não no tamanho: sorteá-lo fazia duas
    // camisas de mesma medida aparecerem com tamanhos diferentes na loja.
    const { w, h, caixa } = medidas[i];
    const giro = (rnd() - 0.5) * 11;

    const img = el('img', {
      src: peca.src, alt: nomeDaPeca(peca), loading: 'eager', decoding: 'async',
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
    const pos = {
      x: clamp(bruta.x, FOLGA_BORDA, Math.max(FOLGA_BORDA, largura - caixa.w - FOLGA_BORDA)),
      y: clamp(bruta.y, FOLGA_BORDA, Math.max(FOLGA_BORDA, altura - caixa.h - FOLGA_BORDA)),
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
      }, caixaDeAura(raridade, peca.src), img),
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

  if (!pecas.length) {
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

  atualizarBadge();
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
      const limiteY = Math.max(FOLGA_BORDA, area.height - caixa.height - FOLGA_BORDA);
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

  $('#ficha-img').src = peca.src;
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

  const acao = $('#ficha-acao');
  const possuida = db.temPeca(peca.id);
  acao.textContent = possuida ? 'Já está no seu closet' : 'Pegar';
  acao.disabled = possuida;
  acao.onclick = () => { pegar(peca.id, no); fecharFicha(); };

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
    toast(`Resgates de hoje esgotados. Volta em ${formatarContagem(msAteMeiaNoite())}.`, 'aviso');
    $('#picks-badge')?.classList.add('shake');
    setTimeout(() => $('#picks-badge')?.classList.remove('shake'), 500);
    return;
  }

  // A cópia é reservada no servidor antes de entrar no guarda-roupa: a última
  // lendária disputada por duas pessoas vai para uma só.
  const raridade = db.raridadeDoDia(id);
  pegando.add(id);
  const reserva = await estoque.levar([{ id, raridade }]);
  pegando.delete(id);
  if (!estoque.conseguiu(reserva, id, raridade)) {
    toast(`${nomeDaPeca(peca)} esgotou — as ${RARIDADE[raridade].tiragem} cópias já têm dona.`, 'aviso');
    sairDaLoja(noDOM);
    return;
  }
  if (db.temPeca(id)) return;

  const nova = db.adicionarPeca(peca, { origem: 'vitrine', raridade });
  db.state.dia.resgates += 1;
  db.state.stats.resgates += 1;
  db.progredirMissao('resgates');
  db.salvar();

  voarParaOCloset(noDOM);
  sairDaLoja(noDOM);

  const r = RARIDADE[nova.raridade];
  if (nova.raridade === 'legendary') falarDe('lendario');
  else if (nova.raridade === 'epic' || nova.raridade === 'rare') falarDe('raro');
  else falarDe('pegou');

  toast(`${nomeDaPeca(peca)} — ${r.nome} · foi para o guarda-roupa`, nova.raridade);
  atualizarBadge();
}

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
  alvo.classList.add('recebeu');
  setTimeout(() => alvo.classList.remove('recebeu'), 700);
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
  sementeEstoque = novaSemente();
  sementeArrumacao = novaSemente();
  montarVitrine();
  falarDe('boasVindas');
  toast('Loja reposta: estoque novo e resgates liberados.');
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
  const restantes = db.resgatesRestantes(CONFIG.RESGATES_POR_DIA);
  const campo = $('#picks-left');
  if (campo) campo.textContent = restantes;
  const badge = $('#picks-badge');
  if (!badge) return;
  badge.querySelector('.picks-total').textContent = '/' + CONFIG.RESGATES_POR_DIA;
  badge.classList.toggle('esgotado', restantes === 0);
  badge.querySelector('small').textContent = restantes === 0
    ? `volta em ${formatarContagem(msAteMeiaNoite())}`
    : 'resgates hoje';
}

let fichaLigada = false;

export function aoEntrarNaVitrine() {
  if (!fichaLigada) { ligarFicha(); fichaLigada = true; }
  const virou = db.virarODiaSeNecessario();
  // Conta peça, não filho: o aviso de loja vazia também é filho do mural e
  // fazia a vitrine se achar montada.
  if (virou || !mural?.querySelector('.item-roupa')) montarVitrine();
  else atualizarBadge();
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
