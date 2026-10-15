// Alça de mover: o botão de quatro setas que fica ao lado da peça escolhida.
// No celular o dedo em cima da peça esconde justamente o que se está
// encaixando; arrastando pela alça, a peça anda junto e continua à vista.
// O botão mora no palco (não dentro da peça), então não gira com ela, e
// procura o lado que cabe: direita, esquerda, embaixo ou em cima.
import { ico } from './icones.js';
import { el, clamp } from './util.js';

const TAM = 42, FOLGA = 12, BORDA = 4;

// `aoPegar(e)` recebe o pointerdown do botão e começa o arrasto da peça como
// se o dedo tivesse descido nela; `e.target.dataset.alca` chega como 'mov'.
export function alcaMover(palco, aoPegar) {
  const botao = el('button', {
    type: 'button', class: 'alca-mover', hidden: true,
    'aria-label': 'Mover peça', title: 'Arraste para mover',
    dataset: { alca: 'mov' },
  }, ico('mover'));
  palco.append(botao);

  let alvos = [];
  let lado = null;        // durante o arrasto o lado fica, para não pular do dedo
  let pegando = false;

  botao.addEventListener('pointerdown', (e) => {
    if (botao.hidden) return;
    e.stopPropagation();
    pegando = true;
    const largar = () => {
      pegando = false;
      window.removeEventListener('pointerup', largar);
      window.removeEventListener('pointercancel', largar);
      colocar(alvos);
    };
    window.addEventListener('pointerup', largar);
    window.addEventListener('pointercancel', largar);
    aoPegar(e);
  });
  botao.addEventListener('click', (e) => e.preventDefault());

  function colocar(nos = []) {
    alvos = nos.filter(n => n && n.isConnected);
    const p = palco.getBoundingClientRect();
    if (!alvos.length || !p.width || !p.height) { botao.hidden = true; return; }

    // A caixa de todas as peças escolhidas juntas, no sistema do palco.
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const n of alvos) {
      const c = n.getBoundingClientRect();
      l = Math.min(l, c.left); t = Math.min(t, c.top);
      r = Math.max(r, c.right); b = Math.max(b, c.bottom);
    }
    l -= p.left; r -= p.left; t -= p.top; b -= p.top;

    const lugares = {
      dir:   { x: r + FOLGA,       y: (t + b) / 2 - TAM / 2 },
      esq:   { x: l - FOLGA - TAM, y: (t + b) / 2 - TAM / 2 },
      baixo: { x: (l + r) / 2 - TAM / 2, y: b + FOLGA },
      cima:  { x: (l + r) / 2 - TAM / 2, y: t - FOLGA - TAM },
    };
    const cabe = ({ x, y }) => x >= BORDA && x + TAM <= p.width - BORDA &&
                               y >= BORDA && y + TAM <= p.height - BORDA;
    // Fora do palco no outro eixo não importa: o encaixe abaixo resolve.
    const cabeX = ({ x }) => x >= BORDA && x + TAM <= p.width - BORDA;
    const cabeY = ({ y }) => y >= BORDA && y + TAM <= p.height - BORDA;
    // O lado só muda quando o atual deixa de caber: a alça não pula sozinha.
    const segue = lado && (pegando ||
      (['dir', 'esq'].includes(lado) ? cabeX(lugares[lado]) : cabeY(lugares[lado])));
    if (!segue) {
      lado = ['dir', 'esq'].find(k => cabeX(lugares[k]))
        ?? ['baixo', 'cima'].find(k => cabeY(lugares[k]))
        ?? Object.keys(lugares).find(k => cabe(lugares[k]))
        ?? 'dir';
    }
    const { x, y } = lugares[lado];
    botao.style.left = clamp(x, BORDA, p.width - TAM - BORDA) + 'px';
    botao.style.top = clamp(y, BORDA, p.height - TAM - BORDA) + 'px';
    botao.hidden = false;
  }

  // O palco muda de tamanho (zoom, girar o celular, abrir painel): reposiciona.
  new ResizeObserver(() => colocar(alvos)).observe(palco);

  return { colocar, botao };
}
