// Stylist: a mesa de colagem.
//
// O palco tem 600×1200 unidades e é escalado pelo CSS — todas as coordenadas das
// camadas são guardadas nessas unidades, então o look salvo fica igual em
// qualquer tela e na exportação. Cada peça entra já encaixada no ponto de
// ancoragem da sua categoria (engine de lookbook) e dentro da sua camada de
// z-index; dali a pessoa move, gira e redimensiona à vontade.

import { CONFIG, escalaGrade, ancoraDaPeca } from './config.js';
import { item as pecaDoCatalogo, nomeDaPeca, proporcao, aplicarContorno } from './catalog.js';
import { grupoDe, gruposDoInventario, seletorDeAgrupamento } from './agrupamento.js';
import { ordenar, preencherComGrupos, seletorDeOrdem } from './ordenacao.js';
import * as db from './db.js';
import { svgAvatar } from './avatar.js';
import { miniatura, baixarLook } from './render.js';
import { sortearConjunto, camadasParaAvatar } from './sorteio.js';
import { estrelaFavorito } from './favoritos.js';
import { el, $, $$, clamp, toast } from './util.js';

let camadas = [];
let selecionado = null;
// Marca se o que está no palco veio de um sorteio e não foi mexido: enquanto
// for o caso, gerar de novo não pergunta nada.
let palcoSorteado = false;
let lookAtualId = null;
let catPaleta = 'todas';   // o grupo aberto; a paleta abre mostrando o guarda-roupa inteiro
let guiaLigado = false;
let uidSeq = 1;

const stage = () => $('#stage');
const unidades = (rect, px, eixo) =>
  eixo === 'x' ? px / rect.width * CONFIG.STAGE_W : px / rect.height * CONFIG.STAGE_H;

// --- Montagem -------------------------------------------------------------
export function montarStylist() {
  desenharAvatar();
  montarPaleta();
  ligarFerramentas();
  renderCamadas();
  renderSalvos();

  stage().addEventListener('pointerdown', (e) => {
    if (e.target.closest('.camada')) return;
    selecionar(null);
  });

  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.view !== 'stylist' || !selecionado) return;
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    const c = camadas.find(c => c.uid === selecionado);
    if (!c) return;
    const passo = e.shiftKey ? 12 : 3;
    if (e.key === 'ArrowLeft')  { c.x -= passo; e.preventDefault(); }
    else if (e.key === 'ArrowRight') { c.x += passo; e.preventDefault(); }
    else if (e.key === 'ArrowUp')    { c.y -= passo; e.preventDefault(); }
    else if (e.key === 'ArrowDown')  { c.y += passo; e.preventDefault(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { remover(c.uid); return; }
    else return;
    posicionar(c);
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
  abas.append(el('button', {
    class: 'pal-cat todas' + (catPaleta === 'todas' ? ' active' : ''),
    title: 'Todas as peças',
    onclick: () => { catPaleta = 'todas'; montarPaleta(); },
  }, '✦', el('small', {}, String(db.state.inventario.length))));

  for (const g of grupos) {
    if (!g.qtd) continue;
    abas.append(el('button', {
      class: 'pal-cat' + (g.id === catPaleta ? ' active' : ''),
      title: g.nome,
      onclick: () => { catPaleta = g.id; montarPaleta(); },
    }, g.icone, el('small', {}, String(g.qtd))));
  }

  const grid = $('#palette-grid');
  grid.innerHTML = '';
  const pecas = ordenar(db.state.inventario
    .filter(p => catPaleta === 'todas' || grupoDe(p) === catPaleta));

  if (!db.state.inventario.length) {
    grid.append(el('p', { class: 'palette-vazia' },
      'Seu guarda-roupa está vazio. Pegue peças na vitrine primeiro.'));
    return;
  }
  if (!pecas.length) {
    grid.append(el('p', { class: 'palette-vazia' }, 'Nada nessa categoria ainda.'));
    return;
  }

  preencherComGrupos(grid, pecas, (p) => {
    const peca = pecaDoCatalogo(p.id);
    if (!peca) return null;
    const img = el('img', { src: peca.src, alt: nomeDaPeca(peca), loading: 'lazy' });
    aplicarContorno(img, peca);
    const vestida = camadas.some(c => c.itemId === p.id);
    return el('button', {
      class: 'pal-item' + (vestida ? ' vestida' : ''),
      title: vestida ? nomeDaPeca(peca) + ' — no palco (clique para tirar)' : nomeDaPeca(peca),
      onclick: () => vestirPeca(p.id),
    }, el('div', {
      class: 'peca-caixa',
      style: { '--esc': String(escalaGrade(peca)) },
    }, img));
  }, { categoriaAberta: catPaleta !== 'todas' });
}

// --- Camadas --------------------------------------------------------------
// Cada categoria é um lugar no corpo, não uma pilha: o palco tem uma peça de
// cada. Escolher outra calça troca a que está lá; clicar de novo na mesma peça
// tira ela do palco.
export function vestirPeca(itemId) {
  const peca = pecaDoCatalogo(itemId);
  if (!peca) return;
  palcoSorteado = false;

  if (camadas.some(c => c.itemId === itemId)) {
    camadas = camadas.filter(c => c.itemId !== itemId);
    if (!camadas.some(c => c.uid === selecionado)) selecionado = null;
    renderCamadas();
    montarPaleta();
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
  renderCamadas();
  selecionar(camada.uid);
  montarPaleta();
}

function renderCamadas() {
  const raiz = $('#stage-layers');
  raiz.innerHTML = '';
  for (const c of camadas) raiz.append(criarCamadaDOM(c));
  atualizarFerramentas();
}

function criarCamadaDOM(c) {
  const peca = pecaDoCatalogo(c.itemId);
  const img = el('img', { src: peca.src, alt: nomeDaPeca(peca), draggable: 'false' });
  aplicarContorno(img, peca);

  const no = el('div', {
    class: 'camada' + (c.uid === selecionado ? ' selecionada' : ''),
    dataset: { uid: c.uid },
  }, img,
    el('span', { class: 'alca alca-rot', dataset: { alca: 'rot' } }),
    ...['no', 'ne', 'so', 'se'].map(q =>
      el('span', { class: `alca alca-esc alca-${q}`, dataset: { alca: 'esc' } }))
  );

  no.addEventListener('pointerdown', (e) => iniciarManipulacao(e, c, no));
  no.addEventListener('wheel', (e) => {
    if (c.uid !== selecionado) return;
    e.preventDefault();
    c.escala = clamp(c.escala * (e.deltaY < 0 ? 1.06 : 0.94), 0.2, 2.2);
    posicionar(c);
    atualizarFerramentas();
  }, { passive: false });

  posicionar(c, no);
  return no;
}

function posicionar(c, no = null) {
  const alvo = no || $(`.camada[data-uid="${c.uid}"]`);
  if (!alvo) return;
  const peca = pecaDoCatalogo(c.itemId);
  const larguraUnid = ancoraDaPeca(pecaDoCatalogo(c.itemId)).w * c.escala;
  alvo.style.left = (c.x / CONFIG.STAGE_W * 100) + '%';
  alvo.style.top = (c.y / CONFIG.STAGE_H * 100) + '%';
  alvo.style.width = (larguraUnid / CONFIG.STAGE_W * 100) + '%';
  alvo.style.aspectRatio = String(proporcao(peca));
  alvo.style.zIndex = String(c.z);
  alvo.style.transform = `translate(-50%, -50%) rotate(${c.rot}deg)`;
  alvo.querySelector('img').style.transform = c.flip ? 'scaleX(-1)' : '';
}

function iniciarManipulacao(e, c, no) {
  e.preventDefault();
  selecionar(c.uid);

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

  const mover = (ev) => {
    palcoSorteado = false;
    if (alca === 'esc') {
      const raio = Math.hypot(ev.clientX - centro.x, ev.clientY - centro.y);
      c.escala = clamp(inicial.escala * (raio / raio0), 0.2, 2.2);
    } else if (alca === 'rot') {
      const ang = Math.atan2(ev.clientY - centro.y, ev.clientX - centro.x);
      let g = inicial.rot + (ang - ang0) * 180 / Math.PI;
      if (ev.shiftKey) g = Math.round(g / 15) * 15;
      c.rot = Math.round(clamp(g, -180, 180));
    } else {
      c.x = clamp(inicial.x + unidades(rect, ev.clientX - inicioPtr.x, 'x'), -80, CONFIG.STAGE_W + 80);
      c.y = clamp(inicial.y + unidades(rect, ev.clientY - inicioPtr.y, 'y'), -80, CONFIG.STAGE_H + 80);
    }
    posicionar(c);
    atualizarFerramentas();
  };

  const soltar = () => {
    no.classList.remove('manipulando');
    no.removeEventListener('pointermove', mover);
    no.removeEventListener('pointerup', soltar);
    no.removeEventListener('pointercancel', soltar);
  };

  no.addEventListener('pointermove', mover);
  no.addEventListener('pointerup', soltar);
  no.addEventListener('pointercancel', soltar);
}

function selecionar(uid) {
  selecionado = uid;
  $$('.camada').forEach(n => n.classList.toggle('selecionada', n.dataset.uid === uid));
  atualizarFerramentas();
}

function remover(uid) {
  camadas = camadas.filter(c => c.uid !== uid);
  if (selecionado === uid) selecionado = null;
  renderCamadas();
  montarPaleta();          // a peça volta a aparecer como "fora do palco"
}

// --- Ferramentas ----------------------------------------------------------
function ligarFerramentas() {
  $$('#layer-tools .tool-btn').forEach(btn => btn.addEventListener('click', () => {
    const c = camadas.find(c => c.uid === selecionado);
    if (!c) return;
    palcoSorteado = false;
    const act = btn.dataset.act;
    if (act === 'up')   c.z = Math.min(999, c.z + 1);
    if (act === 'down') c.z = Math.max(1, c.z - 1);
    if (act === 'flip') c.flip = !c.flip;
    if (act === 'reset') {
      const a = ancoraDaPeca(pecaDoCatalogo(c.itemId));
      Object.assign(c, { x: a.x, y: a.y, escala: 1, rot: 0, flip: false, z: a.z });
    }
    if (act === 'del') return remover(c.uid);
    posicionar(c);
    atualizarFerramentas();
  }));

  $('#sld-escala').addEventListener('input', (e) => {
    const c = camadas.find(c => c.uid === selecionado);
    if (!c) return;
    c.escala = Number(e.target.value) / 100;
    posicionar(c);
  });
  $('#sld-rot').addEventListener('input', (e) => {
    const c = camadas.find(c => c.uid === selecionado);
    if (!c) return;
    c.rot = Number(e.target.value);
    posicionar(c);
  });

  $('#btn-limpar').addEventListener('click', () => {
    camadas = []; selecionado = null; lookAtualId = null;
    $('#outfit-nome').value = '';
    renderCamadas();
    montarPaleta();
  });
  $('#btn-guia').addEventListener('click', (e) => {
    guiaLigado = !guiaLigado;
    e.currentTarget.classList.toggle('ativo', guiaLigado);
    desenharAvatar();
  });
  $('#btn-sortear').addEventListener('click', gerarLook);
  $('#btn-salvar').addEventListener('click', () => salvarLook());
  $('#btn-publicar').addEventListener('click', () => publicarLook());
  $$('[data-export]').forEach(b => b.addEventListener('click', async () => {
    if (!camadas.length) return toast('Monte um look antes de exportar.', 'aviso');
    b.disabled = true;
    await baixarLook(camadas, b.dataset.export, $('#outfit-nome').value.trim() || 'meu look');
    b.disabled = false;
    toast('PNG gerado. Confere os downloads.');
  }));
}

function atualizarFerramentas() {
  const c = camadas.find(c => c.uid === selecionado);
  const temSelecao = Boolean(c);
  $('#tool-empty').hidden = temSelecao;
  $$('#layer-tools .tool-btn, #layer-tools input').forEach(n => { n.disabled = !temSelecao; });
  if (!c) return;
  $('#sld-escala').value = Math.round(c.escala * 100);
  $('#sld-rot').value = Math.round(c.rot);
}

// Sorteia um look inteiro com as peças do guarda-roupa.
export function gerarLook() {
  const acervo = db.state.inventario
    .map(p => pecaDoCatalogo(p.id))
    .filter(Boolean);

  if (!acervo.length) {
    toast('Seu guarda-roupa está vazio. Garimpe na vitrine primeiro.', 'aviso');
    return;
  }
  // Só pergunta se tem trabalho não sorteado no palco e nenhum look aberto.
  if (camadas.length && !palcoSorteado && !lookAtualId &&
      !confirm('Trocar o que está no palco por um look sorteado?')) {
    return;
  }

  const sorteadas = camadasParaAvatar(sortearConjunto(acervo));
  camadas = sorteadas.map(c => ({ ...c, uid: 'c' + (uidSeq++) }));
  selecionado = null;
  lookAtualId = null;
  palcoSorteado = true;

  renderCamadas();
  montarPaleta();
  renderSalvos();
  toast(`Look sorteado com ${camadas.length} peças. Clique de novo para outro.`);
}

// --- Looks salvos ---------------------------------------------------------
async function salvarLook({ silencioso = false } = {}) {
  if (!camadas.length) { toast('O palco está vazio.', 'aviso'); return null; }
  const nome = $('#outfit-nome').value.trim() || `Look ${db.state.looks.length + 1}`;
  const thumb = await miniatura(camadas);

  let look = db.state.looks.find(l => l.id === lookAtualId);
  if (look) {
    Object.assign(look, { nome, camadas: estruturaLimpa(), thumb, editadoEm: new Date().toISOString() });
  } else {
    look = {
      id: 'l' + Date.now(),
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
  if (!silencioso) toast(`"${nome}" salvo no seu perfil.`);
  return look;
}

const estruturaLimpa = () => camadas.map(({ uid, ...resto }) => ({ ...resto }));

async function publicarLook() {
  const look = await salvarLook({ silencioso: true });
  if (!look) return;
  if (look.publicado) return toast('Esse look já está no feed.', 'aviso');

  look.publicado = true;
  db.state.feed.unshift({
    id: 'p' + Date.now(),
    autor: db.state.usuario.id,
    lookId: look.id,
    nome: look.nome,
    thumb: look.thumb,
    criadoEm: new Date().toISOString(),
    curtidas: 0,
    curtido: false,
  });
  db.state.stats.publicacoes += 1;
  db.progredirMissao('publicar');
  db.salvar();
  renderSalvos();
  toast('Publicado no feed.');
}

function renderSalvos() {
  const lista = $('#saved-list');
  if (!lista) return;
  lista.innerHTML = '';
  if (!db.state.looks.length) {
    lista.append(el('p', { class: 'tool-hint' }, 'Nenhum look salvo ainda.'));
    return;
  }
  for (const l of [...db.state.looks].reverse()) {
    // A linha deixou de ser um botão só: a estrela é um segundo clique dentro
    // dela, e botão dentro de botão não vale em HTML.
    lista.append(el('div', {
      class: 'saved-item' + (l.id === lookAtualId ? ' ativo' : ''),
    },
      el('button', {
        class: 'saved-abrir',
        title: 'Abrir "' + l.nome + '"',
        onclick: () => abrirLook(l.id),
      },
        l.thumb ? el('img', { src: l.thumb, alt: l.nome }) : el('span', { class: 'sem-thumb' }, '—'),
        el('span', {}, l.nome),
        l.publicado ? el('small', { class: 'pub' }, 'no feed') : null
      ),
      estrelaFavorito('look', l.id, renderSalvos)
    ));
  }
}

export function abrirLook(id) {
  const look = db.state.looks.find(l => l.id === id);
  if (!look) return;
  lookAtualId = look.id;
  camadas = look.camadas.map(c => ({ ...c, uid: 'c' + (uidSeq++) }));
  selecionado = null;
  $('#outfit-nome').value = look.nome;
  renderCamadas();
  montarPaleta();
  renderSalvos();
}

export function aoEntrarNoStylist() {
  montarPaleta();
  renderSalvos();
  desenharAvatar();
}
