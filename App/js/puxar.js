// Puxar para atualizar, no celular.
//
// No celular o <body> não rola (css/mobile.css): cada tela rola por dentro, e
// por isso o gesto nativo do navegador não acontece. Aqui ele é refeito à mão:
// com a tela no topo, arrastar o dedo para baixo puxa uma bolinha; soltar
// depois do limite recarrega a página, que volta na mesma tela (a hash fica) e
// com a mesma conta (a sessão é cookie).
//
// Fica de fora:
// - Stylist e Colagem, onde arrastar é editar e recarregar perderia o trabalho;
// - qualquer gesto que comece num elemento que trata o próprio arraste (peça da
//   vitrine, item do inventário...). Esses dão preventDefault no pointerdown, e
//   o ouvinte do document, que roda depois deles, enxerga isso;
// - modal aberto.

const LIMITE = 70;          // px de puxão (já amortecido) que disparam a atualização
const MAXIMO = 110;         // até onde a bolinha desce
const TELAS_FORA = new Set(['stylist', 'board']);

const celular = matchMedia('(max-width: 900px)');

let bolinha = null;
let inicio = null;          // { x, y } do toque, enquanto o gesto pode virar puxão
let puxando = false;
let distancia = 0;
let bloqueado = false;
let atualizando = false;

function criarBolinha() {
  bolinha = document.createElement('div');
  bolinha.className = 'puxar';
  bolinha.setAttribute('aria-hidden', 'true');
  bolinha.innerHTML = '<span class="puxar-seta">↓</span>';
  document.body.appendChild(bolinha);
}

// Algum ancestral do toque que rola na vertical e não está no topo: o gesto é
// rolagem, não puxão.
function algumRoladoAbaixoDoTopo(alvo) {
  for (let no = alvo; no && no !== document.documentElement; no = no.parentElement) {
    if (no.scrollTop > 0) return true;
  }
  return false;
}

function podeComecar(e) {
  if (!celular.matches || atualizando || bloqueado) return false;
  if (e.touches.length !== 1) return false;
  if (TELAS_FORA.has(document.body.dataset.view)) return false;
  if (document.querySelector('.modal:not([hidden])')) return false;
  const alvo = e.target;
  if (alvo.closest('input, textarea, select, [contenteditable]')) return false;
  return !algumRoladoAbaixoDoTopo(alvo);
}

function desenhar() {
  const y = Math.min(distancia, MAXIMO);
  const pronto = distancia >= LIMITE;
  bolinha.style.transform = `translate(-50%, ${y - 50}px)`;
  bolinha.style.opacity = Math.min(1, distancia / 40);
  bolinha.querySelector('.puxar-seta').style.transform =
    `rotate(${pronto ? 180 : (distancia / LIMITE) * 180}deg)`;
  bolinha.classList.toggle('pronta', pronto);
}

function soltar() {
  bolinha.classList.add('voltando');
  bolinha.style.transform = 'translate(-50%, -50px)';
  bolinha.style.opacity = '0';
  bolinha.classList.remove('pronta');
  setTimeout(() => bolinha?.classList.remove('voltando'), 220);
}

function atualizar() {
  atualizando = true;
  bolinha.classList.add('voltando', 'girando');
  bolinha.style.transform = `translate(-50%, ${LIMITE - 50}px)`;
  bolinha.style.opacity = '1';
  // Um respiro para a bolinha girar antes de a página sumir.
  setTimeout(() => location.reload(), 250);
}

function aoTocar(e) {
  inicio = podeComecar(e) ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  puxando = false;
  distancia = 0;
}

function aoMover(e) {
  if (!inicio) return;
  const dx = e.touches[0].clientX - inicio.x;
  const dy = e.touches[0].clientY - inicio.y;
  if (!puxando) {
    // Só vira puxão se o dedo desce mais do que vai para o lado: deslizar um
    // carrossel não pode atualizar a tela.
    if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
    if (dy <= 0 || Math.abs(dx) > dy) { inicio = null; return; }
    puxando = true;
    bolinha.classList.remove('voltando');
  }
  e.preventDefault();      // segura o quique da rolagem enquanto puxa
  distancia = Math.max(0, dy) * 0.5;
  desenhar();
}

function aoSoltar() {
  if (puxando) {
    if (distancia >= LIMITE) atualizar();
    else soltar();
  }
  inicio = null;
  puxando = false;
  bloqueado = false;
}

criarBolinha();
// Fase de bolha: os pointerdown dos elementos já rodaram.
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') bloqueado = e.defaultPrevented;
});
document.addEventListener('touchstart', aoTocar, { passive: true });
document.addEventListener('touchmove', aoMover, { passive: false });
document.addEventListener('touchend', aoSoltar);
document.addEventListener('touchcancel', aoSoltar);
