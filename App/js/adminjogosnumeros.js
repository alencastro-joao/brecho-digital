// Admin › Mini games › Como vão: tela cheia com tudo o que os jogos de ajuda
// (js/ajudas.js) juntaram. Só lê GET /api/admin/ajudas e a esteira; "Usar na
// ficha" é o mesmo de js/adminjogos.js.
//
// A tela existe para três coisas, nesta ordem: publicar as peças prontas,
// destravar as que os jogadores não resolvem e ver se os jogos estão rodando
// hoje. Por isso a lista de peças é a área principal (com a barra de etapas
// servindo de filtro) e os números do dia ficam na coluna do lado.

import { RARIDADES, RARIDADE, CATEGORIAS, CONFIG, ancoraPadrao } from './config.js';
import { rotuloCategoria } from './catalog.js';
import { svgAvatar } from './avatar.js';
import { ancoraNoCorpo } from './proporcao.js';
import { confirmar, mostrar } from './janela.js';
import { el, $, toast } from './util.js';
import { chamar, usarNaFicha, fichaDosJogos } from './adminjogos.js';

// `entradas`: o que cada jogo fecha na peça (ajudas.py, ENTRADAS).
const JOGOS = [
  { id: 'avaliar', nome: 'Avaliar', faz: 'gostei / não gostei', cor: '#f48fb1', entradas: ['raridade'] },
  { id: 'ajustar', nome: 'Ajustar', faz: 'encaixar no corpo', cor: '#90caf9', entradas: ['ajuste'] },
  { id: 'preencher', nome: 'Preencher', faz: 'tipo, cor e marca', cor: '#ffcc80', entradas: ['cat', 'cor', 'marca'] },
];
// Onde a peça está no caminho até a publicação. Cada peça cai numa só.
const ETAPAS = [
  { id: 'prontas', nome: 'Prontas', cor: '#2fbf63', dica: 'Todas as entradas fecharam. Veja como fica e publique.' },
  { id: 'divididas', nome: 'Divididas', cor: '#ffb74d', dica: 'Os jogadores não concordam em alguma resposta. Decida você: leve para a ficha ou force a publicação.' },
  { id: 'andamento', nome: 'Em andamento', cor: '#90caf9', dica: 'Já recebem ajuda e ainda falta alguma entrada.' },
  { id: 'nada', nome: 'Sem ajuda', cor: '#cfd8dc', dica: 'Ninguém mexeu ainda.' },
];
const ORDENS = [['votos', 'Mais votos'], ['gostei', 'Mais gostadas'], ['menos', 'Menos gostadas']];

const NOME_ENTRADA = { raridade: 'raridade', ajuste: 'ajuste', cat: 'tipo', cor: 'cor', marca: 'marca' };
// A lendária tem aura 'arco-iris', que não é cor: usa a cor de fundo dela.
const corDa = (r) => (r.aura && r.aura !== 'arco-iris' ? r.aura : r.cor);

let dados = null;
let etapa = null;         // null: escolhe na primeira leitura (Prontas, se houver)
let falta = '';
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
  $('#mgn-hora').textContent = `lido às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  if (!etapa) etapa = dados.pecas.some(p => p.etapa === 'prontas') ? 'prontas' : 'todas';
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
    // Entradas que ainda não fecharam (ajudas.py, pendencias). Vazio = pronta.
    const faltam = p.faltam ?? ['raridade', 'ajuste', 'cat', 'cor', 'marca'];
    // Dividida: entrada aberta com 3+ respostas e nenhuma com mais da metade.
    const divididas = ['cor', 'marca', 'cat'].filter(k => faltam.includes(k)
      && p[k] && p[k].total >= 3 && p[k].votos * 2 <= p[k].total);
    const mexeu = porPeca.has(id);
    return {
      id, item, resumo: p, v, total, faltam, divididas, mexeu,
      nome: item.ficha?.nome || '',
      src: item.previa || `assets/jogos/${id}.webp`,
      cat: item.ficha?.cat || item.sugestao?.cat || '',
      etapa: !faltam.length ? 'prontas' : divididas.length ? 'divididas' : mexeu ? 'andamento' : 'nada',
    };
  });
  return { r, min, pecas, regras: r.regras?.jogos || {} };
}

// ------------------------------- Desenho ----------------------------------
const secao = (classe, titulo, dica, ...filhos) => el('section', { class: `mgn-secao ${classe}` },
  el('header', {}, el('h2', {}, titulo), dica ? el('p', {}, dica) : null), ...filhos);

const barra = (pct, cor) => el('div', { class: 'mgn-barra' },
  el('span', { style: { width: `${Math.max(0, Math.min(100, pct))}%`, background: cor } }));

function desenhar() {
  $('#mgn-corpo').replaceChildren(
    el('div', { class: 'mgn-grade' },
      secao('mgn-principal', 'Peças nos jogos', null,
        el('div', { id: 'mgn-etapas' }), el('div', { id: 'mgn-controles' }), el('div', { class: 'mgn-lista', id: 'mgn-lista' })),
      el('aside', { class: 'mgn-lado' }, hojeNosJogos(), raridades())));
  desenharLista();
}

// ------------------------------ Lista de peças -----------------------------
function porEtapa(id) {
  return id === 'todas' ? dados.pecas : dados.pecas.filter(p => p.etapa === id);
}

// A barra de etapas é o filtro principal: cada pedaço é um botão.
function etapas() {
  const n = dados.pecas.length;
  const atual = ETAPAS.find(e => e.id === etapa);
  const botao = (id, nome, cor, qtd) => el('button', {
    type: 'button', class: id === etapa ? 'ativo' : '', 'aria-pressed': String(id === etapa),
    onclick: () => { etapa = id; falta = ''; desenharLista(); },
  }, cor ? el('i', { style: { background: cor } }) : null, nome, el('b', {}, String(qtd)));
  return el('div', { class: 'mgn-etapas' },
    el('div', { class: 'mgn-pilha' }, ...ETAPAS.map(e => {
      const q = porEtapa(e.id).length;
      return q ? el('span', { title: `${e.nome}: ${q}`, style: { flex: q, background: e.cor } }) : null;
    })),
    el('div', { class: 'mgn-abas', role: 'group', 'aria-label': 'Etapa' },
      ...ETAPAS.map(e => botao(e.id, e.nome, e.cor, porEtapa(e.id).length)),
      botao('todas', 'Todas', null, n)),
    atual ? el('p', { class: 'mgn-dica' }, atual.dica) : null);
}

function controles(base) {
  const escolha = (rotulo, opcoes, valor, mudar) => el('label', {}, rotulo,
    el('select', { onchange: (e) => { mudar(e.target.value); desenharLista(); } },
      ...opcoes.map(([id, rot]) => el('option', { value: id, selected: id === valor }, rot))));
  const entradas = Object.entries(NOME_ENTRADA).map(([id, rot]) => {
    const q = base.filter(p => p.faltam.includes(id)).length;
    return q ? [id, `${rot} (${q})`] : null;
  }).filter(Boolean);
  return el('div', { class: 'mgn-controles' },
    // Em Prontas nada falta: o filtro só atrapalharia.
    entradas.length ? escolha('Falta', [['', 'qualquer coisa'], ...entradas], falta, (v) => { falta = v; }) : null,
    escolha('Ordem', ORDENS, ordem, (v) => { ordem = v; }));
}

function desenharLista() {
  const base = porEtapa(etapa);
  if (falta && !base.some(p => p.faltam.includes(falta))) falta = '';
  const lista = falta ? base.filter(p => p.faltam.includes(falta)) : [...base];
  const pct = (p) => p.v.pct ?? -1;
  lista.sort(ordem === 'votos' ? (a, b) => b.total - a.total
    : ordem === 'gostei' ? (a, b) => pct(b) - pct(a)
      : (a, b) => (pct(a) < 0) - (pct(b) < 0) || pct(a) - pct(b));
  $('#mgn-etapas').replaceChildren(etapas());
  $('#mgn-controles').replaceChildren(controles(base));
  $('#mgn-lista').replaceChildren(...(lista.length ? lista.map(linhaPeca)
    : [el('p', { class: 'mgn-vazio' }, dados.pecas.length ? 'Nenhuma peça aqui.' : 'Nenhuma peça nos jogos.')]));
}

// Uma linha por peça: a foto, as respostas (verde = fechou, laranja = dividida,
// apagada = ninguém respondeu) e um botão só, que muda com a etapa.
function linhaPeca(p) {
  const { min } = dados;
  const { v, resumo } = p;
  const rar = v.raridade ? RARIDADE[v.raridade] : null;
  const estado = (k) => (!p.faltam.includes(k) ? 'ok' : p.divididas.includes(k) ? 'dividida' : '');
  const resp = (rot, k, fmt = (x) => x) => (resumo[k]
    ? el('span', { class: estado(k) },
      el('small', {}, rot), `${fmt(resumo[k].valor)} `, el('em', {}, `${resumo[k].votos}/${resumo[k].total}`))
    : el('span', { class: 'falta' }, el('small', {}, rot), '–'));
  const votos = el('div', { class: `mgn-votos${p.total ? '' : ' vazio'}`, title: `${v.sim} gostei · ${v.meh || 0} tanto faz · ${v.nao} não gostei` },
    el('span', { class: 'sim', style: { flex: v.sim } }), el('span', { class: 'meh', style: { flex: v.meh || 0 } }),
    el('span', { class: 'nao', style: { flex: v.nao } }));
  const tipo = p.cat ? rotuloCategoria(p.cat) : 'sem tipo';
  const pronta = p.etapa === 'prontas';
  return el('article', { class: `mgn-peca${pronta ? ' pronta' : ''}` },
    el('img', { src: p.src, alt: '', loading: 'lazy' }),
    el('div', { class: 'mgn-peca-info' },
      el('header', {}, el('b', {}, p.nome || tipo), p.nome ? el('small', {}, tipo) : null,
        rar ? el('span', { class: 'mgn-rar', style: { background: rar.bg, borderColor: corDa(rar) } }, rar.nome) : null),
      el('div', { class: `mgn-peca-votos ${estado('raridade')}` },
        votos, el('small', {}, p.total ? `${v.pct}% gostei · ${p.total}/${min} votos` : `0/${min} votos`)),
      el('div', { class: 'mgn-resps' },
        resp('tipo', 'cat', (c) => (CATEGORIAS[c] ? rotuloCategoria(c) : c)),
        resp('cor', 'cor'), resp('marca', 'marca', (m) => m || 'sem marca'),
        resumo.ajuste ? el('span', { class: estado('ajuste') }, el('small', {}, 'ajuste'),
          `${resumo.ajuste.medidas} medida${resumo.ajuste.medidas > 1 ? 's' : ''}`)
          : el('span', { class: 'falta' }, el('small', {}, 'ajuste'), '–'))),
    el('button', { type: 'button', class: pronta ? 'btn-dark' : 'btn-ghost', onclick: () => verComoFica(p) },
      pronta ? 'Publicar…' : 'Ver como fica'));
}

// ------------------------------ Coluna do lado -----------------------------
function hojeNosJogos() {
  const { r } = dados;
  const hoje = diaBrasilia(0);
  const soma = (k) => JOGOS.reduce((t, j) => t + (r.cotas?.[j.id]?.[hoje]?.[k] || 0), 0);
  return secao('', 'Hoje nos jogos', 'As contagens somem do banco depois de 2 dias.',
    el('p', { class: 'mgn-total' },
      el('b', {}, String(soma('ajudas'))), ' ajudas · ',
      el('b', {}, String(soma('pessoas'))), ' jogadas'),
    el('div', { class: 'mgn-jogos' }, ...JOGOS.map(cartaoJogo)));
}

function cartaoJogo(j) {
  const { r, pecas, regras } = dados;
  const g = regras[j.id] || {};
  const dia = (n) => r.cotas?.[j.id]?.[diaBrasilia(n)] || { pessoas: 0, ajudas: 0, noLimite: 0 };
  const hoje = dia(0), ontem = dia(1);
  // Quantas peças ainda esperam por este jogo (alguma entrada dele aberta).
  const faltam = pecas.filter(p => j.entradas.some(e => p.faltam.includes(e))).length;
  const detalhe = j.entradas.length > 1
    ? ` (${j.entradas.map(e => `${NOME_ENTRADA[e]} ${pecas.filter(p => p.faltam.includes(e)).length}`).join(' · ')})` : '';
  return el('article', { class: 'mgn-jogo', style: { '--cor-jogo': j.cor } },
    el('header', {}, el('h3', {}, j.nome), el('small', {}, j.faz)),
    el('p', { class: 'mgn-jogo-hoje' }, el('b', {}, String(hoje.ajudas)), ' ajudas hoje',
      el('small', {}, `ontem ${ontem.ajudas}`)),
    el('p', { class: 'mgn-jogo-nums' },
      `${hoje.pessoas} pessoa${hoje.pessoas === 1 ? '' : 's'} · `,
      el('span', { class: hoje.noLimite ? 'limite' : '' }, `${hoje.noLimite} no limite`)),
    el('p', { class: 'mgn-jogo-falta' }, `Falta em ${faltam} de ${pecas.length} peças${detalhe}`),
    barra(pecas.length ? (pecas.length - faltam) * 100 / pecas.length : 0, j.cor),
    el('p', { class: 'mgn-regra' }, `Até ${g.limite} ajudas por ${g.janela} · as fichas vêm das missões do mural`));
}

function raridades() {
  const { pecas, min } = dados;
  const conta = Object.fromEntries(RARIDADES.map(r => [r.id, 0]));
  let esperando = 0;
  pecas.forEach(p => { p.v.raridade ? conta[p.v.raridade]++ : esperando++; });
  const total = pecas.length || 1;
  const partes = [...RARIDADES.map(r => ({ nome: r.nome, n: conta[r.id], cor: corDa(r) })),
    { nome: `Menos de ${min} votos`, n: esperando, cor: 'repeating-linear-gradient(45deg, var(--linha) 0 3px, transparent 3px 6px)' }].filter(x => x.n);
  return secao('', 'Raridade que os votos dão', `Com ${min} votos a peça ganha raridade.`,
    pecas.length ? el('div', {},
      el('div', { class: 'mgn-pilha' }, ...partes.map(x =>
        el('span', { title: `${x.nome}: ${x.n}`, style: { flex: x.n, background: x.cor } }))),
      el('ul', { class: 'mgn-legenda' }, ...partes.map(x => el('li', {},
        el('i', { style: { background: x.cor } }), `${x.nome}`, el('b', {}, `${x.n}`),
        el('small', {}, `${Math.round(x.n * 100 / total)}%`)))))
      : el('p', { class: 'mgn-vazio' }, 'Nenhuma peça nos jogos.'));
}

// ---------------------------- Ver como fica --------------------------------
// A peça no corpo com a ficha que sairia hoje (a da esteira com os votos por
// cima, como em "Usar na ficha"). Nada é gravado até apertar "Publicar".
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
      el('div', { class: 'mgn-ver-acoes' },
        el('button', { type: 'button', class: pronta ? 'btn-dark' : 'btn-admin', onclick: () => forcar(p, ficha, caixa) },
          pronta ? 'Publicar' : 'Forçar publicação'),
        p.mexeu ? el('button', { type: 'button', class: 'btn-ghost', onclick: () => usarNaFicha(p.item, p.resumo) },
          'Usar na ficha') : null),
      el('small', {}, pronta
        ? 'Publicar põe a peça no jogo com esta ficha e tira dos mini games.'
        : 'Forçar publica agora com esta ficha, mesmo faltando entrada. Usar na ficha só grava na esteira, para você revisar e publicar por lá.')));
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
