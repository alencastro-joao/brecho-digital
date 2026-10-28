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
      if (!cat) return toast('Escolha a categoria dessa peça na esteira antes.', 'aviso');
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
