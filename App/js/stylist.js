// Stylist: a mesa de colagem.
//
// O palco tem 600×1200 unidades e é escalado pelo CSS — todas as coordenadas das
// camadas são guardadas nessas unidades, então o look salvo fica igual em
// qualquer tela e na exportação. Cada peça entra já encaixada no ponto de
// ancoragem da sua categoria (engine de lookbook) e dentro da sua camada de
// z-index; dali a pessoa move, gira e redimensiona à vontade.

import { CONFIG, CATEGORIAS, RARIDADE, escalaGrade, ancoraDaPeca } from './config.js';
import { doPadraoParaAtual, doAtualParaPadrao } from './proporcao.js';
import { item as pecaDoCatalogo, nomeDaPeca, proporcao, aplicarContorno, srcGrande, pecaCombina } from './catalog.js';
import { grupoDe, gruposDoInventario, seletorDeAgrupamento } from './agrupamento.js';
import { ordenar, preencherComGrupos, seletorDeOrdem } from './ordenacao.js';
import * as db from './db.js';
import { svgAvatar } from './avatar.js';
import { miniaturaAtual, miniaturaPronta, baixarLook } from './render.js';
import { publicarOuGuardar, publicarNoFeed, pacoteDoLook, jaPublicado } from './publicacoes.js';
import { sortearConjunto, camadasParaAvatar } from './sorteio.js';
import { el, $, $$, clamp, toast, teclaLivre, anguloNormal, ehToque, soltarCampo } from './util.js';
import { ico, emo } from './icones.js';
import { alcaMover } from './alcamover.js';
import { camadaDeAlcas } from './alcas.js';
import { ligarPinca } from './pinca.js';
import { confirmar, pedirTexto } from './janela.js';
import { criarDesfazer } from './desfazer.js';
import { criarPainel, idNovo, nomeLivre } from './painelsalvos.js';
import { animando, cairNoCorpo } from './movimento.js';
import { barrasPosicao } from './barrapos.js';

let camadas = [];
let selecionado = null;
// Marca se o que está no palco veio de um sorteio e não foi mexido: enquanto
// for o caso, gerar de novo não pergunta nada.
let palcoSorteado = false;
let lookAtualId = null;
let catPaleta = 'todas';   // o grupo aberto; a paleta abre mostrando o guarda-roupa inteiro
let buscaPaleta = '';
let guiaLigado = false;
let uidSeq = 1;
let painel = null;
let alcas = null, pinca = null, barrasPos = null;

const ESC_MIN = 0.2, ESC_MAX = 2.2;
const stage = () => $('#stage');
const unidades = (rect, px, eixo) =>
  eixo === 'x' ? px / rect.width * CONFIG.STAGE_W : px / rect.height * CONFIG.STAGE_H;
const atual = () => camadas.find(c => c.uid === selecionado);
const noDe = (c) => c && $(`.camada[data-uid="${c.uid}"]`);

// Desfazer/refazer: fotos do palco antes de cada mudança. Abrir outro look
// zera as duas pilhas, como na Colagem.
const hist = criarDesfazer({
  foto: () => JSON.stringify(camadas),
  restaurar: (json) => {
    camadas = JSON.parse(json);
    if (!camadas.some(c => c.uid === selecionado)) selecionado = null;
    palcoSorteado = false;
    renderCamadas();
    atualizarVestidas();
  },
  aoMudar: () => {
    const d = $('#st-undo'), r = $('#st-redo');
    if (d) d.disabled = !hist.podeDesfazer();
    if (r) r.disabled = !hist.podeRefazer();
  },
});

// Toda mudança feita à mão passa por aqui: entra no histórico (junto, se for
// um gesto contínuo) e o palco deixa de ser "o sorteado", então gerar de novo
// volta a perguntar antes de jogar o trabalho fora.
function mudanca(gesto = null) {
  palcoSorteado = false;
  if (gesto) hist.marcarJunto(gesto); else hist.marcar();
}

// --- Montagem -------------------------------------------------------------
export function montarStylist() {
  desenharAvatar();
  montarPaleta();
  ligarFerramentas();
  renderCamadas();
  hist.zerar();
  montarMeusStylists();

  alcas = camadaDeAlcas(stage(), {
    classe: 'st-alcas',
    aoPegar: (e, uid) => {
      const c = camadas.find(k => k.uid === uid);
      if (c) iniciarManipulacao(e, c, noDe(c));
    },
  });
  pinca = ligarPinca(stage(), {
    comecar: () => {
      const c = atual();
      if (!c) return null;
      mudanca();
      return { c, escala: c.escala, rot: c.rot };
    },
    mudar: (s, fator, graus) => {
      s.c.escala = clamp(s.escala * fator, ESC_MIN, ESC_MAX);
      s.c.rot = Math.round(anguloNormal(s.rot + graus));
      posicionar(s.c);
      atualizarFerramentas();
    },
  });

  // ⇅ (só no celular): mostra e esconde o agrupar e a ordem da paleta.
  $('#palette-ajustes').addEventListener('click', (e) => {
    const aberto = $('.stylist-palette').classList.toggle('abertas');
    e.currentTarget.setAttribute('aria-expanded', String(aberto));
  });
  $('#palette-busca').addEventListener('input', (e) => {
    buscaPaleta = e.target.value;
    montarPaleta();
  });

  stage().addEventListener('pointerdown', (e) => {
    if (e.target.closest('.camada, .alcas-moldura, .alca-mover, .st-troca')) return;
    fecharTroca();
    selecionar(null);
  });

  // Ctrl+Z desfaz; Ctrl+Y ou Ctrl+Shift+Z refaz.
  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.view !== 'stylist' || !(e.ctrlKey || e.metaKey) || !teclaLivre()) return;
    const k = e.key.toLowerCase();
    if (k === 'z') { e.preventDefault(); e.shiftKey ? hist.refazer() : hist.desfazer(); }
    else if (k === 'y') { e.preventDefault(); hist.refazer(); }
  });

  // Com uma peça escolhida: setas movem (Shift: passo maior), R / Shift+R
  // giram 15°, + e − mudam o tamanho, Delete tira, Esc solta a escolha.
  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.view !== 'stylist' || !teclaLivre()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const c = atual();
    if (!c) return;
    const passo = e.shiftKey ? 12 : 3;
    const mover = { ArrowLeft: [-passo, 0], ArrowRight: [passo, 0], ArrowUp: [0, -passo], ArrowDown: [0, passo] }[e.key];
    if (mover) {
      e.preventDefault();
      mudanca('setas');
      c.x = clamp(c.x + mover[0], -80, CONFIG.STAGE_W + 80);
      c.y = clamp(c.y + mover[1], -80, CONFIG.STAGE_H + 80);
    } else if (e.key === 'r' || e.key === 'R') {
      mudanca('girar');
      c.rot = Math.round(anguloNormal(c.rot + (e.shiftKey ? -15 : 15)));
    } else if (e.key === '+' || e.key === '=' || e.key === '-') {
      mudanca('escala');
      c.escala = clamp(c.escala * (e.key === '-' ? 0.94 : 1.06), ESC_MIN, ESC_MAX);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      return remover(c.uid);
    } else if (e.key === 'Escape') {
      return selecionar(null);
    } else return;
    posicionar(c);
    atualizarFerramentas();
  });
}

function desenharAvatar() {
  $('#stage-avatar').innerHTML = svgAvatar({ guia: guiaLigado });
}

// --- Paleta de peças ------------------------------------------------------
function montarPaleta() {
  // Se o grupo aberto não tem nada (ou deixou de existir, quando a pessoa
  // trocou peça ↔ corpo), volta para "todas" — senão a paleta abre vazia
  // mesmo com o guarda-roupa cheio.
  const grupos = gruposDoInventario();
  if (catPaleta !== 'todas' && db.state.inventario.length &&
      !grupos.some(g => g.id === catPaleta && g.qtd)) {
    catPaleta = 'todas';
  }

  $('#palette-agrupar').replaceChildren(seletorDeAgrupamento(() => {
    catPaleta = 'todas';
    montarPaleta();
  }));
  $('#palette-ordem').replaceChildren(seletorDeOrdem(() => montarPaleta()));

  const abas = $('#palette-cats');
  abas.innerHTML = '';

  // Primeira aba: o guarda-roupa inteiro, como no rail do closet.
  const total = db.state.inventario.length;
  abas.append(el('button', {
    type: 'button',
    class: 'pal-cat todas' + (catPaleta === 'todas' ? ' active' : ''),
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

  const grid = $('#palette-grid');
  grid.innerHTML = '';
  const pecas = ordenar(db.state.inventario
    .filter(p => catPaleta === 'todas' || grupoDe(p) === catPaleta)
    .filter(p => pecaCombina(p, buscaPaleta)));

  if (!total) {
    grid.append(el('p', { class: 'palette-vazia' },
      'Seu guarda-roupa está vazio. Pegue peças na vitrine primeiro.'));
    return;
  }
  if (!pecas.length) {
    grid.append(el('p', { class: 'palette-vazia' },
      buscaPaleta.trim() ? `Nenhuma peça com "${buscaPaleta.trim()}".` : 'Nada nessa categoria ainda.'));
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
    const nome = nomeDaPeca(peca);
    return el('button', {
      type: 'button',
      class: `pal-item r-${p.raridade || 'common'}`,
      style: { '--rar-borda': r.aura && r.aura !== 'arco-iris' ? r.aura : r.cor },
      dataset: { id: p.id, nome, acao },
      onclick: () => vestirPeca(p.id),
    }, el('div', {
      class: 'peca-caixa',
      style: { '--esc': String(escalaGrade(peca)) },
    }, img));
  }, { categoriaAberta: catPaleta !== 'todas' });
  atualizarVestidas();
}

// Só a marca de "no palco" de cada botão da paleta: vestir ou tirar uma peça
// não precisa refazer a paleta inteira (com 200 peças, pesava no celular).
function atualizarVestidas() {
  const noPalco = new Set(camadas.map(c => c.itemId));
  for (const b of $$('#palette-grid .pal-item')) {
    const vestida = noPalco.has(b.dataset.id);
    b.classList.toggle('vestida', vestida);
    b.setAttribute('aria-pressed', String(vestida));
    b.title = vestida ? `${b.dataset.nome} — no palco (${b.dataset.acao} para tirar)` : b.dataset.nome;
    b.setAttribute('aria-label', vestida ? `${b.dataset.nome}, no palco` : b.dataset.nome);
  }
}

// --- Camadas --------------------------------------------------------------
// Cada categoria é um lugar no corpo, não uma pilha: o palco tem uma peça de
// cada. Escolher outra calça troca a que está lá; clicar de novo na mesma peça
// tira ela do palco.
export function vestirPeca(itemId) {
  const peca = pecaDoCatalogo(itemId);
  if (!peca) return;
  mudanca();
  fecharTroca();

  if (camadas.some(c => c.itemId === itemId)) {
    camadas = camadas.filter(c => c.itemId !== itemId);
    if (!camadas.some(c => c.uid === selecionado)) selecionado = null;
    renderCamadas();
    atualizarVestidas();
    return;
  }

  // A peça anterior da categoria sai, mas o lugar dela fica: se você tinha
  // mexido na camada (subido, descido), a nova entra na mesma altura.
  const anterior = camadas.find(c => c.cat === peca.cat);
  camadas = camadas.filter(c => c.cat !== peca.cat);

  const a = ancoraDaPeca(peca);
  const camada = {
    uid: 'c' + (uidSeq++),
    itemId,
    cat: peca.cat,
    x: a.x, y: a.y,
    escala: 1,
    rot: 0,
    flip: false,
    z: anterior ? anterior.z : a.z,
  };
  camadas.push(camada);
  selecionado = camada.uid;
  renderCamadas();
  atualizarVestidas();
}

// Atualiza o palco sem recriar quem já estava nele: só a peça que chegou
// ganha um nó novo (e cai no corpo), as outras só se reposicionam.
function renderCamadas() {
  const raiz = $('#stage-layers');
  const vivos = new Map($$('.camada', raiz).map(n => [n.dataset.uid, n]));
  for (const c of camadas) {
    let no = vivos.get(c.uid);
    vivos.delete(c.uid);
    if (no && no.dataset.item === c.itemId) {
      posicionar(c, no);
      continue;
    }
    no?.remove();
    no = criarCamadaDOM(c);
    no.classList.add('chegou');
    if (animando()) {
      no.classList.add('com-gsap');
      cairNoCorpo(no.querySelector('img'));
    }
    raiz.append(no);
  }
  for (const n of vivos.values()) n.remove();
  marcarSelecao();
}

function criarCamadaDOM(c) {
  const peca = pecaDoCatalogo(c.itemId);
  // No palco a peça cresce na mão: vai a grande desde o começo.
  const img = el('img', { src: srcGrande(peca), alt: '', draggable: 'false' });
  aplicarContorno(img, peca);

  // Peça no palco também recebe foco (Tab): Enter ou espaço a escolhem, e
  // aí as setas, R e +/− mexem nela.
  const no = el('div', {
    class: 'camada',
    tabindex: '0', role: 'button',
    'aria-label': nomeDaPeca(peca),
    dataset: { uid: c.uid, item: c.itemId },
  }, img);

  no.addEventListener('pointerdown', (e) => {
    const k = camadas.find(x => x.uid === no.dataset.uid);
    if (k) iniciarManipulacao(e, k, no);
  });
  no.addEventListener('focus', () => { if (selecionado !== no.dataset.uid) selecionar(no.dataset.uid); });
  no.addEventListener('dblclick', () => abrirTroca(no.dataset.uid));
  no.addEventListener('wheel', (e) => {
    const k = camadas.find(x => x.uid === no.dataset.uid);
    if (!k || k.uid !== selecionado) return;
    e.preventDefault();
    mudanca('roda');
    k.escala = clamp(k.escala * (e.deltaY < 0 ? 1.06 : 0.94), ESC_MIN, ESC_MAX);
    posicionar(k);
    atualizarFerramentas();
  }, { passive: false });

  posicionar(c, no);
  return no;
}

function posicionar(c, no = null) {
  const alvo = no || noDe(c);
  if (!alvo) return;
  const peca = pecaDoCatalogo(c.itemId);
  const larguraUnid = ancoraDaPeca(peca).w * c.escala;
  alvo.style.left = (c.x / CONFIG.STAGE_W * 100) + '%';
  alvo.style.top = (c.y / CONFIG.STAGE_H * 100) + '%';
  alvo.style.width = (larguraUnid / CONFIG.STAGE_W * 100) + '%';
  alvo.style.aspectRatio = String(proporcao(peca));
  alvo.style.zIndex = String(c.z);
  alvo.style.transform = `translate(-50%, -50%) rotate(${c.rot}deg)`;
  alvo.querySelector('img').style.transform = c.flip ? 'scaleX(-1)' : '';
}

// Segurar a peça parada (~½ s, no dedo) também abre a troca rápida.
const SEGURAR_MS = 520;

function iniciarManipulacao(e, c, no) {
  if (!no || e.button > 0) return;
  e.preventDefault();
  soltarCampo();
  // Peça já escolhida (ou puxada pela alça) anda desde o primeiro pixel: é
  // assim que se faz o ajuste fino, como encaixar o óculos no rosto.
  const jaEscolhida = selecionado === c.uid || Boolean(e.target.dataset?.alca);
  if (selecionado !== c.uid) selecionar(c.uid);
  fecharTroca();

  const rect = stage().getBoundingClientRect();
  const alca = e.target.dataset?.alca;
  const centro = {
    x: rect.left + (c.x / CONFIG.STAGE_W) * rect.width,
    y: rect.top + (c.y / CONFIG.STAGE_H) * rect.height,
  };
  const inicial = { x: c.x, y: c.y, escala: c.escala, rot: c.rot };
  const inicioPtr = { x: e.clientX, y: e.clientY };
  const raio0 = Math.hypot(e.clientX - centro.x, e.clientY - centro.y) || 1;
  const ang0 = Math.atan2(e.clientY - centro.y, e.clientX - centro.x);

  no.setPointerCapture(e.pointerId);
  no.classList.add('manipulando');
  let mexeu = false;   // só um clique para selecionar não entra no histórico
  const segurar = !alca && e.pointerType === 'touch'
    ? setTimeout(() => { if (!mexeu) { soltar(); abrirTroca(c.uid); } }, SEGURAR_MS) : 0;

  // O ponteiro manda vários movimentos por quadro: guarda o último e desenha
  // uma vez por quadro. Arrastar só mexe no transform (a peça já está numa
  // camada própria); left/top voltam a valer ao soltar.
  let ultimo = null, quadroMov = 0;
  const desenhar = () => {
    quadroMov = 0;
    if (!ultimo) return;
    ultimo = null;
    if (alca === 'esc' || alca === 'rot') {
      posicionar(c, no);
      atualizarFerramentas();
      return;
    }
    // Só andar: a peça, a moldura e a alça de mover vão juntas pelo mesmo
    // deslocamento, sem medir nada na página (medir a cada quadro travava).
    const dx = (c.x - inicial.x) / CONFIG.STAGE_W * rect.width;
    const dy = (c.y - inicial.y) / CONFIG.STAGE_H * rect.height;
    no.style.transform = `translate(${dx}px, ${dy}px) translate(-50%, -50%) rotate(${c.rot}deg)`;
    for (const n of junto) n.style.translate = `${dx}px ${dy}px`;
  };
  const junto = [alcas?.camada, alcaMov?.botao].filter(Boolean);

  const mover = (ev) => {
    if (pinca?.ativa()) return;
    // No toque que só escolhe a peça, um tremor de 3px não é arrasto: não
    // suja o histórico. Na peça já escolhida qualquer movimento vale.
    if (!mexeu && Math.hypot(ev.clientX - inicioPtr.x, ev.clientY - inicioPtr.y) < (jaEscolhida ? 0.5 : 3)) return;
    if (!mexeu) { mudanca(); mexeu = true; clearTimeout(segurar); }
    if (alca === 'esc') {
      const raio = Math.hypot(ev.clientX - centro.x, ev.clientY - centro.y);
      c.escala = clamp(inicial.escala * (raio / raio0), ESC_MIN, ESC_MAX);
    } else if (alca === 'rot') {
      const ang = Math.atan2(ev.clientY - centro.y, ev.clientX - centro.x);
      let g = inicial.rot + (ang - ang0) * 180 / Math.PI;
      if (ev.shiftKey) g = Math.round(g / 15) * 15;
      c.rot = Math.round(anguloNormal(g));
    } else {
      c.x = clamp(inicial.x + unidades(rect, ev.clientX - inicioPtr.x, 'x'), -80, CONFIG.STAGE_W + 80);
      c.y = clamp(inicial.y + unidades(rect, ev.clientY - inicioPtr.y, 'y'), -80, CONFIG.STAGE_H + 80);
    }
    ultimo = ev;
    quadroMov ||= requestAnimationFrame(desenhar);
  };

  function soltar() {
    clearTimeout(segurar);
    cancelAnimationFrame(quadroMov);
    quadroMov = 0;
    for (const n of junto) n.style.translate = '';
    posicionar(c, no);
    no.classList.remove('manipulando');
    no.removeEventListener('pointermove', mover);
    no.removeEventListener('pointerup', soltar);
    no.removeEventListener('pointercancel', soltar);
    atualizarFerramentas();
  }

  no.addEventListener('pointermove', mover);
  no.addEventListener('pointerup', soltar);
  no.addEventListener('pointercancel', soltar);
}

function selecionar(uid) {
  selecionado = uid;
  marcarSelecao();
}

function marcarSelecao() {
  $$('.camada').forEach(n => n.classList.toggle('selecionada', n.dataset.uid === selecionado));
  atualizarFerramentas();
}

function remover(uid) {
  mudanca();
  camadas = camadas.filter(c => c.uid !== uid);
  if (selecionado === uid) selecionado = null;
  fecharTroca();
  renderCamadas();
  atualizarVestidas();       // a peça volta a aparecer como "fora do palco"
}

// --- Troca rápida ---------------------------------------------------------
// Duplo clique (ou segurar, no dedo) numa peça do palco: as outras peças da
// mesma categoria aparecem ali do lado, e tocar numa troca sem voltar à paleta.
function abrirTroca(uid) {
  const c = camadas.find(k => k.uid === uid);
  if (!c) return;
  fecharTroca();
  const outras = db.state.inventario
    .filter(p => p.id !== c.itemId && pecaDoCatalogo(p.id)?.cat === c.cat);
  const caixa = el('div', { class: 'st-troca', role: 'dialog', 'aria-label': 'Trocar por outra peça' },
    el('p', { class: 'st-troca-titulo' }, outras.length
      ? `Trocar ${CATEGORIAS[c.cat]?.nome?.toLowerCase() || 'peça'}` : 'Nenhuma outra peça dessa categoria'),
    el('div', { class: 'st-troca-lista' }, outras.map(p => {
      const peca = pecaDoCatalogo(p.id);
      const img = el('img', { src: peca.src, alt: '' });
      aplicarContorno(img, peca);
      return el('button', {
        type: 'button', class: 'st-troca-item', title: nomeDaPeca(peca), 'aria-label': nomeDaPeca(peca),
        onclick: () => trocarPor(uid, p.id),
      }, img);
    })));
  stage().append(caixa);
  caixa.querySelector('button')?.focus();
}

function trocarPor(uid, itemId) {
  const c = camadas.find(k => k.uid === uid);
  const peca = pecaDoCatalogo(itemId);
  if (!c || !peca) return;
  mudanca();
  // A nova fica onde a outra estava (lugar, giro e camada), com o tamanho
  // da âncora dela.
  Object.assign(c, { uid: 'c' + (uidSeq++), itemId, cat: peca.cat });
  selecionado = c.uid;
  fecharTroca();
  renderCamadas();
  atualizarVestidas();
}

function fecharTroca() { $('.st-troca')?.remove(); }

// --- Ferramentas ----------------------------------------------------------
function ligarFerramentas() {
  $$('#layer-tools .tool-btn').forEach(btn => btn.addEventListener('click', () => {
    const c = atual();
    if (!c) return;
    const act = btn.dataset.act;
    if (act === 'del') return remover(c.uid);
    if (act === 'trocar') return abrirTroca(c.uid);
    mudanca();
    if (act === 'up')   c.z = Math.min(999, c.z + 1);
    if (act === 'down') c.z = Math.max(1, c.z - 1);
    if (act === 'flip') c.flip = !c.flip;
    if (act === 'girar') c.rot = Math.round(anguloNormal(c.rot + 15));
    if (act === 'reset') {
      const a = ancoraDaPeca(pecaDoCatalogo(c.itemId));
      Object.assign(c, { x: a.x, y: a.y, escala: 1, rot: 0, flip: false, z: a.z });
    }
    posicionar(c);
    atualizarFerramentas();
  }));

  // O tamanho tem duas barras: a do painel (PC) e a em pé no palco (celular).
  const mudarEscala = (valor) => {
    const c = atual();
    if (!c) return;
    mudanca('escala');
    c.escala = clamp(valor / 100, ESC_MIN, ESC_MAX);
    posicionar(c);
    atualizarFerramentas();
  };
  // Celular: barra em pé à direita (altura) e deitada embaixo (lados).
  const moldura = $('#stage').parentElement;
  barrasPos = barrasPosicao({
    paiX: moldura, paiY: moldura,
    faixaX: [-80, CONFIG.STAGE_W + 80], faixaY: [-80, CONFIG.STAGE_H + 80],
    ler: () => atual(),
    mudar: ({ x, y }, gesto) => {
      const c = atual();
      if (!c) return;
      mudanca(gesto);
      c.x = x; c.y = y;
      posicionar(c);
      atualizarFerramentas();
    },
  });
  $('#sld-escala').addEventListener('input', (e) => mudarEscala(Number(e.target.value)));
  $('#sld-escala-vert').addEventListener('input', (e) => mudarEscala(Number(e.target.value)));
  // + e − dão um passo de 10% de cada vez, para ajustar sem arrastar.
  $$('.st-tam-btn').forEach(b => b.addEventListener('click', () => {
    const c = atual();
    if (c) mudarEscala(Math.round(c.escala * 100) + 10 * Number(b.dataset.tam));
  }));
  $('#sld-rot').addEventListener('input', (e) => {
    const c = atual();
    if (!c) return;
    mudanca('rot');
    c.rot = Number(e.target.value);
    posicionar(c);
    agendarFerramentas();
  });

  $('#btn-limpar').addEventListener('click', () => {
    if (camadas.length) hist.marcar();
    limparPalco({ manterHistorico: true });
  });
  $('#st-undo').addEventListener('click', () => hist.desfazer());
  $('#st-redo').addEventListener('click', () => hist.refazer());
  $('#btn-apagar-look').addEventListener('click', () => {
    if (lookAtualId) painel.apagar(lookAtualId);
  });
  $('#btn-guia').addEventListener('click', (e) => {
    guiaLigado = !guiaLigado;
    e.currentTarget.classList.toggle('ativo', guiaLigado);
    e.currentTarget.setAttribute('aria-pressed', String(guiaLigado));
    desenharAvatar();
  });
  $('#btn-sortear').addEventListener('click', gerarLook);
  ligarMenusDaBarra();
  $('#btn-salvar').addEventListener('click', () => salvarLook());
  $('#btn-publicar').addEventListener('click', () => publicarLook());
  $$('[data-export]').forEach(b => b.addEventListener('click', async () => {
    if (!camadas.length) return toast('Monte um look antes de exportar.', 'aviso');
    b.disabled = true;
    try {
      await baixarLook(estruturaLimpa(), b.dataset.export, $('#outfit-nome').value.trim());
      toast('PNG gerado. Confere os downloads.');
    } catch (err) {
      console.warn('exportar look', err);
      toast('Não consegui gerar o PNG agora. Tente de novo.', 'aviso');
    } finally {
      b.disabled = false;
    }
  }));
}

// Os menus da barra do look (Exportar e ⋯): um aberto por vez, e qualquer
// toque fora, num item ou o Esc fecha.
function ligarMenusDaBarra() {
  const fechar = () => $$('#look-barra [data-menu]').forEach((b) => {
    b.setAttribute('aria-expanded', 'false');
    $('#' + b.dataset.menu).hidden = true;
  });
  $$('#look-barra [data-menu]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = $('#' + b.dataset.menu);
    const abrir = menu.hidden;
    fechar();
    menu.hidden = !abrir;
    b.setAttribute('aria-expanded', String(abrir));
  }));
  $$('#look-barra .lb-menu button').forEach(i => i.addEventListener('click', fechar));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#look-barra .lb-menu')) fechar();
    if (!e.target.closest('.st-troca, .camada, [data-act="trocar"]')) fecharTroca();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { fechar(); fecharTroca(); } });
}

function limparPalco({ manterHistorico = false } = {}) {
  camadas = []; selecionado = null; lookAtualId = null; palcoSorteado = false;
  $('#outfit-nome').value = '';
  if (!manterHistorico) hist.zerar();
  fecharTroca();
  renderCamadas();
  atualizarVestidas();
  renderSalvos();
}

// A alça de quatro setas ao lado da peça escolhida: puxar por ela é o mesmo
// que arrastar a peça, só que sem o dedo em cima (celular).
let alcaMov = null;
function colocarAlcaMover(c) {
  alcaMov ??= alcaMover(stage(), (e) => {
    const k = atual();
    const no = noDe(k);
    if (no) iniciarManipulacao(e, k, no);
  });
  alcaMov.colocar([noDe(c)]);
}

// Durante o arrasto as alças e os controles acompanham uma vez por quadro,
// não a cada movimento do ponteiro.
let quadro = 0;
function agendarFerramentas() {
  if (quadro) return;
  quadro = requestAnimationFrame(() => { quadro = 0; atualizarFerramentas(); });
}

function atualizarFerramentas() {
  const c = atual();
  colocarAlcaMover(c);
  alcas?.sincronizar(c ? [{ uid: c.uid, no: noDe(c) }] : []);
  const temSelecao = Boolean(c);
  $('#tool-empty').hidden = temSelecao;
  $$('#layer-tools .tool-btn, #layer-tools input').forEach(n => { n.disabled = !temSelecao; });
  $('#st-tamanho').hidden = !temSelecao;
  barrasPos?.atualizar();
  if (!c) return;
  $('#sld-escala').value = $('#sld-escala-vert').value = Math.round(c.escala * 100);
  $('#sld-rot').value = Math.round(c.rot);
}

// Sorteia um look inteiro com as peças do guarda-roupa.
export async function gerarLook() {
  const acervo = db.state.inventario
    .map(p => pecaDoCatalogo(p.id))
    .filter(Boolean);

  if (!acervo.length) {
    toast('Seu guarda-roupa está vazio. Garimpe na vitrine primeiro.', 'aviso');
    return;
  }
  // Só pergunta se tem trabalho não sorteado no palco e nenhum look aberto.
  if (camadas.length && !palcoSorteado && !lookAtualId &&
      !await confirmar('Dá para voltar com ↶ desfazer.',
        { titulo: 'Trocar o que está no palco por um look sorteado?', sim: 'Sortear' })) {
    return;
  }

  if (camadas.length) hist.marcar();
  const sorteadas = noAtual(camadasParaAvatar(sortearConjunto(acervo)));
  camadas = sorteadas.map(c => ({ ...c, uid: 'c' + (uidSeq++) }));
  selecionado = null;
  // O look sorteado é outro look: o nome do que estava aberto não vem junto,
  // senão salvar criava uma segunda entrada com o nome do anterior.
  if (lookAtualId) $('#outfit-nome').value = '';
  lookAtualId = null;
  palcoSorteado = true;

  fecharTroca();
  renderCamadas();
  atualizarVestidas();
  renderSalvos();
  toast(`Look sorteado com ${camadas.length} peças. ${ehToque() ? 'Toque' : 'Clique'} de novo para outro.`);
}

// --- Looks salvos ---------------------------------------------------------
// No celular o campo do nome não aparece no palco: o primeiro salvar pergunta
// o nome numa janelinha, já com "Look N" escrito.
async function nomeDoLook(novo) {
  const campo = $('#outfit-nome');
  const digitado = campo.value.trim();
  if (digitado || !novo || campo.offsetParent !== null) return digitado || nomeLivre('Look', db.state.looks);
  const nome = await pedirTexto('Dá para trocar depois em ▦.', {
    titulo: 'Nome do look', sim: 'Salvar', valor: nomeLivre('Look', db.state.looks), max: 40,
  });
  if (nome === null) return null;
  campo.value = nome.trim().slice(0, 40);
  return campo.value || nomeLivre('Look', db.state.looks);
}

async function salvarLook({ silencioso = false } = {}) {
  if (!camadas.length) { toast('O palco está vazio.', 'aviso'); return null; }
  let look = db.state.looks.find(l => l.id === lookAtualId);
  const nome = await nomeDoLook(!look);
  if (nome === null) return null;
  const thumb = await miniaturaAtual(estruturaLimpa());

  if (look) {
    Object.assign(look, { nome, camadas: estruturaLimpa(), thumb, editadoEm: new Date().toISOString() });
  } else {
    look = {
      id: idNovo('l'),
      nome,
      criadoEm: new Date().toISOString(),
      camadas: estruturaLimpa(),
      thumb,
      publicado: false,
    };
    db.state.looks.push(look);
    db.state.stats.looks += 1;
    db.progredirMissao('looks');
    lookAtualId = look.id;
  }
  db.salvar();
  renderSalvos();
  if (silencioso) return look;
  // Já está no feed: salvar leva a versão nova para o post também (curtidas e
  // comentários ficam). Antes só o "Publicar" fazia isso, e o post ficava com
  // o look de antes.
  if (look.publicado && jaPublicado('lookId', look.id)) {
    try {
      await publicarNoFeed({ ...await pacoteDoLook(look), atualizar: true });
      toast(`"${nome}" salvo e atualizado no feed.`);
    } catch (e) {
      toast(`"${nome}" salvo, mas o post do feed não mudou: ${e.message || 'sem conexão'}.`, 'aviso');
    }
    return look;
  }
  toast(`"${nome}" salvo no seu perfil.`);
  return look;
}

const estruturaLimpa = () => noPadrao(camadas.map(({ uid, ...resto }) => ({ ...resto })));

// O palco trabalha no boneco de agora; o que é gravado (look salvo, post,
// exportação) fica no boneco de verdade. Fora do teste de proporção é igual.
const regiaoDe = (c) => CATEGORIAS[pecaDoCatalogo(c.itemId)?.cat || c.cat]?.regiao;
const noAtual = (cs) => cs.map(c => ({ ...c, ...doPadraoParaAtual(regiaoDe(c), c) }));
const noPadrao = (cs) => cs.map(c => ({ ...c, ...doAtualParaPadrao(regiaoDe(c), c) }));

async function publicarLook() {
  const look = await salvarLook({ silencioso: true });
  if (!look) return;

  // Já está no feed: a versão nova substitui a imagem do post (curtidas e
  // comentários ficam).
  if (look.publicado && jaPublicado('lookId', look.id)) {
    if (!await confirmar('As curtidas e os comentários continuam.',
      { titulo: 'Atualizar o post no feed com esta versão?', sim: 'Atualizar' })) return;
    try {
      await publicarNoFeed({ ...await pacoteDoLook(look), atualizar: true });
      return toast('Post atualizado no feed.');
    } catch (e) {
      return toast(e.message || 'Não consegui atualizar o post agora.', 'aviso');
    }
  }

  let onde;
  try {
    onde = await publicarOuGuardar(await pacoteDoLook(look));
  } catch (e) {
    return toast(e.message || 'Não consegui publicar agora.', 'aviso');
  }
  if (!look.publicado) {
    db.state.stats.publicacoes += 1;
    db.progredirMissao('publicar');
  }
  look.publicado = true;
  db.salvar();
  renderSalvos();
  toast(onde === 'servidor'
    ? 'Publicado no feed — seus amigos já podem ver.'
    : 'Sem conexão: publicado só aqui por enquanto. Sobe para o feed quando o servidor voltar.');
}

// Os looks salvos moram só no painel "Meus stylists", aberto pelo botão em
// cima do palco; aqui só se atualiza o número dele e o painel, se aberto.
function renderSalvos() {
  const total = db.state.looks.length;
  // "Apagar look salvo" no ⋯ só vale com um look salvo aberto no palco.
  const apagar = $('#btn-apagar-look');
  if (apagar) apagar.disabled = !db.state.looks.some(l => l.id === lookAtualId);
  const qtd = $('#meus-qtd');
  if (qtd) qtd.textContent = total ? String(total) : '';
  painel?.render();
}

export function abrirLook(id) {
  const look = db.state.looks.find(l => l.id === id);
  if (!look) return;
  lookAtualId = look.id;
  camadas = noAtual(look.camadas).map(c => ({ ...c, uid: 'c' + (uidSeq++) }));
  selecionado = null;
  palcoSorteado = false;
  $('#outfit-nome').value = look.nome;
  hist.zerar();
  fecharTroca();
  renderCamadas();
  atualizarVestidas();
  renderSalvos();
}

// --- Meus stylists -------------------------------------------------------
// O cartão desenha o look com o personagem de agora (render.js), não a
// miniatura do save: ela é de quando o look foi salvo e fica com o cabelo e o
// corpo de antes. A do save só aparece se o desenho falhar.
function imagemDoCartao(l) {
  if (!l.camadas?.length) {
    return l.thumb ? el('img', { src: l.thumb, alt: l.nome, loading: 'lazy' })
      : el('span', { class: 'sem-thumb' }, '—');
  }
  const pronta = miniaturaPronta(l.camadas);
  if (pronta) return el('img', { src: pronta, alt: l.nome });
  const vaga = el('span', { class: 'sem-thumb' });
  miniaturaAtual(l.camadas).then(
    (url) => { if (vaga.isConnected) vaga.replaceWith(el('img', { src: url, alt: l.nome })); },
    () => { if (vaga.isConnected && l.thumb) vaga.replaceWith(el('img', { src: l.thumb, alt: l.nome })); });
  return vaga;
}

function montarMeusStylists() {
  painel = criarPainel({
    prefixo: 'ms',
    botao: '#btn-meus-stylists',
    modal: '#modal-meus',
    lista: () => db.state.looks,
    tipoFav: 'look',
    origem: 'look',
    campo: 'lookId',
    prefixoId: 'l',
    maxNome: 40,
    feminino: false,
    nomes: ['look', 'looks'],
    lugar: 'no palco',
    vazio: ['Nenhum look salvo ainda',
      'Vista o avatar com as suas peças e toque em "Salvar look": ele aparece aqui.'],
    abertoId: () => lookAtualId,
    imagem: imagemDoCartao,
    pecas: (l) => l.camadas?.length || 0,
    abrir: abrirLook,
    novo: async () => {
      limparPalco();
      toast('Palco limpo: monte o look novo e salve.');
    },
    aoRenomear: (id, nome) => { if (id === lookAtualId) $('#outfit-nome').value = nome; },
    // O palco fica como está, só deixa de ser aquele look: salvar de novo cria outro.
    aoApagar: (id) => { if (id === lookAtualId) lookAtualId = null; },
    aoMudar: renderSalvos,
  });
}

export function aoEntrarNoStylist() {
  montarPaleta();
  renderSalvos();
  desenharAvatar();
}
