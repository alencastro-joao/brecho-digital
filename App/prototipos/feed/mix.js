// O que as opções 4, 5 e 6 montam igual: o card do mural, o duelo e a
// sequência de dias. Cada página só arruma esses pedaços de um jeito.

import { rosto, perfil, tempo, tile, selo, maisRara, el } from './dados.js';

export const MEDALHA = ['#d4a72c', '#a7a39c', '#c07a4a'];

const ehEpica = (post) => ['epic', 'legendary'].includes(maisRara(post.pecas)?.raridade);

// `extra` decide o que o card mostra além da imagem: hover com as peças,
// selo do tema, medalha do ranking, botão de votar.
export function cardMural(post, estado, extra = {}) {
  const autor = perfil(post.autor);
  const epica = ehEpica(post);
  const tem = post.pecas.filter(p => estado(p) === 'tenho').length;
  return el('article', { class: 'card' + (epica ? ' epica' : '') + (extra.hover ? ' hover' : '') },
    el('div', { class: 'img' + (post.tipo === 'board' ? ' board' : '') },
      el('img', { class: 'arte', src: post.img, alt: post.nome }),
      extra.posicao ? el('span', { class: 'medalha', style: { background: MEDALHA[extra.posicao - 1] } }, String(extra.posicao))
        : epica ? selo(maisRara(post.pecas)) : null,
      el('span', { class: 'likes' + (extra.curtido ? ' on' : '') },
        extra.votos ? `${extra.votos} votos` : (extra.curtido ? '♥ ' : '♡ ') + post.curtidas),
      extra.noTema ? el('span', { class: 'no-tema' }, '☀ no desafio') : null,
      extra.hover ? el('div', { class: 'sobre' },
        el('div', { class: 'pecas' }, ...post.pecas.slice(0, 5).map(p => tile(p, 40))),
        el('span', { class: 'tem' }, 'você tem ', el('b', {}, `${tem} de ${post.pecas.length}`), ' peças deste look'),
        el('div', { class: 'botoes' },
          el('button', { class: 'btn-pri' }, extra.votar ? '☀ Votar neste' : 'Vestir no meu avatar'),
          el('button', { class: 'redondo' }, '🔖'),
          el('button', { class: 'redondo' }, '♡'))) : null),
    el('div', { class: 'pe' }, rosto(post.autor, 26),
      el('strong', {}, autor.nome),
      extra.votar && !extra.hover
        ? el('button', { class: 'votar' + (extra.votado ? ' on' : '') }, extra.votado ? '✓ votado' : 'Votar')
        : el('small', {}, tempo(post.horas))));
}

export const duelo = (a, b) => el('div', { class: 'duelo-mini' },
  ...[a, b].map((p, i) => el('div', { class: 'lado' + (i === 0 ? ' escolhido' : '') },
    el('img', { src: p.img, alt: p.nome }),
    el('button', {}, i === 0 ? '✓ ' + perfil(p.autor).nome.split(' ')[0] : perfil(p.autor).nome.split(' ')[0]))),
  el('span', { class: 'vs' }, 'VS'));

export const sequencia = () => el('section', { class: 'sequencia' },
  el('div', { class: 'grande' }, el('strong', {}, '🔥 4 dias'), el('span', {}, 'seguidos')),
  el('div', { class: 'semana' }, ...['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((d, i) =>
    el('div', { class: i < 4 ? 'ok' : i === 4 ? 'hoje' : '' }, el('i', {}, i < 4 ? '✓' : ''), d))),
  el('p', {}, 'Vote ou publique hoje: ', el('b', {}, '5 dias'), ' rendem uma peça rara.'));
