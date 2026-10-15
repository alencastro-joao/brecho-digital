// Deslizar como ficha: a grade e a ficha da peça seguem o dedo como uma folha
// de papel. Mora aqui porque o guarda-roupa (closet.js) e a ficha das peças do
// perfil (usuario.js) deslizam do mesmo jeito. `quando` diz se o arrasto vale
// agora (o guarda-roupa só desliza no celular).
//
// A folha gira de leve junto, e soltar depois de um tanto passa para a vizinha: a
// folha sai para o lado e a nova entra do outro. Sem vizinha, a folha resiste
// e volta. Só arrasto de lado; rolar para baixo continua rolando.
const SAIDA = 180, ENTRADA = 220;

export function trocarComSlide(alvo, passo, ir) {
  const w = alvo.offsetWidth || 300;
  alvo.style.transition = `transform ${SAIDA}ms ease-in, opacity ${SAIDA}ms ease-in`;
  alvo.style.transform = `translateX(${-passo * w * 0.55}px) rotate(${-passo * 2.5}deg)`;
  alvo.style.opacity = '0';
  setTimeout(() => {
    ir(passo);
    alvo.style.transition = 'none';
    alvo.style.transform = `translateX(${passo * w * 0.35}px) rotate(${passo * 1.5}deg)`;
    void alvo.offsetWidth;
    alvo.style.transition = `transform ${ENTRADA}ms ease-out, opacity ${ENTRADA}ms ease-out`;
    alvo.style.transform = '';
    alvo.style.opacity = '';
  }, SAIDA);
}

export function deslizavel(alvo, { pode, ir, quando = () => true }) {
  let x0 = null, y0 = 0, dx = 0, puxando = false, arrastou = false;
  alvo.style.touchAction = 'pan-y';
  alvo.addEventListener('pointerdown', (e) => {
    if (!quando() || (e.pointerType === 'mouse' && e.button !== 0)) return;
    x0 = e.clientX; y0 = e.clientY; dx = 0; puxando = false; arrastou = false;
  });
  alvo.addEventListener('pointermove', (e) => {
    if (x0 === null) return;
    dx = e.clientX - x0;
    const dy = e.clientY - y0;
    if (!puxando) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { x0 = null; return; }
      if (Math.abs(dx) < 8) return;
      puxando = true;
      alvo.setPointerCapture?.(e.pointerId);
      alvo.style.transition = 'none';
    }
    // Sem vizinha daquele lado, a folha quase não sai do lugar.
    const d = pode(dx < 0 ? 1 : -1) ? dx : dx * 0.22;
    alvo.style.transform = `translateX(${d}px) rotate(${d * 0.012}deg)`;
  });
  const soltar = () => {
    if (x0 === null) return;
    x0 = null;
    if (!puxando) return;
    puxando = false;
    arrastou = true;
    const passo = dx < 0 ? 1 : -1;
    if (Math.abs(dx) > 60 && pode(passo)) {
      trocarComSlide(alvo, passo, ir);
    } else {
      alvo.style.transition = 'transform .22s ease-out';
      alvo.style.transform = '';
    }
  };
  alvo.addEventListener('pointerup', soltar);
  alvo.addEventListener('pointercancel', soltar);
  // Arrastar não é tocar: o clique que vem no fim do arrasto não abre peça.
  alvo.addEventListener('click', (e) => {
    if (arrastou) { e.stopPropagation(); e.preventDefault(); arrastou = false; }
  }, true);
}

