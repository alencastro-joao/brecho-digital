// Guarda-roupa: o inventário real do usuário.
//
// Diferença para o protótipo antigo: aqui só aparece o que a pessoa resgatou, a
// raridade vem gravada na peça (não é re-sorteada a cada render) e a ordem dos
// slots é persistida quando você arrasta.

import { ADMIN, CATEGORIAS, RARIDADE, escalaGrade } from './config.js';
import { item as pecaDoCatalogo, nomeDaPeca, proporcao, trocarImagem } from './catalog.js';
import {
  agrupamento, categoriaDe, grupoDe, gruposDoInventario, seletorDeAgrupamento,
} from './agrupamento.js';
import { ordemAtual, ordenar, seletorDeOrdem } from './ordenacao.js';
import * as db from './db.js';
import { el, $, toast } from './util.js';
import { abrirEditar } from './editar.js';
import { montarVitrine } from './vitrine.js';
import { irPara } from './router.js';
import { vestirPeca } from './stylist.js';
import { adicionar as soltarNaColagem } from './board.js';
import { colecoesDaPeca, chipDaColecao } from './colecoes.js';

let categoriaAtual = 'todas';   // o grupo aberto no trilho; abre mostrando tudo
let arrastando = null;
let selecionada = null;
let pagina = 0;                 // a página aberta da grade (começa em 0)

// A "Minha ordem" é a que a pessoa arrasta; os outros modos de organizar
// (ordenacao.js, compartilhado com o Stylist e a Colagem) só ordenam a vista.
const manual = () => ordemAtual() === 'manual';

export function montarCloset() {
  montarRail();
  montarSeletorDeAgrupamento();
  montarSeletorDeOrdem();
  carregarCategoria(categoriaAtual);
  // Celular: Categorias e Organizar ficam guardados atrás de um botão só,
  // para a grade não começar no meio da tela.
  $('#closet-ajustes').addEventListener('click', (e) => {
    const aberto = $('.closet-head').classList.toggle('abertas');
    e.currentTarget.setAttribute('aria-expanded', String(aberto));
  });
  $('#closet-pag-ant').addEventListener('click', () => irParaPagina(pagina - 1));
  $('#closet-pag-prox').addEventListener('click', () => irParaPagina(pagina + 1));
  $('#btn-para-stylist').addEventListener('click', () => {
    if (!selecionada) return;
    vestirPeca(selecionada);
    irPara('stylist');
  });
  // Subir peça é ferramenta do administrador: para o usuário final o botão
  // nem existe.
  const btnAdd = $('#btn-add-peca');
  btnAdd.hidden = !ADMIN;
  // Peça nova entra pela esteira (esteira.html): sobe a foto, a nuvem recorta
  // e preenche a ficha, e a peça publicada lá aparece aqui na próxima carga.
  btnAdd.addEventListener('click', () => { location.href = 'esteira.html'; });
  // Editar também é ferramenta de administrador, e só vale para peça do
  // acervo (as guardadas só no navegador não têm ficha em disco para reescrever).
  $('#btn-editar-peca').addEventListener('click', () => {
    if (!selecionada) return;
    const cat = pecaDoCatalogo(selecionada);
    abrirEditar(cat, () => {
      montarRail();
      carregarCategoria(categoriaAtual);
      montarVitrine();                    // ficha nova, a loja precisa saber
      const p = db.pecaDoInventario(cat.id);
      if (p) selecionar(p);
      else limparPreview();               // a peça foi apagada
    });
  });
  $('#btn-para-board').addEventListener('click', () => {
    if (!selecionada) return;
    irPara('board');
    soltarNaColagem(selecionada);
  });

  // Favoritar é o que escolhe as roupas que aparecem no seu perfil.
  $('#btn-favorita-peca').addEventListener('click', () => {
    if (!selecionada) return;
    const agora = db.alternarFavorito('peca', selecionada);
    rotularFavorito();
    // A estrelinha do slot acompanha sem repintar a grade inteira.
    document.querySelector(`.item-slot[data-id="${selecionada}"]`)
      ?.classList.toggle('favorita', agora);
    toast(agora ? 'Peça favoritada — aparece no seu perfil.' : 'Peça desfavoritada.');
  });
  let t;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    // No computador o tamanho da página depende da tela: refaz a grade.
    t = setTimeout(() => carregarCategoria(categoriaAtual, { manterPagina: true }), 140);
  });
}

function montarSeletorDeAgrupamento() {
  $('#closet-agrupar').replaceChildren(seletorDeAgrupamento(() => {
    categoriaAtual = 'todas';    // os grupos mudaram: o aberto não existe mais
    montarSeletorDeAgrupamento();
    montarRail();
    carregarCategoria(categoriaAtual);
  }));
}

function montarSeletorDeOrdem() {
  $('#closet-ordem').replaceChildren(seletorDeOrdem(() => carregarCategoria(categoriaAtual)));
}

function montarRail() {
  const rail = $('#cat-rail');
  // Só os botões saem: o puxador de redimensionar mora aqui dentro.
  rail.querySelectorAll('.cat-btn').forEach(b => b.remove());
  const divisor = () => rail.querySelector('.divisor');

  const total = db.state.inventario.length;
  const todas = el('button', {
    class: 'cat-btn todas' + (categoriaAtual === 'todas' ? ' active' : ''),
    dataset: { cat: 'todas' }, title: 'Todas as peças',
    onclick: () => carregarCategoria('todas'),
  },
    el('span', { class: 'cat-icone' }, '✦'),
    total ? el('span', { class: 'cat-qtd' }, String(total)) : null
  );
  rail.insertBefore(todas, divisor());

  for (const g of gruposDoInventario()) {
    const botao = el('button', {
      class: 'cat-btn' + (g.id === categoriaAtual ? ' active' : ''),
      dataset: { cat: g.id }, title: g.nome,
      onclick: () => carregarCategoria(g.id),
    },
      el('span', { class: 'cat-icone' }, g.icone),
      g.qtd ? el('span', { class: 'cat-qtd' }, String(g.qtd)) : null
    );
    rail.insertBefore(botao, divisor());
  }
}

let pecasDaVista = [];           // as peças da categoria aberta, já ordenadas

export function carregarCategoria(cat, { manterPagina = false } = {}) {
  const grupos = agrupamento().grupos;
  if (!grupos[cat]) cat = 'todas';
  if (cat !== categoriaAtual || !manterPagina) pagina = 0;
  categoriaAtual = cat;
  document.querySelectorAll('.cat-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.cat === cat));

  limparPreview();

  const tudo = cat === 'todas';
  // Peça órfã (no inventário mas fora do catálogo) não ocupa quadrado.
  pecasDaVista = db.state.inventario
    .filter(p => (tudo || grupoDe(p) === cat) && pecaDoCatalogo(p.id));
  ordenar(pecasDaVista);

  const n = pecasDaVista.length;
  const qtd = `${n} ${n === 1 ? 'peça' : 'peças'}`;
  $('#closet-sub').textContent = tudo ? qtd : `${grupos[cat].nome} · ${qtd}`;

  desenharPagina();
}

// A grade é sempre cheia: um número fixo de quadrados por página (os que
// sobram na última viram quadrados vazios) e botões para passar de página.
function desenharPagina() {
  const grid = $('#inventory-grid');
  grid.innerHTML = '';

  if (!pecasDaVista.length) {
    $('#closet-paginas').hidden = true;
    grid.append(el('p', { class: 'closet-vazio' },
      categoriaAtual === 'todas'
        ? 'Guarda-roupa vazio. Garimpe na vitrine — o dono repõe todo dia.'
        : 'Nada nesta categoria ainda.'));
    return;
  }

  const porPagina = pecasPorPagina();
  const total = Math.max(1, Math.ceil(pecasDaVista.length / porPagina));
  pagina = Math.min(Math.max(0, pagina), total - 1);

  const daPagina = pecasDaVista.slice(pagina * porPagina, (pagina + 1) * porPagina);
  for (const p of daPagina) {
    const slot = criarSlot(p);
    if (slot) grid.append(slot);
  }
  for (let i = daPagina.length; i < porPagina; i++) {
    grid.append(el('div', { class: 'item-slot vazio' }));
  }

  $('#closet-paginas').hidden = total < 2;
  $('#closet-pag-num').textContent = `${pagina + 1} / ${total}`;
  $('#closet-pag-ant').disabled = pagina === 0;
  $('#closet-pag-prox').disabled = pagina >= total - 1;
}

function irParaPagina(n) {
  pagina = n;
  limparPreview();
  desenharPagina();
  $('#inventory-grid').scrollTop = 0;
}

// Celular: 4 colunas × 6 fileiras. Computador: as colunas que a largura
// comporta × as fileiras que cabem sem rolar (mínimo de 3).
function pecasPorPagina() {
  if (matchMedia('(max-width: 900px)').matches) return 24;
  const grid = $('#inventory-grid');
  const wrapper = document.querySelector('.grid-wrapper');
  const head = document.querySelector('.closet-head');
  const pag = $('#closet-paginas');
  const estilo = getComputedStyle(grid);
  const colunas = estilo.gridTemplateColumns.split(' ').filter(Boolean).length || 4;
  const gap = parseInt(estilo.gap) || 16;
  const celula = parseFloat(getComputedStyle(document.documentElement)
    .getPropertyValue('--cel-peca')) || 140;
  const disponivel = (wrapper?.clientHeight || 0) - (head?.offsetHeight || 0)
    - 18 - (pag?.offsetHeight || 48) - 40;
  const linhas = Math.max(3, Math.floor((disponivel + gap) / (celula + gap)));
  return colunas * linhas;
}

function criarSlot(peca) {
  const cat = pecaDoCatalogo(peca.id);
  // Peça órfã: está no inventário mas não no catálogo (arquivo removido do
  // disco, catálogo desligado). Some do slot em vez de derrubar a tela.
  if (!cat) return null;
  const r = RARIDADE[peca.raridade] || RARIDADE.common;

  const slot = el('div', {
    class: `item-slot r-${peca.raridade}`,
    // Arrastar só reordena na "Minha ordem"; nos outros modos a ordem é calculada.
    draggable: manual() ? 'true' : 'false',
    dataset: { id: peca.id },
    title: nomeDaPeca(cat) + ' · ' + r.nome,
    // No guarda-roupa a raridade é só cor: borda e fundo do slot. A aura fica
    // reservada para a loja, onde ela serve para a peça saltar no mural.
    style: {
      '--rar-borda': r.aura && r.aura !== 'arco-iris' ? r.aura : r.cor,
      '--rar-bg': r.bg,
    },
    onclick: () => selecionar(peca),
  },
    cat ? el('div', {
      class: 'peca-caixa',
      style: { '--esc': String(escalaGrade(cat)) },
    }, el('img', { src: cat.src, alt: nomeDaPeca(cat), loading: 'lazy' })) : null);

  if (peca.origem === 'collab') slot.append(el('span', { class: 'selo-collab' }, '★'));
  if (peca.favorito) slot.classList.add('favorita');

  slot.addEventListener('dragstart', (e) => {
    if (!manual()) { e.preventDefault(); return; }
    arrastando = peca.id;
    slot.classList.add('arrastando');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', peca.id);
  });
  slot.addEventListener('dragover', (e) => { e.preventDefault(); slot.classList.add('alvo'); });
  slot.addEventListener('dragleave', () => slot.classList.remove('alvo'));
  slot.addEventListener('drop', (e) => {
    e.preventDefault();
    slot.classList.remove('alvo');
    if (manual() && arrastando && arrastando !== peca.id) {
      db.reordenarInventario(arrastando, peca.id);
      carregarCategoria(categoriaAtual, { manterPagina: true });
    }
  });
  slot.addEventListener('dragend', () => {
    slot.classList.remove('arrastando');
    arrastando = null;
  });

  return slot;
}

function selecionar(peca) {
  const cat = pecaDoCatalogo(peca.id);
  if (!cat) return;
  selecionada = peca.id;
  const r = RARIDADE[peca.raridade] || RARIDADE.common;
  const img = $('#big-preview-img');

  const moldura = $('#preview-moldura');
  $('#placeholder').hidden = true;
  moldura.hidden = false;
  // 300 px de altura é o teto da prévia (closet.css).
  trocarImagem(img, cat, 300 * proporcao(cat));

  moldura.classList.remove('flutua');
  void moldura.offsetWidth;
  moldura.classList.add('flutua');

  const meta = $('#preview-meta');
  meta.hidden = false;
  const tag = $('#preview-rarity');
  tag.textContent = r.nome;
  tag.style.background = r.bg;
  tag.style.borderColor = r.cor;
  $('#preview-nome').textContent = nomeDaPeca(cat);
  $('#btn-editar-peca').hidden = !(ADMIN && cat.permanente);

  rotularFavorito();

  const origem = { collab: 'cápsula do mês', propria: 'peça sua', teste: 'teste' }[peca.origem] || 'garimpo';
  const tipo = CATEGORIAS[categoriaDe(peca)];
  const partes = [tipo?.nome ?? 'Peça'];
  if (cat.cor?.trim()) partes.push(cat.cor.trim());
  if (cat.marca?.trim()) partes.push(cat.marca.trim());
  partes.push(origem, `em ${new Date(peca.obtidoEm).toLocaleDateString('pt-BR')}`);
  $('#preview-info').textContent = partes.join(' · ');
  $('#preview-colecoes').replaceChildren(...colecoesDaPeca(peca.id).map(chipDaColecao));
}

// O rótulo do botão diz o que o clique vai fazer, não o estado atual.
function rotularFavorito() {
  const botao = $('#btn-favorita-peca');
  if (!botao) return;
  const favorita = selecionada && db.ehFavorito('peca', selecionada);
  botao.classList.toggle('on', Boolean(favorita));
  botao.textContent = favorita ? '★ Nas favoritas' : '☆ Favoritar';
  botao.title = favorita
    ? 'Tirar do "Roupas favoritas" do seu perfil'
    : 'Mostrar esta peça no seu perfil';
}

function limparPreview() {
  selecionada = null;
  const moldura = $('#preview-moldura');
  if (moldura) {
    moldura.hidden = true;
    $('#big-preview-img')?.removeAttribute('src');
  }
  const ph = $('#placeholder'); if (ph) ph.hidden = false;
  const meta = $('#preview-meta'); if (meta) meta.hidden = true;
  const editar = $('#btn-editar-peca'); if (editar) editar.hidden = true;
}

let pecaPedida = null;            // peça que outra tela pediu para mostrar

// Abre o guarda-roupa já com a peça escolhida (o álbum das coleções usa).
export function abrirPecaNoCloset(id) {
  pecaPedida = id;
  irPara('closet');
}

export function aoEntrarNoCloset() {
  // O agrupamento e a ordem podem ter mudado no Stylist ou na Colagem.
  montarSeletorDeAgrupamento();
  montarSeletorDeOrdem();
  montarRail();
  const id = pecaPedida;
  pecaPedida = null;
  if (!id) { carregarCategoria(categoriaAtual, { manterPagina: true }); return; }
  carregarCategoria('todas');
  const i = pecasDaVista.findIndex(p => p.id === id);
  if (i < 0) return;
  pagina = Math.floor(i / pecasPorPagina());
  desenharPagina();
  selecionar(pecasDaVista[i]);
  const slot = $(`#inventory-grid .item-slot[data-id="${CSS.escape(id)}"]`);
  if (slot) {
    slot.classList.add('achada');
    slot.scrollIntoView({ block: 'nearest' });
    setTimeout(() => slot.classList.remove('achada'), 2400);
  }
  $('#preview-moldura')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

export function darPecasAleatorias(qtd, itens) {
  let novas = 0;
  for (const it of itens) {
    if (novas >= qtd) break;
    if (db.temPeca(it.id)) continue;
    db.adicionarPeca(it, { origem: 'teste' });
    db.state.stats.resgates += 1;
    db.progredirMissao('resgates');
    novas++;
  }
  db.salvar();
  toast(`${novas} peças adicionadas ao guarda-roupa.`);
}
