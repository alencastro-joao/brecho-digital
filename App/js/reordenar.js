// Segurar e arrastar para reorganizar uma grade (as abas do seu perfil).
// Segurar parado por um instante pega o quadrinho: ele cresce, segue o dedo, e
// os outros abrem espaço deslizando. Soltar grava a ordem nova. Mexer o dedo
// antes disso é rolar a página, e o toque rápido continua abrindo a peça.
const SEGURAR = 300;
const FOLGA = 12;
const ANDAR = 180;

export function reordenavel(grade, { itens = '[data-id]', aoSoltar }) {
  let timer = null, pego = null, x0 = 0, y0 = 0, ancora = null, soltouEm = 0;
  // Quem acabou de abrir espaço ainda passa embaixo do dedo enquanto desliza;
  // contá-lo como alvo desfaria a troca. Fica de fora até chegar.
  const andando = new WeakMap();
  grade.classList.add('pf-reordenavel');

  const cancelar = () => { clearTimeout(timer); timer = null; };
  const lista = () => [...grade.querySelectorAll(itens)];

  // O quadrinho preso no dedo: tira o deslocamento, mede onde ele está na
  // grade agora e põe de volta, para o dedo segurar sempre o mesmo ponto.
  const seguir = (x, y) => {
    pego.style.transform = '';
    const r = pego.getBoundingClientRect();
    pego.style.transform = `translate(${x - ancora.x - r.left}px, ${y - ancora.y - r.top}px) scale(1.08)`;
  };

  // Os outros andam de onde estavam para o lugar novo (FLIP).
  const mudarDeLugar = (alvo) => {
    const outros = lista().filter(n => n !== pego);
    const antes = new Map(outros.map(n => [n, n.getBoundingClientRect()]));
    const todos = lista();
    if (todos.indexOf(pego) < todos.indexOf(alvo)) alvo.after(pego); else alvo.before(pego);
    for (const n of outros) {
      const a = antes.get(n), b = n.getBoundingClientRect();
      if (a.left === b.left && a.top === b.top) continue;
      andando.set(n, Date.now() + ANDAR);
      n.style.transition = 'none';
      n.style.transform = `translate(${a.left - b.left}px, ${a.top - b.top}px)`;
      void n.offsetWidth;
      n.style.transition = `transform ${ANDAR}ms ease-out`;
      n.style.transform = '';
    }
  };

  grade.addEventListener('pointerdown', (e) => {
    const no = e.target.closest(itens);
    if (!no || !grade.contains(no) || (e.pointerType === 'mouse' && e.button !== 0)) return;
    x0 = e.clientX; y0 = e.clientY;
    cancelar();
    timer = setTimeout(() => {
      timer = null;
      pego = no;
      const r = no.getBoundingClientRect();
      ancora = { x: x0 - r.left, y: y0 - r.top };
      grade.setPointerCapture?.(e.pointerId);
      window.getSelection?.()?.removeAllRanges();
      grade.classList.add('reordenando');
      no.classList.add('pego');
      navigator.vibrate?.(12);
      seguir(x0, y0);
    }, SEGURAR);
  });

  grade.addEventListener('pointermove', (e) => {
    if (timer && Math.hypot(e.clientX - x0, e.clientY - y0) > FOLGA) cancelar();
    if (!pego) return;
    seguir(e.clientX, e.clientY);
    // O quadrinho preso não recebe o ponteiro (CSS), então o que está embaixo
    // do dedo é o vizinho onde ele vai entrar.
    const alvo = document.elementFromPoint(e.clientX, e.clientY)?.closest(itens);
    if (alvo && alvo !== pego && grade.contains(alvo) && !(andando.get(alvo) > Date.now())) {
      mudarDeLugar(alvo);
      seguir(e.clientX, e.clientY);
    }
  });

  const terminar = () => {
    cancelar();
    if (!pego) return;
    const no = pego;
    pego = null;
    soltouEm = Date.now();
    grade.classList.remove('reordenando');
    no.style.transition = 'transform .16s ease-out';
    no.style.transform = '';
    no.classList.remove('pego');
    setTimeout(() => { no.style.transition = ''; }, 200);
    aoSoltar(lista().map(n => n.dataset.id));
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
