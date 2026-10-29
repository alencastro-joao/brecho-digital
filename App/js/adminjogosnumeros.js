// Admin › Mini games › Como vão: tela cheia com tudo o que os jogos de ajuda
// (js/ajudas.js) juntaram. Só lê GET /api/admin/ajudas e a esteira; "Usar na
// ficha" é o mesmo de js/adminjogos.js.

import { RARIDADES, RARIDADE, CATEGORIAS } from './config.js';
import { rotuloCategoria } from './catalog.js';
import { el, $ } from './util.js';
import { chamar, usarNaFicha } from './adminjogos.js';

const JOGOS = [
  { id: 'avaliar', nome: 'Avaliar', faz: 'gostei / não gostei', cor: '#f48fb1' },
  { id: 'ajustar', nome: 'Ajustar', faz: 'encaixar no corpo', cor: '#90caf9' },
  { id: 'preencher', nome: 'Preencher', faz: 'cor, marca e tipo', cor: '#ffcc80' },
];
const FILTROS = [
  ['todas', 'Todas'], ['faltam', 'Faltam votos'], ['prontas', 'Com raridade'],
  ['divididas', 'Respostas divididas'], ['semAjuste', 'Sem ajuste'], ['nada', 'Ninguém mexeu'],
];
const ORDENS = [['votos', 'Mais votos'], ['gostei', 'Mais gostadas'], ['menos', 'Menos gostadas']];

let dados = null;
let filtro = 'todas';
let ordem = 'votos';

export function montarNumeros() {
  $('#adm-jogos-avaliar').addEventListener('click', abrir);
  $('#mgn-voltar').addEventListener('click', fechar);
  $('#mgn-atualizar').addEventListener('click', carregar);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#mgn-tela').hidden) fechar(); });
}

function abrir() {
  $('#mgn-tela').hidden = false;
  document.body.classList.add('mgn-aberta');
  carregar();
}

function fechar() {
  $('#mgn-tela').hidden = true;
  document.body.classList.remove('mgn-aberta');
}

function diaBrasilia(menos = 0) {
  return new Date(Date.now() - 3 * 3600e3 - menos * 86400e3).toISOString().slice(0, 10);
}

async function carregar() {
  const corpo = $('#mgn-corpo');
  corpo.replaceChildren(el('p', { class: 'mgn-vazio' }, 'Carregando…'));
  try {
    const [r, esteira] = await Promise.all([chamar('/api/admin/ajudas'), chamar('/api/esteira').catch(() => ({}))]);
    dados = preparar(r, esteira);
  } catch (e) {
    corpo.replaceChildren(el('p', { class: 'mgn-vazio' }, `Não consegui ler: ${e.message}`));
    return;
  }
  desenhar();
}

// Junta o resumo com a esteira: uma linha por peça que está nos jogos.
function preparar(r, esteira) {
  const min = r.regras?.votosMin || 10;
  const foto = new Map((esteira.itens || []).map(i => [i.id, i]));
  const porPeca = new Map((r.pecas || []).map(p => [p.peca, p]));
  const pecas = (r.nosJogos || []).map(id => {
    const p = porPeca.get(id) || { peca: id };
    const v = p.votos || { sim: 0, nao: 0, meh: 0 };
    const total = v.sim + v.nao + (v.meh || 0);
    const item = foto.get(id) || { id };
    const divididas = ['cor', 'marca', 'cat'].filter(k => p[k] && p[k].total >= 3 && p[k].votos * 2 <= p[k].total);
    return {
      id, item, resumo: p, v, total,
      nome: item.ficha?.nome || '',
      src: item.previa || `assets/jogos/${id}.webp`,
      cat: item.ficha?.cat || item.sugestao?.cat || '',
      divididas, mexeu: porPeca.has(id),
    };
  });
  return { r, min, pecas, regras: r.regras?.jogos || {} };
}

// ------------------------------- Desenho ----------------------------------
const secao = (titulo, dica, ...filhos) => el('section', { class: 'mgn-secao' },
  el('header', {}, el('h2', {}, titulo), dica ? el('p', {}, dica) : null), ...filhos);

const barra = (pct, cor) => el('div', { class: 'mgn-barra' },
  el('span', { style: { width: `${Math.max(0, Math.min(100, pct))}%`, background: cor } }));

function desenhar() {
  const { r, min, pecas } = dados;
  const hoje = diaBrasilia(0);
  const somaHoje = (k) => JOGOS.reduce((t, j) => t + (r.cotas?.[j.id]?.[hoje]?.[k] || 0), 0);
  const prontas = pecas.filter(p => p.total >= min).length;

  $('#mgn-corpo').replaceChildren(
    el('div', { class: 'mgn-kpis' },
      kpi('Peças nos jogos', pecas.length),
      kpi('Com raridade sugerida', prontas, pecas.length ? `${Math.round(prontas * 100 / pecas.length)}%` : ''),
      kpi('Ajudas hoje', somaHoje('ajudas')),
      kpi('Fichas dadas hoje', somaHoje('fichas')),
      kpi('Jogadas hoje', somaHoje('pessoas'), 'pessoa × jogo')),
    secao('Cada jogo', 'Hoje e ontem (as contagens somem do banco depois de 2 dias).',
      el('div', { class: 'mgn-jogos' }, ...JOGOS.map(cartaoJogo))),
    el('div', { class: 'mgn-duas' },
      secao('Raridade que os votos sugerem', `Precisa de ${min} votos para ganhar raridade.`, raridades()),
      secao('O que falta', 'Quantas peças ainda não têm cada coisa.', faltas())),
    destaques(),
    secao('Peças', null, controles(), el('div', { class: 'mgn-lista', id: 'mgn-lista' })));
  desenharLista();
}

const kpi = (rotulo, valor, extra) => el('div', { class: 'mgn-kpi' },
  el('b', {}, String(valor)), el('span', {}, rotulo), extra ? el('small', {}, extra) : null);

function cartaoJogo(j) {
  const { r, pecas, regras } = dados;
  const g = regras[j.id] || {};
  const dia = (n) => r.cotas?.[j.id]?.[diaBrasilia(n)] || { pessoas: 0, ajudas: 0, fichas: 0, noLimite: 0 };
  const hoje = dia(0), ontem = dia(1);
  const maior = Math.max(hoje.ajudas, ontem.ajudas, 1);
  const feito = {
    avaliar: (p) => p.total > 0,
    ajustar: (p) => !!p.resumo.ajuste,
    preencher: (p) => !!(p.resumo.cor || p.resumo.marca || p.resumo.cat),
  }[j.id];
  const cobertas = pecas.filter(feito).length;
  const cob = pecas.length ? Math.round(cobertas * 100 / pecas.length) : 0;
  const linhaDia = (rot, d) => el('div', { class: 'mgn-dia' },
    el('span', {}, rot), barra(d.ajudas * 100 / maior, j.cor), el('b', {}, String(d.ajudas)));
  return el('article', { class: 'mgn-jogo', style: { '--cor-jogo': j.cor } },
    el('header', {}, el('h3', {}, j.nome), el('small', {}, j.faz)),
    el('p', { class: 'mgn-rot' }, 'Ajudas'),
    linhaDia('Hoje', hoje), linhaDia('Ontem', ontem),
    el('dl', { class: 'mgn-nums' },
      el('div', {}, el('dt', {}, 'Pessoas hoje'), el('dd', {}, String(hoje.pessoas))),
      el('div', {}, el('dt', {}, 'Fichas hoje'), el('dd', {}, String(hoje.fichas))),
      el('div', {}, el('dt', {}, 'No limite'), el('dd', {}, String(hoje.noLimite))),
      el('div', {}, el('dt', {}, 'Média/pessoa'), el('dd', {}, hoje.pessoas ? (hoje.ajudas / hoje.pessoas).toFixed(1) : '–'))),
    el('p', { class: 'mgn-rot' }, `Peças com ajuda: ${cobertas} de ${pecas.length} (${cob}%)`),
    barra(cob, j.cor),
    el('p', { class: 'mgn-regra' }, `1 ficha a cada ${g.porFicha} · até ${g.limite} por ${g.janela}`));
}

function raridades() {
  const { pecas, min } = dados;
  const conta = Object.fromEntries(RARIDADES.map(r => [r.id, 0]));
  let esperando = 0;
  pecas.forEach(p => { p.v.raridade ? conta[p.v.raridade]++ : esperando++; });
  const total = pecas.length || 1;
  const partes = [...RARIDADES.map(r => ({ nome: r.nome, n: conta[r.id], cor: r.aura || r.cor })),
    { nome: `Menos de ${min} votos`, n: esperando, cor: 'var(--linha)' }].filter(x => x.n);
  if (!pecas.length) return el('p', { class: 'mgn-vazio' }, 'Nenhuma peça nos jogos.');
  return el('div', {},
    el('div', { class: 'mgn-pilha' }, ...partes.map(x =>
      el('span', { title: `${x.nome}: ${x.n}`, style: { flex: x.n, background: x.cor } }))),
    el('ul', { class: 'mgn-legenda' }, ...partes.map(x => el('li', {},
      el('i', { style: { background: x.cor } }), `${x.nome}`, el('b', {}, `${x.n}`),
      el('small', {}, `${Math.round(x.n * 100 / total)}%`)))));
}

function faltas() {
  const { pecas, min } = dados;
  const t = pecas.length || 1;
  const itens = [
    ['Votos suficientes', pecas.filter(p => p.total < min).length],
    ['Ajuste no corpo', pecas.filter(p => !p.resumo.ajuste).length],
    ['Cor', pecas.filter(p => !p.resumo.cor).length],
    ['Marca', pecas.filter(p => !p.resumo.marca).length],
    ['Tipo', pecas.filter(p => !p.resumo.cat).length],
    ['Qualquer ajuda', pecas.filter(p => !p.mexeu).length],
  ];
  return el('div', { class: 'mgn-faltas' }, ...itens.map(([rot, n]) => el('div', { class: 'mgn-dia' },
    el('span', {}, rot), barra(n * 100 / t, '#ef9a9a'), el('b', {}, `${n}`))));
}

function destaques() {
  const com = dados.pecas.filter(p => p.v.raridade).sort((a, b) => b.v.pct - a.v.pct);
  if (!com.length) return null;
  const fila = (ps) => el('div', { class: 'mgn-fila' }, ...ps.map(p => el('figure', {},
    el('img', { src: p.src, alt: '', loading: 'lazy' }),
    el('figcaption', {}, el('b', {}, `${p.v.pct}%`), ` ${RARIDADE[p.v.raridade]?.nome || ''}`))));
  return el('div', { class: 'mgn-duas' },
    secao('Mais gostadas', null, fila(com.slice(0, 6))),
    com.length > 6 ? secao('Menos gostadas', null, fila(com.slice(-6).reverse())) : null);
}

function controles() {
  const chips = (lista, atual, mudar) => el('div', { class: 'mgn-chips' }, ...lista.map(([id, rot]) =>
    el('button', { type: 'button', class: id === atual ? 'ativo' : '', onclick: () => mudar(id) }, rot)));
  const caixa = el('div', { class: 'mgn-controles' });
  const pintar = () => caixa.replaceChildren(
    chips(FILTROS.map(([id, rot]) => [id, `${rot} (${filtrar(id).length})`]), filtro, (id) => { filtro = id; pintar(); desenharLista(); }),
    chips(ORDENS, ordem, (id) => { ordem = id; pintar(); desenharLista(); }));
  pintar();
  return caixa;
}

function filtrar(f) {
  const { pecas, min } = dados;
  return {
    todas: pecas,
    faltam: pecas.filter(p => p.total < min),
    prontas: pecas.filter(p => p.v.raridade),
    divididas: pecas.filter(p => p.divididas.length),
    semAjuste: pecas.filter(p => !p.resumo.ajuste),
    nada: pecas.filter(p => !p.mexeu),
  }[f];
}

function desenharLista() {
  const lista = [...filtrar(filtro)];
  const pct = (p) => p.v.pct ?? -1;
  lista.sort(ordem === 'votos' ? (a, b) => b.total - a.total
    : ordem === 'gostei' ? (a, b) => pct(b) - pct(a)
      : (a, b) => (pct(a) < 0) - (pct(b) < 0) || pct(a) - pct(b));
  $('#mgn-lista').replaceChildren(...(lista.length ? lista.map(linhaPeca)
    : [el('p', { class: 'mgn-vazio' }, 'Nenhuma peça aqui.')]));
}

function linhaPeca(p) {
  const { min } = dados;
  const { v, resumo } = p;
  const rar = v.raridade ? RARIDADE[v.raridade] : null;
  const votos = p.total
    ? el('div', { class: 'mgn-votos', title: `${v.sim} gostei · ${v.meh || 0} tanto faz · ${v.nao} não gostei` },
      el('span', { class: 'sim', style: { flex: v.sim } }), el('span', { class: 'meh', style: { flex: v.meh || 0 } }),
      el('span', { class: 'nao', style: { flex: v.nao } }))
    : el('div', { class: 'mgn-votos vazio' });
  const resp = (rot, k, fmt = (x) => x) => resumo[k]
    ? el('span', { class: p.divididas.includes(k) ? 'dividida' : '' },
      el('small', {}, rot), `${fmt(resumo[k].valor)} `, el('em', {}, `${resumo[k].votos}/${resumo[k].total}`))
    : el('span', { class: 'falta' }, el('small', {}, rot), '–');
  const tipo = p.cat ? rotuloCategoria(p.cat) : 'sem categoria';
  return el('article', { class: 'mgn-peca' },
    el('img', { src: p.src, alt: '', loading: 'lazy' }),
    el('div', { class: 'mgn-peca-info' },
      el('header', {}, el('b', {}, p.nome || tipo), p.nome ? el('small', {}, tipo) : null,
        rar ? el('span', { class: 'mgn-rar', style: { background: rar.bg, borderColor: rar.aura || rar.cor } }, rar.nome) : null),
      el('div', { class: 'mgn-peca-votos' },
        votos,
        el('small', {}, p.total ? `${v.pct}% gostei · ${p.total}/${min} votos` : `0/${min} votos`)),
      el('div', { class: 'mgn-resps' },
        resp('cor', 'cor'), resp('marca', 'marca'),
        resp('tipo', 'cat', (c) => (CATEGORIAS[c] ? rotuloCategoria(c) : c)),
        resumo.ajuste ? el('span', {}, el('small', {}, 'ajuste'), `${resumo.ajuste.medidas} medida${resumo.ajuste.medidas > 1 ? 's' : ''}`)
          : el('span', { class: 'falta' }, el('small', {}, 'ajuste'), '–'))),
    p.mexeu ? el('button', { type: 'button', class: 'btn-ghost', onclick: () => usarNaFicha(p.item, resumo) }, 'Usar na ficha') : null);
}
