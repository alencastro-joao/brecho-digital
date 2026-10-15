// Segurar e arrastar para reorganizar uma grade (as abas do seu perfil).
// Segurar parado por um instante pega o quadrinho: ele cresce, segue o dedo, e
// os outros abrem espaço deslizando. Soltar grava a ordem nova. Mexer o dedo
// antes disso é rolar a página, e o toque rápido continua abrindo a peça.
//
// Para o quadrinho não ficar para trás do dedo, nada é medido durante o
// arrasto: as casas da grade são medidas uma vez, ao pegar (a grade não muda de
// tamanho, só troca quem está em cada casa), e cada movimento só muda um
// transform, uma vez por quadro.
const SEGURAR = 300;
const FOLGA = 12;
const ANDAR = 160;

export function reordenavel(grade, { itens = '[data-id]', aoSoltar }) {
  let timer = null, pego = null, x0 = 0, y0 = 0, soltouEm = 0;
  let casas = [];          // o retângulo de cada casa, na ordem da grade
  let ordem = [];          // quem está em cada casa agora
  let ancora = null;       // onde o dedo segura o quadrinho
  let dedo = null, quadro = 0;
  grade.classList.add('pf-reordenavel');

  const cancelar = () => { clearTimeout(timer); timer = null; };
  const lista = () => [...grade.querySelectorAll(itens)];

  // A casa embaixo do dedo; entre duas casas (no vão), a mais perto.
  const casaEm = (x, y) => {
    let melhor = -1, menor = Infinity;
    casas.forEach((r, i) => {
      const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      const d = dx * dx + dy * dy;
      if (d < menor) { menor = d; melhor = i; }
    });
    return melhor;
  };

  const posicionar = () => {
    quadro = 0;
    if (!pego || !dedo) return;
    const i = ordem.indexOf(pego);
    const alvo = casaEm(dedo.x, dedo.y);
    if (alvo >= 0 && alvo !== i) mudarDeCasa(i, alvo);
    const casa = casas[ordem.indexOf(pego)];
    pego.style.transform =
      `translate(${dedo.x - ancora.x - casa.left}px, ${dedo.y - ancora.y - casa.top}px) scale(1.08)`;
  };

  // Tira o quadrinho da casa `de` e põe na casa `para`; os que estavam no meio
  // andam uma casa, saindo de onde estavam (FLIP com as casas já medidas).
  const mudarDeCasa = (de, para) => {
    const antes = new Map(ordem.map((n, k) => [n, k]));
    ordem.splice(de, 1);
    ordem.splice(para, 0, pego);
    const vizinho = ordem[para + 1];
    if (vizinho) vizinho.before(pego); else ordem[para - 1].after(pego);
    ordem.forEach((n, k) => {
      const k0 = antes.get(n);
      if (n === pego || k0 === k) return;
      const a = casas[k0], b = casas[k];
      n.style.transition = 'none';
      n.style.transform = `translate(${a.left - b.left}px, ${a.top - b.top}px)`;
      void n.offsetWidth;
      n.style.transition = `transform ${ANDAR}ms ease-out`;
      n.style.transform = '';
    });
  };

  grade.addEventListener('pointerdown', (e) => {
    const no = e.target.closest(itens);
    if (!no || !grade.contains(no) || (e.pointerType === 'mouse' && e.button !== 0)) return;
    x0 = e.clientX; y0 = e.clientY;
    cancelar();
    timer = setTimeout(() => {
      timer = null;
      window.getSelection?.()?.removeAllRanges();
      ordem = lista();
      casas = ordem.map(n => n.getBoundingClientRect());
      const r = casas[ordem.indexOf(no)];
      ancora = { x: x0 - r.left, y: y0 - r.top };
      pego = no;
      dedo = { x: x0, y: y0 };
      grade.setPointerCapture?.(e.pointerId);
      grade.classList.add('reordenando');
      no.classList.add('pego');
      navigator.vibrate?.(12);
      posicionar();
    }, SEGURAR);
  });

  grade.addEventListener('pointermove', (e) => {
    if (timer && Math.hypot(e.clientX - x0, e.clientY - y0) > FOLGA) cancelar();
    if (!pego) return;
    dedo = { x: e.clientX, y: e.clientY };
    if (!quadro) quadro = requestAnimationFrame(posicionar);
  });

  const terminar = () => {
    cancelar();
    if (!pego) return;
    cancelAnimationFrame(quadro);
    quadro = 0;
    const no = pego;
    pego = null;
    soltouEm = Date.now();
    grade.classList.remove('reordenando');
    no.classList.remove('pego');
    // Volta para a casa dele, deslizando.
    no.style.transition = `transform ${ANDAR}ms ease-out`;
    no.style.transform = '';
    // Grava (e quem chamou repinta) depois que ele assenta, senão a grade
    // nova cortaria o deslize no meio.
    const ids = lista().map(n => n.dataset.id);
    setTimeout(() => { no.style.transition = ''; aoSoltar(ids); }, ANDAR + 40);
  };
  grade.addEventListener('pointerup', terminar);
  grade.addEventListener('pointercancel', terminar);

  // Com um quadrinho preso, o dedo arrasta ele e não a página; e segurar não
  // abre o menu de salvar imagem do aparelho.
  grade.addEventListener('touchmove', (e) => { if (pego) e.preventDefault(); }, { passive: false });
  grade.addEventListener('contextmenu', (e) => { if (pego || timer) e.preventDefault(); });
  grade.addEventListener('dragstart', (e) => e.preventDefault());
  grade.addEventListener('selectstart', (e) => e.preventDefault());
  // Soltar não é tocar: o clique que vem no fim do arrasto não abre nada.
  grade.addEventListener('click', (e) => {
    if (Date.now() - soltouEm < 400) { e.stopPropagation(); e.preventDefault(); }
  }, true);
}
