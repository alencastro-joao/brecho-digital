// Tela de administração (#/admin): só a conta do dono da loja. Quem é admin
// é o servidor que diz (lambda/contas.py, pelo e-mail); aqui qualquer outra
// conta que caia nesta hash volta para a loja.
//
// Junta o que antes ficava espalhado nos ajustes do perfil: os números do dia
// (painel.js), a esteira, as contas (perfil.js › montarLimpeza) e os testes da
// própria conta (perfil.js › montarTestes), mais fichas e baús de teste.

import { ADMIN, BAUS, SERVICOS, CATEGORIAS, medidaNoCorpoDaArtista } from './config.js';
import { catalogo } from './catalog.js';
import { abrirEditar } from './editar.js';
import * as db from './db.js';
import { renderPainel } from './painel.js';
import { irPara } from './router.js';
import { el, $, toast } from './util.js';

export function montarAdmin() {
  $('#adm-voltar').addEventListener('click', () => irPara('perfil'));

  $('#adm-fichas').addEventListener('click', () => {
    db.ganharFicha(5);
    db.salvar();
    toast('+5 fichas.');
  });

  $('#adm-baus').replaceChildren(...Object.entries(BAUS).map(([tipo, b]) =>
    el('button', {
      class: 'btn-ghost',
      onclick: () => { db.guardarBau(tipo, 'teste', 'Teste'); toast(`${b.nome} guardado em Baús.`); },
    }, '+ ' + b.nome)));

  $('#adm-revisar').addEventListener('click', () => revisar(pecasParaRevisar(), 0));
}

export function aoEntrarNoAdmin() {
  if (!ADMIN) { irPara('vitrine'); return; }
  renderPainel();
  renderRedes();
  renderRevisao();
}

// --------------------------- Peças antigas ---------------------------------
// Peças medidas no boneco antigo aparecem com um ajuste automático para o
// corpo da artista (config.js › ajustarPecaAntiga). A fila abre cada uma no
// molde do editor, já ajustada: salvar grava a medida no corpo novo e tira a
// peça da fila. Perna primeiro, que é onde o ajuste acerta menos.
const ORDEM_REVISAO = ['perna', 'tronco', 'maos', 'pes', 'cabeca'];

function pecasParaRevisar() {
  const ordem = (p) => {
    const i = ORDEM_REVISAO.indexOf(CATEGORIAS[p.cat]?.regiao);
    return i < 0 ? ORDEM_REVISAO.length : i;
  };
  return catalogo.itens
    .filter(p => p.permanente && p.ancora?.w && !medidaNoCorpoDaArtista(p))
    .sort((a, b) => ordem(a) - ordem(b) || a.cat.localeCompare(b.cat));
}

function renderRevisao() {
  const n = pecasParaRevisar().length;
  const botao = $('#adm-revisar');
  const resumo = $('#adm-revisar-resumo');
  botao.hidden = resumo.hidden = !n;
  botao.textContent = `Revisar peças antigas (${n})`;
  resumo.textContent = n === 1
    ? '1 peça ainda está com a medida do boneco antigo.'
    : `${n} peças ainda estão com a medida do boneco antigo.`;
}

// Salvar ou pular vai para a próxima. Quem foi pulada continua na fila para
// a próxima vez.
function revisar(fila, i) {
  if (i >= fila.length) {
    renderRevisao();
    toast(fila.length ? 'Fim da fila de peças antigas.' : 'Nenhuma peça antiga para revisar.');
    return;
  }
  const seguir = () => revisar(fila, i + 1);
  abrirEditar(fila[i], (salva) => { renderRevisao(); if (salva) seguir(); },
    { revisao: { posicao: i + 1, total: fila.length, pular: () => { renderRevisao(); seguir(); } } });
}

// ------------------------- Instagram e Pinterest ---------------------------
// As chaves dos apps criados no Meta for Developers e no Pinterest Developers.
// O segredo vai para o servidor e nunca volta: o campo só diz se já existe.
// O endereço de retorno é o que se cadastra no app de cada rede.
async function renderRedes() {
  const caixa = $('#adm-redes');
  let cfg;
  try {
    const r = await fetch('/api/admin/redes', { credentials: 'include' });
    cfg = await r.json();
    if (!r.ok) throw new Error(cfg.erro || 'HTTP ' + r.status);
  } catch (e) {
    caixa.replaceChildren(el('p', { class: 'tool-hint' }, 'Não consegui ler: ' + e.message));
    return;
  }
  caixa.replaceChildren(...Object.entries(SERVICOS).map(([id, s]) => {
    const c = cfg[id] || {};
    const appId = el('input', { type: 'text', value: c.appId || '', placeholder: 'App ID', autocomplete: 'off' });
    const segredo = el('input', {
      type: 'password', autocomplete: 'off',
      placeholder: c.temSegredo ? 'segredo guardado (deixe vazio para manter)' : 'App secret',
    });
    const salvar = el('button', { class: 'btn-dark', onclick: async () => {
      salvar.disabled = true;
      try {
        const r = await fetch('/api/admin/redes', {
          method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ servico: id, appId: appId.value, segredo: segredo.value }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro || 'HTTP ' + r.status);
        toast(`${s.nome} pronto para conectar.`);
        renderRedes();
      } catch (e) {
        toast(e.message, 'aviso');
        salvar.disabled = false;
      }
    } }, 'Salvar');
    return el('div', { class: 'adm-rede' },
      el('strong', {}, s.nome + (c.appId && c.temSegredo ? ' · pronto' : '')),
      el('label', { class: 'tool-campo' }, 'App ID', appId),
      el('label', { class: 'tool-campo' }, 'Segredo', segredo),
      el('label', { class: 'tool-campo' }, 'Endereço de retorno (cadastre no app)',
        el('input', { type: 'text', value: c.volta || '', readonly: true, onclick: (e) => e.target.select() })),
      el('div', { class: 'tool-row' }, salvar));
  }));
}
