// Guarda-roupa: o inventário real do usuário.
//
// Diferença para o protótipo antigo: aqui só aparece o que a pessoa resgatou, a
// raridade vem gravada na peça (não é re-sorteada a cada render) e a ordem dos
// slots é persistida quando você arrasta.

import { ADMIN, CATEGORIAS, ORDEM_CATEGORIAS, RARIDADE, RARIDADES, escalaGrade } from './config.js';
import { item as pecaDoCatalogo, nomeDaPeca } from './catalog.js';
import * as db from './db.js';
import { el, $, toast } from './util.js';
import { abrirEditar } from './editar.js';
import { montarVitrine } from './vitrine.js';
import { irPara } from './router.js';
import { vestirPeca } from './stylist.js';
import { adicionar as soltarNaColagem } from './board.js';

let categoriaAtual = 'todas';   // o guarda-roupa abre mostrando tudo
let arrastando = null;
let selecionada = null;

// Jeitos de organizar a grade. "manual" é a ordem que a pessoa arrasta; os
// outros só ordenam a vista (não mexem no `ordem` gravado) e, quando faz
// sentido, separam a grade em grupos com rótulo.
const CHAVE_ORDEM = 'closet.ordem';
let ordemAtual = (() => { try { return localStorage.getItem(CHAVE_ORDEM) || 'manual'; } catch { return 'manual'; } })();

const NIVEL = Object.fromEntries(RARIDADES.map((r, i) => [r.id, i]));
const ORIGENS = { collab: 'Cápsula do mês', propria: 'Peças suas', teste: 'Teste', vitrine: 'Garimpo' };
const quando = p => new Date(p.obtidoEm).getTime() || 0;
// Cor e marca são campo livre: "verde", "Verde " e "VERDE" têm que cair no
// mesmo grupo. Normaliza espaços (inclusive o não-separável) e a caixa, e
// devolve com só a primeira letra maiúscula.
const texto = (v, vazio) => {
  const t = (v || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');
  return t ? t[0].toLocaleUpperCase('pt-BR') + t.slice(1) : vazio;
};
const porTexto = (a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' });

// Cada modo: como comparar e (opcional) em que grupo a peça cai.
const ORDENS = {
  manual:    { cmp: (a, b) => a.ordem - b.ordem },
  raridade:  { cmp: (a, b) => (NIVEL[b.raridade] ?? 0) - (NIVEL[a.raridade] ?? 0) || quando(b) - quando(a),
               grupo: p => (RARIDADE[p.raridade] || RARIDADE.common).nome },
  recentes:  { cmp: (a, b) => quando(b) - quando(a), grupo: p => mesAno(p) },
  antigas:   { cmp: (a, b) => quando(a) - quando(b), grupo: p => mesAno(p) },
  favoritas: { cmp: (a, b) => (b.favorito ? 1 : 0) - (a.favorito ? 1 : 0) || a.ordem - b.ordem,
               grupo: p => p.favorito ? 'Favoritas' : 'Outras' },
  cor:       { cmp: (a, b) => porTexto(corDe(a), corDe(b)) || a.ordem - b.ordem, grupo: p => corDe(p) },
  marca:     { cmp: (a, b) => porTexto(marcaDe(a), marcaDe(b)) || a.ordem - b.ordem, grupo: p => marcaDe(p) },
  categoria: { cmp: (a, b) => ORDEM_CATEGORIAS.indexOf(a.cat) - ORDEM_CATEGORIAS.indexOf(b.cat) || a.ordem - b.ordem,
               grupo: p => CATEGORIAS[p.cat]?.nome || p.cat },
  origem:    { cmp: (a, b) => porTexto(origemDe(a), origemDe(b)) || quando(b) - quando(a), grupo: p => origemDe(p) },
};

function mesAno(p) {
  const d = new Date(p.obtidoEm);
  if (isNaN(d)) return 'Sem data';
  const s = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return s[0].toUpperCase() + s.slice(1);
}
function corDe(p) { return texto(pecaDoCatalogo(p.id)?.cor, 'Sem cor'); }
function marcaDe(p) { return texto(pecaDoCatalogo(p.id)?.marca, 'Sem marca'); }
function origemDe(p) { return ORIGENS[p.origem] || 'Garimpo'; }

export function montarCloset() {
  montarRail();
  const seletor = $('#closet-ordem');
  if (!ORDENS[ordemAtual]) ordemAtual = 'manual';
  seletor.value = ordemAtual;
  seletor.addEventListener('change', () => {
    ordemAtual = seletor.value;
    try { localStorage.setItem(CHAVE_ORDEM, ordemAtual); } catch {}
    carregarCategoria(categoriaAtual);
  });
  carregarCategoria(categoriaAtual);
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
  // acervo (as do pipeline não têm ficha em disco para reescrever).
  $('#btn-editar-peca').addEventListener('click', () => {
    if (!selecionada) return;
    const cat = pecaDoCatalogo(selecionada);
    abrirEditar(cat, () => {
      montarRail();
      carregarCategoria(categoriaAtual);
      montarVitrine();                    // ficha nova, a loja precisa saber
      const p = db.pecaDoInventario(cat.id);
      if (p) selecionar(p);
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
    t = setTimeout(preencherVazios, 140);
  });
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

  for (const cat of ORDEM_CATEGORIAS) {
    const c = CATEGORIAS[cat];
    const qtd = db.state.inventario.filter(p => p.cat === cat).length;
    const botao = el('button', {
      class: 'cat-btn' + (cat === categoriaAtual ? ' active' : ''),
      dataset: { cat }, title: c.nome,
      onclick: () => carregarCategoria(cat),
    },
      el('span', { class: 'cat-icone' }, c.icone),
      qtd ? el('span', { class: 'cat-qtd' }, String(qtd)) : null
    );
    rail.insertBefore(botao, divisor());
  }
}

export function carregarCategoria(cat) {
  categoriaAtual = cat;
  document.querySelectorAll('.cat-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.cat === cat));

  limparPreview();

  const grid = $('#inventory-grid');
  grid.innerHTML = '';

  const tudo = cat === 'todas';
  const pecas = db.state.inventario
    .filter(p => tudo || p.cat === cat)
    .sort(ORDENS[ordemAtual].cmp);

  const rotulo = tudo ? 'Todas as peças' : CATEGORIAS[cat].nome;
  $('#closet-sub').textContent = tudo
    ? `${rotulo} · ${pecas.length} ${pecas.length === 1 ? 'peça' : 'peças'}`
    : `${rotulo} · ${pecas.length} ${pecas.length === 1 ? 'peça' : 'peças'} · ` +
      `${db.state.inventario.length} no total`;

  if (!pecas.length) {
    grid.append(el('p', { class: 'closet-vazio' },
      tudo
        ? 'Guarda-roupa vazio. Garimpe na vitrine — o dono repõe todo dia.'
        : 'Nada nesta categoria ainda.'));
    return;
  }

  // Agrupar por categoria dentro de uma categoria só seria um grupo único.
  const grupo = !(ordemAtual === 'categoria' && !tudo) && ORDENS[ordemAtual].grupo;
  let ultimo = null;
  for (const p of pecas) {
    const slot = criarSlot(p);
    if (!slot) continue;
    if (grupo) {
      const g = grupo(p);
      // Compara sem acento/caixa, igual ao sort, para não partir um grupo.
      if (ultimo === null || porTexto(g, ultimo) !== 0) {
        grid.append(el('h3', { class: 'grupo-rotulo' }, g));
        ultimo = g;
      }
    }
    grid.append(slot);
  }
  preencherVazios();
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
    draggable: ordemAtual === 'manual' ? 'true' : 'false',
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
    if (ordemAtual !== 'manual') { e.preventDefault(); return; }
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
    if (ordemAtual === 'manual' && arrastando && arrastando !== peca.id) {
      db.reordenarInventario(arrastando, peca.id);
      carregarCategoria(categoriaAtual);
    }
  });
  slot.addEventListener('dragend', () => {
    slot.classList.remove('arrastando');
    arrastando = null;
  });

  return slot;
}

// Completa a grade com slots vazios até fechar as linhas visíveis.
function preencherVazios() {
  const grid = $('#inventory-grid');
  const wrapper = document.querySelector('.grid-wrapper');
  const head = document.querySelector('.closet-head');
  if (!grid || !wrapper || !grid.querySelector('.item-slot')) return;

  grid.querySelectorAll('.item-slot.vazio').forEach(n => n.remove());

  const estilo = getComputedStyle(grid);
  const colunas = estilo.gridTemplateColumns.split(' ').filter(Boolean).length;
  const gap = parseInt(estilo.gap) || 14;
  const primeiro = grid.querySelector('.item-slot');
  const alturaSlot = primeiro?.offsetHeight || 120;

  const disponivel = wrapper.clientHeight - (head?.offsetHeight || 0) - 42;
  const linhas = Math.max(1, Math.floor((disponivel + gap) / (alturaSlot + gap)));
  const total = colunas * linhas;
  // Com grupos, os rótulos quebram as linhas: completa só a última linha.
  const slots = grid.querySelectorAll('.item-slot').length;
  const faltam = grid.querySelector('.grupo-rotulo')
    ? (colunas - ultimosDoGrupo(grid) % colunas) % colunas
    : total - slots;

  for (let i = 0; i < faltam; i++) grid.append(el('div', { class: 'item-slot vazio' }));
}

// Quantos slots tem o último grupo da grade.
function ultimosDoGrupo(grid) {
  let n = 0;
  for (let no = grid.lastElementChild; no && !no.classList.contains('grupo-rotulo'); no = no.previousElementSibling) n++;
  return n;
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
  img.src = cat.src;

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
  const partes = [CATEGORIAS[peca.cat].nome];
  if (cat.cor?.trim()) partes.push(cat.cor.trim());
  if (cat.marca?.trim()) partes.push(cat.marca.trim());
  partes.push(origem, `em ${new Date(peca.obtidoEm).toLocaleDateString('pt-BR')}`);
  $('#preview-info').textContent = partes.join(' · ');
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

export function aoEntrarNoCloset() {
  montarRail();
  carregarCategoria(categoriaAtual);
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
