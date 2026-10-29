// Admin › Mini games › Como vão: tela cheia com tudo o que os jogos de ajuda
// (js/ajudas.js) juntaram. Só lê GET /api/admin/ajudas e a esteira; "Usar na
// ficha" é o mesmo de js/adminjogos.js.

import { RARIDADES, RARIDADE, CATEGORIAS, CONFIG, ancoraPadrao } from './config.js';
import { rotuloCategoria } from './catalog.js';
import { svgAvatar } from './avatar.js';
import { ancoraNoCorpo } from './proporcao.js';
import { confirmar, mostrar } from './janela.js';
import { el, $, toast } from './util.js';
import { chamar, usarNaFicha, fichaDosJogos } from './adminjogos.js';

const JOGOS = [
  { id: 'avaliar', nome: 'Avaliar', faz: 'gostei / não gostei', cor: '#f48fb1' },
  { id: 'ajustar', nome: 'Ajustar', faz: 'encaixar no corpo', cor: '#90caf9' },
  { id: 'preencher', nome: 'Preencher', faz: 'cor, marca e tipo', cor: '#ffcc80' },
];
const FILTROS = [
  ['todas', 'Todas'], ['prontas', 'Prontas'], ['faltam', 'Faltam votos'], ['comRaridade', 'Com raridade'],
  ['divididas', 'Respostas divididas'], ['semAjuste', 'Sem ajuste'], ['nada', 'Ninguém mexeu'],
];
const ORDENS = [['votos', 'Mais votos'], ['gostei', 'Mais gostadas'], ['menos', 'Menos gostadas']];

const NOME_ENTRADA = { raridade: 'raridade', ajuste: 'ajuste', cat: 'tipo', cor: 'cor', marca: 'marca' };

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
      // Entradas que ainda não fecharam (ajudas.py, pendencias). Vazio = pronta.
      faltam: p.faltam ?? ['raridade', 'ajuste', 'cat', 'cor', 'marca'],
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
  const comRaridade = pecas.filter(p => p.total >= min).length;
  const prontas = pecas.filter(p => !p.faltam.length).length;
  const pctDe = (n) => (pecas.length ? `${Math.round(n * 100 / pecas.length)}%` : '');

  $('#mgn-corpo').replaceChildren(
    el('div', { class: 'mgn-kpis' },
      kpi('Peças nos jogos', pecas.length),
      kpi('Prontas', prontas, pctDe(prontas)),
      kpi('Com raridade sugerida', comRaridade, pctDe(comRaridade)),
      kpi('Ajudas hoje', somaHoje('ajudas')),
      kpi('Fichas dadas hoje', somaHoje('fichas')),
      kpi('Jogadas hoje', somaHoje('pessoas'), 'pessoa × jogo')),
    secao('Cada jogo', 'Hoje e ontem (as contagens somem do banco depois de 2 dias).',
      el('div', { class: 'mgn-jogos' }, ...JOGOS.map(cartaoJogo))),
    el('div', { class: 'mgn-duas' },
      secao('Raridade que os votos sugerem', `Precisa de ${min} votos para ganhar raridade.`, raridades()),
      secao('O que falta', 'Peças em que cada entrada ainda não fechou. Tipo e cor: 3 iguais, ou a maioria de 5.', faltas())),
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
  const regras = dados.r.regras || {};
  const t = pecas.length || 1;
  const itens = [
    [`Raridade (${min} votos)`, pecas.filter(p => p.faltam.includes('raridade')).length],
    [`Ajuste (${regras.ajustesMin ?? 3} medidas)`, pecas.filter(p => p.faltam.includes('ajuste')).length],
    ['Cor', pecas.filter(p => p.faltam.includes('cor')).length],
    [`Marca (${regras.marcaIguais ?? 2} iguais)`, pecas.filter(p => p.faltam.includes('marca')).length],
    ['Tipo', pecas.filter(p => p.faltam.includes('cat')).length],
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
    prontas: pecas.filter(p => !p.faltam.length),
    comRaridade: pecas.filter(p => p.v.raridade),
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
        rar ? el('span', { class: 'mgn-rar', style: { background: rar.bg, borderColor: rar.aura || rar.cor } }, rar.nome) : null,
        el('small', {}, p.faltam.length ? `falta: ${p.faltam.map(e => NOME_ENTRADA[e]).join(', ')}` : 'pronta')),
      el('div', { class: 'mgn-peca-votos' },
        votos,
        el('small', {}, p.total ? `${v.pct}% gostei · ${p.total}/${min} votos` : `0/${min} votos`)),
      el('div', { class: 'mgn-resps' },
        resp('cor', 'cor'), resp('marca', 'marca', (m) => m || 'sem marca'),
        resp('tipo', 'cat', (c) => (CATEGORIAS[c] ? rotuloCategoria(c) : c)),
        resumo.ajuste ? el('span', {}, el('small', {}, 'ajuste'), `${resumo.ajuste.medidas} medida${resumo.ajuste.medidas > 1 ? 's' : ''}`)
          : el('span', { class: 'falta' }, el('small', {}, 'ajuste'), '–'))),
    el('div', { class: 'mgn-peca-acoes' },
      el('button', { type: 'button', class: 'btn-ghost', onclick: () => verComoFica(p) }, 'Ver como fica'),
      p.mexeu ? el('button', { type: 'button', class: 'btn-ghost', onclick: () => usarNaFicha(p.item, resumo) }, 'Usar na ficha') : null));
}

// ---------------------------- Ver como fica --------------------------------
// A peça no corpo com a ficha que sairia hoje (a da esteira com os votos por
// cima, como em "Usar na ficha"). Nada é gravado até apertar "Forçar publicação".
function verComoFica(p) {
  const { ficha, medida } = fichaDosJogos(p.item, p.resumo);
  const cat = CATEGORIAS[ficha.cat] ? ficha.cat : '';
  const palco = el('div', { class: 'mg-corpo mgn-ver-corpo' });
  const boneco = el('div', { class: 'mg-boneco' });
  boneco.innerHTML = svgAvatar();
  palco.append(boneco);
  if (cat) {
    // Medida do molde (votos ou esteira) levada ao corpo; sem ela, o lugar padrão.
    const m = medida || p.item.medida;
    const a = m ? ancoraNoCorpo(CATEGORIAS[cat].regiao, m) : ancoraPadrao(cat);
    const prop = p.item.w && p.item.h ? p.item.w / p.item.h : 1;
    palco.append(el('div', {
      class: 'mg-peca', style: {
        left: `${a.x / CONFIG.STAGE_W * 100}%`, top: `${a.y / CONFIG.STAGE_H * 100}%`,
        width: `${a.w / CONFIG.STAGE_W * 100}%`, height: `${a.w / prop / CONFIG.STAGE_H * 100}%`, cursor: 'default',
      },
    }, el('img', { src: p.src, alt: '' })));
  }
  const rar = RARIDADE[ficha.raridade];
  const linha = (rot, valor, deOnde) => el('li', {}, el('small', {}, rot), el('b', {}, valor || '–'),
    deOnde ? el('em', {}, deOnde) : null);
  const votou = (k) => (p.resumo[k] ? 'dos jogos' : 'da esteira');
  const lugar = !cat ? 'sem tipo, não dá para pôr no corpo'
    : p.resumo.ajuste ? `mediana de ${p.resumo.ajuste.medidas} ajuste${p.resumo.ajuste.medidas > 1 ? 's' : ''}`
      : (medida || p.item.medida) ? 'medida da esteira' : 'lugar padrão do tipo';
  const pronta = !p.faltam.length;

  const caixa = el('div', { class: 'mgn-ver' },
    el('div', { class: 'mgn-ver-palco' }, cat ? palco : el('img', { src: p.src, alt: '', class: 'mgn-ver-solta' })),
    el('div', { class: 'mgn-ver-ficha' },
      el('h3', {}, ficha.nome || (cat ? rotuloCategoria(cat) : 'Peça sem nome')),
      el('p', { class: pronta ? 'mgn-ver-ok' : 'mgn-ver-falta' },
        pronta ? 'Pronta: todas as entradas fecharam.' : `Ainda falta: ${p.faltam.map(e => NOME_ENTRADA[e]).join(', ')}.`),
      el('ul', {},
        linha('tipo', cat ? rotuloCategoria(cat) : '', votou('cat')),
        linha('raridade', rar?.nome, p.v.raridade ? `${p.total} votos` : 'da esteira'),
        linha('cor', ficha.cor, votou('cor')),
        linha('marca', ficha.marca || (p.resumo.marca ? 'sem marca' : ''), votou('marca')),
        linha('no corpo', '', lugar)),
      el('button', { type: 'button', class: 'btn-admin mgn-forcar', onclick: () => forcar(p, ficha, caixa) }, 'Forçar publicação'),
      el('small', {}, 'Publica agora com esta ficha, mesmo que falte entrada. A peça entra no jogo e sai dos mini games.')));
  mostrar(caixa, { sim: 'Fechar' });
}

async function forcar(p, ficha, caixa) {
  if (!CATEGORIAS[ficha.cat]) return toast('Sem tipo não dá para publicar. Escolha o tipo na esteira.', 'aviso');
  const ok = await confirmar(`Publicar "${ficha.nome || rotuloCategoria(ficha.cat)}" agora?`
    + (p.faltam.length ? ` Ainda falta ${p.faltam.map(e => NOME_ENTRADA[e]).join(', ')}.` : ''),
  { sim: 'Publicar', nao: 'Cancelar' });
  if (!ok) return;
  try {
    const corpo = fichaDosJogos(p.item, p.resumo);
    const { item: peca } = await chamar(`/api/esteira/${encodeURIComponent(p.id)}/publicar`, 'POST',
      { ficha: corpo.ficha, medida: corpo.medida || p.item.medida || null });
    caixa.closest('.modal')?.querySelector('.pergunta-botoes .btn-dark')?.click();   // fecha o "Ver como fica"
    toast(`${peca?.nome || 'Peça'} entrou no jogo.`, peca?.raridade);
    carregar();
  } catch (e) {
    toast(`Não deu: ${e.message}`, 'aviso');
  }
}
