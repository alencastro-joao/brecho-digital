// Missões de introdução: o tutorial de conta nova, guiado e em forma de missão.
//
// Abre numa tela em branco que avisa que o tutorial vai começar e, dali, leva a
// pessoa por um passo de cada vez (INTRO em config.js): personagem, a loja e
// as regras dela, pegar a primeira roupa, o closet e as raridades, coleções e
// o resgate do item, vestir o avatar, combos, e o resto do app. Cada passo
// abre sozinho a tela de que fala. Passo que só explica segue no "Entendi";
// passo com ação é missão e paga um prêmio que cresce com a cadeia — XP,
// fichas e peças, até a épica da última. O progresso vem dos mesmos eventos das
// missões do dia (db.progredirMissao), então fazer a coisa antes já conta.
//
// Cumprir a missão entrega o prêmio na hora (num aviso) e já passa para o
// próximo passo, sem tela de prêmio no meio.
//
// O cartão não pode ficar na frente do que a missão pede: a faixa fica em cima
// ou embaixo conforme a missão (`lugar`, em INTRO), qualquer toque fora dela a
// recolhe numa bolinha no canto, e tanto a faixa quanto a bolinha se arrastam.
//
// Começa sozinho na conta nova. Para testar de novo: Perfil › Testes ›
// "Recomeçar missões de introdução", ou abrir o site com ?tutorial.

import { INTRO, RARIDADE, RARIDADES, BAUS, faixasDeTroca, idDaCor } from './config.js';
import { catalogo, nomeDaPeca, imagemDaPeca } from './catalog.js';
import * as db from './db.js';
import * as estoque from './estoque.js';
import { irPara } from './router.js';
import { montarVitrine } from './vitrine.js';
import { abrirColecao } from './colecoes.js';
import { darTrioDaCor } from './presente.js';
import { el, $ } from './util.js';
import { emoHtml, ico } from './icones.js';

let caixa = null;
let modo = 'barra';       // 'boasvindas' | 'aberta' | 'barra' | 'bolha'
let concluindo = false;
// Onde a pessoa arrastou: a faixa só sobe e desce (y), a bolinha vai a
// qualquer lugar. null = o lugar padrão da missão (CSS).
const posicao = { barra: null, bolha: null };
let arrasto = null;
let acabouDeArrastar = false;

export function montarTutorial() {
  $('#btn-tutorial')?.addEventListener('click', () => {
    $('#aj-fechar')?.click();   // fecha o modal de Testes antes
    comecar();
  });
  // Fora da pilha de quem fez a ação: o prêmio remonta a vitrine, e fazer isso
  // no meio do resgate dela atropelaria o próprio resgate.
  db.onIntro(() => setTimeout(() => {
    if (concluirProntas()) passoNovo();
    desenhar();
  }));
  // Tocar em qualquer coisa fora do cartão, numa missão, é ir fazer a missão:
  // ele se recolhe. Em captura e sem impedir nada, então o toque segue para
  // onde foi dado. Passo que só explica não se recolhe: ele espera o Entendi.
  document.addEventListener('pointerdown', (e) => {
    if (caixa && !caixa.contains(e.target) && (modo === 'barra' || modo === 'aberta') && passoAtual()?.evento) {
      modo = 'bolha';
      desenhar();
    }
  }, true);
  concluirProntas();
  desenhar();
}

const passoAtual = () => (db.introAtiva() ? INTRO[db.state.intro.passo] : null);

// O passo da vez acabou de mudar: o cartão abre inteiro e o app vai para a
// tela de que ele fala.
function passoNovo() {
  const m = passoAtual();
  if (!m) return;
  modo = 'aberta';
  irParaMissao(m);
}

// "Entendi" num passo que só explica: segue, e paga em cadeia o que já estiver
// feito adiante.
function entendi() {
  db.avancarIntro();
  concluirProntas();
  passoNovo();
  desenhar();
}

// ?tutorial no endereço: o jeito de testar de qualquer aparelho.
export function pediuTutorialNaUrl() {
  return new URLSearchParams(location.search).has('tutorial');
}

export function comecar() {
  // Tira o ?tutorial do endereço: recarregar não recomeça de novo.
  if (pediuTutorialNaUrl()) history.replaceState(null, '', location.pathname + location.hash);
  modo = 'boasvindas';
  // Recomeçar numa conta de antes do trio da cor: ele entra agora.
  if (!db.state.presenteCor) darTrioDaCor();
  db.comecarIntro();
  // O que já está feito de uma vez por todas conta logo (recomeçar em Testes
  // não pode travar numa escolha que já foi feita, nem no carimbo de hoje).
  const cor = db.state.presenteCor;
  if (cor && db.progressoDasColecoes()[idDaCor(cor)]?.escolhidas.length) db.progredirMissao('colecao');
  if (db.diaCarimbado()) db.progredirMissao('carimbo');
}

// ------------------------------- Prêmios ----------------------------------
// Uma peça por faixa pedida: que você não tem, que não esgotou e que não saiu
// neste mesmo prêmio. Sem nenhuma na faixa, tenta a vizinha (faixasDeTroca).
function sortearPecas(faixas) {
  const escolhidas = new Set();
  const out = [];
  for (const pedida of faixas) {
    for (const faixa of faixasDeTroca(pedida)) {
      const lista = catalogo.itens.filter(it => !escolhidas.has(it.id) &&
        !db.temPeca(it.id) && db.raridadeDoDia(it.id) === faixa && !estoque.esgotada(it.id, faixa));
      if (!lista.length) continue;
      const item = lista[Math.floor(Math.random() * lista.length)];
      escolhidas.add(item.id);
      out.push({ item, raridade: faixa });
      break;
    }
  }
  return out;
}

function entregar(m) {
  const { premio } = m;
  const r = { xp: premio.xp || 0, fichas: premio.fichas || 0, pecas: [], bau: premio.bau || null };
  // Baú vai fechado para a tela de Baús, como todos os outros (o sorteio é na
  // hora de abrir); `pecas` pede uma peça de cada faixa, entregue na hora.
  if (premio.bau) db.guardarBau(premio.bau, 'missao', `Missão: ${m.nome}`);
  for (const { item, raridade } of sortearPecas(premio.pecas || [])) {
    const peca = db.adicionarPeca(item, { origem: 'missao', raridade });
    if (peca) r.pecas.push({ item, peca });
  }
  if (r.fichas) db.ganharFicha(r.fichas);
  if (r.xp) db.ganharXP(r.xp);   // sem motivo: o aviso é o da missão (anunciar)
  db.salvar();
  if (r.pecas.length) {
    const pecas = r.pecas.map(({ peca }) => peca);
    estoque.levar(pecas)
      .then(() => { estoque.numerar(pecas); db.salvar(); });
    montarVitrine();   // a peça ganha sai do mural, se estava nele
  }
  return r;
}

// Paga e avança cada missão da vez que já está feita — em cadeia, porque fazer
// a coisa antes de chegar na missão já vale. avancarIntro avisa os ouvintes, e
// a trava impede que esse aviso entre aqui de novo no meio do laço.
function concluirProntas() {
  if (concluindo) return false;
  concluindo = true;
  let alguma = false;
  try {
    while (db.introPronta()) {
      const passo = db.state.intro.passo;
      const m = INTRO[passo];
      const r = entregar(m);
      const ultima = passo === INTRO.length - 1;
      db.avancarIntro();
      anunciar(m, r, ultima);
      alguma = true;
    }
  } finally {
    concluindo = false;
  }
  return alguma;
}

// Um aviso só por missão, com tudo o que ela pagou: um cartão de prêmio no meio
// da tela. Baú aparece fechado, com o aviso de que foi para a tela de Baús.
// Peça solta vem dentro de um baú da raridade dela, que só mostra o que tem
// depois do toque em "Abrir" (com a mesma animação dos baús de Tarefas). XP e
// fichas aparecem em destaque. Depois de aberto, o cartão some sozinho (ou num
// toque) e, se várias missões fecharem juntas, os cartões entram em fila.
const filaDePremios = [];
let premioNaTela = null;
const TEMPO_NA_TELA = 4600;   // ms com o prêmio à mostra, mais 700 por peça
const BAU_DA_RARIDADE = { common: 'comum', uncommon: 'incomum', rare: 'raro', epic: 'epico', legendary: 'lendario' };

function anunciar(m, r, ultima) {
  const melhor = r.pecas.map(p => p.peca.raridade).sort((a, b) => ordem(b) - ordem(a))[0];
  enfileirar({
    sobre: 'Missão completa', titulo: m.nome, pecas: r.pecas, xp: r.xp, fichas: r.fichas,
    bau: r.bau || (melhor && BAU_DA_RARIDADE[melhor]),
  });
  if (ultima) {
    enfileirar({
      sobre: 'Fim', titulo: 'O tutorial acabou!', tempo: 7000,
      texto: 'Você já sabe tudo o que dá pra fazer aqui. Agora as missões do dia, em Tarefas, continuam dando prêmio. Boas garimpadas!',
    });
  }
}

// O presente por começar o tutorial: as peças da conta nova, com as três da
// mesma cor na frente, dentro de um baú para abrir.
function anunciarPresente() {
  const cor = db.state.presenteCor;
  const daCor = (it) => cor && (it.cor || '').toLowerCase() === cor.toLowerCase();
  const pecas = db.state.inventario
    .filter(p => p.origem === 'presente')
    .map(peca => ({ peca, item: catalogo.porId.get(peca.id) }))
    .filter(p => p.item)
    .sort((a, b) => daCor(b.item) - daCor(a.item));
  if (!pecas.length) return;
  const nDaCor = pecas.filter(p => daCor(p.item)).length;
  enfileirar({
    sobre: 'Presente', titulo: 'Um presente por começar!', pecas, bau: 'presente', tempo: 6000,
    texto: nDaCor >= 3
      ? `As ${nDaCor} peças ${cor.toLowerCase()} já começam a sua coleção ${cor}. Elas ficam no seu closet.`
      : 'Elas ficam no seu closet.',
    marcar: daCor,
  });
}

function enfileirar(cartao) {
  filaDePremios.push(cartao);
  if (!premioNaTela) proximoPremio();
}

function proximoPremio() {
  const vez = filaDePremios.shift();
  if (!vez) { premioNaTela = null; return; }
  const { sobre, titulo, pecas = [], xp = 0, fichas = 0, bau = null, texto = '', tempo = 0, marcar = null } = vez;
  const melhor = pecas.map(p => p.peca.raridade)
    .sort((a, b) => ordem(b) - ordem(a))[0] || 'nenhuma';

  const fotos = pecas.map(({ item, peca }, i) => {
    const rar = RARIDADE[peca.raridade] || RARIDADE.common;
    return el('div', { class: 'premio-peca' + (marcar?.(item) ? ' da-cor' : ''),
        style: { '--cor': rar.cor, '--bg': rar.bg, animationDelay: `${.15 + i * .12}s` } },
      el('div', { class: 'premio-foto' },
        el('img', { ...imagemDaPeca(item, 120), alt: nomeDaPeca(item), decoding: 'async' })),
      el('span', { class: 'premio-rar' }, rar.nome),
      el('span', { class: 'premio-nome' }, nomeDaPeca(item)));
  });
  const bonus = [
    fichas && el('span', { class: 'premio-bonus ficha' }, `+${fichas} ${fichas === 1 ? 'ficha' : 'fichas'}`),
    xp && el('span', { class: 'premio-bonus xp' }, `+${xp} XP`),
  ].filter(Boolean);

  // Com peça: o baú fechado e o botão de abrir; o conteúdo entra depois.
  const fechado = Boolean(bau && fotos.length);
  // Baú ganho sem peça à mostra: foi guardado fechado na tela de Baús.
  const guardado = Boolean(bau && bau !== 'presente' && !fotos.length);
  const caixaDoBau = fechado || guardado
    ? el('div', { class: `bau-caixa premio-bau bau-${bau}` }, ico('presente'))
    : null;
  const nomeDoBau = bau === 'presente' ? 'Presente' : BAUS[bau]?.nome;
  const btnAbrir = fechado
    ? el('button', { type: 'button', class: 'btn-dark premio-abrir' }, `Abrir ${nomeDoBau?.toLowerCase() ?? 'baú'}`)
    : null;
  const conteudo = el('div', { class: 'premio-conteudo' },
    fotos.length ? el('div', { class: 'premio-pecas' + (fotos.length > 3 ? ' muitas' : '') }, fotos) : null,
    bonus.length ? el('div', { class: 'premio-bonus-linha' }, bonus) : null,
    texto ? el('p', { class: 'premio-fim' }, texto) : null,
    guardado ? el('p', { class: 'premio-fim' }, 'Guardado na tela de Baús, em Tarefas.') : null);
  const toque = el('p', { class: 'premio-toque' }, fechado ? '' : 'toque para fechar');

  // O presente fica na cor da paleta; o baú, na cor dele; peça solta, na da raridade.
  const tom = bau === 'presente' ? 'nenhuma'
    : Object.keys(BAU_DA_RARIDADE).find(f => BAU_DA_RARIDADE[f] === bau) || melhor;
  const cartao = el('div', { class: `premio r-${tom}` + (fechado ? ' fechado' : ''), role: 'status' },
    el('div', { class: 'premio-brilho' }),
    el('p', { class: 'premio-sobre' }, sobre),
    el('h2', {}, titulo),
    caixaDoBau, fechado || guardado ? el('p', { class: 'premio-bau-nome' }, nomeDoBau) : null,
    conteudo, btnAbrir, toque);

  let timer = 0;
  let saindo = false;
  const fechar = () => {
    if (saindo) return;
    saindo = true;
    clearTimeout(timer);
    cartao.classList.add('saindo');
    setTimeout(() => { cartao.remove(); proximoPremio(); }, 250);
  };
  const contar = () => { timer = setTimeout(fechar, (tempo || TEMPO_NA_TELA) + fotos.length * 700); };
  const abrir = () => {
    if (!cartao.classList.contains('fechado') || cartao.classList.contains('abrindo')) return;
    cartao.classList.add('abrindo');
    btnAbrir.remove();
    // O baú treme e salta; as peças pulam para fora quando ele some.
    setTimeout(() => {
      cartao.classList.remove('fechado', 'abrindo');
      cartao.classList.add('aberto');
      toque.textContent = 'toque para fechar';
      contar();
    }, 800);
  };
  cartao.addEventListener('click', () => (cartao.classList.contains('fechado') ? abrir() : fechar()));
  if (!fechado) contar();
  premioNaTela = cartao;
  document.body.append(cartao);
}
const ordem = (f) => RARIDADES.findIndex(r => r.id === f);

// ------------------------------- Desenho ----------------------------------
const nomeFaixa = (f) => RARIDADE[f]?.nome?.toLowerCase() ?? f;

function rotuloDoPremio(p) {
  const partes = [];
  if (p.bau) partes.push(BAUS[p.bau].nome.toLowerCase());
  for (const f of p.pecas || []) partes.push(`peça ${nomeFaixa(f)}`);
  if (p.fichas) partes.push(p.fichas === 1 ? '1 ficha' : `${p.fichas} fichas`);
  if (p.xp) partes.push(`${p.xp} XP`);
  return partes.join(' + ');
}

function pontos(passo) {
  return `<div class="intro-pontos">${INTRO.map((_, i) =>
    `<i class="${i < passo ? 'feito' : i === passo ? 'ativo' : ''}"></i>`).join('')}</div>`;
}

// A missão das coleções fala da cor que veio no presente.
const comCor = (texto) => texto.replaceAll('{cor}', (db.state.presenteCor || '').toLowerCase() || 'da mesma cor');

// "Ir para lá": a missão da coleção abre direto a coleção da cor do presente.
function irParaMissao(m) {
  const cor = db.state.presenteCor;
  if (m.ir === 'colecoes' && cor) abrirColecao(idDaCor(cor));
  else irPara(m.ir);
}

// A abertura: uma tela em branco, antes de qualquer outra coisa.
function htmlBoasVindas() {
  return `
    <div class="intro-abertura">
      <span class="intro-logo">BD</span>
      <h2>Bem-vindo ao Brechó Digital!</h2>
      <div class="intro-balao" data-digitar>
        <p class="intro-dica">Vamos começar um tutorial rápido. Você vai criar o seu personagem,
          pegar a sua primeira roupa e conhecer tudo o que dá pra fazer aqui.</p>
        <p class="intro-dica">Cada missão dá um prêmio, e a última é um <b>baú épico</b>.</p>
      </div>
      <button class="btn-dark" data-acao="comecar" type="button">Começar o tutorial</button>
      <button class="link-btn" data-acao="pular" type="button">Pular tutorial</button>
    </div>`;
}

function htmlAberta(m, passo) {
  const missao = Boolean(m.evento);
  return `
    <div class="intro-topo">
      <span class="intro-sobre">${missao ? 'Missão' : 'Tutorial'} · ${passo + 1} de ${INTRO.length}</span>
      ${missao ? '<button class="intro-min" data-acao="minimizar" type="button" aria-label="Minimizar">–</button>' : ''}
    </div>
    <h2>${m.nome}</h2>
    <div class="intro-balao" data-digitar><p class="intro-dica">${comCor(m.dica)}</p></div>
    ${missao ? `<p class="intro-premio">${emoHtml('🎁')} ${rotuloDoPremio(m.premio)}</p>` : ''}
    ${pontos(passo)}
    <div class="intro-acoes">
      <button class="btn-ghost" data-acao="pular" type="button">Pular tutorial</button>
      ${missao
        ? '<button class="btn-dark" data-acao="minimizar" type="button">Bora!</button>'
        : '<button class="btn-dark" data-acao="entendi" type="button">Entendi</button>'}
    </div>`;
}

function htmlBarra(m, passo) {
  const sub = m.evento ? `${emoHtml('🎁')} ${rotuloDoPremio(m.premio)}` : 'toque para ler';
  return `
    <button class="intro-faixa" data-acao="abrir" type="button">
      <span class="intro-num">${passo + 1}/${INTRO.length}</span>
      <span class="intro-texto"><b>${m.nome}</b><small>${sub}</small></span>
    </button>
    <button class="btn-dark" data-acao="ir" type="button">Ir</button>`;
}

function htmlBolha(passo) {
  return `<button class="intro-bolha" data-acao="barra" type="button"
    aria-label="Missão ${passo + 1} de ${INTRO.length}: mostrar">${passo + 1}/${INTRO.length}</button>`;
}

function desenhar() {
  if (!db.introAtiva()) { fechar(); return; }

  if (!caixa) {
    caixa = el('div', { class: 'intro', role: 'region', 'aria-label': 'Missões de introdução' });
    caixa.addEventListener('click', clique);
    caixa.addEventListener('pointerdown', comecarArrasto);
    document.body.append(caixa);
    document.body.classList.add('com-intro');
  }

  const passo = db.state.intro.passo;
  const m = INTRO[passo];
  caixa.dataset.modo = modo;
  caixa.dataset.lugar = modo === 'boasvindas' ? 'baixo' : m.lugar;
  document.body.classList.toggle('intro-embaixo', caixa.dataset.lugar === 'baixo' && modo !== 'bolha');
  caixa.innerHTML =
    modo === 'boasvindas' ? htmlBoasVindas() :
    modo === 'aberta' ? htmlAberta(m, passo) :
    modo === 'bolha' ? htmlBolha(passo) :
    htmlBarra(m, passo);
  digitar(modo === 'boasvindas' || modo === 'aberta' ? `${modo}:${passo}` : null);
  posicionar();
}

// ------------------------------ Digitando ---------------------------------
// O texto do balão aparece letra por letra, como se alguém digitasse. Só na
// primeira vez que aquele balão aparece: redesenhar no meio (um aviso de
// missão, um toque) continua de onde parou, e voltar a um balão já lido mostra
// tudo de uma vez. Um toque no balão termina na hora.
const MS_POR_LETRA = 22;
const lidos = new Set();
let digitando = null;   // { chave, mostradas, timer }

function digitar(chave) {
  if (digitando && digitando.chave !== chave) pararDeDigitar();
  const balao = chave && caixa.querySelector('[data-digitar]');
  if (!balao || lidos.has(chave) ||
      matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // Cada pedaço de texto guarda o conteúdo inteiro e começa vazio; as letras
  // vão sendo devolvidas em ordem, atravessando o <b> e os parágrafos.
  const nos = [];
  const andar = document.createTreeWalker(balao, NodeFilter.SHOW_TEXT);
  while (andar.nextNode()) {
    const n = andar.currentNode;
    nos.push({ n, texto: n.nodeValue });
  }
  const total = nos.reduce((t, x) => t + x.texto.length, 0);
  // O balão já nasce do tamanho do texto inteiro, para o cartão não crescer
  // (e pular) enquanto digita.
  balao.style.minHeight = `${balao.offsetHeight}px`;
  if (!digitando) digitando = { chave, mostradas: 0, timer: 0 };
  clearTimeout(digitando.timer);
  balao.classList.add('digitando');

  const cursor = el('span', { class: 'intro-cursor', 'aria-hidden': 'true' });
  const pintar = () => {
    let resta = digitando.mostradas;
    let ultimo = nos[0]?.n;
    for (const { n, texto } of nos) {
      n.nodeValue = texto.slice(0, Math.max(0, resta));
      if (resta > 0 && texto.trim()) ultimo = n;
      resta -= texto.length;
    }
    ultimo?.after(cursor);
  };
  const passo = () => {
    // Espaços em sequência (a quebra do HTML) contam como um só.
    do digitando.mostradas++;
    while (digitando.mostradas < total && /\s/.test(letraEm(nos, digitando.mostradas)) &&
           /\s/.test(letraEm(nos, digitando.mostradas - 1)));
    pintar();
    if (digitando.mostradas >= total) { terminar(); return; }
    const letra = letraEm(nos, digitando.mostradas - 1);
    digitando.timer = setTimeout(passo, /[.!?:]/.test(letra) ? MS_POR_LETRA * 8 : MS_POR_LETRA);
  };
  const terminar = () => {
    for (const { n, texto } of nos) n.nodeValue = texto;
    cursor.remove();
    balao.classList.remove('digitando');
    lidos.add(chave);
    clearTimeout(digitando.timer);
    digitando = null;
  };
  digitando.terminar = terminar;
  pintar();
  digitando.timer = setTimeout(passo, digitando.mostradas ? MS_POR_LETRA : 180);
}

function letraEm(nos, i) {
  for (const { texto } of nos) {
    if (i < texto.length) return texto[i];
    i -= texto.length;
  }
  return '';
}

function pararDeDigitar() {
  if (!digitando) return;
  clearTimeout(digitando.timer);
  lidos.add(digitando.chave);
  digitando = null;
}

function fechar() {
  pararDeDigitar();
  caixa?.remove();
  caixa = null;
  document.body.classList.remove('com-intro', 'intro-embaixo');
}

// --------------------------------- Arrastar -------------------------------
const tipoDePosicao = () => (modo === 'bolha' ? 'bolha' : modo === 'barra' ? 'barra' : null);

function posicionar() {
  const tipo = tipoDePosicao();
  const p = tipo && posicao[tipo];
  const s = caixa.style;
  s.top = s.left = s.right = s.bottom = '';
  if (!p) return;
  s.top = `${p.y}px`;
  s.bottom = 'auto';
  if (tipo === 'bolha') { s.left = `${p.x}px`; s.right = 'auto'; }
}

function comecarArrasto(e) {
  if (!tipoDePosicao() || e.button > 0) return;
  const r = caixa.getBoundingClientRect();
  arrasto = { x0: e.clientX, y0: e.clientY, top: r.top, left: r.left, w: r.width, h: r.height, movendo: false };
  window.addEventListener('pointermove', moverArrasto);
  window.addEventListener('pointerup', soltarArrasto, { once: true });
  window.addEventListener('pointercancel', soltarArrasto, { once: true });
}

function moverArrasto(e) {
  const a = arrasto;
  if (!a) return;
  const dx = e.clientX - a.x0, dy = e.clientY - a.y0;
  if (!a.movendo && Math.hypot(dx, dy) < 6) return;   // abaixo disso é toque
  a.movendo = true;
  const tipo = tipoDePosicao();
  const y = Math.min(Math.max(4, a.top + dy), innerHeight - a.h - 4);
  const x = Math.min(Math.max(4, a.left + dx), innerWidth - a.w - 4);
  posicao[tipo] = tipo === 'bolha' ? { x, y } : { y };
  posicionar();
}

function soltarArrasto() {
  window.removeEventListener('pointermove', moverArrasto);
  // O click que vem depois de um arrasto não é toque: não abre nem vai.
  if (arrasto?.movendo) acabouDeArrastar = true;
  arrasto = null;
}

function clique(e) {
  if (acabouDeArrastar) { acabouDeArrastar = false; return; }
  const acao = e.target.closest('[data-acao]')?.dataset.acao;
  if (!acao) { if (digitando && e.target.closest('[data-digitar]')) digitando.terminar(); return; }
  if (acao === 'comecar') { passoNovo(); desenhar(); anunciarPresente(); }
  else if (acao === 'entendi') entendi();
  else if (acao === 'abrir') { modo = 'aberta'; desenhar(); }
  else if (acao === 'barra') { modo = 'barra'; desenhar(); }
  else if (acao === 'minimizar') { modo = 'barra'; desenhar(); }
  else if (acao === 'ir') { modo = passoAtual()?.evento ? 'barra' : 'aberta'; irParaMissao(passoAtual()); desenhar(); }
  else if (acao === 'pular') { modo = 'barra'; db.pularIntro(); }
}
