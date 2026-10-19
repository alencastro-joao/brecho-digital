// Pinça com dois dedos no palco (Stylist e Colagem): abrir e fechar muda o
// tamanho da peça escolhida, torcer gira. É o gesto que todo app de colagem
// tem; as alças continuam lá para quem prefere.
//
// Escuta na captura do palco: quando o segundo dedo desce, a pinça assume e
// o toque não chega à peça nem ao vazio (que tiraria a seleção ou abriria o
// laço). Enquanto houver dedo na tela depois de uma pinça, `ativa()` segue
// verdadeira: o arrasto de um dedo que começou antes para de mexer a peça,
// senão ela pularia ao soltar um dos dedos.
//
// `comecar()` devolve um estado (ou null se não há peça escolhida);
// `mudar(estado, fator, graus)` recebe a escala e o giro desde o começo.
export function ligarPinca(palco, { comecar, mudar, terminar }) {
  const dedos = new Map();          // pointerId -> { x, y }
  let estado = null, inicio = null, usada = false;

  const medida = () => {
    const [a, b] = [...dedos.values()];
    return { d: Math.hypot(b.x - a.x, b.y - a.y) || 1, ang: Math.atan2(b.y - a.y, b.x - a.x) };
  };

  palco.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (dedos.size !== 2) return;
    const est = comecar();
    if (!est) return;
    estado = est; inicio = medida(); usada = true;
    e.stopImmediatePropagation();
    e.preventDefault();
  }, true);

  palco.addEventListener('pointermove', (e) => {
    if (!dedos.has(e.pointerId)) return;
    dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!estado || dedos.size < 2) return;
    const m = medida();
    mudar(estado, m.d / inicio.d, (m.ang - inicio.ang) * 180 / Math.PI);
  }, true);

  const soltar = (e) => {
    if (!dedos.delete(e.pointerId)) return;
    if (estado && dedos.size < 2) { terminar?.(estado); estado = null; }
    if (!dedos.size) usada = false;
  };
  // Na janela: o dedo pode sair do palco antes de soltar.
  window.addEventListener('pointerup', soltar, true);
  window.addEventListener('pointercancel', soltar, true);

  return { ativa: () => usada };
}
