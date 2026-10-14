// Tutorial de boas-vindas: o passo a passo que abre na primeira vez.
//
// Versão provisória e de propósito simples: um cartão por funcionalidade, na
// ordem em que a pessoa vai precisar delas (primeiro o personagem, que é quem
// veste tudo; depois a loja, o closet e o que se faz com as peças). Cada passo
// leva o app para a tela de que fala e acende o botão dela na barra, então o
// cartão nunca descreve uma tela que a pessoa não está vendo.
//
// Abre sozinho quando a conta nasce (app.js). Para ver de novo sem criar conta:
// Perfil › Testes › "Ver tutorial", ou abrir o site com ?tutorial no endereço.

import { irPara } from './router.js';
import { el, $ } from './util.js';

// alvo: a tela cujo botão acende. O Perfil e o Personagem não têm botão na
// barra do celular — lá quem acende é o rosto do avatar no canto de cima.
const PASSOS = [
  {
    tela: 'vitrine', alvo: null,
    titulo: 'Bem-vindo ao Brechó Digital!',
    texto: 'Em um minuto eu te mostro tudo o que dá pra fazer aqui. ' +
      'Você já ganhou 6 peças de presente: elas estão no seu closet.',
  },
  {
    tela: 'personagem', alvo: 'perfil',
    titulo: 'Crie o seu personagem',
    texto: 'Escolha o corpo, o tom de pele, o cabelo e o nariz. ' +
      'É ele que veste os seus looks e aparece no seu perfil. ' +
      'Para voltar aqui depois: Perfil › Personagem.',
  },
  {
    tela: 'vestiario', alvo: 'vestiario',
    titulo: 'Vista o personagem',
    texto: 'Em Roupas ficam as roupinhas desenhadas do avatar. ' +
      'Dois toques (ou arrastar) vestem a peça; completar coleções libera roupinhas novas.',
  },
  {
    tela: 'vitrine', alvo: 'vitrine',
    titulo: 'A loja muda todo dia',
    texto: 'Toda manhã o dono repõe o mural. Você pode resgatar 3 peças por dia. ' +
      'As raras ficam escondidas por baixo da pilha: arraste as de cima pra garimpar.',
  },
  {
    tela: 'closet', alvo: 'closet',
    titulo: 'O seu closet',
    texto: 'Tudo o que você resgata vem pra cá, separado por categoria e com a cor da raridade. ' +
      'Toque numa peça para ver a ficha; a estrela leva ela para o seu perfil.',
  },
  {
    tela: 'stylist', alvo: 'stylist',
    titulo: 'Stylist: monte looks',
    texto: 'Escolha as suas peças e elas encaixam no avatar. Mova, gire e mude o tamanho; ' +
      'ou toque em sortear look. Depois é salvar, publicar no feed ou baixar para o Story.',
  },
  {
    tela: 'board', alvo: 'board',
    titulo: 'Colagem livre',
    texto: 'Um board de moda em fundo branco: espalhe as peças, escreva etiquetas, ' +
      'assine e exporte. Também dá pra sortear uma colagem pronta.',
  },
  {
    tela: 'social', alvo: 'social',
    titulo: 'Feed',
    texto: 'Os looks e colagens de todo mundo. Curta, comente e siga. ' +
      'Na busca de pessoas você acha os seus amigos pelo nome ou pelo @.',
  },
  {
    tela: 'tarefas', alvo: 'tarefas',
    titulo: 'Missões e níveis',
    texto: 'Cumprir as missões do dia dá XP, e cada nível abre coisa nova. ' +
      'Aqui também ficam as coleções por marca, com o que já é seu e o que falta.',
  },
  {
    tela: 'perfil', alvo: 'perfil',
    titulo: 'A sua página',
    texto: 'O que você marca com a estrela aparece aqui, junto dos amigos. ' +
      'Quer rever este tutorial? Perfil › Testes › Ver tutorial.',
  },
];

let passo = 0;
let cartao = null;

export function montarTutorial() {
  $('#btn-tutorial')?.addEventListener('click', () => {
    $('#aj-fechar')?.click();   // fecha o modal de Testes antes
    abrirTutorial();
  });
}

// ?tutorial no endereço: o jeito de testar de qualquer aparelho.
export function pediuTutorialNaUrl() {
  return new URLSearchParams(location.search).has('tutorial');
}

export function abrirTutorial() {
  if (cartao) return;
  passo = 0;
  cartao = el('div', { class: 'tutorial', role: 'dialog', 'aria-live': 'polite' });
  document.body.append(cartao);
  document.body.classList.add('com-tutorial');
  document.addEventListener('keydown', teclas);
  mostrar();
}

function fechar() {
  apagarAlvo();
  cartao?.remove();
  cartao = null;
  document.body.classList.remove('com-tutorial');
  document.removeEventListener('keydown', teclas);
  // Tira o ?tutorial do endereço: recarregar a página não abre de novo.
  if (pediuTutorialNaUrl()) history.replaceState(null, '', location.pathname + location.hash);
  irPara('vitrine');
}

function teclas(e) {
  if (e.key === 'Escape') fechar();
  else if (e.key === 'ArrowRight') ir(1);
  else if (e.key === 'ArrowLeft') ir(-1);
}

function ir(d) {
  const n = passo + d;
  if (n < 0) return;
  if (n >= PASSOS.length) { fechar(); return; }
  passo = n;
  mostrar();
}

function apagarAlvo() {
  document.querySelectorAll('.tut-alvo').forEach(b => b.classList.remove('tut-alvo'));
}

// O botão da tela na barra; se ele estiver escondido (Perfil no celular), o
// atalho redondo do perfil.
function botaoDa(tela) {
  const b = document.querySelector(`.sidebar-btn[data-goto="${tela}"]`);
  if (b && b.offsetParent) return b;
  if (tela === 'perfil') return $('#perfil-atalho');
  return null;
}

function mostrar() {
  const p = PASSOS[passo];
  irPara(p.tela);
  apagarAlvo();
  if (p.alvo) botaoDa(p.alvo)?.classList.add('tut-alvo');

  const ultimo = passo === PASSOS.length - 1;
  const pontos = PASSOS.map((_, i) =>
    `<i class="${i === passo ? 'ativo' : i < passo ? 'feito' : ''}"></i>`).join('');

  cartao.innerHTML = `
    <div class="tut-topo">
      <span class="tut-conta">${passo + 1} de ${PASSOS.length}</span>
      <button class="tut-pular" type="button">Pular</button>
    </div>
    <h2>${p.titulo}</h2>
    <p>${p.texto}</p>
    <div class="tut-pontos">${pontos}</div>
    <div class="tut-acoes">
      ${passo > 0 ? '<button class="btn-ghost tut-voltar" type="button">Voltar</button>' : ''}
      <button class="btn-dark tut-proximo" type="button">${ultimo ? 'Começar a garimpar' : passo === 0 ? 'Bora!' : 'Próximo'}</button>
    </div>`;
  cartao.querySelector('.tut-pular').addEventListener('click', fechar);
  cartao.querySelector('.tut-voltar')?.addEventListener('click', () => ir(-1));
  cartao.querySelector('.tut-proximo').addEventListener('click', () => ir(1));
}
