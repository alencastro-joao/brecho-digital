// Tarefas: o que o app pede de você — missões do dia, trilha de níveis e a
// cápsula do ilustrador.
//
// É a metade "jogo" do que antes morava no perfil. O perfil ficou sendo quem
// você é (a mesma página que os outros veem quando você aparece no feed) e o
// progresso veio para cá: o XP, as cinco missões que zeram à meia-noite, o que
// cada nível abre e a recompensa de fechar o dia inteiro.

import { MISSOES, MISSOES_SEMANA, PREMIO_SEMANA, RARIDADE, COLLAB, CONFIG, escalaGrade } from './config.js';
import { catalogo, item as pecaDoCatalogo, nomeDaPeca } from './catalog.js';
import * as db from './db.js';
import * as estoque from './estoque.js';
import { el, $, toast, msAteMeiaNoite, msAteSegunda, formatarContagem, formatarDias } from './util.js';
import { barraDeNivel, listaDeFerramentas } from './nivel.js';
import { irPara, viewAtual } from './router.js';

export function montarTarefas() {
  // Missão fecha em qualquer tela: resgatar na vitrine, salvar um look, seguir
  // alguém no feed. Toda gravação repinta esta aba — se ela estiver aberta.
  db.onChange(() => { if (viewAtual() === 'tarefas') renderTarefas(); });
  renderTarefas();
}

export function renderTarefas() {
  const p = db.progresso();
  $('#tarefas-sub').textContent = p.maximo
    ? `Nível ${p.nivel} · ${p.titulo} — o fim da trilha, por enquanto.`
    : `Nível ${p.nivel} · ${p.titulo} — faltam ${p.xpFaltando} XP para o ${p.nivel + 1}.`;

  $('#tarefas-nivel').replaceChildren(barraDeNivel());

  const stats = [
    ['XP', db.xpTotal()],
    ['missões hoje', `${db.missoesFeitas()}/${MISSOES.length}`],
    ['resgates hoje', `${db.state.dia.resgates}/${CONFIG.RESGATES_POR_DIA}`],
    ['dias fechados', db.state.stats.diasCompletos ?? 0],
    ['semanas fechadas', db.state.stats.semanasCompletas ?? 0],
  ];
  $('#tarefas-stats').replaceChildren(...stats.map(([rotulo, valor]) =>
    el('div', { class: 'stat' },
      el('strong', {}, String(valor)), el('small', {}, rotulo))));

  renderMissoes();
  renderSemana();
  $('#ferramenta-box').replaceChildren(listaDeFerramentas());
  renderCollab();
}

// -------------------------------- Missões ---------------------------------
function renderMissoes() {
  const lista = $('#missao-list');
  lista.innerHTML = '';
  const feitas = db.missoesFeitas();
  const tudo = feitas === MISSOES.length;
  $('#missoes-sub').textContent = tudo
    ? `Dia fechado — as ${MISSOES.length} missões saíram. Zeram em ${formatarContagem(msAteMeiaNoite())}.`
    : `${feitas} de ${MISSOES.length} concluídas · zeram em ${formatarContagem(msAteMeiaNoite())} — ` +
      `fechar todas libera a ${COLLAB.titulo}.`;

  for (const m of MISSOES) {
    const atual = Math.min(db.progressoMissao(m.id), m.meta);
    const ok = atual >= m.meta;
    lista.append(el('div', { class: 'missao' + (ok ? ' ok' : '') },
      el('span', { class: 'missao-check' }, ok ? '✓' : ''),
      el('div', { class: 'missao-info' },
        el('strong', {}, m.nome, el('span', { class: 'missao-xp' }, `+${m.xp} XP`)),
        el('div', { class: 'barra' },
          el('span', { style: { width: (atual / m.meta * 100) + '%' } })),
      ),
      el('small', {}, `${atual}/${m.meta}`)
    ));
  }
}

// ----------------------------- Missões da semana ---------------------------
function renderSemana() {
  db.virarODiaSeNecessario();   // a semana pode ter virado com a aba aberta
  const feitas = db.semanaisFeitas();
  const tudo = feitas === MISSOES_SEMANA.length;
  const zera = formatarDias(msAteSegunda());
  $('#semana-sub').textContent = tudo
    ? `Semana fechada. Novas missões em ${zera}.`
    : `${feitas} de ${MISSOES_SEMANA.length} concluídas · zeram em ${zera} — ` +
      `fechar todas abre o baú da semana.`;

  $('#semana-list').replaceChildren(...MISSOES_SEMANA.map(m => {
    const atual = Math.min(db.progressoSemanal(m.id), m.meta);
    const ok = atual >= m.meta;
    return el('div', { class: 'missao' + (ok ? ' ok' : '') },
      el('span', { class: 'missao-check' }, ok ? '✓' : ''),
      el('div', { class: 'missao-info' },
        el('strong', {}, m.nome, el('span', { class: 'missao-xp' }, `+${m.xp} XP`)),
        el('div', { class: 'barra' },
          el('span', { style: { width: (atual / m.meta * 100) + '%' } })),
      ),
      el('small', {}, `${atual}/${m.meta}`));
  }));

  renderBau(tudo);
}

function renderBau(tudo) {
  const box = $('#semana-bau');
  const premio = db.state.semana.premio;
  const faixa = RARIDADE[PREMIO_SEMANA.faixas[0]]?.nome.toLowerCase();

  if (premio) {
    const peca = premio.id && pecaDoCatalogo(premio.id);
    box.className = 'bau aberto';
    box.replaceChildren(
      peca ? el('div', { class: 'bau-peca', style: { '--esc': String(escalaGrade(peca)) } },
        el('div', { class: 'peca-caixa' }, el('img', { src: peca.src, alt: nomeDaPeca(peca) })))
        : el('span', { class: 'bau-icone' }, '🎁'),
      el('div', { class: 'bau-info' },
        el('strong', {}, 'Baú da semana aberto'),
        el('small', {}, peca
          ? `${nomeDaPeca(peca)} (${RARIDADE[premio.raridade]?.nome ?? ''}) + ${PREMIO_SEMANA.xp} XP`
          : `+${PREMIO_SEMANA.xp} XP`)),
      ...(peca ? [el('button', { class: 'btn-ghost', onclick: () => irPara('closet') }, 'Ver')] : []));
    return;
  }

  box.className = 'bau' + (tudo ? ' pronto' : '');
  box.replaceChildren(
    el('span', { class: 'bau-icone' }, tudo ? '🎁' : '🔒'),
    el('div', { class: 'bau-info' },
      el('strong', {}, 'Baú da semana'),
      el('small', {}, `Uma peça ${faixa} sorteada + ${PREMIO_SEMANA.xp} XP.`)),
    ...(tudo ? [el('button', { class: 'btn-dark', onclick: abrirBau }, 'Abrir')] : []));
}

// A peça do baú: a primeira faixa (rara, depois épica, depois incomum) que
// ainda tem peça que você não tem e que não esgotou.
function sortearPremio() {
  for (const faixa of PREMIO_SEMANA.faixas) {
    const lista = catalogo.itens.filter(it =>
      !db.temPeca(it.id) && db.raridadeDoDia(it.id) === faixa && !estoque.esgotada(it.id, faixa));
    if (lista.length) return { item: lista[Math.floor(Math.random() * lista.length)], faixa };
  }
  return { item: null, faixa: null };
}

function abrirBau() {
  const { item, faixa } = sortearPremio();
  const peca = db.abrirPremioDaSemana(item, faixa);
  if (peca) {
    estoque.levar([{ id: peca.id, raridade: peca.raridade }]);
    toast(`Baú aberto: ${nomeDaPeca(item)} (${RARIDADE[faixa].nome}) no seu guarda-roupa.`,
          faixa);
  } else {
    toast(`Baú aberto: +${PREMIO_SEMANA.xp} XP.`);
  }
}

// -------------------------------- Cápsula ---------------------------------
function renderCollab() {
  const box = $('#collab-box');
  box.innerHTML = '';
  const liberada = db.state.collab.liberada;
  const podeResgatar = db.todasMissoesCompletas() && !liberada;

  box.append(el('header', { class: 'collab-head' },
    el('div', {},
      el('h2', {}, COLLAB.titulo),
      el('p', {}, `${COLLAB.ilustrador} · ${COLLAB.descricao}`)
    ),
    el('span', { class: 'collab-selo' + (liberada ? ' on' : '') },
      liberada ? 'liberada' : 'bloqueada')
  ));

  const grade = el('div', { class: 'collab-grid' });
  const disponiveis = COLLAB.itens.filter(id => pecaDoCatalogo(id));
  if (!disponiveis.length) {
    box.append(el('p', { class: 'tool-hint' },
      'As peças desta cápsula ainda não estão no acervo.'));
    return;
  }
  for (const id of disponiveis) {
    const peca = pecaDoCatalogo(id);
    grade.append(el('div', { class: 'collab-item' + (liberada ? '' : ' travado') },
      el('div', {
        class: 'peca-caixa',
        style: { '--esc': String(escalaGrade(peca)) },
      }, el('img', { src: peca.src, alt: nomeDaPeca(peca), loading: 'lazy' })),
      liberada ? null : el('span', { class: 'cadeado' }, '🔒')
    ));
  }
  box.append(grade);

  if (podeResgatar) {
    box.append(el('button', { class: 'btn-dark', onclick: resgatarCollab },
      'Resgatar a cápsula'));
  } else if (!liberada) {
    box.append(el('p', { class: 'tool-hint' },
      'Complete as missões acima para desbloquear as cinco peças.'));
  } else {
    box.append(el('button', { class: 'btn-ghost', onclick: () => irPara('closet') },
      'Ver no guarda-roupa'));
  }
}

function resgatarCollab() {
  const ganhas = [];
  for (const id of COLLAB.itens) {
    const peca = pecaDoCatalogo(id);
    if (peca && db.adicionarPeca(peca, { origem: 'collab', raridade: 'legendary' })) {
      ganhas.push({ id, raridade: 'legendary' });
    }
  }
  estoque.levar(ganhas);   // a collab também conta na tiragem das lendárias
  db.state.collab.liberada = true;
  db.salvar();   // grava e repinta esta tela pelo onChange de montarTarefas
  toast(`${COLLAB.titulo} liberada — 5 peças no seu guarda-roupa.`, 'legendary');
}

export const aoEntrarNasTarefas = renderTarefas;
