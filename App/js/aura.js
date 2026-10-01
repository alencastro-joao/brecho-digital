// Aura de raridade.
//
// O brilho não é um retângulo atrás da peça: a silhueta é recortada da própria
// imagem com mask-image, então o halo acompanha o contorno da roupa — mesmo
// princípio do clip-path que já resolve o clique.
//
// Só a vitrine e o guarda-roupa chamam isto. Stylist, prancheta, feed e as
// imagens exportadas continuam sem aura, de propósito.

import { RARIDADE } from './config.js';
import { el } from './util.js';

export const temAura = (raridade) => Boolean(RARIDADE[raridade]?.aura);

export function criarAura(raridade, src, { atraso = null } = {}) {
  const r = RARIDADE[raridade];
  if (!r?.aura) return null;                       // comum não brilha

  const aura = el('span', {
    class: 'aura aura-' + raridade,
    'aria-hidden': 'true',
  });

  if (r.aura !== 'arco-iris') aura.style.setProperty('--aura-cor', r.aura);

  // Cada peça respira no seu tempo: sem isso o mural inteiro pulsa junto.
  const seg = atraso ?? -(Math.random() * 2.6);
  aura.style.setProperty('--aura-atraso', seg.toFixed(2) + 's');

  const url = `url("${src}")`;
  aura.style.webkitMaskImage = url;
  aura.style.maskImage = url;

  return aura;
}
