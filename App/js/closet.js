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
import { deslizavel, trocarComSlide } from './deslizar.js';
import { ico, emo } from './icones.js';
import { abrirEditar } from './editar.js';
import { montarVitrine } from './vitrine.js';
import { irPara } from './router.js';
import { festejar } from './animacoes.js';
import { vestirPeca } from './stylist.js';
import { adicionar as soltarNaColagem } from './board.js';
import { colecoesDaPeca, chipDaColecao, abrirColecao } from './colecoes.js';

let categoriaAtual = 'todas';   // o grupo aberto no trilho; abre mostrando tudo
let arrastando = null;
let selecionada = null;
let pagina = 0;                 // a página aberta da grade (começa em 0)

// A "Minha ordem" é a que a pessoa arrasta; os outros modos de organizar
// (ordenacao.js, compartilhado com o Stylist e a Colagem) só ordenam a vista.
const manual = () => ordemAtual() === 'manual';

// Celular: a peça aberta toma o lugar da grade (classe .detalhe na tela). Abrir
// empilha uma entrada no histórico, então o voltar do aparelho fecha a peça
// em vez de sair do guarda-roupa.
const celular = () => matchMedia('(max-width: 900px)').matches;
const tela = () => document.querySelector('.view-closet');
const naPeca = () => history.state?.closetPeca === true;

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
  $('#closet-voltar').addEventListener('click', () => {
    if (naPeca()) history.back(); else limparPreview();
  });
  // Na ficha (celular), as setas e o arrasto passam para a peça vizinha.
  $('#preview-nome').addEventListener('click', editarNome);
  const cartao = $('#ficha-cartao');
  const temVizinha = (passo) => {
    const i = pecasDaVista.findIndex(p => p.id === selecionada);
    return i >= 0 && Boolean(pecasDaVista[i + passo]);
  };
  $('#ficha-ant').addEventListener('click', () => trocarComSlide(cartao, -1, vizinha));
  $('#ficha-prox').addEventListener('click', () => trocarComSlide(cartao, 1, vizinha));
  deslizavel(cartao, { pode: temVizinha, ir: vizinha, quando: celular });
  // A grade também: arrastar para o lado passa a página.
  const grade = $('#inventory-grid');
  const totalPaginas = () => Math.max(1, Math.ceil(pecasDaVista.length / pecasPorPagina()));
  const podePagina = (passo) => pagina + passo >= 0 && pagina + passo < totalPaginas();
  deslizavel(grade, { pode: podePagina, ir: (passo) => irParaPagina(pagina + passo), quando: celular });
  window.addEventListener('popstate', () => {
    if (!naPeca() && tela()?.classList.contains('detalhe')) limparPreview();
  });
  const trocarPagina = (passo) => (celular()
    ? trocarComSlide($('#inventory-grid'), passo, (p) => irParaPagina(pagina + p))
    : irParaPagina(pagina + passo));
  $('#closet-pag-ant').addEventListener('click', () => trocarPagina(-1));
  $('#closet-pag-prox').addEventListener('click', () => trocarPagina(1));
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
  $('#btn-favorita-peca').addEventListener('click', (e) => {
    if (!selecionada) return;
    const agora = db.alternarFavorito('peca', selecionada);
    rotularFavorito();
    if (agora) festejar(e.currentTarget);
    // A estrelinha do slot acompanha sem repintar a grade inteira.
    document.querySelector(`.item-slot[data-id="${selecionada}"]`)
      ?.classList.toggle('favorita', agora);
    toast(agora ? 'Peça favoritada — aparece no seu perfil.' : 'Peça desfavoritada.');
  });
  let t;
  let larguraAntes = window.innerWidth;
  window.addEventListener('resize', () => {
    // No celular, abrir o teclado (editar o nome da peça) muda só a altura:
    // refazer a grade aí fecharia a ficha no meio da digitação.
    if (window.innerWidth === larguraAntes && celular()) return;
    larguraAntes = window.innerWidth;
    if (tela()?.classList.contains('detalhe')) return;
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
    el('span', { class: 'cat-icone' }, ico('brilho')),
    total ? el('span', { class: 'cat-qtd' }, String(total)) : null
  );
  rail.insertBefore(todas, divisor());

  for (const g of gruposDoInventario()) {
    const botao = el('button', {
      class: 'cat-btn' + (g.id === categoriaAtual ? ' active' : ''),
      dataset: { cat: g.id }, title: g.nome,
      onclick: () => carregarCategoria(g.id),
    },
      el('span', { class: 'cat-icone' }, emo(g.icone)),
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

  $('#closet-paginas').hidden = total < 2 && !celular();
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

// Celular: 4 colunas × 6 fileiras, como um inventário. Computador: as colunas que a largura
// comporta × as fileiras que cabem sem rolar (mínimo de 3).
function pecasPorPagina() {
  if (celular()) return 24;
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

  if (peca.origem === 'collab') slot.append(el('span', { class: 'selo-collab' }, ico('estrela-cheia')));
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

// A peça antes ou depois da aberta, na ordem da grade. A página da grade
// acompanha, para o voltar cair onde a peça está.
function vizinha(passo) {
  const i = pecasDaVista.findIndex(p => p.id === selecionada);
  const nova = pecasDaVista[i + passo];
  if (i < 0 || !nova) return;
  const porPagina = pecasPorPagina();
  if (Math.floor((i + passo) / porPagina) !== pagina) {
    pagina = Math.floor((i + passo) / porPagina);
    desenharPagina();
  }
  selecionar(nova);
}

function selecionar(peca) {
  const cat = pecaDoCatalogo(peca.id);
  if (!cat) return;
  selecionada = peca.id;
  const r = RARIDADE[peca.raridade] || RARIDADE.common;
  const img = $('#big-preview-img');

  if (celular()) {
    tela()?.classList.add('detalhe');
    if (!naPeca()) history.pushState({ closetPeca: true }, '');
  }

  const moldura = $('#preview-moldura');
  // A cor da raridade pinta o bloco da foto (no celular), como na grade.
  const quadro = document.querySelector('.view-closet .preview-wrapper');
  quadro?.style.setProperty('--rar-borda', r.aura && r.aura !== 'arco-iris' ? r.aura : r.cor);
  quadro?.classList.toggle('lendaria', peca.raridade === 'legendary');
  $('#placeholder').hidden = true;
  moldura.hidden = false;
  // 300 px de altura é o teto da prévia (closet.css); a peça aberta no
  // celular é maior.
  trocarImagem(img, cat, (celular() ? 420 : 300) * proporcao(cat));

  moldura.classList.remove('flutua');
  void moldura.offsetWidth;
  moldura.classList.add('flutua');

  const meta = $('#preview-meta');
  meta.hidden = false;
  const tag = $('#preview-rarity');
  tag.textContent = r.nome;
  tag.style.background = r.bg;
  tag.style.borderColor = r.cor;
  tag.style.setProperty('--rar-borda', r.aura && r.aura !== 'arco-iris' ? r.aura : r.cor);
  // No celular a ficha mostra o nome de verdade (o que a pessoa deu, ou o do
  // acervo) e "Sem nome" quando não há; tocar no nome edita. No computador
  // segue o nome montado (tipo + marca/cor).
  pintarNome(peca, cat);
  // Que cópia da tiragem é esta. Só as peças levadas depois que o servidor
  // passou a contar têm número.
  const num = $('#preview-numero');
  num.hidden = !peca.numero;
  num.textContent = peca.numero ? `nº ${peca.numero}/${r.tiragem}` : '';
  $('#btn-editar-peca').hidden = !(ADMIN && cat.permanente);

  // A posição na grade aberta: "15/100", e as setas somem nas pontas.
  const pos = pecasDaVista.findIndex(p => p.id === peca.id);
  $('#ficha-pos').textContent = pos >= 0 ? `${pos + 1}/${pecasDaVista.length}` : '';
  $('#ficha-ant').disabled = pos <= 0;
  $('#ficha-prox').disabled = pos < 0 || pos >= pecasDaVista.length - 1;

  rotularFavorito();

  const origem = { collab: 'cápsula do mês', propria: 'peça sua', teste: 'teste' }[peca.origem] || 'garimpo';
  const tipo = CATEGORIAS[categoriaDe(peca)];
  const partes = [['Tipo', tipo?.nome ?? 'Peça']];
  if (cat.cor?.trim()) partes.push(['Cor', cat.cor.trim()]);
  if (cat.marca?.trim()) partes.push(['Marca', cat.marca.trim()]);
  partes.push(['Origem', origem, 'origem'],
    ['Desde', new Date(peca.obtidoEm).toLocaleDateString('pt-BR')]);
  // Cada informação num pedaço: no computador viram uma linha com " · "
  // entre eles; no celular, as linhas da ficha (rótulo e valor, sem a origem).
  // Cor e marca levam à coleção delas, quando ela existe.
  const cols = colecoesDaPeca(peca.id);
  const colecaoDe = { Cor: cols.find(c => c.tipo === 'cor'), Marca: cols.find(c => !c.tipo) };
  $('#preview-info').replaceChildren(...partes.map(([rotulo, t, extra]) => {
    const col = colecaoDe[rotulo];
    return el('span', {
      class: 'info-item' + (extra ? ' ' + extra : '') + (col ? ' link' : ''),
      dataset: { rotulo },
      ...(col ? { role: 'link', title: 'Abrir a coleção', onclick: () => abrirColecao(col.id) } : {}),
    }, t);
  }));
  $('#preview-colecoes').replaceChildren(...colecoesDaPeca(peca.id).map(chipDaColecao));
}

const nomeDaFicha = (peca, cat) => peca.apelido?.trim() || cat.nome?.trim() || '';

function pintarNome(peca, cat) {
  const h3 = $('#preview-nome');
  const nome = celular() ? nomeDaFicha(peca, cat) : nomeDaPeca(cat);
  h3.textContent = nome || 'Sem nome';
  h3.classList.toggle('sem-nome', !nome);
  h3.title = celular() ? 'Tocar para mudar o nome' : '';
}

// Tocar no nome (celular) troca o título por um campo; Enter ou sair do
// campo grava. O nome é seu: fica na sua cópia da peça, não no acervo.
function editarNome() {
  if (!celular() || !selecionada) return;
  const peca = db.pecaDoInventario(selecionada);
  const cat = pecaDoCatalogo(selecionada);
  if (!peca || !cat) return;
  const h3 = $('#preview-nome');
  const campo = el('input', {
    class: 'nome-campo', type: 'text', maxlength: 40,
    value: nomeDaFicha(peca, cat), placeholder: 'Sem nome', 'aria-label': 'Nome da peça',
  });
  let feito = false;
  const gravar = (salvarAgora) => {
    if (feito) return;
    feito = true;
    if (salvarAgora) {
      const novo = campo.value.replace(/\s+/g, ' ').trim();
      // Igual ao do acervo (ou vazio) não precisa de apelido.
      peca.apelido = novo && novo !== (cat.nome?.trim() || '') ? novo : undefined;
      if (!peca.apelido) delete peca.apelido;
      db.salvar();
    }
    campo.replaceWith(h3);
    pintarNome(peca, cat);
  };
  campo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); gravar(true); }
    if (e.key === 'Escape') gravar(false);
  });
  campo.addEventListener('blur', () => gravar(true));
  h3.replaceWith(campo);
  campo.focus();
  campo.select();
}

// O rótulo do botão diz o que o clique vai fazer, não o estado atual.
function rotularFavorito() {
  const botao = $('#btn-favorita-peca');
  if (!botao) return;
  const favorita = selecionada && db.ehFavorito('peca', selecionada);
  botao.classList.toggle('on', Boolean(favorita));
  // No celular só a estrela aparece; o rótulo fica para o computador.
  botao.replaceChildren(ico(favorita ? 'estrela-cheia' : 'estrela'),
    el('span', { class: 'so-pc' }, favorita ? ' Nas favoritas' : ' Favoritar'));
  botao.setAttribute('aria-label', favorita ? 'Nas favoritas' : 'Favoritar');
  botao.title = favorita
    ? 'Tirar do "Roupas favoritas" do seu perfil'
    : 'Mostrar esta peça no seu perfil';
}

function limparPreview() {
  selecionada = null;
  // Fechou por outro caminho (categoria, página): a entrada da peça sai do
  // histórico também, para o voltar seguinte não "fechar" uma peça já fechada.
  if (tela()?.classList.contains('detalhe')) {
    tela().classList.remove('detalhe');
    if (naPeca()) history.back();
  }
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
