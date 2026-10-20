// Barras de posição (celular): uma em pé à direita sobe e desce a peça, uma
// deitada embaixo a leva para os lados. As setas nas pontas andam um pouquinho
// por toque (segurar repete), para o ajuste fino que o dedo em cima da peça
// não consegue, como encaixar o óculos no rosto. Arrastar a peça e a alça de
// mover continuam valendo. Usada no Stylist, no molde do editor e na esteira.
import { el, clamp } from './util.js';

const PASSO = 2;                 // unidades do palco (600×1200) por toque
const ESPERA = 350, REPETE = 50; // segurar a seta: espera e depois repete

// `ler()` devolve { x, y } da peça (ou null sem peça: as barras somem);
// `mudar({ x, y }, gesto)` grava e redesenha. As faixas são [min, max].
export function barrasPosicao({ paiX, paiY, faixaX, faixaY, ler, mudar }) {
  function criar(eixo, faixa, rotulo, menos, mais) {
    const sld = el('input', {
      type: 'range', min: faixa[0], max: faixa[1], step: 1, 'aria-label': rotulo,
    });
    sld.addEventListener('input', () => {
      const p = ler();
      if (p) mudar({ ...p, [eixo]: Number(sld.value) }, 'barra-' + eixo);
    });
    const seta = ([txt, nome], sinal) => {
      const b = el('button', { type: 'button', class: 'barra-pos-btn', title: nome, 'aria-label': nome }, txt);
      repetir(b, () => andar(eixo, faixa, sinal * PASSO));
      return b;
    };
    const caixa = el('div', { class: `barra-pos barra-pos-${eixo}`, hidden: true },
      seta(menos, -1), sld, seta(mais, 1));
    return { caixa, sld };
  }

  function andar(eixo, faixa, d) {
    const p = ler();
    if (p) mudar({ ...p, [eixo]: clamp(p[eixo] + d, faixa[0], faixa[1]) }, 'seta-' + eixo);
  }

  const y = criar('y', faixaY, 'Altura da peça', ['↑', 'Subir'], ['↓', 'Descer']);
  const x = criar('x', faixaX, 'Lado da peça', ['←', 'Para a esquerda'], ['→', 'Para a direita']);
  paiY.append(y.caixa);
  paiX.append(x.caixa);

  function atualizar() {
    const p = ler();
    x.caixa.hidden = y.caixa.hidden = !p;
    if (!p) return;
    x.sld.value = Math.round(p.x);
    y.sld.value = Math.round(p.y);
  }
  return { atualizar };
}

// Toque anda um passo; segurado, continua andando até soltar.
function repetir(botao, fn) {
  let t = 0;
  const parar = () => { clearTimeout(t); clearInterval(t); t = 0; };
  botao.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    parar();
    fn();
    t = setTimeout(() => { t = setInterval(fn, REPETE); }, ESPERA);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) botao.addEventListener(ev, parar);
  // Teclado (Enter/espaço) chega como click sem ponteiro.
  botao.addEventListener('click', (e) => { if (e.detail === 0) fn(); });
}
