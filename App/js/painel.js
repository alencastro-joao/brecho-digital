// Painel do administrador (Ajustes › Painel): os números do dia, para decidir
// o que subir na esteira. Quem conta é o servidor (nuvem/lambda/painel.py);
// aqui os ids viram nome e foto do acervo.

import { RARIDADE } from './config.js';
import { item as pecaDoCatalogo, nomeDaPeca } from './catalog.js';
import { el, $ } from './util.js';

const ORIGENS = {
  vitrine: 'Loja do dia', presente: 'Boas-vindas', missao: 'Missões', semana: 'Baú dos dias',
  'bau-especial': 'Baú semanal', nivel: 'Trilha de níveis', collab: 'Cápsula', teste: 'Teste',
};

export async function renderPainel() {
  const caixa = $('#painel-corpo');
  caixa.replaceChildren(el('p', { class: 'pa-vazio' }, 'Lendo os números…'));
  let d;
  try {
    const r = await fetch('/api/admin/painel', { credentials: 'include' });
    d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.erro || 'HTTP ' + r.status);
  } catch (e) {
    caixa.replaceChildren(el('p', { class: 'pa-vazio' }, 'Não consegui ler o painel: ' + e.message));
    return;
  }
  const { contas, posts, pecas } = d;
  const origens = Object.entries(pecas.porOrigemHoje).sort((a, b) => b[1] - a[1]);
  // replaceChildren escreveria "null" no lugar do bloco que não existe.
  caixa.replaceChildren(...[
    el('div', { class: 'pa-numeros' },
      numero(contas.ativasHoje, 'ativas hoje', `${contas.ativas7} nos últimos 7 dias`),
      numero(contas.novasHoje, 'contas novas', `${contas.novas7} na semana · ${contas.total} no total`),
      numero(pecas.levadasHoje, 'peças levadas', `por ${pecas.quemLevouHoje} ${pecas.quemLevouHoje === 1 ? 'pessoa' : 'pessoas'}`),
      numero(posts.hoje, 'posts hoje', `${posts.total} no total`)),
    origens.length ? el('div', { class: 'pa-chips' },
      origens.map(([o, n]) => el('span', {}, `${ORIGENS[o] || o} · ${n}`))) : null,
    lista('Mais levadas hoje', pecas.maisLevadasHoje),
    lista('Mais levadas desde o começo', pecas.maisLevadas),
    pecas.esgotadas.length ? lista('Esgotadas', pecas.esgotadas.map(p => ({ ...p, n: RARIDADE[p.raridade]?.nome }))) : null,
  ].filter(Boolean));
}

const numero = (n, rotulo, dica) => el('div', { class: 'pa-numero' },
  el('strong', {}, String(n)), el('span', {}, rotulo), el('small', {}, dica));

function lista(titulo, itens) {
  const linhas = itens.map(({ id, n }) => {
    const peca = pecaDoCatalogo(id);
    return el('li', {},
      peca?.src ? el('img', { src: peca.src, alt: '', loading: 'lazy' }) : el('span', { class: 'pa-sem-foto' }),
      el('span', { class: 'pa-nome' }, peca ? nomeDaPeca(peca) : id),
      el('b', {}, String(n)));
  });
  return el('section', { class: 'pa-lista' },
    el('h3', {}, titulo),
    linhas.length ? el('ol', {}, linhas) : el('p', { class: 'pa-vazio' }, 'Nada ainda.'));
}
