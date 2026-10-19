// Movimentos com GSAP: o que pede trajetória, sequência ou medir antes e
// depois, que o CSS sozinho não faz bem (o resto mora em css/animacoes.css).
//
// - chegarNaArara(): as peças do dia caem no mural uma a uma;
// - voar(): a peça resgatada é jogada num arco até o botão do guarda-roupa;
// - rearrumar(): ao reorganizar o guarda-roupa, cada peça desliza do lugar
//   velho para o novo (Flip), em vez de a grade inteira piscar.
//
// O GSAP vem de js/vendor/ (3.15.0, gsap.com — grátis, inclusive para uso
// comercial), carregado por <script> no index.html antes do app. Sem ele, ou
// para quem pede menos movimento no sistema, tudo aqui vira "só faz a troca":
// nenhuma função muda o que o jogo faz, só como aparece.

const gsap = window.gsap;
const Flip = window.Flip;
if (gsap && Flip) gsap.registerPlugin(Flip);

const calmo = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const animando = () => !!gsap && !calmo();

// Vitrine: as peças despencam na arara, cada uma num instante, e assentam com
// uma molinha. A ordem é sorteada para a rara (que fica por baixo da pilha)
// não chegar sozinha nem por último. O transform e a transição do CSS voltam
// no fim: o giro de cada peça e o zoom do hover são deles.
export function chegarNaArara(nos) {
  if (!animando() || !nos.length) return;
  gsap.killTweensOf(nos);
  gsap.set(nos, { transition: 'none' });   // a transição do CSS brigaria com o tween
  gsap.from(nos, {
    y: () => -(70 + Math.random() * 90),
    rotation: () => `+=${(Math.random() - 0.5) * 30}`,
    scale: 0.85,
    autoAlpha: 0,
    duration: 0.75,
    ease: 'back.out(1.5)',
    stagger: { each: 0.07, from: 'random' },
    onComplete() { gsap.set(nos, { clearProps: 'transform,opacity,visibility,transition' }); },
  });
}

// Resgate: uma cópia da imagem é jogada da arara até o botão do guarda-roupa.
// O x anda reto e o y recua antes de ir (back.in), então a peça sobe um pouco
// e cai no botão, como quem joga a roupa no cesto. Devolve false quando não
// animou, para quem chamou usar o voo antigo.
export function voar(img, alvo, aoChegar) {
  if (!animando() || !img || !alvo) return false;
  const de = img.getBoundingClientRect();
  const para = alvo.getBoundingClientRect();
  if (!de.width || !para.width) return false;
  const voo = img.cloneNode();
  Object.assign(voo.style, {
    position: 'fixed', left: `${de.left}px`, top: `${de.top}px`,
    width: `${de.width}px`, height: `${de.height}px`,
    margin: '0', zIndex: '9999', pointerEvents: 'none',
  });
  document.body.append(voo);
  const dx = para.left + para.width / 2 - (de.left + de.width / 2);
  const dy = para.top + para.height / 2 - (de.top + de.height / 2);
  const fim = 36 / Math.max(de.width, de.height);
  gsap.timeline({ onComplete: () => { voo.remove(); aoChegar?.(); } })
    .to(voo, { x: dx, duration: 0.8, ease: 'power1.inOut' }, 0)
    .to(voo, { y: dy, duration: 0.8, ease: 'back.in(2.2)' }, 0)
    .to(voo, { scale: fim, rotation: 200, duration: 0.8, ease: 'power2.in' }, 0)
    .to(voo, { autoAlpha: 0.25, duration: 0.2 }, 0.6);
  return true;
}

// Guarda-roupa: fotografa onde cada peça está, deixa `mudar` redesenhar a
// grade e anima cada uma do lugar antigo para o novo. As peças são casadas
// pelo data-flip-id (o id da peça), porque a grade é recriada do zero; a que
// não estava na tela antes surge no lugar. A cascata de entrada do CSS sai
// para não brigar com o deslize.
export function rearrumar(grade, mudar) {
  const seletor = '.item-slot[data-flip-id]';
  if (!animando() || !Flip || !grade) { mudar(); return; }
  const antes = Flip.getState(grade.querySelectorAll(seletor));
  mudar();
  grade.classList.remove('grade-entra');
  const depois = grade.querySelectorAll(seletor);
  if (!depois.length) return;
  grade.classList.add('flipando');
  Flip.from(antes, {
    targets: depois,
    duration: 0.55,
    ease: 'power2.inOut',
    stagger: 0.012,
    onEnter: (novas) => gsap.fromTo(novas,
      { autoAlpha: 0, scale: 0.8 },
      { autoAlpha: 1, scale: 1, duration: 0.35, delay: 0.2, ease: 'back.out(1.7)',
        clearProps: 'transform,opacity,visibility' }),
    onComplete: () => grade.classList.remove('flipando'),
  });
}
