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

// Nível: a barrinha anda até o novo valor e o número do nível conta até o
// próximo. Sem GSAP, a largura vai direto para o valor, como antes.
export function andarBarra(barra, de, ate) {
  if (!barra) return;
  if (!animando()) { barra.style.width = ate + '%'; return; }
  gsap.fromTo(barra, { width: de + '%', transition: 'none' },
    { width: ate + '%', duration: 0.9, ease: 'power3.out' });
}

export function contarNumero(el, de, ate) {
  if (!el) return;
  if (!animando()) { el.textContent = String(ate); return; }
  const v = { n: de };
  gsap.to(v, {
    n: ate, duration: 0.6, ease: 'power1.out',
    onUpdate: () => { el.textContent = String(Math.round(v.n)); },
  });
}

// Baú: as peças saem de dentro do baú com um arco (sobem com uma curva e
// vão para o lado) e assentam com um pulinho.
export function animarBau(itens, atraso = 0.75) {
  if (!animando() || !itens.length) return;
  const limpar = { onComplete: () => gsap.set(itens, { clearProps: 'transform,opacity,visibility' }) };
  gsap.timeline({ delay: atraso, ...limpar })
    .from(itens, { y: -130, duration: 0.7, ease: 'back.out(1.6)', stagger: 0.09 }, 0)
    .from(itens, { x: (i) => (i % 2 ? 46 : -46), duration: 0.7, ease: 'power1.out', stagger: 0.09 }, 0)
    .from(itens, { scale: 0.3, rotation: (i) => (i % 2 ? -40 : 40), autoAlpha: 0, duration: 0.6, ease: 'power2.out', stagger: 0.09 }, 0);
}

// Colagem: cada peça sai do lugar em que estava e vai para o sorteado; as que
// são novas na colagem aparecem com um pulinho. `antes` é o mapa uid → retângulo.
export function espalhar(raiz, antes) {
  if (!animando() || !raiz) return;
  raiz.querySelectorAll('.pr-item[data-uid]').forEach((n) => {
    const a = antes.get(n.dataset.uid);
    if (!a) {
      gsap.fromTo(n, { autoAlpha: 0, scale: 0.6 },
        { autoAlpha: 1, scale: 1, duration: 0.45, delay: 0.2, ease: 'back.out(1.7)', clearProps: 'transform,opacity,visibility' });
      return;
    }
    const r = n.getBoundingClientRect();
    const dx = a.left - r.left, dy = a.top - r.top;
    if (Math.abs(dx) + Math.abs(dy) < 1) return;
    gsap.fromTo(n, { x: dx, y: dy }, { x: 0, y: 0, duration: 0.65, ease: 'power3.inOut' });
  });
}

// Feed: cada publicação nova sobe e aparece quando entra na tela. As que já
// apareceram não se animam de novo (curtir repinta o feed).
const vistos = new Set();
export function cascataDoFeed(raiz) {
  if (!animando() || !raiz) return;
  const novos = [...raiz.querySelectorAll('.post[data-post]')]
    .filter((n) => !vistos.has(n.dataset.post));
  if (!novos.length) return;
  novos.forEach((n) => vistos.add(n.dataset.post));
  const obs = new IntersectionObserver((entradas) => entradas.forEach((e) => {
    if (!e.isIntersecting) return;
    obs.unobserve(e.target);
    gsap.fromTo(e.target, { y: 26, autoAlpha: 0 },
      { y: 0, autoAlpha: 1, duration: 0.55, ease: 'power2.out', clearProps: 'transform,opacity,visibility' });
  }), { rootMargin: '0px 0px -6% 0px' });
  novos.forEach((n) => { gsap.set(n, { autoAlpha: 0 }); obs.observe(n); });
}

// Curtida: o coração estica e o número sobe de um valor ao outro.
export function pulsoCurtida(botao, de, ate) {
  if (!botao) return;
  if (!animando()) return;
  gsap.fromTo(botao, { scale: 0.7 },
    { scale: 1, duration: 0.7, ease: 'elastic.out(1, 0.35)', clearProps: 'transform' });
  const numero = botao.querySelector('span');
  if (numero && de !== ate) {
    const v = { n: de };
    gsap.to(v, { n: ate, duration: 0.5, ease: 'power1.out',
      onUpdate: () => { numero.textContent = String(Math.round(v.n)); } });
  }
}

// Troca de tela: a tela nova entra deslizando para o lado de onde veio.
// dir = 1 vem da direita, -1 da esquerda.
export function deslizarTela(el, dir) {
  if (!animando() || !el) return;
  gsap.fromTo(el, { x: dir * 40 }, { x: 0, duration: 0.38, ease: 'power2.out', clearProps: 'transform' });
}

// Personagem: a bolha de fala cresce com elástico a partir do canto.
export function animarFala(bolha) {
  if (!animando() || !bolha) return;
  gsap.fromTo(bolha, { scale: 0.5, autoAlpha: 0, transformOrigin: '0% 100%' },
    { scale: 1, autoAlpha: 1, duration: 0.7, ease: 'elastic.out(1, 0.5)', clearProps: 'transform,opacity,visibility' });
}

// Sino: balança quando chega aviso novo.
export function balancarSino(sino) {
  if (!animando() || !sino) return;
  gsap.fromTo(sino, { rotation: -18 },
    { rotation: 0, duration: 1.1, ease: 'elastic.out(1, 0.25)', clearProps: 'transform' });
}

// Stylist: a peça que acabou de chegar cai no corpo, estica e assenta.
export function cairNoCorpo(img) {
  if (!animando() || !img) return;
  gsap.fromTo(img, { y: -70, scaleY: 0.9, autoAlpha: 0 },
    { y: 0, scaleY: 1, autoAlpha: 1, duration: 0.6, ease: 'bounce.out', clearProps: 'transform,opacity,visibility' });
}
