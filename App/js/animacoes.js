// Animações de interação: a parte que o CSS sozinho não faz (css/animacoes.css).
//
// - a onda de pérola que sai de onde você tocou num botão;
// - o dado do "Gerar" rolando quando você sorteia;
// - estrelinhas, corações e confete (festejar()) e o "+XP" que sobe
//   (flutuarTexto()), chamados por quem sabe que algo bom aconteceu.
//
// Tudo é enfeite: nada aqui muda o que o botão faz, e quem pede menos
// movimento no sistema não vê nada disso.

const calmo = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Põe um elemento solto por cima da página e tira quando a animação acaba.
function soltar(classe, x, y, estilo = {}) {
  const d = document.createElement('div');
  d.className = classe;
  d.style.left = x + 'px';
  d.style.top = y + 'px';
  for (const [k, v] of Object.entries(estilo)) d.style.setProperty(k, v);
  d.addEventListener('animationend', () => d.remove(), { once: true });
  document.body.append(d);
  setTimeout(() => d.remove(), 1500);   // garantia se a animação não rodar
}

// Onda: só em botão de verdade e habilitado.
document.addEventListener('pointerdown', (e) => {
  if (calmo() || e.button !== 0) return;
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  soltar('anim-onda', e.clientX, e.clientY);
}, { passive: true });

// Dado: o "Gerar" do Stylist e da Colagem.
document.addEventListener('click', (e) => {
  const b = e.target.closest('#btn-sortear, #bd-sortear');
  if (!b || calmo()) return;
  b.classList.remove('rolando');
  void b.offsetWidth;                    // reinicia se clicar de novo no meio
  b.classList.add('rolando');
  setTimeout(() => b.classList.remove('rolando'), 650);
});

// Confete saindo de um botão ou selo: estrelinhas ao favoritar, corações ao
// curtir, confete colorido ao subir de nível. Recebe o próprio elemento; a
// conta é pelo centro dele, então funciona igual com mouse, toque ou teclado.
const ESTILOS_FESTA = {
  estrela: { n: 8, dist: 26, classe: 'anim-faisca' },
  coracao: { n: 7, dist: 30, classe: 'anim-faisca anim-coracao' },
  confete: { n: 18, dist: 60, classe: 'anim-faisca anim-confete' },
};
const CORES_CONFETE = ['#ff6b9a', '#ffc94d', '#57d68d', '#4dc3ff', '#a07cff'];

export function festejar(botao, tipo = 'estrela') {
  if (calmo() || !botao?.isConnected) return;
  const { n, dist, classe } = ESTILOS_FESTA[tipo] || ESTILOS_FESTA.estrela;
  const r = botao.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + Math.random() * .5;
    const d = dist + Math.random() * dist * .7;
    // Coração sobe; o resto espalha em volta.
    const dy = tipo === 'coracao' ? -(20 + Math.random() * 40) : Math.sin(ang) * d;
    const dx = tipo === 'coracao' ? (Math.random() - .5) * 50 : Math.cos(ang) * d;
    soltar(classe, x, y, {
      '--dx': dx + 'px',
      '--dy': dy + 'px',
      '--giro': (Math.random() * 240 - 120) + 'deg',
      ...(tipo === 'confete' ? { '--cor': CORES_CONFETE[i % CORES_CONFETE.length] } : {}),
    });
  }
  pular(botao);
}

// O pulinho de quem foi tocado (a estrela, o coração, o selo do nível).
export function pular(alvo) {
  if (calmo() || !alvo) return;
  alvo.classList.remove('anim-acendeu');
  void alvo.offsetWidth;
  alvo.classList.add('anim-acendeu');
  setTimeout(() => alvo.classList.remove('anim-acendeu'), 550);
}

// Um texto curto que sobe e some saindo de um elemento ("+10 XP").
export function flutuarTexto(alvo, texto) {
  if (calmo() || !alvo?.isConnected) return;
  const r = alvo.getBoundingClientRect();
  const d = document.createElement('div');
  d.className = 'anim-sobe';
  d.textContent = texto;
  d.style.left = (r.left + r.width / 2) + 'px';
  d.style.top = r.top + 'px';
  d.addEventListener('animationend', () => d.remove(), { once: true });
  document.body.append(d);
  setTimeout(() => d.remove(), 2000);
}
