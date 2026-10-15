// Animações de interação: a parte que o CSS sozinho não faz (css/animacoes.css).
//
// - a onda de pérola que sai de onde você tocou num botão;
// - o dado do "Gerar" rolando quando você sorteia;
// - as estrelinhas de quando algo vai para o seu perfil (festejar()).
//
// Tudo é enfeite: nada aqui muda o que o botão faz, e quem pede menos
// movimento no sistema não vê nenhum dos três.

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

// Estrelinhas saindo do botão que favoritou. Recebe o próprio botão; a conta
// é pelo centro dele, então funciona igual com mouse, toque ou teclado.
export function festejar(botao) {
  if (calmo() || !botao?.isConnected) return;
  const r = botao.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const n = 8;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + Math.random() * .5;
    const dist = 26 + Math.random() * 18;
    soltar('anim-faisca', x, y, {
      '--dx': Math.cos(ang) * dist + 'px',
      '--dy': Math.sin(ang) * dist + 'px',
      '--giro': (Math.random() * 240 - 120) + 'deg',
    });
  }
  botao.classList.remove('anim-acendeu');
  void botao.offsetWidth;
  botao.classList.add('anim-acendeu');
  setTimeout(() => botao.classList.remove('anim-acendeu'), 550);
}
