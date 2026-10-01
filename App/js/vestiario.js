// Inventário: onde se veste o avatar com as roupinhas desenhadas.
//
// O nome na tela é "Inventário"; o id interno continua sendo `vestiario`
// porque `state.inventario` já é outra coisa — o guarda-roupa das peças de
// verdade (js/db.js). Dois inventários com o mesmo nome no mesmo estado seria
// pedir para trocar um pelo outro.
//
// A tela é um inventário de RPG, e é de propósito. Duas metades: à esquerda o
// personagem vestido, grande, no meio, com uma coluna de lugares do corpo de
// cada lado dele — três e três; à direita a mochila, uma página de casas de
// cima a baixo. O que muda do gênero é a cor: aqui quem informa é a raridade,
// na mesma escala do guarda-roupa.
//
// Os lugares do corpo ficam em volta do personagem, não numa fileira: é o que
// faz a caixa vazia da Cabeça estar na altura da cabeça, e a dos Pés na altura
// dos pés. Quem manda na posição é a ordem de SLOTS (js/roupinhas.js) — a
// primeira metade vai para a coluna da esquerda, a segunda para a direita.
//
// A ficha da peça fica embaixo do personagem, não no painel: ela é sobre o
// que você está provando, e o que se prova aparece é ali do lado.
//
// Vestir não tem botão. Um clique abre a peça na ficha, dois cliques vestem —
// e arrastar a peça até o corpo (ou até o lugar dela) veste também. Botão de
// confirmar num gesto que não destrói nada é um passo a mais sem nada em
// troca; dois cliques desfazem o que dois cliques fizeram.
//
// Tudo que se vê aqui se arrasta, e o arrasto é uma coisa só nos três sentidos:
//
//   saco → corpo      veste
//   corpo → saco      tira, e a peça pousa onde você soltou
//   saco → saco       arruma o saco, e a ordem fica gravada
//
// É por isso que a peça sabe de onde saiu (`arrastando.de`): o mesmo gesto tem
// três destinos, e quem decide o que fazer é o alvo, não a peça.
//
// A miniatura de cada peça não é um ícone: é o desenho dela mesma, fora do
// corpo (roupinhas.svgRoupinha). Existe um desenho só — o que veste o avatar —,
// então nada aqui envelhece quando a arte muda; o que a casa mostra é a peça
// solta, como item de inventário, e não um recorte de gente vestida.
//
// A grade é o que você tem — o saco, não o catálogo. Peça que ainda não abriu
// não aparece aqui; quem avisa que ela abriu é o toast, e daí ela entra no
// saco como qualquer outra.

import { RARIDADE } from './config.js';
import { SLOTS, ORDEM_SLOTS, roupinha, svgRoupinha } from './roupinhas.js';
import * as db from './db.js';
import { svgAvatar, aparenciaAtual } from './avatar.js';
import { el, $, toast } from './util.js';
import { irPara, viewAtual } from './router.js';

let filtro = 'tudo';        // aba da coleção: 'tudo' ou um slot
let pagina = 0;             // página da mochila, começando em 0
let selecionada = null;     // id da peça aberta na ficha
let arrastando = null;      // { id, de: 'saco' | 'corpo' } no meio de um arrasto

// A mochila é um saco de tamanho fixo: um retângulo de casas, cheias ou
// vazias, sempre o mesmo. O que não cabe não estica a página — vai para a
// próxima, e o passador embaixo leva até lá. É o que faz a grade ler como
// inventário e não como uma lista que acabou onde acabou.
//
// O número de casas por página é daqui, não do CSS: é ele que decide quantas
// páginas existem, e dois palpites diferentes dariam páginas com sobra.
const COLUNAS = 5;
const LINHAS = 5;
const POR_PAGINA = COLUNAS * LINHAS;

const equipada = (r) => db.state.vestiario.equipado?.[r.slot] === r.id;

// O desenho da peça no corpo, recortado no pedaço que interessa. Sozinha, sem
// o resto da roupa: a grade é o que você tem, e o look inteiro está na prévia.
// O corpo entra só como medida: a manga é o braço engordado, e o braço de quem
// está vestindo é o que dá a ela a largura certa.
const miniatura = (r) => svgRoupinha(r, aparenciaAtual().corpo);

const estiloDaRaridade = (r) => {
  const rar = RARIDADE[r.raridade] || RARIDADE.common;
  return {
    '--rar-borda': rar.aura && rar.aura !== 'arco-iris' ? rar.aura : rar.cor,
    '--rar-bg': rar.bg,
  };
};

// ------------------------------- Montagem ---------------------------------
export function montarVestiario() {
  $('#vs-despir').addEventListener('click', () => {
    db.tirarTudo();
    toast('Avatar sem roupinha — o Stylist continua igual.');
    renderVestiario();
  });

  // O corpo inteiro aceita a peça arrastada, não só o lugar dela: mirar num
  // quadradinho de 80px é trabalho, e a peça já sabe onde ela vai.
  aceitarSolta($('#vs-previa'), null);

  // Quem ganha XP ou fecha missão não sabe que esta tela existe: db avisa, e
  // a novidade aparece como toast em qualquer tela.
  db.onChange(() => {
    anunciarNovidades();
    if (viewAtual() === 'vestiario') renderVestiario();
  });

  // No boot o save só aprende o que já estava aberto — sem seis toasts de
  // uma vez na primeira tela (ver db.roupinhasNovas).
  db.roupinhasNovas();
}

let anunciando = false;

function anunciarNovidades() {
  if (anunciando) return;
  anunciando = true;
  try {
    const novas = db.roupinhasNovas();
    for (const id of novas) {
      const r = roupinha(id);
      if (!r) continue;
      // O tipo do toast é o id da raridade: 'uncommon'..'legendary' já são as
      // cores dele em base.css, e 'common' cai no padrão.
      toast(`Roupinha nova: ${r.nome}! Está no inventário.`, r.raridade);
    }
    if (novas.length) piscarBotao();
  } finally {
    anunciando = false;
  }
}

// -------------------------- Vestir por gesto ------------------------------
// Um lugar do corpo, uma peça: vestir outra troca a que está lá — mesma regra
// do Stylist, e pela mesma razão (o corpo não empilha).
function vestir(r) {
  if (!db.estadoDaRoupinha(r).liberada) return;
  db.equiparRoupinha(r.id);
  renderVestiario();
}

// Dois cliques fazem e desfazem a mesma coisa: sem botão de confirmar, o
// caminho de volta precisa ser o mesmo gesto.
function alternar(r) {
  if (!db.estadoDaRoupinha(r).liberada) return;
  if (equipada(r)) { db.tirarRoupinha(r.slot); renderVestiario(); }
  else vestir(r);
}

// `casa` é o slot que o alvo representa, ou null quando ele aceita qualquer
// peça (o palco). Só acende e só aceita o que cabe ali.
function aceitarSolta(alvo, casa) {
  const cabe = () => {
    const r = arrastando && roupinha(arrastando.id);
    // Peça que já está vestida não se veste de novo: arrastar de um lugar do
    // corpo para ele mesmo (ou para o palco) não é gesto nenhum.
    if (!r || equipada(r)) return null;
    return !casa || r.slot === casa ? r : null;
  };
  alvo.addEventListener('dragover', (e) => {
    if (!cabe()) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    alvo.classList.add('alvo');
  });
  alvo.addEventListener('dragleave', () => alvo.classList.remove('alvo'));
  alvo.addEventListener('drop', (e) => {
    const r = cabe();
    alvo.classList.remove('alvo');
    if (!r) return;
    e.preventDefault();
    selecionada = r.id;
    vestir(r);
  });
}

// ------------------------- O arrasto, dos dois lados ----------------------
// Quem começa a arrastar acende o caminho: o lugar do corpo onde a peça cabe
// (saindo do saco) ou o saco inteiro (saindo do corpo). O resto apaga, e não
// há como errar a mira.
const comecarArrasto = (r, de) => (e) => {
  arrastando = { id: r.id, de };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', r.id);
  document.body.dataset.arrastando = de;
  if (de === 'saco') {
    document.body.dataset.vestindo = r.slot;
    $(`.vs-slot[data-slot="${r.slot}"]`)?.classList.add('alvo-possivel');
  }
};

const terminarArrasto = () => {
  arrastando = null;
  delete document.body.dataset.vestindo;
  delete document.body.dataset.arrastando;
  document.querySelectorAll('.alvo-possivel, .alvo')
    .forEach(n => n.classList.remove('alvo-possivel', 'alvo'));
};

// Uma casa do saco como alvo. `alvoId` é a peça que está nela, ou null quando
// a casa está vazia — e aí a peça vai para o fim da fila.
//
// O saco aceita as duas origens porque o destino é o mesmo lugar: quem vinha
// do corpo é tirado antes de pousar. Soltar a roupa no saco é despir, e é o
// contrário exato de soltar a peça no corpo.
function aceitarNoSaco(alvo, alvoId = null) {
  const cabe = () => arrastando && arrastando.id !== alvoId;

  alvo.addEventListener('dragover', (e) => {
    if (!cabe()) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    alvo.classList.add('alvo');
  });
  alvo.addEventListener('dragleave', () => alvo.classList.remove('alvo'));
  alvo.addEventListener('drop', (e) => {
    alvo.classList.remove('alvo');
    if (!cabe()) return;
    e.preventDefault();
    const { id, de } = arrastando;
    const r = roupinha(id);
    if (de === 'corpo' && r) db.tirarRoupinha(r.slot);
    db.moverRoupinha(id, alvoId);
    selecionada = id;
    renderVestiario();
  });
}

function piscarBotao() {
  const botao = document.querySelector('.sidebar-btn.vestiario');
  if (!botao) return;
  botao.classList.add('recebeu');
  setTimeout(() => botao.classList.remove('recebeu'), 700);
}

// -------------------------------- Render ----------------------------------
export function renderVestiario() {
  renderPrevia();
  renderColunas();
  renderAbas();
  renderGrade();
  renderFicha();
}

function renderPrevia() {
  $('#vs-previa').innerHTML = svgAvatar({ roupas: db.roupasEquipadas() });
  $('#vs-despir').disabled = !Object.keys(db.roupasEquipadas()).length;
}

// As duas colunas em volta do personagem: a primeira metade de ORDEM_SLOTS à
// esquerda, a segunda à direita. Os nomes dos lugares do corpo ficam na caixa,
// então o painel não precisa repetir o retrato nem o nível — o personagem já
// está no meio, grande, e o selo do nível mora na barra lateral.
function renderColunas() {
  const meio = Math.ceil(ORDEM_SLOTS.length / 2);
  $('#vs-coluna-esq').replaceChildren(...ORDEM_SLOTS.slice(0, meio).map(slotBox));
  $('#vs-coluna-dir').replaceChildren(...ORDEM_SLOTS.slice(meio).map(slotBox));
}

function slotBox(slot) {
  const s = SLOTS[slot];
  const r = roupinha(db.roupasEquipadas()[slot]);

  const caixa = el('button', {
    class: 'vs-slot' + (r ? ` r-${r.raridade}` : ' vazio')
      + (r && selecionada === r.id ? ' selecionado' : ''),
    dataset: { slot },
    title: r ? `${r.nome} — dois cliques para tirar` : `${s.nome}: nada vestido`,
    style: r ? estiloDaRaridade(r) : {},
    onclick: () => {
      if (r) abrirFicha(r.id);
      else { filtro = slot; pagina = 0; selecionada = null; renderVestiario(); }
    },
    ondblclick: () => { if (r) { db.tirarRoupinha(slot); renderVestiario(); } },
    // Só o lugar ocupado se arrasta: arrastar caixa vazia não leva nada.
    draggable: r ? 'true' : null,
    ondragstart: r ? comecarArrasto(r, 'corpo') : null,
    ondragend: r ? terminarArrasto : null,
  });
  aceitarSolta(caixa, slot);

  if (r) caixa.innerHTML = miniatura(r);
  else caixa.append(el('span', { class: 'vs-slot-icone' }, s.icone));
  caixa.append(el('span', { class: 'vs-slot-nome' }, s.nome));
  return caixa;
}

// O que você tem, agrupado por lugar do corpo. A aba de um lugar sem peça
// nenhuma não aparece — mesma regra da paleta do Stylist: aba vazia é um
// caminho que não leva a lugar nenhum.
function renderAbas() {
  const minhas = db.roupinhasLiberadas();
  const abas = [['tudo', '✦ todas', minhas.length]];

  for (const slot of ORDEM_SLOTS) {
    const qtd = minhas.filter(r => r.slot === slot).length;
    if (qtd) abas.push([slot, `${SLOTS[slot].icone} ${SLOTS[slot].nome}`, qtd]);
  }
  if (!abas.some(([id]) => id === filtro)) filtro = 'tudo';

  $('#vs-abas').replaceChildren(...abas.map(([id, rotulo, qtd]) =>
    el('button', {
      class: 'vs-aba' + (filtro === id ? ' ativa' : ''),
      onclick: () => { filtro = id; pagina = 0; renderGrade(); renderAbas(); },
    }, rotulo, el('b', {}, String(qtd)))));
}

// A grade é o saco: só o que já é seu, mais as casas vazias que sobram na
// página. O que ainda não abriu não aparece aqui — quem avisa que abriu é o
// toast.
function renderGrade() {
  const lista = minhasPecas();
  const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  pagina = Math.min(Math.max(pagina, 0), paginas - 1);

  const daPagina = lista.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA);

  const grade = $('#vs-grade');
  grade.style.setProperty('--colunas', String(COLUNAS));
  grade.style.setProperty('--linhas', String(LINHAS));
  // A página tem sempre POR_PAGINA casas, mesmo a última: saco que encolhe no
  // fim não é saco, e a grade pularia de tamanho a cada virada.
  grade.replaceChildren(...Array.from({ length: POR_PAGINA }, (_, i) =>
    daPagina[i] ? itemDaGrade(daPagina[i]) : casaVazia()));

  renderPaginacao(paginas, lista.length);
}

const minhasPecas = () => {
  const minhas = db.roupinhasLiberadas();
  // A ordem é a que você arrumou arrastando; quem nunca foi arrastado entra
  // atrás, na ordem dos lugares do corpo (db.ordenarRoupinhas).
  return db.ordenarRoupinhas(
    filtro === 'tudo' ? minhas : minhas.filter(r => r.slot === filtro));
};

// Casa vazia: o saco tem tamanho, e casa sem peça continua sendo lugar — dá
// para soltar uma peça nela, e é assim que se manda alguma coisa para o fim
// da fila sem ter que passar por cima de todas as outras.
function casaVazia() {
  const casa = el('div', { class: 'vs-item vaga' });
  aceitarNoSaco(casa);
  return casa;
}

// O passador. Ele aparece sempre, com uma página só: é o rodapé que diz
// quantas peças você tem, e a página some de vista quando não há para onde ir
// porque as setas apagam, não porque o rodapé sumiu e mexeu na altura da
// grade.
function renderPaginacao(paginas, total) {
  const ir = (d) => { pagina += d; renderGrade(); };

  $('#vs-paginacao').replaceChildren(
    el('button', {
      class: 'vs-pag-seta', disabled: pagina === 0,
      title: 'Página anterior', onclick: () => ir(-1),
    }, '‹'),
    el('div', { class: 'vs-pag-pontos' }, ...Array.from({ length: paginas }, (_, i) =>
      el('button', {
        class: 'vs-pag-ponto' + (i === pagina ? ' ativa' : ''),
        title: `Página ${i + 1}`,
        onclick: () => { pagina = i; renderGrade(); },
      }))),
    el('button', {
      class: 'vs-pag-seta', disabled: pagina >= paginas - 1,
      title: 'Próxima página', onclick: () => ir(1),
    }, '›'),
    el('span', { class: 'vs-pag-conta' }, `${total} peça${total === 1 ? '' : 's'}`));
}

function itemDaGrade(r) {
  const classes = ['vs-item', `r-${r.raridade}`];
  if (equipada(r)) classes.push('vestida');
  if (selecionada === r.id) classes.push('selecionado');

  const caixa = el('button', {
    class: classes.join(' '),
    style: estiloDaRaridade(r),
    draggable: 'true',
    title: `${r.nome} · ${RARIDADE[r.raridade].nome} — dois cliques para vestir`,
    onclick: () => abrirFicha(r.id),
    ondblclick: () => alternar(r),
    ondragstart: comecarArrasto(r, 'saco'),
    ondragend: terminarArrasto,
  });
  // Ela também é alvo: peça solta em cima de outra toma o lugar dela.
  aceitarNoSaco(caixa, r.id);
  caixa.innerHTML = miniatura(r);
  if (db.ehNova(r.id)) caixa.append(el('span', { class: 'vs-novo' }));
  return caixa;
}

// --------------------------------- Ficha ----------------------------------
function abrirFicha(id) {
  selecionada = id;
  db.marcarVista(id);        // grava e repinta pelo onChange
  renderVestiario();
}

function renderFicha() {
  const ficha = $('#vs-ficha');
  const r = selecionada && roupinha(selecionada);

  if (!r) {
    ficha.replaceChildren(el('div', { class: 'vs-ficha-vazia' },
      el('p', {}, el('strong', {}, 'Um clique'), ' abre a peça aqui. ',
        el('strong', {}, 'Dois cliques'), ' vestem, e dois de novo tiram. ',
        'Arrastando: do saco para o corpo veste, do corpo para o saco tira, e ',
        'dentro do saco arruma as casas.'),
      el('p', {}, 'O que você veste aqui aparece no seu perfil e no retrato do ' +
        'feed. No Stylist o avatar continua pelado, para a roupa de verdade ' +
        'cair no corpo.')));
    return;
  }

  const arte = el('div', { class: 'vs-ficha-arte' });
  arte.innerHTML = miniatura(r);

  // replaceChildren não é o el(): um null aqui vira a palavra "null" na tela.
  ficha.replaceChildren(arte, el('div', { class: 'vs-ficha-info' }, ...[
    el('div', { class: 'vs-ficha-topo' },
      el('h2', {}, r.nome),
      el('span', { class: 'vs-tag raridade', style: estiloDaRaridade(r) },
        RARIDADE[r.raridade].nome),
      el('span', { class: 'vs-tag' }, SLOTS[r.slot].nome),
      equipada(r) ? el('span', { class: 'vs-tag vestida' }, '✓ vestida') : null),
    // De onde ela veio. A peça já é sua, então isto não é uma meta: é a
    // procedência dela, que é metade do valor de uma peça de coleção.
    el('div', { class: 'vs-condicao ok' },
      el('strong', {}, '✓ ' + db.estadoDaRoupinha(r).rotulo)),
  ].filter(Boolean)), el('div', { class: 'vs-ficha-acoes' }, ...acoes(r)));
}

function acoes(r) {
  if (equipada(r)) {
    return [
      el('button', {
        class: 'btn-dark',
        onclick: () => { db.tirarRoupinha(r.slot); renderVestiario(); },
      }, 'Tirar'),
      el('button', { class: 'btn-ghost', onclick: () => irPara('perfil') }, 'No perfil'),
      el('p', { class: 'vs-dica' }, 'Ou arraste ela do corpo de volta para o saco.'),
    ];
  }
  return [
    el('p', { class: 'vs-dica' },
      el('strong', {}, 'Dois cliques'), ' na peça vestem — ou arraste ela até o corpo.'),
  ];
}

export function aoEntrarNoVestiario() {
  anunciarNovidades();
  renderVestiario();
}
