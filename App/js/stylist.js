// Stylist: a mesa de colagem.
//
// O palco tem 600×1200 unidades e é escalado pelo CSS — todas as coordenadas das
// camadas são guardadas nessas unidades, então o look salvo fica igual em
// qualquer tela e na exportação. Cada peça entra já encaixada no ponto de
// ancoragem da sua categoria (engine de lookbook) e dentro da sua camada de
// z-index; dali a pessoa move, gira e redimensiona à vontade.

import { CONFIG, escalaGrade, ancoraDaPeca } from './config.js';
import { item as pecaDoCatalogo, nomeDaPeca, proporcao, aplicarContorno, srcGrande } from './catalog.js';
import { grupoDe, gruposDoInventario, seletorDeAgrupamento } from './agrupamento.js';
import { ordenar, preencherComGrupos, seletorDeOrdem } from './ordenacao.js';
import * as db from './db.js';
import { svgAvatar } from './avatar.js';
import { miniatura, baixarLook } from './render.js';
import { publicarOuGuardar, pacoteDoLook, jaPublicado } from './publicacoes.js';
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
  montarMeusStylists();

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
  // No palco a peça cresce na mão: vai a grande desde o começo.
  const img = el('img', { src: srcGrande(peca), alt: nomeDaPeca(peca), draggable: 'false' });
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

  $('#btn-limpar').addEventListener('click', limparPalco);
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

function limparPalco() {
  camadas = []; selecionado = null; lookAtualId = null; palcoSorteado = false;
  $('#outfit-nome').value = '';
  renderCamadas();
  montarPaleta();
  renderSalvos();
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
  // O look sorteado é outro look: o nome do que estava aberto não vem junto,
  // senão salvar criava uma segunda entrada com o nome do anterior.
  if (lookAtualId) $('#outfit-nome').value = '';
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
  if (look.publicado && jaPublicado('lookId', look.id)) {
    return toast('Esse look já está no feed.', 'aviso');
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

// A lista da lateral é um atalho: os últimos looks mexidos. O resto (e tudo o
// que se faz com eles) mora no painel "Meus stylists", mais abaixo.
const NA_LATERAL = 4;

function renderSalvos() {
  const total = db.state.looks.length;
  const qtd = $('#meus-qtd');
  if (qtd) qtd.textContent = total ? String(total) : '';
  const verTodos = $('#btn-ver-todos');
  if (verTodos) {
    verTodos.hidden = !total;
    verTodos.textContent = total > NA_LATERAL ? `Ver todos (${total})` : 'Organizar looks';
  }
  if (!$('#modal-meus')?.hidden) renderMeus();

  const lista = $('#saved-list');
  if (!lista) return;
  lista.innerHTML = '';
  if (!total) {
    lista.append(el('p', { class: 'tool-hint' }, 'Nenhum look salvo ainda.'));
    return;
  }
  for (const l of ordenarLooks(db.state.looks, 'recentes').slice(0, NA_LATERAL)) {
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

// --- Meus stylists -------------------------------------------------------
// O painel com todos os looks salvos. No PC é um modal com uma grade de
// cartões; no celular (mobile: ver stylist.css) ocupa a tela toda, duas
// colunas. Cada cartão abre o look no palco para editar, e o ⋯ guarda o resto:
// renomear, duplicar e apagar. A estrela é a mesma do resto do app.
let msFiltro = 'todos';
let msMenuAberto = null;      // id do look com o menu ⋯ aberto
let msRenomeando = null;      // id do look com o nome virando campo
// Look de save antigo pode ter perdido a miniatura (o db joga fora quando o
// navegador fica sem espaço): esta é refeita na hora e fica só na memória.
const thumbsRefeitas = new Map();

const quandoDoLook = (l) => l.editadoEm || l.criadoEm || '';

function ordenarLooks(looks, ordem) {
  const lista = [...looks];
  if (ordem === 'nome') return lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  // Sem data (save muito antigo), vale a posição na lista: o último salvo é o mais novo.
  const pos = new Map(looks.map((l, i) => [l.id, i]));
  lista.sort((a, b) =>
    quandoDoLook(b).localeCompare(quandoDoLook(a)) || pos.get(b.id) - pos.get(a.id));
  return ordem === 'antigos' ? lista.reverse() : lista;
}

function dataCurta(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
    .replace(/ de /g, ' ').replace('.', '');
}

function montarMeusStylists() {
  const modal = $('#modal-meus');
  if (!modal) return;
  $('#btn-meus-stylists').addEventListener('click', abrirMeus);
  $('#btn-ver-todos').addEventListener('click', abrirMeus);
  $('#ms-fechar').addEventListener('click', fecharMeus);
  $('#ms-novo').addEventListener('click', () => {
    limparPalco();
    fecharMeus();
    toast('Palco limpo: monte o look novo e salve.');
  });
  $('#ms-busca').addEventListener('input', renderMeus);
  $('#ms-ordem').addEventListener('change', renderMeus);
  modal.addEventListener('pointerdown', (e) => { if (e.target === modal) fecharMeus(); });
  // Clicar fora do ⋯ fecha o menu dele.
  modal.addEventListener('click', (e) => {
    if (msMenuAberto && !e.target.closest('.ms-menu, .ms-mais')) {
      msMenuAberto = null;
      renderMeus();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || modal.hidden || msRenomeando) return;
    if (msMenuAberto) { msMenuAberto = null; renderMeus(); return; }
    fecharMeus();
  });
}

function abrirMeus() {
  msMenuAberto = null;
  msRenomeando = null;
  $('#ms-busca').value = '';
  $('#modal-meus').hidden = false;
  document.body.classList.add('com-modal');
  renderMeus();
}

function fecharMeus() {
  $('#modal-meus').hidden = true;
  document.body.classList.remove('com-modal');
  msMenuAberto = null;
  msRenomeando = null;
}

function renderMeus() {
  const looks = db.state.looks;
  const favs = looks.filter(l => l.favorito).length;
  const noFeed = looks.filter(l => l.publicado).length;

  $('#ms-sub').textContent = looks.length
    ? `${looks.length} ${looks.length === 1 ? 'look salvo' : 'looks salvos'} · ${favs} de 3 no perfil`
    : '';

  const filtros = $('#ms-filtros');
  filtros.replaceChildren(...[
    ['todos', 'Todos', looks.length],
    ['fav', '★ Favoritos', favs],
    ['feed', 'No feed', noFeed],
  ].map(([id, nome, n]) => el('button', {
    type: 'button',
    class: 'ms-filtro' + (msFiltro === id ? ' ativo' : ''),
    onclick: () => { msFiltro = id; renderMeus(); },
  }, nome, el('small', {}, String(n)))));

  const busca = $('#ms-busca').value.trim().toLocaleLowerCase('pt-BR');
  const visiveis = ordenarLooks(looks, $('#ms-ordem').value).filter(l =>
    (msFiltro === 'todos' || (msFiltro === 'fav' ? l.favorito : l.publicado)) &&
    (!busca || l.nome.toLocaleLowerCase('pt-BR').includes(busca)));

  const grade = $('#ms-grade');
  grade.replaceChildren();
  if (!looks.length) {
    grade.append(el('div', { class: 'ms-vazio' },
      el('strong', {}, 'Nenhum look salvo ainda'),
      el('p', {}, 'Vista o avatar com as suas peças e toque em "Salvar look": ele aparece aqui.')));
    return;
  }
  if (!visiveis.length) {
    grade.append(el('div', { class: 'ms-vazio' },
      el('p', {}, busca ? `Nenhum look com "${$('#ms-busca').value.trim()}".`
        : msFiltro === 'fav' ? 'Nenhum favorito. Toque na ☆ de um look para ele ir para o seu perfil.'
        : 'Nenhum look publicado no feed ainda.')));
    return;
  }
  for (const l of visiveis) grade.append(cartaoDoLook(l));

  const campo = grade.querySelector('.ms-renomear');
  if (campo) { campo.focus(); campo.select(); }
}

function imagemDoCartao(l) {
  const src = l.thumb || thumbsRefeitas.get(l.id);
  if (src) return el('img', { src, alt: l.nome, loading: 'lazy' });
  const vaga = el('span', { class: 'sem-thumb' }, '—');
  if (l.camadas?.length && !thumbsRefeitas.has(l.id)) {
    thumbsRefeitas.set(l.id, null);
    miniatura(l.camadas).then((url) => {
      thumbsRefeitas.set(l.id, url);
      if (vaga.isConnected) vaga.replaceWith(el('img', { src: url, alt: l.nome }));
    }).catch(() => {});
  }
  return vaga;
}

function cartaoDoLook(l) {
  const aberto = l.id === lookAtualId;
  const nPecas = l.camadas?.length || 0;

  const nome = msRenomeando === l.id
    ? el('input', {
      class: 'ms-renomear', type: 'text', value: l.nome, maxlength: '40',
      'aria-label': 'Novo nome do look',
      onkeydown: (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        // Esc aqui só desiste do nome: não pode subir e fechar o painel.
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); msRenomeando = null; renderMeus(); }
      },
      onblur: (e) => { if (msRenomeando === l.id) renomearLook(l.id, e.currentTarget.value); },
    })
    : el('button', {
      type: 'button', class: 'ms-nome', title: 'Renomear',
      onclick: () => { msRenomeando = l.id; msMenuAberto = null; renderMeus(); },
    }, l.nome);

  const menu = msMenuAberto === l.id ? el('div', { class: 'ms-menu', role: 'menu' },
    el('button', { type: 'button', role: 'menuitem', onclick: () => editarDoPainel(l.id) }, '✎ Abrir e editar'),
    el('button', {
      type: 'button', role: 'menuitem',
      onclick: () => { msRenomeando = l.id; msMenuAberto = null; renderMeus(); },
    }, 'Aa Renomear'),
    el('button', { type: 'button', role: 'menuitem', onclick: () => duplicarLook(l.id) }, '⧉ Duplicar'),
    el('button', { type: 'button', role: 'menuitem', class: 'perigo', onclick: () => apagarLook(l.id) }, '🗑 Excluir'),
  ) : null;

  return el('article', { class: 'ms-card' + (aberto ? ' aberto' : '') + (menu ? ' com-menu' : '') },
    el('button', {
      type: 'button', class: 'ms-thumb',
      title: `Abrir "${l.nome}" no palco para editar`,
      onclick: () => editarDoPainel(l.id),
    },
      imagemDoCartao(l),
      el('span', { class: 'ms-editar' }, '✎ Editar'),
      aberto ? el('span', { class: 'ms-selo' }, 'no palco') : null,
      l.publicado ? el('span', { class: 'ms-selo feed' }, 'no feed') : null,
    ),
    el('div', { class: 'ms-fav' }, estrelaFavorito('look', l.id, renderSalvos)),
    el('div', { class: 'ms-info' },
      el('div', { class: 'ms-linha' },
        nome,
        el('button', {
          type: 'button', class: 'ms-mais', title: 'Mais opções',
          'aria-haspopup': 'menu', 'aria-expanded': menu ? 'true' : 'false',
          onclick: () => { msMenuAberto = msMenuAberto === l.id ? null : l.id; renderMeus(); },
        }, '⋯')),
      el('small', {}, [dataCurta(quandoDoLook(l)),
        nPecas === 1 ? '1 peça' : `${nPecas} peças`].filter(Boolean).join(' · '))),
    menu);
}

function editarDoPainel(id) {
  abrirLook(id);
  fecharMeus();
  const look = db.state.looks.find(l => l.id === id);
  if (look) toast(`"${look.nome}" no palco. Mexa e toque em "Salvar look".`);
}

function renomearLook(id, valor) {
  msRenomeando = null;
  const look = db.state.looks.find(l => l.id === id);
  const nome = String(valor || '').trim().slice(0, 40);
  if (look && nome && nome !== look.nome) {
    look.nome = nome;
    if (id === lookAtualId) $('#outfit-nome').value = nome;
    db.salvar();
    toast(`Renomeado para "${nome}".`);
  }
  renderSalvos();
  renderMeus();
}

function duplicarLook(id) {
  const orig = db.state.looks.find(l => l.id === id);
  if (!orig) return;
  const agora = new Date().toISOString();
  // A cópia é um look novo: não herda a estrela (o perfil tem três vagas) nem
  // o "no feed" — quem foi publicado foi o original.
  const copia = {
    ...structuredClone(orig),
    id: 'l' + Date.now(),
    nome: `${orig.nome} (cópia)`.slice(0, 40),
    criadoEm: agora,
    editadoEm: agora,
    publicado: false,
    favorito: false,
  };
  if (!copia.thumb && thumbsRefeitas.get(id)) thumbsRefeitas.set(copia.id, thumbsRefeitas.get(id));
  db.state.looks.push(copia);
  msMenuAberto = null;
  db.salvar();
  renderSalvos();
  renderMeus();
  toast(`"${copia.nome}" criado.`);
}

function apagarLook(id) {
  const look = db.state.looks.find(l => l.id === id);
  if (!look) return;
  msMenuAberto = null;
  const aviso = `Excluir "${look.nome}"? Não dá para desfazer.` +
    (look.publicado ? '\nO post que já está no feed continua lá.' : '');
  if (!confirm(aviso)) { renderMeus(); return; }
  db.state.looks.splice(db.state.looks.indexOf(look), 1);
  thumbsRefeitas.delete(id);
  // O palco fica como está, só deixa de ser aquele look: salvar de novo cria outro.
  if (id === lookAtualId) lookAtualId = null;
  db.salvar();
  renderSalvos();
  renderMeus();
  toast(`"${look.nome}" excluído.`);
}

export function aoEntrarNoStylist() {
  montarPaleta();
  renderSalvos();
  desenharAvatar();
}
