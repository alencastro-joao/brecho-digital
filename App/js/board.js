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
import { catalogo, item as pecaDoCatalogo, nomeDaPeca, proporcao, aplicarContorno,
         srcGrande } from './catalog.js';
import * as db from './db.js';
import { alturaDe, margemDe, posAssinatura, fonteCss, caixaDoItem, areaUtil } from './boardgeo.js';
import { miniaturaBoard, baixarBoard } from './render.js';
import { publicarOuGuardar, pacoteDaColagem, jaPublicado, apagarDoFeedPorOrigem } from './publicacoes.js';
import { sortearConjunto, colagemAleatoria } from './sorteio.js';
import { estrelaFavorito } from './favoritos.js';
import { el, $, $$, clamp, toast } from './util.js';
import { confirmar } from './janela.js';
import { ico, emo } from './icones.js';
import { alcaMover } from './alcamover.js';
import { espalhar } from './movimento.js';

const W = BOARD.W;

let board = novaColagem();
let selecao = new Set();
// No celular, selecionar uma peça no palco troca a paleta pelas ferramentas.
// Peça recém-solta pela paleta já nasce selecionada, mas aí a paleta fica:
// quem está soltando peças quer continuar soltando.
let vemDaPaleta = false;
let historico = [], futuro = [];
let uidSeq = 1;
let zoom = 1, ajustarSozinho = true;
let catPaleta = 'todas', busca = '';
let montado = false;

const H = () => alturaDe(board.formato);
const prancheta = () => $('#prancheta');
const itemDe = (uid) => board.itens.find(i => i.uid === uid);
const selecionados = () => board.itens.filter(i => selecao.has(i.uid));
const pxPorUnidade = () => (prancheta()?.getBoundingClientRect().width || 1) / W;

// A colagem aceita dois tipos de item: peca (imagem) e etiqueta (texto).
const ehTexto = (it) => it.tipo === 'texto';
const propDoItem = (it) => ehTexto(it)
  ? (it.w || 1) / (it.tamanho * 1.25)
  : proporcao(pecaDoCatalogo(it.itemId));

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
function marcar() {
  historico.push(JSON.stringify(board));
  if (historico.length > 60) historico.shift();
  futuro.length = 0;
  atualizarBarra();
}
function desfazer() {
  if (!historico.length) return;
  futuro.push(JSON.stringify(board));
  board = JSON.parse(historico.pop());
  selecao.clear();
  render();
}
function refazer() {
  if (!futuro.length) return;
  historico.push(JSON.stringify(board));
  board = JSON.parse(futuro.pop());
  selecao.clear();
  render();
}

// =============================== Montagem ================================
export function montarBoard() {
  if (montado) return;
  montado = true;

  preencherSelects();
  ligarControles();
  ligarPalco();
  ligarReguas();
  ligarTeclado();
  montarPaleta();
  montarMinhasColagens();
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
    class: 'pal-cat' + (catPaleta === 'todas' ? ' active' : ''),
    onclick: () => { catPaleta = 'todas'; montarPaleta(); },
  }, ico('brilho'), el('small', {}, String(total))));

  for (const g of grupos) {
    if (!g.qtd) continue;
    abas.append(el('button', {
      class: 'pal-cat' + (g.id === catPaleta ? ' active' : ''),
      title: g.nome,
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
    .filter(p => !busca || p.id.includes(busca)));

  if (!pecas.length) {
    grid.append(el('p', { class: 'palette-vazia' }, 'Nada aqui com esse filtro.'));
    return;
  }

  preencherComGrupos(grid, pecas, (p) => {
    const peca = pecaDoCatalogo(p.id);
    if (!peca) return null;
    const img = el('img', { src: peca.src, alt: nomeDaPeca(peca), loading: 'lazy' });
    aplicarContorno(img, peca);
    // A raridade pinta o bloco no celular, como na grade do closet.
    const r = RARIDADE[p.raridade] || RARIDADE.common;
    return el('button', {
      class: `pal-item r-${p.raridade || 'common'}`, title: nomeDaPeca(peca) + ' — clique para soltar',
      style: { '--rar-borda': r.aura && r.aura !== 'arco-iris' ? r.aura : r.cor },
      onclick: () => adicionar(p.id),
    }, el('div', {
      class: 'peca-caixa',
      style: { '--esc': String(escalaGrade(peca)) },
    }, img));
  }, { categoriaAberta: catPaleta !== 'todas' });
}

// ============================== Peças no board ============================
export function adicionar(itemId) {
  const peca = pecaDoCatalogo(itemId);
  if (!peca) return;
  marcar();

  const escalaCat = escalaMural(peca);
  // Cada peça nova cai na próxima casa de uma grade 3×N dentro do enquadramento,
  // com um empurrãozinho aleatório — assim a colagem já nasce ocupada, não
  // empilhada no meio.
  const area = areaUtil(board, W, H());
  const cols = 3, linhas = 4;
  const n = board.itens.length;
  const c = n % cols, l = Math.floor(n / cols) % linhas;
  const cw = (area.x1 - area.x0) / cols, ch = (area.y1 - area.y0) / linhas;

  const it = {
    uid: 'b' + (uidSeq++),
    itemId,
    cat: peca.cat,
    x: clamp(area.x0 + cw * (c + 0.5) + (Math.random() - 0.5) * cw * 0.22, area.x0, area.x1),
    y: clamp(area.y0 + ch * (l + 0.5) + (Math.random() - 0.5) * ch * 0.22, area.y0, area.y1),
    w: Math.round(Math.min(cw * 1.02, 300) * escalaCat),
    rot: 0,
    flip: false,
    opacidade: 100,
    sombra: db.state.usuario.preferencias.sombra,
    travado: false,
    z: (board.itens.at(-1)?.z ?? 0) + 1,
  };
  board.itens.push(it);
  selecao = new Set([it.uid]);
  vemDaPaleta = true;
  render();
}

export function adicionarTexto() {
  vemDaPaleta = false;
  marcar();
  const area = areaUtil(board, W, H());
  const it = {
    uid: 'b' + (uidSeq++),
    tipo: 'texto',
    texto: 'texto',
    fonte: board.assinatura.fonte,
    tamanho: 54,
    cor: '#1a1a1a',
    x: (area.x0 + area.x1) / 2,
    y: area.y0 + 40,
    rot: 0,
    flip: false,
    opacidade: 100,
    sombra: false,       // texto com sombra costuma sujar; fica desligado
    travado: false,
    z: (board.itens.at(-1)?.z ?? 0) + 1,
  };
  medirTexto(it);
  board.itens.push(it);
  selecao = new Set([it.uid]);
  render();
  setTimeout(() => $('#bd-texto')?.select(), 60);
}

function removerSelecionados() {
  const alvos = selecionados().filter(i => !i.travado);
  if (!alvos.length) return;
  marcar();
  const ids = new Set(alvos.map(i => i.uid));
  board.itens = board.itens.filter(i => !ids.has(i.uid));
  selecao.clear();
  render();
}

function duplicarSelecionados() {
  const alvos = selecionados();
  if (!alvos.length) return;
  marcar();
  const novos = alvos.map(o => ({
    ...o, uid: 'b' + (uidSeq++),
    x: o.x + 40, y: o.y + 40,
    z: (board.itens.at(-1)?.z ?? 0) + 1,
  }));
  board.itens.push(...novos);
  selecao = new Set(novos.map(i => i.uid));
  render();
}

// ================================ Desenho =================================
function render() {
  if (!prancheta()) return;
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
  atualizarBarra();
}

function renderItens() {
  const raiz = $('#pr-itens');
  raiz.innerHTML = '';
  for (const it of [...board.itens].sort((a, b) => a.z - b.z)) {
    raiz.append(criarItemDOM(it));
  }
}

function criarItemDOM(it) {
  let conteudo;
  if (ehTexto(it)) {
    conteudo = el('span', { class: 'pr-texto' }, it.texto);
  } else {
    const peca = pecaDoCatalogo(it.itemId);
    // Na prancheta a peça cresce na mão: vai a grande desde o começo.
    conteudo = el('img', { src: srcGrande(peca), alt: nomeDaPeca(peca), draggable: 'false' });
    aplicarContorno(conteudo, peca);
  }

  const no = el('div', {
    class: 'pr-item' + (ehTexto(it) ? ' pr-item-texto' : '') +
           (selecao.has(it.uid) ? ' selecionado' : '') +
           (it.travado ? ' travado' : '') + (it.sombra ? ' com-sombra' : ''),
    dataset: { uid: it.uid },
  }, conteudo,
    el('span', { class: 'pr-alca pr-alca-rot', dataset: { alca: 'rot' } }),
    // Uma alça em cada quina: a conta é radial a partir do centro, então
    // qualquer uma delas redimensiona igual.
    ...['no', 'ne', 'so', 'se'].map(q =>
      el('span', { class: `pr-alca pr-alca-esc pr-alca-${q}`, dataset: { alca: 'esc' } }))
  );

  no.addEventListener('pointerdown', (e) => iniciarManipulacao(e, it, no));
  no.addEventListener('wheel', (e) => {
    if (!selecao.has(it.uid) || it.travado) return;
    e.preventDefault();
    marcar();
    const f = e.deltaY < 0 ? 1.06 : 0.94;
    for (const s of selecionados()) {
      if (s.travado) continue;
      if (ehTexto(s)) { s.tamanho = clamp(s.tamanho * f, 12, 260); medirTexto(s); }
      else s.w = clamp(s.w * f, 40, 1000);
    }
    posicionarTodos();
    atualizarFerramentas();
  }, { passive: false });

  posicionarItem(it, no);
  return no;
}

function posicionarItem(it, no = null) {
  const alvo = no || prancheta().querySelector(`.pr-item[data-uid="${it.uid}"]`);
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
  const arte = alvo.querySelector('img');
  if (arte) arte.style.transform = it.flip ? 'scaleX(-1)' : '';
}

const posicionarTodos = () => board.itens.forEach(i => posicionarItem(i));

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
    g.addEventListener('dblclick', () => { marcar(); board.guias.h.splice(i, 1); render(); });
    caixa.append(g);
  });
  board.guias.v.forEach((x, i) => {
    const g = el('div', { class: 'guia guia-v', style: { left: (x / W * 100) + '%' } });
    g.addEventListener('pointerdown', (e) => arrastarGuia(e, 'v', i));
    g.addEventListener('dblclick', () => { marcar(); board.guias.v.splice(i, 1); render(); });
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

function iniciarManipulacao(e, it, no) {
  e.preventDefault();
  e.stopPropagation();

  const alca = e.target.dataset?.alca;
  // Tocar numa peça (mesmo a que acabou de cair da paleta) abre as ferramentas.
  if (vemDaPaleta) { vemDaPaleta = false; atualizarFerramentas(); }
  if (!selecao.has(it.uid)) {
    if (e.shiftKey) selecao.add(it.uid);
    else selecao = new Set([it.uid]);
    marcarSelecaoNoDOM();
    atualizarFerramentas();
  } else if (e.shiftKey && !alca) {
    selecao.delete(it.uid);
    marcarSelecaoNoDOM();
    atualizarFerramentas();
    return;
  }
  if (it.travado) return;

  const rect = prancheta().getBoundingClientRect();
  const centro = {
    x: rect.left + (it.x / W) * rect.width,
    y: rect.top + (it.y / H()) * rect.height,
  };
  const raio0 = Math.hypot(e.clientX - centro.x, e.clientY - centro.y) || 1;
  const ang0 = Math.atan2(e.clientY - centro.y, e.clientX - centro.x);
  const inicio = { x: e.clientX, y: e.clientY };
  const antes = selecionados().filter(s => !s.travado)
    .map(s => ({ ref: s, x: s.x, y: s.y, w: s.w, rot: s.rot, tamanho: s.tamanho }));

  let mexeu = false;
  no.setPointerCapture(e.pointerId);
  no.classList.add('arrastando');

  const mover = (ev) => {
    if (!mexeu) { marcar(); mexeu = true; }

    if (alca === 'esc') {
      const raio = Math.hypot(ev.clientX - centro.x, ev.clientY - centro.y);
      const f = clamp(raio / raio0, 0.1, 8);
      for (const a of antes) {
        if (ehTexto(a.ref)) { a.ref.tamanho = clamp((a.tamanho ?? 54) * f, 12, 260); medirTexto(a.ref); }
        else a.ref.w = clamp(a.w * f, 40, 1000);
      }
    } else if (alca === 'rot') {
      const ang = Math.atan2(ev.clientY - centro.y, ev.clientX - centro.x);
      let g = antes[0].rot + (ang - ang0) * 180 / Math.PI;
      if (ev.shiftKey) g = Math.round(g / 15) * 15;
      for (const a of antes) a.ref.rot = Math.round(clamp(g, -180, 180));
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
    posicionarTodos();
    atualizarFerramentas();
  };

  const soltar = () => {
    no.classList.remove('arrastando');
    limparImas();
    no.removeEventListener('pointermove', mover);
    no.removeEventListener('pointerup', soltar);
    no.removeEventListener('pointercancel', soltar);
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
    if (e.target.closest('.pr-item') || e.target.closest('.guia')) return;
    const rect = prancheta().getBoundingClientRect();
    const alt = H();
    const ini = {
      x: clamp(unidadesX(rect, e.clientX - rect.left), 0, W),
      y: clamp(unidadesY(rect, e.clientY - rect.top), 0, alt),
    };
    vemDaPaleta = false;
    if (!e.shiftKey) { selecao.clear(); marcarSelecaoNoDOM(); atualizarFerramentas(); }

    const laco = $('#pr-marquee');
    let arrastou = false;

    const mover = (ev) => {
      arrastou = true;
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
      for (const it of board.itens) {
        const c = caixaDoItem(it, propDoItem(it));
        const cruza = c.x + c.w / 2 > x0 && c.x - c.w / 2 < x1 &&
                      c.y + c.h / 2 > y0 && c.y - c.h / 2 < y1;
        if (cruza) selecao.add(it.uid);
        else if (!ev.shiftKey) selecao.delete(it.uid);
      }
      marcarSelecaoNoDOM();
      atualizarFerramentas();
    };

    const soltar = () => {
      laco.hidden = true;
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      if (!arrastou) { /* clique simples no vazio: só limpa */ }
    };

    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  });
}

// ------------------------------- Réguas ----------------------------------
function ligarReguas() {
  $('#regua-h').addEventListener('pointerdown', (e) => criarGuiaArrastando(e, 'h'));
  $('#regua-v').addEventListener('pointerdown', (e) => criarGuiaArrastando(e, 'v'));
}

function criarGuiaArrastando(e, eixo) {
  e.preventDefault();
  marcar();
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
  marcar();
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
    // Guia largada fora da colagem é descartada.
    const lista = eixo === 'h' ? board.guias.h : board.guias.v;
    const limite = eixo === 'h' ? alt : W;
    if (lista[idx] <= 0.5 || lista[idx] >= limite - 0.5) lista.splice(idx, 1);
    renderGuias();
  };
  window.addEventListener('pointermove', mover);
  window.addEventListener('pointerup', soltar);
}

// ============================== Ferramentas ===============================
function ligarControles() {
  const on = (sel, evt, fn) => $(sel).addEventListener(evt, fn);

  on('#board-busca', 'input', (e) => { busca = e.target.value.trim(); montarPaleta(); });

  on('#bd-margem-val', 'input', (e) => {
    board.margem = Number(e.target.value);
    renderMargem(); renderAssinatura();
  });

  on('#bd-assinatura', 'input', (e) => { board.assinatura.texto = e.target.value; renderAssinatura(); });
  on('#bd-fonte', 'change', (e) => { board.assinatura.fonte = e.target.value; renderAssinatura(); });
  on('#bd-pos-assinatura', 'change', (e) => { board.assinatura.posicao = e.target.value; renderAssinatura(); });
  on('#bd-tam-assinatura', 'input', (e) => { board.assinatura.tamanho = Number(e.target.value); renderAssinatura(); });
  on('#bd-esp-assinatura', 'input', (e) => { board.assinatura.espaco = Number(e.target.value); renderAssinatura(); });
  on('#bd-cor-assinatura', 'input', (e) => { board.assinatura.cor = e.target.value; renderAssinatura(); });
  on('#bd-ver-assinatura', 'change', (e) => { board.assinatura.visivel = e.target.checked; renderAssinatura(); });
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

  on('#bd-undo', 'click', desfazer);
  on('#bd-redo', 'click', refazer);
  $$('[data-zoom]').forEach(b => b.addEventListener('click', () => {
    const acao = b.dataset.zoom;
    if (acao === 'fit') return encaixar();
    ajustarSozinho = false;
    zoom = clamp(zoom * (acao === '+' ? 1.2 : 1 / 1.2), 0.3, 4);
    $('#prancheta-wrap').style.width = larguraAlvo() + 'px';
    renderAssinatura();
    atualizarBarra();
  }));

  $$('[data-bd]').forEach(b => b.addEventListener('click', () => acaoNaSelecao(b.dataset.bd)));
  $$('[data-arranjo]').forEach(b => b.addEventListener('click', () => arranjar(b.dataset.arranjo)));

  on('#bd-escala', 'input', (e) => {
    const v = Number(e.target.value) / 100 * W;
    for (const it of selecionados()) {
      if (it.travado) continue;
      if (ehTexto(it)) { it.tamanho = clamp(v / 6, 12, 260); medirTexto(it); }
      else it.w = v;
    }
    posicionarTodos();
  });
  on('#bd-rot', 'input', (e) => {
    for (const it of selecionados()) if (!it.travado) it.rot = Number(e.target.value);
    posicionarTodos();
  });
  on('#bd-opacidade', 'input', (e) => {
    for (const it of selecionados()) if (!it.travado) it.opacidade = Number(e.target.value);
    posicionarTodos();
  });
  // A sombra vale para a seleção e, ao mesmo tempo, fica gravada como padrão
  // das próximas peças — para não ter que reajustar a cada colagem.
  on('#bd-sombra', 'change', (e) => {
    const querSombra = e.target.checked;
    if (selecionados().length) {
      marcar();
      for (const it of selecionados()) if (!it.travado) it.sombra = querSombra;
      posicionarTodos();
    }
    db.state.usuario.preferencias.sombra = querSombra;
    db.salvar();
  });

  on('#bd-add-texto', 'click', adicionarTexto);
  on('#bd-texto', 'input', (e) => {
    for (const it of selecionados()) {
      if (!ehTexto(it) || it.travado) continue;
      it.texto = e.target.value;
      medirTexto(it);
    }
    posicionarTodos();
  });
  on('#bd-texto-fonte', 'change', (e) => {
    marcar();
    for (const it of selecionados()) {
      if (!ehTexto(it) || it.travado) continue;
      it.fonte = e.target.value;
      medirTexto(it);
    }
    posicionarTodos();
  });
  on('#bd-texto-cor', 'input', (e) => {
    for (const it of selecionados()) if (ehTexto(it) && !it.travado) it.cor = e.target.value;
    posicionarTodos();
  });

  on('#board-nome', 'input', (e) => { board.nome = e.target.value; });
  on('#bd-salvar', 'click', () => salvarBoard());
  on('#bd-publicar', 'click', publicarBoard);
  on('#bd-sortear', 'click', gerarColagem);
  on('#bd-nova', 'click', async () => {
    if (board.itens.length && !await confirmar('O que não foi salvo nesta colagem se perde.',
      { titulo: 'Começar uma colagem nova?', sim: 'Começar' })) return;
    board = novaColagem();
    selecao.clear(); historico = []; futuro = [];
    encaixar(); render();
  });
  on('#bd-limpar-guias', 'click', () => { marcar(); board.guias = { h: [], v: [] }; renderGuias(); });

  $$('[data-bd-export]').forEach(b => b.addEventListener('click', async () => {
    if (!board.itens.length) return toast('Solte alguma peça antes de exportar.', 'aviso');
    b.disabled = true;
    await baixarBoard(board, { escala: b.dataset.bdExport === 'alta' ? 2 : 1 });
    b.disabled = false;
    toast('PNG gerado. Confere os downloads.');
  }));
}

function acaoNaSelecao(acao) {
  const alvos = selecionados();
  if (!alvos.length) return;
  marcar();

  const zs = board.itens.map(i => i.z);
  const max = Math.max(...zs), min = Math.min(...zs);

  for (const it of alvos) {
    if (it.travado && acao !== 'travar') continue;
    if (acao === 'frente') it.z = max + 1;
    if (acao === 'fundo') it.z = min - 1;
    if (acao === 'subir') it.z += 1;
    if (acao === 'descer') it.z -= 1;
    if (acao === 'espelhar') it.flip = !it.flip;
    if (acao === 'travar') it.travado = !it.travado;
  }
  if (acao === 'duplicar') { historico.pop(); return duplicarSelecionados(); }
  if (acao === 'remover') { historico.pop(); return removerSelecionados(); }

  normalizarZ();
  renderItens();
  atualizarFerramentas();
}

function normalizarZ() {
  [...board.itens].sort((a, b) => a.z - b.z).forEach((it, i) => { it.z = i + 1; });
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
  marcar();

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
  toast(`Colagem sorteada com ${board.itens.length} peças. Ctrl+Z desfaz.`);
}

// Arruma as peças sozinho: grade certinha ou espalhadas com leve inclinação.
function arranjar(modo) {
  const alvos = selecionados().length > 1 ? selecionados() : board.itens;
  if (alvos.length < 2) return;
  marcar();
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
  const livres = vemDaPaleta ? [] : selecionados().filter(s => !s.travado);
  alcaMov ??= alcaMover(prancheta(), (e) => {
    const it = selecionados().find(s => !s.travado);
    const no = it && prancheta().querySelector(`.pr-item[data-uid="${it.uid}"]`);
    if (no) iniciarManipulacao(e, it, no);
  });
  alcaMov.colocar(livres.map(s => prancheta().querySelector(`.pr-item[data-uid="${s.uid}"]`)));
}

function atualizarFerramentas() {
  colocarAlcaMover();
  const alvos = selecionados();
  const tem = alvos.length > 0;
  $('.view-board').classList.toggle('com-selecao', tem && !vemDaPaleta);
  $('#bd-vazio').hidden = tem;
  $('#bd-qtd-sel').textContent = tem ? `(${alvos.length})` : '';
  $$('#bd-selecao .tool-btn, #bd-selecao input').forEach(n => {
    n.disabled = !tem && n.id !== 'bd-sombra';
  });
  if (!tem) $('#bd-sombra').checked = db.state.usuario.preferencias.sombra;
  const texto = alvos.find(ehTexto);
  $('#bd-texto-campos').hidden = !texto;
  if (texto) {
    $('#bd-texto').value = texto.texto;
    $('#bd-texto-fonte').value = texto.fonte;
    $('#bd-texto-cor').value = texto.cor;
  }
  if (!tem) return;
  const it = alvos[0];
  $('#bd-escala').value = Math.round((ehTexto(it) ? it.tamanho * 6 : it.w) / W * 100);
  $('#bd-rot').value = Math.round(it.rot);
  $('#bd-opacidade').value = Math.round(it.opacidade ?? 100);
  $('#bd-sombra').checked = !!it.sombra;
  $('#bd-info').textContent =
    `${board.itens.length} peças · ${alvos.length} selecionada${alvos.length > 1 ? 's' : ''}`;
}

function atualizarBarra() {
  $('#bd-undo').disabled = !historico.length;
  $('#bd-redo').disabled = !futuro.length;
  $('#bd-zoom').textContent = Math.round(zoom * 100) + '%';
  if (!selecionados().length) $('#bd-info').textContent = `${board.itens.length} peças`;
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
    if (document.body.dataset.view !== 'board') return;
    const campo = document.activeElement;
    if (campo && ['INPUT', 'TEXTAREA', 'SELECT'].includes(campo.tagName)) return;

    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      return e.shiftKey ? refazer() : desfazer();
    }
    if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); return refazer(); }
    if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); return duplicarSelecionados(); }
    if (ctrl && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selecao = new Set(board.itens.map(i => i.uid));
      marcarSelecaoNoDOM(); atualizarFerramentas();
      return;
    }
    if (e.key === 'Escape') { selecao.clear(); marcarSelecaoNoDOM(); atualizarFerramentas(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); return removerSelecionados(); }
    if (e.key === '[') return acaoNaSelecao('descer');
    if (e.key === ']') return acaoNaSelecao('subir');

    const passo = e.shiftKey ? 20 : 4;
    const mapa = { ArrowLeft: [-passo, 0], ArrowRight: [passo, 0], ArrowUp: [0, -passo], ArrowDown: [0, passo] };
    const mov = mapa[e.key];
    if (!mov || !selecao.size) return;
    e.preventDefault();
    marcar();
    for (const it of selecionados()) {
      if (it.travado) continue;
      it.x += mov[0]; it.y += mov[1];
    }
    posicionarTodos();
  });
}

// ============================ Salvar / publicar ===========================
function dadosLimpos() {
  return JSON.parse(JSON.stringify({ ...board, itens: board.itens.map(({ uid, ...r }) => r) }));
}

async function salvarBoard({ silencioso = false } = {}) {
  if (!board.itens.length) { toast('A colagem está vazia.', 'aviso'); return null; }
  const nome = board.nome.trim() || `Colagem ${db.state.boards.length + 1}`;
  board.nome = nome;
  $('#board-nome').value = nome;

  const thumb = await miniaturaBoard(board);
  const dados = { ...dadosLimpos(), nome, thumb };

  let salvo = db.state.boards.find(b => b.id === board.id);
  if (salvo) {
    Object.assign(salvo, dados, { editadoEm: new Date().toISOString() });
  } else {
    salvo = { ...dados, id: 'bd' + Date.now(), criadoEm: new Date().toISOString(), publicado: false };
    db.state.boards.push(salvo);
    db.progredirMissao('board');
    board.id = salvo.id;
  }
  db.salvar();
  renderLista();
  if (!silencioso) toast(`"${nome}" salva.`);
  return salvo;
}

async function publicarBoard() {
  const salvo = await salvarBoard({ silencioso: true });
  if (!salvo) return;
  if (salvo.publicado && jaPublicado('boardId', salvo.id)) {
    return toast('Essa colagem já está no feed.', 'aviso');
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

// As colagens salvas moram só no painel "Minhas colagens" (mais abaixo),
// aberto pelo botão em cima da mesa; aqui só se atualiza o número dele e o
// painel, se estiver aberto.
function renderLista() {
  const qtd = $('#mc-qtd');
  if (qtd) qtd.textContent = db.state.boards.length ? String(db.state.boards.length) : '';
  if ($('#modal-colagens') && !$('#modal-colagens').hidden) renderMinhas();
}

// --- Minhas colagens ------------------------------------------------------
// O mesmo painel do Meus stylists (stylist.js), com as mesmas classes ms-*:
// no PC um modal com uma grade de cartões; no celular a tela toda, duas
// colunas. O cartão abre a colagem na mesa, e o ⋯ guarda o resto: renomear,
// duplicar e apagar.
let mcFiltro = 'todos';
let mcMenuAberto = null;      // id da colagem com o menu ⋯ aberto
let mcRenomeando = null;      // id da colagem com o nome virando campo
const miniaturas = new Map(); // id -> miniatura desenhada agora (save sem thumb)

const quandoDaColagem = (b) => b.editadoEm || b.criadoEm || '';

function ordenarColagens(boards, ordem) {
  const lista = [...boards];
  if (ordem === 'nome') return lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const pos = new Map(boards.map((b, i) => [b.id, i]));
  lista.sort((a, b) =>
    quandoDaColagem(b).localeCompare(quandoDaColagem(a)) || pos.get(b.id) - pos.get(a.id));
  return ordem === 'antigos' ? lista.reverse() : lista;
}

function dataCurta(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
    .replace(/ de /g, ' ').replace('.', '');
}

function montarMinhasColagens() {
  const modal = $('#modal-colagens');
  if (!modal) return;
  $('#btn-minhas-colagens').addEventListener('click', abrirMinhas);
  $('#mc-fechar').addEventListener('click', fecharMinhas);
  $('#mc-novo').addEventListener('click', async () => {
    fecharMinhas();
    if (board.itens.length && !await confirmar('O que não foi salvo nesta colagem se perde.',
      { titulo: 'Começar uma colagem nova?', sim: 'Começar' })) return;
    board = novaColagem();
    selecao.clear(); historico = []; futuro = [];
    encaixar(); render();
    toast('Mesa limpa: monte a colagem nova e salve.');
  });
  $('#mc-busca').addEventListener('input', renderMinhas);
  $('#mc-ordem').addEventListener('change', renderMinhas);
  modal.addEventListener('pointerdown', (e) => { if (e.target === modal) fecharMinhas(); });
  // Clicar fora do ⋯ fecha o menu dele.
  modal.addEventListener('click', (e) => {
    if (mcMenuAberto && !e.target.closest('.ms-menu, .ms-mais')) {
      mcMenuAberto = null;
      renderMinhas();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || modal.hidden || mcRenomeando) return;
    if (mcMenuAberto) { mcMenuAberto = null; renderMinhas(); return; }
    fecharMinhas();
  });
}

function abrirMinhas() {
  mcMenuAberto = null;
  mcRenomeando = null;
  $('#mc-busca').value = '';
  $('#modal-colagens').hidden = false;
  document.body.classList.add('com-modal');
  renderMinhas();
}

function fecharMinhas() {
  $('#modal-colagens').hidden = true;
  document.body.classList.remove('com-modal');
  mcMenuAberto = null;
  mcRenomeando = null;
}

function renderMinhas() {
  const boards = db.state.boards;
  const favs = boards.filter(b => b.favorito).length;
  const noFeed = boards.filter(b => b.publicado).length;

  $('#mc-sub').textContent = boards.length
    ? `${boards.length} ${boards.length === 1 ? 'colagem salva' : 'colagens salvas'} · ${favs} de 3 no perfil`
    : '';

  $('#mc-filtros').replaceChildren(...[
    ['todos', 'Todas', boards.length],
    ['fav', [ico('estrela-cheia'), ' Favoritas'], favs],
    ['feed', 'No feed', noFeed],
  ].map(([id, nome, n]) => el('button', {
    type: 'button',
    class: 'ms-filtro' + (mcFiltro === id ? ' ativo' : ''),
    onclick: () => { mcFiltro = id; renderMinhas(); },
  }, nome, el('small', {}, String(n)))));

  const termo = $('#mc-busca').value.trim().toLocaleLowerCase('pt-BR');
  const visiveis = ordenarColagens(boards, $('#mc-ordem').value).filter(b =>
    (mcFiltro === 'todos' || (mcFiltro === 'fav' ? b.favorito : b.publicado)) &&
    (!termo || b.nome.toLocaleLowerCase('pt-BR').includes(termo)));

  const grade = $('#mc-grade');
  grade.replaceChildren();
  if (!boards.length) {
    grade.append(el('div', { class: 'ms-vazio' },
      el('strong', {}, 'Nenhuma colagem salva ainda'),
      el('p', {}, 'Solte as suas peças na mesa e toque em "salvar": ela aparece aqui.')));
    return;
  }
  if (!visiveis.length) {
    grade.append(el('div', { class: 'ms-vazio' },
      el('p', {}, termo ? `Nenhuma colagem com "${$('#mc-busca').value.trim()}".`
        : mcFiltro === 'fav' ? 'Nenhuma favorita. Toque na ☆ de uma colagem para ela ir para o seu perfil.'
        : 'Nenhuma colagem publicada no feed ainda.')));
    return;
  }
  for (const b of visiveis) grade.append(cartaoDaColagem(b));

  const campo = grade.querySelector('.ms-renomear');
  if (campo) { campo.focus(); campo.select(); }
}

// A miniatura do save pode ter sido descartada (quota cheia: ver db.salvar);
// aí desenha uma agora e guarda só na memória.
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

function cartaoDaColagem(b) {
  const aberta = b.id === board.id;
  const nPecas = b.itens?.filter(i => i.tipo !== 'texto').length || 0;

  const nome = mcRenomeando === b.id
    ? el('input', {
      class: 'ms-renomear', type: 'text', value: b.nome, maxlength: '46',
      'aria-label': 'Novo nome da colagem',
      onkeydown: (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        // Esc aqui só desiste do nome: não pode subir e fechar o painel.
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); mcRenomeando = null; renderMinhas(); }
      },
      onblur: (e) => { if (mcRenomeando === b.id) renomearColagem(b.id, e.currentTarget.value); },
    })
    : el('button', {
      type: 'button', class: 'ms-nome', title: 'Renomear',
      onclick: () => { mcRenomeando = b.id; mcMenuAberto = null; renderMinhas(); },
    }, b.nome);

  const menu = mcMenuAberto === b.id ? el('div', { class: 'ms-menu', role: 'menu' },
    el('button', { type: 'button', role: 'menuitem', onclick: () => abrirDoPainel(b.id) }, ico('editar'), ' Abrir e editar'),
    el('button', {
      type: 'button', role: 'menuitem',
      onclick: () => { mcRenomeando = b.id; mcMenuAberto = null; renderMinhas(); },
    }, 'Aa Renomear'),
    el('button', { type: 'button', role: 'menuitem', onclick: () => duplicarColagem(b.id) }, ico('duplicar'), ' Duplicar'),
    el('button', { type: 'button', role: 'menuitem', class: 'perigo', onclick: () => apagarColagem(b.id) }, ico('lixo'), ' Excluir'),
  ) : null;

  return el('article', { class: 'ms-card' + (aberta ? ' aberto' : '') + (menu ? ' com-menu' : '') },
    el('button', {
      type: 'button', class: 'ms-thumb',
      title: `Abrir "${b.nome}" na mesa para editar`,
      onclick: () => abrirDoPainel(b.id),
    },
      imagemDoCartao(b),
      el('span', { class: 'ms-editar' }, ico('editar'), ' Editar'),
      aberta ? el('span', { class: 'ms-selo' }, 'na mesa') : null,
      b.publicado ? el('span', { class: 'ms-selo feed' }, 'no feed') : null,
    ),
    el('div', { class: 'ms-fav' }, estrelaFavorito('colagem', b.id, renderLista)),
    el('div', { class: 'ms-info' },
      el('div', { class: 'ms-linha' },
        nome,
        el('button', {
          type: 'button', class: 'ms-apagar', title: `Apagar "${b.nome}"`,
          'aria-label': `Apagar "${b.nome}"`,
          onclick: () => apagarColagem(b.id),
        }, ico('lixo')),
        el('button', {
          type: 'button', class: 'ms-mais', title: 'Mais opções',
          'aria-haspopup': 'menu', 'aria-expanded': menu ? 'true' : 'false',
          onclick: () => { mcMenuAberto = mcMenuAberto === b.id ? null : b.id; renderMinhas(); },
        }, ico('mais'))),
      el('small', {}, [dataCurta(quandoDaColagem(b)),
        nPecas === 1 ? '1 peça' : `${nPecas} peças`].filter(Boolean).join(' · '))),
    menu);
}

function abrirDoPainel(id) {
  abrirBoard(id);
  fecharMinhas();
  const salvo = db.state.boards.find(b => b.id === id);
  if (salvo) toast(`"${salvo.nome}" na mesa. Mexa e toque em "salvar".`);
}

function renomearColagem(id, valor) {
  mcRenomeando = null;
  const salvo = db.state.boards.find(b => b.id === id);
  const nome = String(valor || '').trim().slice(0, 46);
  if (salvo && nome && nome !== salvo.nome) {
    salvo.nome = nome;
    if (id === board.id) { board.nome = nome; $('#board-nome').value = nome; }
    db.salvar();
    toast(`Renomeada para "${nome}".`);
  }
  renderLista();
  renderMinhas();
}

function duplicarColagem(id) {
  const orig = db.state.boards.find(b => b.id === id);
  if (!orig) return;
  const agora = new Date().toISOString();
  // A cópia é uma colagem nova: não herda a estrela nem o "no feed".
  const copia = {
    ...structuredClone(orig),
    id: 'bd' + Date.now(),
    nome: `${orig.nome} (cópia)`.slice(0, 46),
    criadoEm: agora,
    editadoEm: agora,
    publicado: false,
    favorito: false,
  };
  db.state.boards.push(copia);
  mcMenuAberto = null;
  db.salvar();
  renderLista();
  renderMinhas();
  toast(`"${copia.nome}" criada.`);
}

function apagarColagem(id) {
  const salvo = db.state.boards.find(b => b.id === id);
  if (!salvo) return;
  mcMenuAberto = null;
  const aviso = `Excluir "${salvo.nome}"? Não dá para desfazer.` +
    (jaPublicado('boardId', id) || salvo.publicado ? '\nO post dela sai do feed também.' : '');
  if (!confirm(aviso)) { renderLista(); return; }
  db.state.boards.splice(db.state.boards.indexOf(salvo), 1);
  miniaturas.delete(id);
  // A mesa fica como está, só deixa de ser aquela colagem: salvar de novo cria outra.
  if (id === board.id) board.id = null;
  db.salvar();
  renderLista();
  toast(`"${salvo.nome}" excluída.`);
  apagarDoFeedPorOrigem('board', id).then(ok => {
    db.salvar();
    if (!ok) toast('Não consegui tirar o post do feed agora. Apague por lá.', 'aviso');
  });
}

export function abrirBoard(id) {
  const salvo = db.state.boards.find(b => b.id === id);
  if (!salvo) return;
  const { thumb, publicado, criadoEm, editadoEm, ...dados } = salvo;
  board = JSON.parse(JSON.stringify(dados));
  board.itens = board.itens.map(i => ({ ...i, uid: 'b' + (uidSeq++) }));
  board.guias = board.guias || { h: [], v: [] };
  // Colagem salva antes de a moldura sair: aproveita a margem e larga o resto.
  board.margem = margemDe(board);
  delete board.moldura; delete board.fundo;
  selecao.clear(); historico = []; futuro = [];
  encaixar(); render();
}

export function aoEntrarNoBoard() {
  // A mesa vazia nasceu antes do login (ou na conta anterior): refaz com a
  // assinatura de quem está entrando agora.
  if (!board.id && !board.itens.length) board = novaColagem();
  montarBoard();
  montarPaleta();
  encaixar();
  render();
}
