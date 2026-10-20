// Colagem — a mesa de colagem livre.
//
// Diferente do Stylist (que veste um avatar), aqui as peças ficam soltas sobre o
// fundo branco, como nas pranchetas de moda: recorte, enquadramento e assinatura.
//
// Tudo é medido em "unidades de board": a largura é sempre 1000 e a altura vem do
// formato. Assim o que você monta na tela sai idêntico na exportação, em qualquer
// resolução. As coordenadas de cada peça são o centro dela.

import { BOARD, RARIDADE, escalaGrade, escalaMural } from './config.js';
import { grupoDe, gruposDoInventario, seletorDeAgrupamento } from './agrupamento.js';
import { ordenar, preencherComGrupos, seletorDeOrdem } from './ordenacao.js';
import { item as pecaDoCatalogo, nomeDaPeca, proporcao, aplicarContorno,
         srcGrande, pecaCombina } from './catalog.js';
import * as db from './db.js';
import { alturaDe, margemDe, posAssinatura, fonteCss, caixaDoItem, areaUtil } from './boardgeo.js';
import { miniaturaBoard, imagemDoBoard } from './render.js';
import { abrirCompartilhar } from './compartilhar.js';
import { publicarOuGuardar, publicarNoFeed, pacoteDaColagem, jaPublicado } from './publicacoes.js';
import { sortearConjunto, colagemAleatoria } from './sorteio.js';
import { el, $, $$, clamp, toast, teclaLivre, anguloNormal, ehToque, soltarCampo } from './util.js';
import { confirmar, pedirTexto } from './janela.js';
import { ico, emo } from './icones.js';
import { alcaMover } from './alcamover.js';
import { camadaDeAlcas } from './alcas.js';
import { ligarPinca } from './pinca.js';
import { criarDesfazer } from './desfazer.js';
import { criarPainel, idNovo, nomeLivre } from './painelsalvos.js';
import { espalhar } from './movimento.js';

const W = BOARD.W;

// A mesa nasce ao montar a tela (depois do login), não ao importar o módulo:
// a assinatura padrão vem da conta de quem entrou.
let board = null;
let selecao = new Set();
// No celular, selecionar uma peça no palco troca a paleta pelas ferramentas.
// Peça recém-solta pela paleta já nasce selecionada, mas aí a paleta fica:
// quem está soltando peças quer continuar soltando.
let vemDaPaleta = false;
let uidSeq = 1;
let zoom = 1, ajustarSozinho = true;
let catPaleta = 'todas', busca = '';
let montado = false;
let painel = null;
let alcas = null, pinca = null;
// A foto do que foi salvo (ou aberto) por último: "nova" só pergunta se a
// mesa mudou desde então.
let fotoSalva = '';

const H = () => alturaDe(board.formato);
const prancheta = () => $('#prancheta');
const itemDe = (uid) => board.itens.find(i => i.uid === uid);
const selecionados = () => board.itens.filter(i => selecao.has(i.uid));
const livres = () => selecionados().filter(i => !i.travado);
const noDoItem = (it) => prancheta().querySelector(`.pr-item[data-uid="${it.uid}"]`);
const pxPorUnidade = () => (prancheta()?.getBoundingClientRect().width || 1) / W;

// A colagem aceita dois tipos de item: peca (imagem) e etiqueta (texto).
const ehTexto = (it) => it.tipo === 'texto';
const propDoItem = (it) => ehTexto(it)
  ? (it.w || 1) / (it.tamanho * 1.25)
  : proporcao(pecaDoCatalogo(it.itemId));
const nomeDoItem = (it) => ehTexto(it) ? `Texto: ${it.texto}` : nomeDaPeca(pecaDoCatalogo(it.itemId));

// Mede a etiqueta no mesmo referencial das unidades do board: como a medicao usa
// a fonte em `tamanho` px, a largura ja sai em unidades.
const reguaTexto = document.createElement('canvas').getContext('2d');
function medirTexto(it) {
  reguaTexto.font = it.tamanho + 'px ' + fonteCss(it.fonte);
  it.w = Math.max(20, reguaTexto.measureText(it.texto || ' ').width);
  return it.w;
}

function novaColagem() {
  return {
    id: null,
    nome: '',
    formato: BOARD.FORMATO_PADRAO,
    margem: BOARD.MARGEM_PADRAO,
    assinatura: {
      ...db.state.usuario.assinatura,
      texto: db.state.usuario.assinatura.texto || db.state.usuario.nome || '',
    },
    itens: [],
    guias: { h: [], v: [] },
  };
}

// --------------------------- Histórico (undo/redo) ------------------------
const hist = criarDesfazer({
  foto: () => JSON.stringify(board),
  restaurar: (json) => {
    board = JSON.parse(json);
    selecao.clear();
    render();
  },
  aoMudar: () => atualizarBarra(),
});
// `gesto`: rodinha, setas e sliders viram um passo só enquanto duram.
const mudanca = (gesto = null) => (gesto ? hist.marcarJunto(gesto) : hist.marcar());

// O que conta para "mudou desde o último salvar": a mesa sem os uid.
const fotoDaMesa = () => JSON.stringify(dadosLimpos());
const temMudanca = () => board.itens.length > 0 && fotoDaMesa() !== fotoSalva;

// =============================== Montagem ================================
export function montarBoard() {
  if (montado) return;
  montado = true;
  board ??= novaColagem();
  fotoSalva = fotoDaMesa();

  preencherSelects();
  ligarControles();
  ligarPalco();
  ligarReguas();
  ligarTeclado();
  montarPaleta();
  montarMinhasColagens();

  alcas = camadaDeAlcas(prancheta(), {
    classe: 'bd-alcas',
    aoPegar: (e, uid) => {
      const it = itemDe(uid);
      if (it) iniciarManipulacao(e, it, noDoItem(it));
    },
  });
  pinca = ligarPinca(prancheta(), {
    comecar: () => {
      const alvos = livres();
      if (!alvos.length) return null;
      mudanca();
      return { antes: fotoDosItens(alvos), centro: centroDe(alvos) };
    },
    mudar: (s, fator, graus) => {
      transformarGrupo(s.antes, s.centro, { fator, graus });
      s.antes.forEach(a => posicionarItem(a.ref));
      agendarFerramentas();
    },
  });

  render();

  // Só no celular: ⇅ mostra o agrupar, a ordem e a busca da paleta, e ⚙ troca
  // a paleta pelas ferramentas (seleção, arranjo, assinatura).
  $('#board-ajustes').addEventListener('click', (e) => {
    const aberto = $('.board-palette').classList.toggle('abertas');
    e.currentTarget.setAttribute('aria-expanded', String(aberto));
  });
  $('#bd-ferramentas').addEventListener('click', (e) => {
    const aberto = $('.view-board').classList.toggle('com-ferramentas');
    e.currentTarget.setAttribute('aria-expanded', String(aberto));
  });

  new ResizeObserver(() => { if (ajustarSozinho) encaixar(); })
    .observe($('#board-scroll'));

  // As fontes da etiqueta chegam depois da primeira medida: mede de novo.
  document.fonts?.ready.then(() => {
    board.itens.filter(ehTexto).forEach(medirTexto);
    posicionarTodos();
    renderAssinatura();
  });
}

function preencherSelects() {
  const fonte = $('#bd-fonte');
  fonte.innerHTML = '';
  for (const f of BOARD.FONTES) fonte.append(el('option', { value: f.id }, f.nome));

  const fonteTexto = $('#bd-texto-fonte');
  fonteTexto.innerHTML = '';
  for (const f of BOARD.FONTES) fonteTexto.append(el('option', { value: f.id }, f.nome));

  const pos = $('#bd-pos-assinatura');
  pos.innerHTML = '';
  for (const p of BOARD.POSICOES_ASSINATURA) pos.append(el('option', { value: p.id }, p.nome));
}

// ================================ Paleta =================================
function montarPaleta() {
  const abas = $('#board-cats');
  abas.innerHTML = '';
  const total = db.state.inventario.length;
  const grupos = gruposDoInventario();
  // Grupo que deixou de existir (trocou peça ↔ corpo) ou esvaziou: volta a tudo.
  if (catPaleta !== 'todas' && !grupos.some(g => g.id === catPaleta && g.qtd)) catPaleta = 'todas';

  $('#board-agrupar').replaceChildren(seletorDeAgrupamento(() => {
    catPaleta = 'todas';
    montarPaleta();
  }));
  $('#board-ordem').replaceChildren(seletorDeOrdem(() => montarPaleta()));

  abas.append(el('button', {
    type: 'button',
    class: 'pal-cat' + (catPaleta === 'todas' ? ' active' : ''),
    title: 'Todas as peças',
    'aria-label': `Todas as peças, ${total}`,
    'aria-pressed': String(catPaleta === 'todas'),
    onclick: () => { catPaleta = 'todas'; montarPaleta(); },
  }, ico('brilho'), el('small', {}, String(total))));

  for (const g of grupos) {
    if (!g.qtd) continue;
    abas.append(el('button', {
      type: 'button',
      class: 'pal-cat' + (g.id === catPaleta ? ' active' : ''),
      title: g.nome,
      'aria-label': `${g.nome}, ${g.qtd}`,
      'aria-pressed': String(g.id === catPaleta),
      onclick: () => { catPaleta = g.id; montarPaleta(); },
    }, emo(g.icone), el('small', {}, String(g.qtd))));
  }

  const grid = $('#board-grid');
  grid.innerHTML = '';
  if (!total) {
    grid.append(el('p', { class: 'palette-vazia' },
      'Guarda-roupa vazio. Garimpe na vitrine primeiro.'));
    return;
  }

  const pecas = ordenar(db.state.inventario
    .filter(p => catPaleta === 'todas' || grupoDe(p) === catPaleta)
    .filter(p => pecaCombina(p, busca)));

  if (!pecas.length) {
    grid.append(el('p', { class: 'palette-vazia' },
      busca.trim() ? `Nenhuma peça com "${busca.trim()}".` : 'Nada aqui com esse filtro.'));
    return;
  }

  const acao = ehToque() ? 'toque' : 'clique';
  preencherComGrupos(grid, pecas, (p) => {
    const peca = pecaDoCatalogo(p.id);
    if (!peca) return null;
    const img = el('img', { src: peca.src, alt: '', loading: 'lazy' });
    aplicarContorno(img, peca);
    // A raridade pinta o bloco no celular, como na grade do closet.
    const r = RARIDADE[p.raridade] || RARIDADE.common;
    return el('button', {
      type: 'button',
      class: `pal-item r-${p.raridade || 'common'}`, title: `${nomeDaPeca(peca)} — ${acao} para soltar`,
      'aria-label': `Soltar ${nomeDaPeca(peca)} na colagem`,
      style: { '--rar-borda': r.aura && r.aura !== 'arco-iris' ? r.aura : r.cor },
      onclick: () => adicionar(p.id),
    }, el('div', {
      class: 'peca-caixa',
      style: { '--esc': String(escalaGrade(peca)) },
    }, img));
  }, { categoriaAberta: catPaleta !== 'todas' });
}

// ============================== Peças no board ============================
// O lugar mais vazio da área útil para uma caixa de w × h: testa uma grade de
// casas e fica com a que menos encosta nas peças que já estão lá. Assim a
// colagem nasce ocupada, e a 13ª peça não cai em cima da 1ª.
function lugarLivre(w, h) {
  const area = areaUtil(board, W, H());
  const caixas = board.itens.map(i => caixaDoItem(i, propDoItem(i)));
  const cols = 4, linhas = 5;
  const cw = (area.x1 - area.x0) / cols, ch = (area.y1 - area.y0) / linhas;
  let melhor = null;
  for (let l = 0; l < linhas; l++) {
    for (let c = 0; c < cols; c++) {
      const x = clamp(area.x0 + cw * (c + 0.5), area.x0 + w / 2, area.x1 - w / 2);
      const y = clamp(area.y0 + ch * (l + 0.5), area.y0 + h / 2, area.y1 - h / 2);
      let encosta = 0;
      for (const b of caixas) {
        const dx = Math.min(x + w / 2, b.x + b.w / 2) - Math.max(x - w / 2, b.x - b.w / 2);
        const dy = Math.min(y + h / 2, b.y + b.h / 2) - Math.max(y - h / 2, b.y - b.h / 2);
        if (dx > 0 && dy > 0) encosta += dx * dy;
      }
      if (!melhor || encosta < melhor.encosta) melhor = { x, y, encosta };
      if (melhor.encosta === 0) break;
    }
    if (melhor?.encosta === 0) break;
  }
  // Um empurrãozinho para não ficar tudo alinhado demais.
  return {
    x: melhor.x + (Math.random() - 0.5) * cw * 0.12,
    y: melhor.y + (Math.random() - 0.5) * ch * 0.12,
  };
}

const zDoTopo = () => Math.max(0, ...board.itens.map(i => i.z)) + 1;

export function adicionar(itemId) {
  const peca = pecaDoCatalogo(itemId);
  if (!peca || !board) return;
  mudanca();

  const area = areaUtil(board, W, H());
  const w = Math.round(Math.min((area.x1 - area.x0) / 3.6, 240) * escalaMural(peca));
  const { x, y } = lugarLivre(w, w / proporcao(peca));

  const it = {
    uid: 'b' + (uidSeq++),
    itemId,
    cat: peca.cat,
    x, y, w,
    rot: 0,
    flip: false,
    opacidade: 100,
    sombra: db.state.usuario.preferencias.sombra,
    travado: false,
    z: zDoTopo(),
  };
  board.itens.push(it);
  selecao = new Set([it.uid]);
  vemDaPaleta = true;
  render();
}

// A etiqueta pergunta o texto na hora (no celular não há campo à vista) e
// nasce num canto vazio da colagem.
export async function adicionarTexto() {
  vemDaPaleta = false;
  const texto = await pedirTexto('Duplo clique na etiqueta muda o texto depois.',
    { titulo: 'Texto da etiqueta', sim: 'Pôr na colagem', max: 60 });
  if (!texto?.trim()) return;
  mudanca();
  const it = {
    uid: 'b' + (uidSeq++),
    tipo: 'texto',
    texto: texto.trim(),
    fonte: board.assinatura.fonte,
    tamanho: 54,
    cor: '#1a1a1a',
    x: 0, y: 0,
    rot: 0,
    flip: false,
    opacidade: 100,
    sombra: false,       // texto com sombra costuma sujar; fica desligado
    travado: false,
    z: zDoTopo(),
  };
  medirTexto(it);
  Object.assign(it, lugarLivre(it.w, it.tamanho * 1.25));
  board.itens.push(it);
  selecao = new Set([it.uid]);
  render();
}

async function editarTexto(it) {
  if (!ehTexto(it) || it.travado) return;
  const texto = await pedirTexto('', { titulo: 'Texto da etiqueta', sim: 'Trocar', valor: it.texto, max: 60 });
  if (texto === null || !texto.trim() || texto.trim() === it.texto) return;
  mudanca();
  it.texto = texto.trim();
  medirTexto(it);
  posicionarItem(it);
  atualizarFerramentas();
}

function removerSelecionados() {
  const alvos = livres();
  if (!alvos.length) return;
  mudanca();
  const ids = new Set(alvos.map(i => i.uid));
  board.itens = board.itens.filter(i => !ids.has(i.uid));
  selecao.clear();
  render();
}

function duplicarSelecionados() {
  const alvos = selecionados().sort((a, b) => a.z - b.z);
  if (!alvos.length) return;
  mudanca();
  // A cópia de um grupo é um grupo novo; cada peça vai para o topo, na ordem.
  const novosGrupos = new Map();
  let z = zDoTopo();
  const novos = alvos.map(o => ({
    ...o, uid: 'b' + (uidSeq++),
    x: o.x + 40, y: o.y + 40,
    z: z++,
    travado: false,
    grupo: o.grupo ? (novosGrupos.get(o.grupo) ?? novosGrupos.set(o.grupo, 'g' + (uidSeq++)).get(o.grupo)) : undefined,
  }));
  board.itens.push(...novos);
  selecao = new Set(novos.map(i => i.uid));
  render();
}

// ================================ Desenho =================================
function render() {
  if (!prancheta() || !board) return;
  const alt = H();
  prancheta().style.setProperty('--ar', String(W / alt));
  $('#prancheta-wrap').style.width = larguraAlvo() + 'px';

  renderItens();
  renderAssinatura();
  renderGuias();
  renderReguas();
  renderMargem();
  sincronizarControles();
  atualizarFerramentas();
  atualizarBarra();
  renderLista();
}

function larguraAlvo() {
  const area = $('#board-scroll');
  const alt = H();
  // No celular não há réguas: a folga é só o padding do painel (onde ficam
  // os botões), para a colagem ocupar todo o resto.
  let folgaW = 104, folgaH = 120;
  if (area && matchMedia('(max-width: 900px)').matches) {
    const cs = getComputedStyle(area);
    folgaW = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    folgaH = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  }
  const dispW = Math.max(200, (area?.clientWidth || 900) - folgaW);
  const dispH = Math.max(200, (area?.clientHeight || 700) - folgaH);
  const base = Math.min(dispW, dispH * (W / alt));
  return Math.round(base * zoom);
}

function encaixar() {
  ajustarSozinho = true;
  zoom = 1;
  $('#prancheta-wrap').style.width = larguraAlvo() + 'px';
  renderReguas();
  renderAssinatura();
  posicionarTodos();
  atualizarBarra();
}

// Reaproveita o nó de quem já estava na mesa (a imagem não carrega de novo);
// só quem chegou ganha nó novo. A ordem no DOM segue o z.
function renderItens() {
  const raiz = $('#pr-itens');
  const vivos = new Map($$('.pr-item', raiz).map(n => [n.dataset.uid, n]));
  for (const it of [...board.itens].sort((a, b) => a.z - b.z)) {
    let no = vivos.get(it.uid);
    vivos.delete(it.uid);
    if (!no || no.dataset.item !== (it.itemId || 'texto')) {
      no?.remove();
      no = criarItemDOM(it);
    } else {
      posicionarItem(it, no);
    }
    no.classList.toggle('selecionado', selecao.has(it.uid));
    raiz.append(no);
  }
  for (const n of vivos.values()) n.remove();
}

function criarItemDOM(it) {
  let conteudo;
  if (ehTexto(it)) {
    conteudo = el('span', { class: 'pr-texto' }, it.texto);
  } else {
    const peca = pecaDoCatalogo(it.itemId);
    // Na prancheta a peça cresce na mão: vai a grande desde o começo.
    conteudo = el('img', { src: srcGrande(peca), alt: '', draggable: 'false' });
    aplicarContorno(conteudo, peca);
  }

  // A peça recebe foco (Tab) e Enter ou espaço a escolhem; na etiqueta,
  // Enter muda o texto.
  const no = el('div', {
    class: 'pr-item' + (ehTexto(it) ? ' pr-item-texto' : ''),
    tabindex: '0', role: 'button',
    dataset: { uid: it.uid, item: it.itemId || 'texto' },
  }, conteudo);

  const meu = () => itemDe(no.dataset.uid);
  no.addEventListener('pointerdown', (e) => { const k = meu(); if (k) iniciarManipulacao(e, k, no); });
  no.addEventListener('dblclick', () => { const k = meu(); if (k) editarTexto(k); });
  no.addEventListener('focus', () => {
    const k = meu();
    if (k && !selecao.has(k.uid)) { selecao = new Set(doGrupo([k.uid])); marcarSelecaoNoDOM(); atualizarFerramentas(); }
  });
  no.addEventListener('keydown', (e) => {
    const k = meu();
    if (e.key === 'Enter' && k && ehTexto(k)) { e.preventDefault(); editarTexto(k); }
  });
  no.addEventListener('wheel', (e) => {
    const k = meu();
    if (!k || !selecao.has(k.uid) || k.travado) return;
    e.preventDefault();
    mudanca('roda');
    const f = e.deltaY < 0 ? 1.06 : 0.94;
    const alvos = livres();
    transformarGrupo(fotoDosItens(alvos), centroDe(alvos), { fator: f });
    alvos.forEach(a => posicionarItem(a));
    atualizarFerramentas();
  }, { passive: false });

  posicionarItem(it, no);
  return no;
}

function posicionarItem(it, no = null) {
  const alvo = no || noDoItem(it);
  if (!alvo) return;
  const alt = H();
  if (ehTexto(it)) {
    const span = alvo.querySelector('.pr-texto');
    span.textContent = it.texto;
    span.style.fontFamily = fonteCss(it.fonte);
    span.style.fontSize = (it.tamanho * pxPorUnidade()) + 'px';
    span.style.color = it.cor;
  }
  const h = it.w / propDoItem(it);
  alvo.style.left = (it.x / W * 100) + '%';
  alvo.style.top = (it.y / alt * 100) + '%';
  alvo.style.width = (it.w / W * 100) + '%';
  alvo.style.height = (h / alt * 100) + '%';
  alvo.style.zIndex = String(it.z);
  alvo.style.opacity = String((it.opacidade ?? 100) / 100);
  alvo.style.transform = `translate(-50%, -50%) rotate(${it.rot}deg)`;
  alvo.classList.toggle('com-sombra', !!it.sombra);
  alvo.classList.toggle('travado', !!it.travado);
  alvo.setAttribute('aria-label', nomeDoItem(it) + (it.travado ? ' (travada)' : ''));
  const arte = alvo.querySelector('img');
  if (arte) arte.style.transform = it.flip ? 'scaleX(-1)' : '';
}

const posicionarTodos = () => board?.itens.forEach(i => posicionarItem(i));

function renderAssinatura() {
  const caixa = $('#pr-assinatura');
  caixa.innerHTML = '';
  const a = board.assinatura;
  if (!a.visivel || !a.texto.trim()) return;

  const alt = H();
  const p = posAssinatura(board, W, alt);
  const u = pxPorUnidade();
  const span = el('span', {}, a.texto);
  Object.assign(span.style, {
    left: (p.x / W * 100) + '%',
    top: (p.y / alt * 100) + '%',
    fontFamily: fonteCss(a.fonte),
    fontSize: (a.tamanho * u) + 'px',
    letterSpacing: (a.espaco * u) + 'px',
    color: a.cor,
    transform: p.align === 'centro' ? 'translate(-50%, -100%)'
             : p.align === 'direita' ? 'translate(-100%, -100%)' : 'translate(0, -100%)',
  });
  caixa.append(span);
}

function renderMargem() {
  const m = $('#pr-margem');
  const ligado = $('#bd-margem').checked;
  m.style.display = ligado ? 'block' : 'none';
  m.style.setProperty('--m', (board.margem / W * 100) + '%');
  const g = $('#pr-grade');
  g.style.display = $('#bd-grade').checked ? 'block' : 'none';
  g.style.backgroundImage =
    'linear-gradient(rgba(18,181,203,.28) 1px, transparent 1px),' +
    'linear-gradient(90deg, rgba(18,181,203,.28) 1px, transparent 1px)';
  g.style.backgroundSize = '5% 4%, 5% 4%';
}

function renderGuias() {
  const alt = H();
  const caixa = $('#pr-guias');
  caixa.innerHTML = '';
  board.guias.h.forEach((y, i) => {
    const g = el('div', { class: 'guia guia-h', style: { top: (y / alt * 100) + '%' } });
    g.addEventListener('pointerdown', (e) => arrastarGuia(e, 'h', i));
    g.addEventListener('dblclick', () => { mudanca(); board.guias.h.splice(i, 1); render(); });
    caixa.append(g);
  });
  board.guias.v.forEach((x, i) => {
    const g = el('div', { class: 'guia guia-v', style: { left: (x / W * 100) + '%' } });
    g.addEventListener('pointerdown', (e) => arrastarGuia(e, 'v', i));
    g.addEventListener('dblclick', () => { mudanca(); board.guias.v.splice(i, 1); render(); });
    caixa.append(g);
  });
}

function renderReguas() {
  const alt = H();
  const rh = $('#regua-h'), rv = $('#regua-v');
  rh.innerHTML = ''; rv.innerHTML = '';
  const passo = 25;
  for (let u = 0; u <= W; u += passo) {
    const maior = u % 100 === 0;
    rh.append(el('span', { class: 'tick' + (maior ? ' maior' : ''), style: { left: (u / W * 100) + '%' } }));
    if (maior && u) rh.append(el('span', { class: 'num', style: { left: (u / W * 100) + '%' } }, String(u)));
  }
  for (let u = 0; u <= alt; u += passo) {
    const maior = u % 100 === 0;
    rv.append(el('span', { class: 'tick' + (maior ? ' maior' : ''), style: { top: (u / alt * 100) + '%' } }));
    if (maior && u) rv.append(el('span', { class: 'num', style: { top: (u / alt * 100) + '%' } }, String(u)));
  }
}

// ============================== Manipulação ===============================
function unidadesX(rect, px) { return px / rect.width * W; }
function unidadesY(rect, px) { return px / rect.height * H(); }

// Peça de um grupo vem com o grupo inteiro.
function doGrupo(uids) {
  const grupos = new Set(uids.map(u => itemDe(u)?.grupo).filter(Boolean));
  if (!grupos.size) return uids;
  return [...new Set([...uids, ...board.itens.filter(i => grupos.has(i.grupo)).map(i => i.uid)])];
}

const fotoDosItens = (alvos) =>
  alvos.map(s => ({ ref: s, x: s.x, y: s.y, w: s.w, rot: s.rot, tamanho: s.tamanho }));

function centroDe(alvos) {
  const n = alvos.length || 1;
  return { x: alvos.reduce((t, a) => t + a.x, 0) / n, y: alvos.reduce((t, a) => t + a.y, 0) / n };
}

// Escala e giro do grupo em volta do centro dele: cada peça soma o giro ao
// que já tinha (não fica todo mundo no mesmo ângulo) e se afasta ou se
// aproxima do centro junto com o tamanho. Com uma peça só, o centro é ela.
function transformarGrupo(antes, centro, { fator = 1, graus = 0 }) {
  const rad = graus * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  // O limite de tamanho vale para o grupo inteiro, senão as peças se
  // desencontrariam quando uma batesse no limite.
  let f = fator;
  for (const a of antes) {
    if (ehTexto(a.ref)) f = clamp(f, 12 / (a.tamanho ?? 54), 260 / (a.tamanho ?? 54));
    else f = clamp(f, 40 / a.w, 1000 / a.w);
  }
  for (const a of antes) {
    const dx = (a.x - centro.x) * f, dy = (a.y - centro.y) * f;
    a.ref.x = centro.x + dx * cos - dy * sin;
    a.ref.y = centro.y + dx * sin + dy * cos;
    a.ref.rot = Math.round(anguloNormal(a.rot + graus));
    if (ehTexto(a.ref)) { a.ref.tamanho = (a.tamanho ?? 54) * f; medirTexto(a.ref); }
    else a.ref.w = a.w * f;
  }
}

function iniciarManipulacao(e, it, no) {
  if (!no || e.button > 0) return;
  e.preventDefault();
  soltarCampo();
  e.stopPropagation();

  const alca = e.target.dataset?.alca;
  // Tocar numa peça (mesmo a que acabou de cair da paleta) abre as ferramentas.
  if (vemDaPaleta) { vemDaPaleta = false; atualizarFerramentas(); }
  if (!selecao.has(it.uid)) {
    const doMesmo = doGrupo([it.uid]);
    if (e.shiftKey) doMesmo.forEach(u => selecao.add(u));
    else selecao = new Set(doMesmo);
    marcarSelecaoNoDOM();
    atualizarFerramentas();
  } else if (e.shiftKey && !alca) {
    doGrupo([it.uid]).forEach(u => selecao.delete(u));
    marcarSelecaoNoDOM();
    atualizarFerramentas();
    return;
  }
  if (it.travado) return;

  const rect = prancheta().getBoundingClientRect();
  const alvos = livres();
  const antes = fotoDosItens(alvos);
  // Girar e redimensionar contam a partir do centro do grupo escolhido.
  const c = alca ? centroDe(alvos) : it;
  const centro = {
    x: rect.left + (c.x / W) * rect.width,
    y: rect.top + (c.y / H()) * rect.height,
  };
  const raio0 = Math.hypot(e.clientX - centro.x, e.clientY - centro.y) || 1;
  const ang0 = Math.atan2(e.clientY - centro.y, e.clientX - centro.x);
  const inicio = { x: e.clientX, y: e.clientY };
  const centroU = centroDe(alvos);

  let mexeu = false;
  no.setPointerCapture(e.pointerId);
  no.classList.add('arrastando');

  const mover = (ev) => {
    if (pinca?.ativa()) return;
    // Um tremor de dedo de 3px não é arrasto: não suja o histórico.
    if (!mexeu && Math.hypot(ev.clientX - inicio.x, ev.clientY - inicio.y) < 3) return;
    if (!mexeu) { mudanca(); mexeu = true; }

    if (alca === 'esc') {
      const raio = Math.hypot(ev.clientX - centro.x, ev.clientY - centro.y);
      transformarGrupo(antes, centroU, { fator: clamp(raio / raio0, 0.1, 8) });
    } else if (alca === 'rot') {
      const ang = Math.atan2(ev.clientY - centro.y, ev.clientX - centro.x);
      let g = (ang - ang0) * 180 / Math.PI;
      // Shift: a peça que se puxou para de 15 em 15°; o grupo gira junto.
      if (ev.shiftKey) {
        const base = antes.find(a => a.ref === it)?.rot ?? 0;
        g = Math.round((base + g) / 15) * 15 - base;
      }
      transformarGrupo(antes, centroU, { graus: g });
    } else {
      let dx = unidadesX(rect, ev.clientX - inicio.x);
      let dy = unidadesY(rect, ev.clientY - inicio.y);

      if ($('#bd-ima').checked && !ev.altKey) {
        const ajuste = calcularIma(antes, dx, dy);
        dx += ajuste.dx; dy += ajuste.dy;
        mostrarImas(ajuste.linhas);
      }
      for (const a of antes) {
        a.ref.x = clamp(a.x + dx, -200, W + 200);
        a.ref.y = clamp(a.y + dy, -200, H() + 200);
      }
    }
    antes.forEach(a => posicionarItem(a.ref));
    agendarFerramentas();
  };

  const soltar = () => {
    no.classList.remove('arrastando');
    limparImas();
    no.removeEventListener('pointermove', mover);
    no.removeEventListener('pointerup', soltar);
    no.removeEventListener('pointercancel', soltar);
    atualizarFerramentas();
  };

  no.addEventListener('pointermove', mover);
  no.addEventListener('pointerup', soltar);
  no.addEventListener('pointercancel', soltar);
}

// Ímã: encosta bordas e centros nas guias, na margem, no meio e nas outras peças.
function calcularIma(antes, dx, dy) {
  const alt = H();
  const m = board.margem;
  const movidos = new Set(antes.map(a => a.ref.uid));

  const alvosV = [0, m, W / 2, W - m, W, ...board.guias.v];
  const alvosH = [0, m, alt / 2, alt - m, alt, ...board.guias.h];
  for (const it of board.itens) {
    if (movidos.has(it.uid)) continue;
    const c = caixaDoItem(it, propDoItem(it));
    alvosV.push(c.x - c.w / 2, c.x, c.x + c.w / 2);
    alvosH.push(c.y - c.h / 2, c.y, c.y + c.h / 2);
  }

  // A tolerância é medida em pixels de tela e convertida para unidades: assim o
  // ímã "puxa" igual com o board pequeno ou ampliado.
  const lim = BOARD.SNAP / Math.max(0.05, pxPorUnidade());
  let melhorX = { d: lim + 1, ajuste: 0, linha: null };
  let melhorY = { d: lim + 1, ajuste: 0, linha: null };

  for (const a of antes) {
    const c = caixaDoItem({ ...a.ref, x: a.x + dx, y: a.y + dy }, propDoItem(a.ref));
    for (const borda of [c.x - c.w / 2, c.x, c.x + c.w / 2]) {
      for (const alvo of alvosV) {
        const d = Math.abs(alvo - borda);
        if (d < melhorX.d) melhorX = { d, ajuste: alvo - borda, linha: alvo };
      }
    }
    for (const borda of [c.y - c.h / 2, c.y, c.y + c.h / 2]) {
      for (const alvo of alvosH) {
        const d = Math.abs(alvo - borda);
        if (d < melhorY.d) melhorY = { d, ajuste: alvo - borda, linha: alvo };
      }
    }
  }

  const linhas = [];
  if (melhorX.d <= lim) linhas.push({ eixo: 'v', pos: melhorX.linha });
  if (melhorY.d <= lim) linhas.push({ eixo: 'h', pos: melhorY.linha });

  return {
    dx: melhorX.d <= lim ? melhorX.ajuste : 0,
    dy: melhorY.d <= lim ? melhorY.ajuste : 0,
    linhas,
  };
}

function mostrarImas(linhas) {
  const caixa = $('#pr-imas');
  caixa.innerHTML = '';
  const alt = H();
  for (const l of linhas) {
    caixa.append(el('div', {
      class: 'ima ' + (l.eixo === 'v' ? 'ima-v' : 'ima-h'),
      style: l.eixo === 'v'
        ? { left: (l.pos / W * 100) + '%' }
        : { top: (l.pos / alt * 100) + '%' },
    }));
  }
}
const limparImas = () => { $('#pr-imas').innerHTML = ''; };

function marcarSelecaoNoDOM() {
  $$('.pr-item').forEach(n => n.classList.toggle('selecionado', selecao.has(n.dataset.uid)));
}

// ------------------------------- Laço ------------------------------------
function ligarPalco() {
  prancheta().addEventListener('pointerdown', (e) => {
    if (e.target.closest('.pr-item, .guia, .alcas-moldura, .alca-mover')) return;
    const rect = prancheta().getBoundingClientRect();
    const alt = H();
    const ini = {
      x: clamp(unidadesX(rect, e.clientX - rect.left), 0, W),
      y: clamp(unidadesY(rect, e.clientY - rect.top), 0, alt),
    };
    vemDaPaleta = false;
    if (!e.shiftKey) { selecao.clear(); marcarSelecaoNoDOM(); atualizarFerramentas(); }

    const laco = $('#pr-marquee');

    const mover = (ev) => {
      if (pinca?.ativa()) return;
      const p = {
        x: clamp(unidadesX(rect, ev.clientX - rect.left), 0, W),
        y: clamp(unidadesY(rect, ev.clientY - rect.top), 0, alt),
      };
      const x0 = Math.min(ini.x, p.x), x1 = Math.max(ini.x, p.x);
      const y0 = Math.min(ini.y, p.y), y1 = Math.max(ini.y, p.y);
      laco.hidden = false;
      Object.assign(laco.style, {
        left: (x0 / W * 100) + '%', top: (y0 / alt * 100) + '%',
        width: ((x1 - x0) / W * 100) + '%', height: ((y1 - y0) / alt * 100) + '%',
      });
      const pegos = [];
      for (const it of board.itens) {
        const c = caixaDoItem(it, propDoItem(it));
        const cruza = c.x + c.w / 2 > x0 && c.x - c.w / 2 < x1 &&
                      c.y + c.h / 2 > y0 && c.y - c.h / 2 < y1;
        if (cruza) pegos.push(it.uid);
        else if (!ev.shiftKey) selecao.delete(it.uid);
      }
      doGrupo(pegos).forEach(u => selecao.add(u));
      marcarSelecaoNoDOM();
      agendarFerramentas();
    };

    // pointercancel também: o sistema pode tomar o toque (notificação, gesto)
    // e o laço não pode ficar preso na tela.
    const soltar = () => {
      laco.hidden = true;
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      window.removeEventListener('pointercancel', soltar);
      atualizarFerramentas();
    };

    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
    window.addEventListener('pointercancel', soltar);
  });
}

// ------------------------------- Réguas ----------------------------------
function ligarReguas() {
  $('#regua-h').addEventListener('pointerdown', (e) => criarGuiaArrastando(e, 'h'));
  $('#regua-v').addEventListener('pointerdown', (e) => criarGuiaArrastando(e, 'v'));
}

function criarGuiaArrastando(e, eixo) {
  e.preventDefault();
  mudanca();
  const rect = prancheta().getBoundingClientRect();
  const alt = H();
  if (eixo === 'h') board.guias.h.push(clamp(unidadesY(rect, e.clientY - rect.top), 0, alt));
  else board.guias.v.push(clamp(unidadesX(rect, e.clientX - rect.left), 0, W));
  renderGuias();
  seguirGuia(eixo, (eixo === 'h' ? board.guias.h : board.guias.v).length - 1);
}

function arrastarGuia(e, eixo, idx) {
  e.preventDefault();
  e.stopPropagation();
  mudanca();
  seguirGuia(eixo, idx);
}

function seguirGuia(eixo, idx) {
  const rect = prancheta().getBoundingClientRect();
  const alt = H();
  const mover = (ev) => {
    const lista = eixo === 'h' ? board.guias.h : board.guias.v;
    lista[idx] = eixo === 'h'
      ? clamp(unidadesY(rect, ev.clientY - rect.top), 0, alt)
      : clamp(unidadesX(rect, ev.clientX - rect.left), 0, W);
    renderGuias();
  };
  const soltar = () => {
    window.removeEventListener('pointermove', mover);
    window.removeEventListener('pointerup', soltar);
    window.removeEventListener('pointercancel', soltar);
    // Guia largada fora da colagem é descartada.
    const lista = eixo === 'h' ? board.guias.h : board.guias.v;
    const limite = eixo === 'h' ? alt : W;
    if (lista[idx] <= 0.5 || lista[idx] >= limite - 0.5) lista.splice(idx, 1);
    renderGuias();
  };
  window.addEventListener('pointermove', mover);
  window.addEventListener('pointerup', soltar);
  window.addEventListener('pointercancel', soltar);
}

// ============================== Ferramentas ===============================
async function comecarNova() {
  if (temMudanca() && !await confirmar('O que não foi salvo nesta colagem se perde.',
    { titulo: 'Começar uma colagem nova?', sim: 'Começar' })) return false;
  board = novaColagem();
  selecao.clear();
  hist.zerar();
  fotoSalva = fotoDaMesa();
  encaixar(); render();
  return true;
}

function ligarControles() {
  const on = (sel, evt, fn) => $(sel).addEventListener(evt, fn);

  on('#board-busca', 'input', (e) => { busca = e.target.value; montarPaleta(); });

  on('#bd-margem-val', 'input', (e) => {
    mudanca('margem');
    board.margem = Number(e.target.value);
    renderMargem(); renderAssinatura();
  });

  // A assinatura entra no desfazer como um passo por ajuste.
  const assin = (campo, valor, gesto = 'assinatura') => {
    mudanca(gesto);
    board.assinatura[campo] = valor;
    renderAssinatura();
  };
  on('#bd-assinatura', 'input', (e) => assin('texto', e.target.value, 'assinatura-texto'));
  on('#bd-fonte', 'change', (e) => assin('fonte', e.target.value, null));
  on('#bd-pos-assinatura', 'change', (e) => assin('posicao', e.target.value, null));
  on('#bd-tam-assinatura', 'input', (e) => assin('tamanho', Number(e.target.value), 'assinatura-tam'));
  on('#bd-esp-assinatura', 'input', (e) => assin('espaco', Number(e.target.value), 'assinatura-esp'));
  on('#bd-cor-assinatura', 'input', (e) => assin('cor', e.target.value, 'assinatura-cor'));
  on('#bd-ver-assinatura', 'change', (e) => assin('visivel', e.target.checked, null));
  on('#bd-salvar-assinatura', 'click', () => {
    db.state.usuario.assinatura = { ...board.assinatura };
    db.salvar();
    toast('Assinatura salva — novas colagens já nascem com ela.');
  });

  on('#bd-margem', 'change', renderMargem);
  on('#bd-grade', 'change', renderMargem);
  on('#bd-reguas', 'change', (e) => {
    $('#prancheta-wrap').classList.toggle('reguas-off', !e.target.checked);
  });

  on('#bd-undo', 'click', () => hist.desfazer());
  on('#bd-redo', 'click', () => hist.refazer());
  $$('[data-zoom]').forEach(b => b.addEventListener('click', () => {
    const acao = b.dataset.zoom;
    if (acao === 'fit') return encaixar();
    ajustarSozinho = false;
    zoom = clamp(zoom * (acao === '+' ? 1.2 : 1 / 1.2), 0.3, 4);
    $('#prancheta-wrap').style.width = larguraAlvo() + 'px';
    renderAssinatura();
    posicionarTodos();
    atualizarBarra();
    atualizarFerramentas();
  }));

  $$('[data-bd]').forEach(b => b.addEventListener('click', () => acaoNaSelecao(b.dataset.bd)));
  $$('[data-arranjo]').forEach(b => b.addEventListener('click', () => arranjar(b.dataset.arranjo)));
  $$('[data-alinhar]').forEach(b => b.addEventListener('click', () => alinhar(b.dataset.alinhar)));

  on('#bd-escala', 'input', (e) => {
    const alvos = livres();
    if (!alvos.length) return;
    mudanca('escala');
    const v = Number(e.target.value) / 100 * W;
    // O slider diz o tamanho da primeira; as outras crescem na mesma conta.
    const ref = alvos[0];
    const atualRef = ehTexto(ref) ? ref.tamanho * 6 : ref.w;
    transformarGrupo(fotoDosItens(alvos), centroDe(alvos), { fator: v / atualRef });
    alvos.forEach(a => posicionarItem(a));
    agendarFerramentas();
  });
  // A barra em pé do celular conversa com o slider do painel: mexer nela é
  // mexer nele. + e − crescem 10% da seleção de cada vez.
  const escala = $('#bd-escala');
  const mudarEscala = (v) => {
    escala.value = clamp(Math.round(v), Number(escala.min), Number(escala.max));
    escala.dispatchEvent(new Event('input'));
  };
  on('#bd-escala-vert', 'input', (e) => mudarEscala(Number(e.target.value)));
  $$('#bd-tamanho .barra-tam-btn').forEach(b => b.addEventListener('click', () => {
    const v = Number(escala.value);
    mudarEscala(v + Number(b.dataset.tam) * Math.max(1, Math.round(v * 0.1)));
  }));
  on('#bd-rot', 'input', (e) => {
    const alvos = livres();
    if (!alvos.length) return;
    mudanca('rot');
    const delta = Number(e.target.value) - alvos[0].rot;
    transformarGrupo(fotoDosItens(alvos), centroDe(alvos), { graus: delta });
    alvos.forEach(a => posicionarItem(a));
    agendarFerramentas();
  });
  on('#bd-opacidade', 'input', (e) => {
    const alvos = livres();
    if (!alvos.length) return;
    mudanca('opacidade');
    for (const it of alvos) it.opacidade = Number(e.target.value);
    alvos.forEach(a => posicionarItem(a));
  });
  // A sombra vale para a seleção e, ao mesmo tempo, fica gravada como padrão
  // das próximas peças — para não ter que reajustar a cada colagem.
  on('#bd-sombra', 'change', (e) => {
    const querSombra = e.target.checked;
    if (livres().length) {
      mudanca();
      for (const it of livres()) it.sombra = querSombra;
      posicionarTodos();
    }
    db.state.usuario.preferencias.sombra = querSombra;
    db.salvar();
  });

  on('#bd-add-texto', 'click', adicionarTexto);
  on('#bd-texto', 'input', (e) => {
    const alvos = livres().filter(ehTexto);
    if (!alvos.length) return;
    mudanca('texto');
    for (const it of alvos) { it.texto = e.target.value; medirTexto(it); posicionarItem(it); }
    agendarFerramentas();
  });
  on('#bd-texto-fonte', 'change', (e) => {
    const alvos = livres().filter(ehTexto);
    if (!alvos.length) return;
    mudanca();
    for (const it of alvos) { it.fonte = e.target.value; medirTexto(it); posicionarItem(it); }
    // A fonte nova pode chegar depois: mede de novo quando chegar.
    document.fonts?.load(`40px ${fonteCss(e.target.value)}`).then(() => {
      alvos.forEach(it => { medirTexto(it); posicionarItem(it); });
      atualizarFerramentas();
    }, () => {});
    atualizarFerramentas();
  });
  on('#bd-texto-cor', 'input', (e) => {
    const alvos = livres().filter(ehTexto);
    if (!alvos.length) return;
    mudanca('texto-cor');
    for (const it of alvos) { it.cor = e.target.value; posicionarItem(it); }
  });

  on('#board-nome', 'input', (e) => { board.nome = e.target.value; });
  on('#bd-salvar', 'click', () => salvarBoard());
  on('#bd-publicar', 'click', publicarBoard);
  on('#bd-sortear', 'click', gerarColagem);
  on('#bd-nova', 'click', comecarNova);
  on('#bd-limpar-guias', 'click', () => { mudanca(); board.guias = { h: [], v: [] }; renderGuias(); });

  on('#bd-compartilhar', 'click', () => {
    if (!board.itens.length) return toast('Solte alguma peça antes de compartilhar.', 'aviso');
    abrirCompartilhar({
      formatos: [
        { id: 'formato', rotulo: 'Post 1080×1350' },
        { id: 'story', rotulo: 'Story 1080×1920' },
      ],
      gerar: (tipo) => imagemDoBoard(board, { story: tipo === 'story' }),
    });
  });
}

// Ordem das camadas. Subir e descer trocam a peça de lugar com a vizinha de
// cima ou de baixo (antes somava 1 no z, empatava com a vizinha e o
// desempate devolvia a peça ao mesmo lugar).
function reordenar(acao) {
  const pilha = [...board.itens].sort((a, b) => a.z - b.z);
  const mexe = (it) => selecao.has(it.uid) && !it.travado;
  let nova = pilha;
  if (acao === 'frente') nova = [...pilha.filter(i => !mexe(i)), ...pilha.filter(mexe)];
  if (acao === 'fundo') nova = [...pilha.filter(mexe), ...pilha.filter(i => !mexe(i))];
  if (acao === 'subir') {
    for (let i = nova.length - 2; i >= 0; i--) {
      if (mexe(nova[i]) && !mexe(nova[i + 1])) [nova[i], nova[i + 1]] = [nova[i + 1], nova[i]];
    }
  }
  if (acao === 'descer') {
    for (let i = 1; i < nova.length; i++) {
      if (mexe(nova[i]) && !mexe(nova[i - 1])) [nova[i], nova[i - 1]] = [nova[i - 1], nova[i]];
    }
  }
  nova.forEach((it, i) => { it.z = i + 1; });
}

function acaoNaSelecao(acao) {
  if (!selecionados().length) return;
  if (acao === 'duplicar') return duplicarSelecionados();
  if (acao === 'remover') return removerSelecionados();
  mudanca();

  if (['frente', 'fundo', 'subir', 'descer'].includes(acao)) reordenar(acao);
  for (const it of selecionados()) {
    if (acao === 'travar') it.travado = !it.travado;
    if (it.travado) continue;
    if (acao === 'espelhar') it.flip = !it.flip;
  }
  if (acao === 'agrupar') agrupar(true);
  if (acao === 'desagrupar') agrupar(false);

  renderItens();
  atualizarFerramentas();
}

// Grupo: as peças escolhidas passam a andar juntas (escolher uma escolhe
// todas). Desagrupar solta todas as da seleção.
function agrupar(juntar) {
  const alvos = selecionados();
  if (juntar) {
    if (alvos.length < 2) return toast('Escolha duas peças ou mais para agrupar.', 'aviso');
    const g = 'g' + (uidSeq++);
    alvos.forEach(i => { i.grupo = g; });
    toast(`${alvos.length} peças agrupadas.`);
  } else {
    alvos.forEach(i => { delete i.grupo; });
    toast('Grupo desfeito.');
  }
}

// Alinhar: com uma peça, em relação à área útil (dentro da margem); com
// várias, em relação à caixa delas. Distribuir espalha por igual.
function alinhar(modo) {
  const alvos = livres();
  if (!alvos.length) return;
  mudanca();
  const caixas = alvos.map(i => ({ it: i, c: caixaDoItem(i, propDoItem(i)) }));
  const area = areaUtil(board, W, H());
  const ref = alvos.length > 1 ? {
    x0: Math.min(...caixas.map(({ c }) => c.x - c.w / 2)),
    x1: Math.max(...caixas.map(({ c }) => c.x + c.w / 2)),
    y0: Math.min(...caixas.map(({ c }) => c.y - c.h / 2)),
    y1: Math.max(...caixas.map(({ c }) => c.y + c.h / 2)),
  } : area;

  if (modo === 'dist-h' || modo === 'dist-v') {
    if (alvos.length < 3) { toast('Distribuir pede três peças ou mais.', 'aviso'); return; }
    const eixo = modo === 'dist-h' ? 'x' : 'y';
    const ord = caixas.sort((a, b) => a.c[eixo] - b.c[eixo]);
    const primeiro = ord[0].c[eixo], ultimo = ord.at(-1).c[eixo];
    ord.forEach(({ it }, i) => { it[eixo] = primeiro + (ultimo - primeiro) * i / (ord.length - 1); });
  } else {
    for (const { it, c } of caixas) {
      if (modo === 'esq') it.x = ref.x0 + c.w / 2;
      if (modo === 'centro') it.x = (ref.x0 + ref.x1) / 2;
      if (modo === 'dir') it.x = ref.x1 - c.w / 2;
      if (modo === 'topo') it.y = ref.y0 + c.h / 2;
      if (modo === 'meio') it.y = (ref.y0 + ref.y1) / 2;
      if (modo === 'base') it.y = ref.y1 - c.h / 2;
    }
  }
  alvos.forEach(a => posicionarItem(a));
  atualizarFerramentas();
}

// Sorteia uma colagem inteira com as peças do guarda-roupa.
export function gerarColagem() {
  const acervo = db.state.inventario
    .map(p => pecaDoCatalogo(p.id))
    .filter(Boolean);

  if (!acervo.length) {
    toast('Seu guarda-roupa está vazio. Garimpe na vitrine primeiro.', 'aviso');
    return;
  }
  mudanca();

  // O espalhamento é o mesmo que o feed usa para as colagens dos perfis
  // fictícios (sorteio.js). `base` mantém o enquadramento que você escolheu:
  // sortear troca as peças, não a margem.
  const pecas = sortearConjunto(acervo, Math.random, { minimo: 5 });
  const antes = new Map([...prancheta().querySelectorAll('.pr-item[data-uid]')]
    .map(n => [n.dataset.uid, n.getBoundingClientRect()]));
  board.itens = colagemAleatoria(pecas, Math.random, { base: board }).itens
    .map(it => ({
      ...it,
      uid: 'b' + (uidSeq++),
      sombra: db.state.usuario.preferencias.sombra,
    }));
  selecao.clear();
  render();
  espalhar(prancheta(), antes);
  toast(`Colagem sorteada com ${board.itens.length} peças. ${ehToque() ? '↶ desfaz' : 'Ctrl+Z desfaz'}.`);
}

// Arruma as peças sozinho: grade certinha ou espalhadas com leve inclinação.
function arranjar(modo) {
  const alvos = selecionados().length > 1 ? livres() : board.itens.filter(i => !i.travado);
  if (alvos.length < 2) return;
  mudanca();
  distribuir(alvos, modo);
  atualizarFerramentas();
}

function distribuir(alvos, modo) {
  if (alvos.length < 1) return;
  const area = areaUtil(board, W, H());
  const util = { w: area.x1 - area.x0, h: area.y1 - area.y0 };
  const cols = Math.max(1, Math.ceil(Math.sqrt(alvos.length * (util.w / util.h))));
  const linhas = Math.ceil(alvos.length / cols);
  const cw = util.w / cols, ch = util.h / linhas;

  alvos.forEach((it, i) => {
    const c = i % cols, l = Math.floor(i / cols);
    const prop = propDoItem(it);
    const cabe = Math.min(cw * 0.9, ch * 0.9 * prop);
    if (ehTexto(it)) { it.tamanho = clamp(cabe / 6, 18, 120); medirTexto(it); }
    else it.w = Math.max(50, cabe * escalaMural(pecaDoCatalogo(it.itemId)));
    it.x = area.x0 + cw * (c + 0.5);
    it.y = area.y0 + ch * (l + 0.5);
    it.rot = modo === 'leque' ? (Math.random() - 0.5) * 16 : 0;
    if (modo === 'leque') {
      it.x += (Math.random() - 0.5) * cw * 0.25;
      it.y += (Math.random() - 0.5) * ch * 0.25;
      it.w *= 0.9 + Math.random() * 0.25;
    }
  });
  posicionarTodos();
}

// A alça de quatro setas ao lado da seleção: puxar por ela é o mesmo que
// arrastar a peça, só que sem o dedo em cima (celular).
let alcaMov = null;
function colocarAlcaMover() {
  const soltas = vemDaPaleta ? [] : livres();
  alcaMov ??= alcaMover(prancheta(), (e) => {
    const it = livres()[0];
    const no = it && noDoItem(it);
    if (no) iniciarManipulacao(e, it, no);
  });
  alcaMov.colocar(soltas.map(s => noDoItem(s)));
}

// Durante o arrasto as alças e os controles acompanham uma vez por quadro.
let quadro = 0;
function agendarFerramentas() {
  if (quadro) return;
  quadro = requestAnimationFrame(() => { quadro = 0; atualizarFerramentas(); });
}

function atualizarFerramentas() {
  if (!board) return;
  colocarAlcaMover();
  const alvos = selecionados();
  alcas?.sincronizar(alvos.map(it => ({ uid: it.uid, no: noDoItem(it), travado: it.travado })));
  const tem = alvos.length > 0;
  $('.view-board').classList.toggle('com-selecao', tem && !vemDaPaleta);
  $('#bd-vazio').hidden = tem;
  $('#bd-qtd-sel').textContent = tem ? `(${alvos.length})` : '';
  $$('#bd-selecao .tool-btn, #bd-selecao input, #bd-selecao select').forEach(n => {
    n.disabled = !tem && n.id !== 'bd-sombra';
  });
  $$('[data-alinhar]').forEach(n => { n.disabled = !alvos.some(i => !i.travado); });
  // Agrupar pede duas ou mais; desagrupar só tem sentido com um grupo.
  $('[data-bd="agrupar"]').disabled = alvos.length < 2 || alvos.every(i => i.grupo && i.grupo === alvos[0].grupo);
  $('[data-bd="desagrupar"]').disabled = !alvos.some(i => i.grupo);
  if (!tem) $('#bd-sombra').checked = db.state.usuario.preferencias.sombra;
  const texto = alvos.find(ehTexto);
  $('#bd-texto-campos').hidden = !texto;
  if (texto && document.activeElement?.id !== 'bd-texto') {
    $('#bd-texto').value = texto.texto;
    $('#bd-texto-fonte').value = texto.fonte;
    $('#bd-texto-cor').value = texto.cor;
  }
  const travar = $('[data-bd="travar"]');
  travar?.setAttribute('aria-pressed', String(tem && alvos.every(i => i.travado)));
  if (!tem) { atualizarBarra(); return; }
  const it = alvos[0];
  $('#bd-escala').value = $('#bd-escala-vert').value =
    Math.round((ehTexto(it) ? it.tamanho * 6 : it.w) / W * 100);
  $('#bd-rot').value = Math.round(it.rot);
  $('#bd-opacidade').value = Math.round(it.opacidade ?? 100);
  $('#bd-sombra').checked = !!it.sombra;
  $('#bd-info').textContent = `${contagem()} · ${alvos.length} selecionad${alvos.length > 1 ? 'os' : 'o'}`;
}

function contagem() {
  const pecas = board.itens.filter(i => !ehTexto(i)).length;
  const textos = board.itens.length - pecas;
  return (pecas === 1 ? '1 peça' : `${pecas} peças`) +
    (textos ? ` · ${textos === 1 ? '1 texto' : `${textos} textos`}` : '');
}

function atualizarBarra() {
  if (!board) return;
  $('#bd-undo').disabled = !hist.podeDesfazer();
  $('#bd-redo').disabled = !hist.podeRefazer();
  $('#bd-zoom').textContent = Math.round(zoom * 100) + '%';
  if (!selecionados().length) $('#bd-info').textContent = contagem();
}

function sincronizarControles() {
  $('#bd-margem-val').value = board.margem;
  $('#bd-assinatura').value = board.assinatura.texto;
  $('#bd-fonte').value = board.assinatura.fonte;
  $('#bd-pos-assinatura').value = board.assinatura.posicao;
  $('#bd-tam-assinatura').value = board.assinatura.tamanho;
  $('#bd-esp-assinatura').value = board.assinatura.espaco;
  $('#bd-cor-assinatura').value = board.assinatura.cor;
  $('#bd-ver-assinatura').checked = board.assinatura.visivel;
  $('#board-nome').value = board.nome;
}

// ================================ Teclado =================================
function ligarTeclado() {
  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.view !== 'board' || !teclaLivre()) return;

    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (ctrl && k === 'z') {
      e.preventDefault();
      return e.shiftKey ? hist.refazer() : hist.desfazer();
    }
    if (ctrl && k === 'y') { e.preventDefault(); return hist.refazer(); }
    if (ctrl && k === 'd') { e.preventDefault(); return duplicarSelecionados(); }
    if (ctrl && k === 'g') { e.preventDefault(); return acaoNaSelecao(e.shiftKey ? 'desagrupar' : 'agrupar'); }
    if (ctrl && k === 'a') {
      e.preventDefault();
      selecao = new Set(board.itens.map(i => i.uid));
      marcarSelecaoNoDOM(); atualizarFerramentas();
      return;
    }
    if (ctrl || e.altKey) return;
    if (e.key === 'Escape') { selecao.clear(); marcarSelecaoNoDOM(); atualizarFerramentas(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); return removerSelecionados(); }
    if (e.key === '[') return acaoNaSelecao('descer');
    if (e.key === ']') return acaoNaSelecao('subir');

    const alvos = livres();
    if (!alvos.length) return;
    if (k === 'r' || ['+', '=', '-'].includes(e.key)) {
      e.preventDefault();
      mudanca(k === 'r' ? 'girar' : 'escala');
      transformarGrupo(fotoDosItens(alvos), centroDe(alvos), k === 'r'
        ? { graus: e.shiftKey ? -15 : 15 } : { fator: e.key === '-' ? 0.94 : 1.06 });
      alvos.forEach(a => posicionarItem(a));
      atualizarFerramentas();
      return;
    }

    const passo = e.shiftKey ? 20 : 4;
    const mapa = { ArrowLeft: [-passo, 0], ArrowRight: [passo, 0], ArrowUp: [0, -passo], ArrowDown: [0, passo] };
    const mov = mapa[e.key];
    if (!mov) return;
    e.preventDefault();
    mudanca('setas');
    for (const it of alvos) {
      it.x = clamp(it.x + mov[0], -200, W + 200);
      it.y = clamp(it.y + mov[1], -200, H() + 200);
      posicionarItem(it);
    }
    agendarFerramentas();
  });
}

// ============================ Salvar / publicar ===========================
// Só o desenho da colagem: estrela, "no feed", datas e miniatura são do item
// salvo, não da mesa (antes a estrela velha voltava ao salvar).
function dadosLimpos() {
  const { thumb, publicado, favorito, criadoEm, editadoEm, ...resto } = board;
  return JSON.parse(JSON.stringify({ ...resto, itens: board.itens.map(({ uid, ...r }) => r) }));
}

async function salvarBoard({ silencioso = false } = {}) {
  if (!board.itens.length) { toast('A colagem está vazia.', 'aviso'); return null; }
  const nome = board.nome.trim() || nomeLivre('Colagem', db.state.boards);
  board.nome = nome;
  $('#board-nome').value = nome;
  const thumb = await miniaturaBoard(board);
  const dados = { ...dadosLimpos(), nome, thumb };

  let salvo = db.state.boards.find(b => b.id === board.id);
  if (salvo) {
    Object.assign(salvo, dados, { editadoEm: new Date().toISOString() });
  } else {
    salvo = { ...dados, id: idNovo('bd'), criadoEm: new Date().toISOString(), publicado: false };
    db.state.boards.push(salvo);
    db.progredirMissao('board');
    board.id = salvo.id;
  }
  fotoSalva = fotoDaMesa();
  db.salvar();
  renderLista();
  if (silencioso) return salvo;
  // Já está no feed: salvar leva a versão nova para o post também.
  if (salvo.publicado && jaPublicado('boardId', salvo.id)) {
    try {
      await publicarNoFeed({ ...await pacoteDaColagem(salvo), atualizar: true });
      toast(`"${nome}" salva e atualizada no feed.`);
    } catch (e) {
      toast(`"${nome}" salva, mas o post do feed não mudou: ${e.message || 'sem conexão'}.`, 'aviso');
    }
    return salvo;
  }
  toast(`"${nome}" salva.`);
  return salvo;
}

async function publicarBoard() {
  const salvo = await salvarBoard({ silencioso: true });
  if (!salvo) return;

  // Já está no feed: a versão nova troca a imagem do post (curtidas e
  // comentários ficam).
  if (salvo.publicado && jaPublicado('boardId', salvo.id)) {
    if (!await confirmar('As curtidas e os comentários continuam.',
      { titulo: 'Atualizar o post no feed com esta versão?', sim: 'Atualizar' })) return;
    try {
      await publicarNoFeed({ ...await pacoteDaColagem(salvo), atualizar: true });
      return toast('Post atualizado no feed.');
    } catch (e) {
      return toast(e.message || 'Não consegui atualizar o post agora.', 'aviso');
    }
  }

  let onde;
  try {
    onde = await publicarOuGuardar(await pacoteDaColagem(salvo));
  } catch (e) {
    return toast(e.message || 'Não consegui publicar agora.', 'aviso');
  }
  if (!salvo.publicado) {
    db.state.stats.publicacoes += 1;
    db.progredirMissao('publicar');
  }
  salvo.publicado = true;
  db.salvar();
  renderLista();
  toast(onde === 'servidor'
    ? 'Colagem publicada no feed — seus amigos já podem ver.'
    : 'Sem conexão: publicada só aqui por enquanto. Sobe para o feed quando o servidor voltar.');
}

// As colagens salvas moram só no painel "Minhas colagens", aberto pelo
// botão em cima da mesa; aqui só se atualiza o número dele e o painel.
function renderLista() {
  const qtd = $('#mc-qtd');
  if (qtd) qtd.textContent = db.state.boards.length ? String(db.state.boards.length) : '';
  painel?.render();
}

// --- Minhas colagens ------------------------------------------------------
// A miniatura do save pode ter sido descartada (quota cheia: ver db.salvar);
// aí desenha uma agora e guarda só na memória.
const miniaturas = new Map(); // id -> miniatura desenhada agora (save sem thumb)

function imagemDoCartao(b) {
  const pronta = b.thumb || miniaturas.get(b.id);
  if (pronta) return el('img', { src: pronta, alt: b.nome, loading: 'lazy' });
  const vaga = el('span', { class: 'sem-thumb' }, '—');
  if (b.itens?.length) {
    miniaturaBoard(b).then((url) => {
      miniaturas.set(b.id, url);
      if (vaga.isConnected) vaga.replaceWith(el('img', { src: url, alt: b.nome }));
    }, () => {});
  }
  return vaga;
}

function montarMinhasColagens() {
  painel = criarPainel({
    prefixo: 'mc',
    botao: '#btn-minhas-colagens',
    modal: '#modal-colagens',
    lista: () => db.state.boards,
    tipoFav: 'colagem',
    origem: 'board',
    campo: 'boardId',
    prefixoId: 'bd',
    maxNome: 46,
    feminino: true,
    nomes: ['colagem', 'colagens'],
    lugar: 'na mesa',
    vazio: ['Nenhuma colagem salva ainda',
      'Solte as suas peças na mesa e toque em "salvar": ela aparece aqui.'],
    abertoId: () => board?.id,
    imagem: imagemDoCartao,
    pecas: (b) => b.itens?.filter(i => i.tipo !== 'texto').length || 0,
    abrir: abrirBoard,
    novo: async () => {
      if (await comecarNova()) toast('Mesa limpa: monte a colagem nova e salve.');
    },
    aoRenomear: (id, nome) => {
      if (id === board.id) { board.nome = nome; $('#board-nome').value = nome; }
    },
    // A mesa fica como está, só deixa de ser aquela colagem: salvar de novo cria outra.
    aoApagar: (id) => { miniaturas.delete(id); if (id === board.id) board.id = null; },
    aoMudar: renderLista,
  });
}

export function abrirBoard(id) {
  const salvo = db.state.boards.find(b => b.id === id);
  if (!salvo) return;
  const { thumb, publicado, favorito, criadoEm, editadoEm, ...dados } = salvo;
  board = JSON.parse(JSON.stringify(dados));
  board.itens = board.itens.map(i => ({ ...i, uid: 'b' + (uidSeq++) }));
  board.guias = board.guias || { h: [], v: [] };
  // Colagem salva antes de a moldura sair: aproveita a margem e larga o resto.
  board.margem = margemDe(board);
  delete board.moldura; delete board.fundo;
  selecao.clear();
  hist.zerar();
  fotoSalva = fotoDaMesa();
  if (montado) { encaixar(); render(); }
}

export function aoEntrarNoBoard() {
  // A mesa vazia nasceu antes do login (ou na conta anterior): refaz com a
  // assinatura de quem está entrando agora.
  if (!board || (!board.id && !board.itens.length)) {
    board = novaColagem();
    fotoSalva = fotoDaMesa();
  }
  montarBoard();
  montarPaleta();
  encaixar();
  render();
}
