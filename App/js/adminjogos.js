// Admin › Mini games: escolher quais fotos da esteira vão para os jogos de
// ajuda (js/ajudas.js) e ver o que os jogadores disseram de cada uma. "Usar
// na ficha" leva a raridade, a cor, a marca e a medida mais votadas para a
// ficha da esteira; publicar continua sendo na esteira.

import { CORES, CATEGORIAS, RARIDADE } from './config.js';
import { rotuloCategoria } from './catalog.js';
import * as db from './db.js';
import { el, $, toast } from './util.js';

const sem = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

async function chamar(rota, metodo = 'GET', corpo) {
  const r = await fetch(rota, {
    method: metodo, credentials: 'include',
    headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.erro || 'HTTP ' + r.status);
  return dados;
}

export function montarJogosAdmin() {
  $('#adm-jogos-abrir').addEventListener('click', () => {
    $('#modal-jogos').hidden = false;
    renderJogosAdmin();
  });
  $('#adm-jogos-fechar').addEventListener('click', () => { $('#modal-jogos').hidden = true; });
  $('#adm-jogos-avaliar').addEventListener('click', () => {
    $('#modal-jogos-numeros').hidden = false;
    renderNumeros();
  });
  $('#adm-jogos-numeros-fechar').addEventListener('click', () => { $('#modal-jogos-numeros').hidden = true; });
}

// ------------------------- Como vão os mini games -------------------------
// Um painel simples: quem jogou hoje e ontem, fichas dadas, e o que falta
// para as peças terem voto suficiente. Só lê o GET /api/admin/ajudas.
const NOME_JOGO = { avaliar: 'Avaliar', ajustar: 'Ajustar', preencher: 'Preencher' };

function diaBrasilia(menos = 0) {
  const d = new Date(Date.now() - 3 * 3600e3 - menos * 86400e3);
  return d.toISOString().slice(0, 10);
}

const bloco = (titulo, ...filhos) => el('div', { class: 'adm-num-bloco' }, el('h3', {}, titulo), ...filhos);
const linha = (t) => el('p', { class: 'tool-hint' }, t);

async function renderNumeros() {
  const caixa = $('#adm-jogos-numeros');
  caixa.replaceChildren(linha('Carregando…'));
  let r, esteira;
  try {
    [r, esteira] = await Promise.all([chamar('/api/admin/ajudas'), chamar('/api/esteira').catch(() => ({}))]);
  } catch (e) {
    caixa.replaceChildren(linha(`Não consegui ler: ${e.message}`));
    return;
  }
  const regras = r.regras?.jogos || {};
  const min = r.regras?.votosMin || 10;
  const nosJogos = new Set(r.nosJogos || []);
  const porPeca = new Map((r.pecas || []).map(p => [p.peca, p]));
  const foto = new Map((esteira.itens || []).map(i => [i.id, i]));
  const nome = (id) => foto.get(id)?.ficha?.nome || id;

  // Hoje e ontem, por jogo.
  const dias = [['Hoje', diaBrasilia(0)], ['Ontem', diaBrasilia(1)]];
  const tabela = el('table', { class: 'adm-num-tabela' },
    el('tr', {}, ...['', 'Pessoas', 'Ajudas', 'Fichas', 'No limite', 'Regra'].map(t => el('th', {}, t))),
    ...Object.keys(NOME_JOGO).flatMap(jogo => dias.map(([rot, dia], k) => {
      const c = r.cotas?.[jogo]?.[dia] || { pessoas: 0, ajudas: 0, fichas: 0, noLimite: 0 };
      const g = regras[jogo] || {};
      return el('tr', {},
        el('td', {}, k ? `  ${rot}` : `${NOME_JOGO[jogo]} · ${rot}`),
        el('td', {}, String(c.pessoas)), el('td', {}, String(c.ajudas)),
        el('td', {}, String(c.fichas)), el('td', {}, String(c.noLimite)),
        el('td', {}, k ? '' : `1 ficha a cada ${g.porFicha}, até ${g.limite}/${g.janela}`));
    })));

  // Peças: quanto falta.
  const ids = [...nosJogos];
  const votos = (id) => { const v = porPeca.get(id)?.votos; return v ? v.sim + v.nao + (v.meh || 0) : 0; };
  const prontas = ids.filter(id => votos(id) >= min).length;
  const semNada = ids.filter(id => !porPeca.has(id));
  const semAjuste = ids.filter(id => !porPeca.get(id)?.ajuste).length;
  const semCor = ids.filter(id => !porPeca.get(id)?.cor).length;
  const semMarca = ids.filter(id => !porPeca.get(id)?.marca).length;

  // Mais e menos gostadas (só quem já tem votos suficientes).
  const comNota = (r.pecas || []).filter(p => p.votos?.raridade && nosJogos.has(p.peca))
    .sort((a, b) => b.votos.pct - a.votos.pct);
  const lista = (ps) => el('ul', {}, ...ps.map(p => el('li', {},
    `${nome(p.peca)}: ${p.votos.pct}% gostei (${votos(p.peca)} votos) → ${RARIDADE[p.votos.raridade]?.nome || p.votos.raridade}`)));

  // Preencher: respostas divididas (a mais votada tem menos da metade).
  const divididas = (r.pecas || []).filter(p => nosJogos.has(p.peca) &&
    ['cor', 'marca', 'cat'].some(k => p[k] && p[k].total >= 3 && p[k].votos * 2 <= p[k].total));

  // Raridades sugeridas.
  const contaRar = {};
  comNota.forEach(p => { contaRar[p.votos.raridade] = (contaRar[p.votos.raridade] || 0) + 1; });

  caixa.replaceChildren(
    bloco('Quem jogou', tabela,
      linha('As contagens somem do banco depois de 2 dias; dias mais antigos não aparecem.')),
    bloco('Peças nos jogos',
      linha(`${ids.length} nos jogos · ${prontas} já têm ${min}+ votos (raridade sugerida) · ${ids.length - prontas} ainda faltam.`),
      linha(`Sem nenhuma ajuda: ${semNada.length} · sem ajuste no corpo: ${semAjuste} · sem cor: ${semCor} · sem marca: ${semMarca}.`),
      semNada.length ? linha(`Ninguém mexeu ainda: ${semNada.slice(0, 12).map(nome).join(', ')}${semNada.length > 12 ? '…' : ''}`) : null),
    bloco('Raridade que os votos sugerem',
      comNota.length
        ? linha(Object.entries(contaRar).map(([k, n]) => `${RARIDADE[k]?.nome || k}: ${n}`).join(' · '))
        : linha('Nenhuma peça com votos suficientes ainda.')),
    comNota.length ? bloco('Mais gostadas', lista(comNota.slice(0, 5))) : null,
    comNota.length > 5 ? bloco('Menos gostadas', lista(comNota.slice(-5).reverse())) : null,
    bloco('Respostas divididas no Preencher',
      divididas.length
        ? el('ul', {}, ...divididas.slice(0, 10).map(p => el('li', {}, `${nome(p.peca)}: ` +
          ['cor', 'marca', 'cat'].filter(k => p[k]).map(k => `${k} ${p[k].valor} (${p[k].votos}/${p[k].total})`).join(' · '))))
        : linha('Nada dividido: quando 3+ pessoas respondem, a maioria concorda.')));
}

let nos = new Set();      // ids que estão nos jogos agora

function resumoDoTopo() {
  $('#adm-jogos-topo').textContent =
    `${nos.size} nos jogos. Toque numa foto para pôr ou tirar. Ao publicar ou descartar na esteira, ela sai dos jogos.`;
}

async function renderJogosAdmin() {
  const caixa = $('#adm-jogos');
  caixa.replaceChildren(el('p', { class: 'tool-hint' }, 'Carregando a esteira…'));
  let esteira, resumo;
  try {
    [esteira, resumo] = await Promise.all([chamar('/api/esteira'), chamar('/api/admin/ajudas')]);
  } catch (e) {
    caixa.replaceChildren(el('p', { class: 'tool-hint' }, `Não consegui ler: ${e.message}`));
    return;
  }
  nos = new Set(resumo.nosJogos || []);
  const porPeca = new Map((resumo.pecas || []).map(p => [p.peca, p]));
  const prontas = (esteira.itens || []).filter(i => i.estado === 'pronta');
  if (!prontas.length) {
    caixa.replaceChildren(el('p', { class: 'tool-hint' }, 'Nenhuma foto pronta na esteira.'));
    return;
  }
  caixa.replaceChildren(
    el('p', { class: 'tool-hint', id: 'adm-jogos-topo' }),
    el('div', { class: 'adm-jogos-grade' }, ...prontas.map(i => cartao(i, porPeca.get(i.id)))));
  resumoDoTopo();
}

function cartao(item, resumo) {
  const cat = item.ficha?.cat || item.sugestao?.cat || '';
  const linhas = [];
  if (resumo?.votos && (resumo.votos.sim + resumo.votos.nao + (resumo.votos.meh || 0))) {
    const v = resumo.votos;
    linhas.push(`${v.sim + v.nao + (v.meh || 0)} votos · ${v.pct}% gostei` +
      (v.raridade ? ` → ${RARIDADE[v.raridade]?.nome}` : ''));
  }
  if (resumo?.cor) linhas.push(`cor: ${resumo.cor.valor} (${resumo.cor.votos}/${resumo.cor.total})`);
  if (resumo?.cat) linhas.push(`tipo: ${rotuloCategoria(resumo.cat.valor)} (${resumo.cat.votos}/${resumo.cat.total})`);
  if (resumo?.marca) linhas.push(`marca: ${resumo.marca.valor} (${resumo.marca.votos}/${resumo.marca.total})`);
  if (resumo?.ajuste) linhas.push(`${resumo.ajuste.medidas} ajuste${resumo.ajuste.medidas > 1 ? 's' : ''} no corpo`);

  // Marcar e desmarcar mexe só nesta foto: a grade não recarrega.
  const selo = el('span', {});
  const pintar = () => {
    const esta = nos.has(item.id);
    botao.classList.toggle('nos', esta);
    botao.title = esta ? 'Tirar dos jogos' : 'Mandar para os jogos';
    selo.textContent = esta ? '✓ nos jogos' : '+ jogos';
  };
  const botao = el('button', {
    type: 'button', class: 'adm-jogos-foto',
    onclick: async () => {
      const ir = !nos.has(item.id);
      botao.disabled = true;
      try {
        await chamar('/api/admin/ajudas', 'POST', { id: item.id, nos: ir });
        ir ? nos.add(item.id) : nos.delete(item.id);
        pintar();
        resumoDoTopo();
      } catch (e) {
        toast(`Não deu: ${e.message}`, 'aviso');
      } finally {
        botao.disabled = false;
      }
    },
  }, el('img', { src: item.previa, alt: '' }), selo);
  pintar();

  return el('div', { class: 'adm-jogos-item' }, botao,
    el('small', {}, cat ? rotuloCategoria(cat) : 'sem categoria'),
    ...linhas.map(t => el('small', { class: 'adm-jogos-voto' }, t)),
    linhas.length ? el('button', {
      type: 'button', class: 'btn-ghost', onclick: () => usarNaFicha(item, resumo),
    }, 'Usar na ficha') : null);
}

// Leva o que os jogadores disseram para a ficha da esteira (só o que tem voto).
async function usarNaFicha(item, resumo) {
  const ficha = { ...(item.ficha || {}) };
  if (resumo.cat && CATEGORIAS[resumo.cat.valor]) ficha.cat = resumo.cat.valor;
  if (!ficha.cat) ficha.cat = item.sugestao?.cat || '';
  if (resumo.votos?.raridade) ficha.raridade = resumo.votos.raridade;
  if (resumo.cor) {
    ficha.cor = CORES.find(c => sem(c.nome) === resumo.cor.valor)?.nome
      || resumo.cor.valor.replace(/^./, l => l.toUpperCase());
  }
  if (resumo.marca) {
    ficha.marca = db.marcasOrdenadas().find(m => sem(m.nome) === resumo.marca.valor)?.nome
      || resumo.marca.valor.replace(/\b\w/g, l => l.toUpperCase());
  }
  const corpo = { ficha };
  if (resumo.ajuste && CATEGORIAS[ficha.cat]) {
    corpo.medida = { x: resumo.ajuste.x, y: resumo.ajuste.y, w: resumo.ajuste.w };
  }
  try {
    await chamar(`/api/esteira/${encodeURIComponent(item.id)}`, 'PUT', corpo);
    toast('Ficha da esteira atualizada. Revise e publique por lá.');
  } catch (e) {
    toast(`Não deu: ${e.message}`, 'aviso');
  }
}
