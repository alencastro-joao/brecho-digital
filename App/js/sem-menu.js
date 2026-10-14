// Segurar o dedo numa peça não abre o menu do navegador (Abrir imagem, Baixar,
// Lens...). No Android o menu vem do evento contextmenu; no iPhone, do
// -webkit-touch-callout, desligado no CSS. Só vale para toque: o botão direito
// do mouse continua normal, e campos de texto mantêm colar/copiar.
let ultimoPonteiro = 'mouse';
document.addEventListener('pointerdown', (e) => { ultimoPonteiro = e.pointerType; },
  { capture: true, passive: true });

document.addEventListener('contextmenu', (e) => {
  const tipo = e.pointerType || ultimoPonteiro;
  if (tipo !== 'touch' && tipo !== 'pen') return;
  if (e.target.closest?.('input, textarea, [contenteditable=""], [contenteditable="true"]')) return;
  e.preventDefault();
}, { capture: true });
