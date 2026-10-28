// Troca de telas por hash (#/vitrine, #/closet, #/stylist, #/social, #/perfil).
//
// Cada tela é uma ferramenta com nível mínimo (config.FERRAMENTAS): entrar numa
// que ainda não abriu devolve o usuário para a vitrine com o aviso.
//
// A hash aceita um parâmetro depois da tela (#/usuario/u-lia): é o perfil de
// quem está sendo visitado. Quem precisa dele lê com paramAtual() no gancho de
// entrada — assim o link continua sendo a única fonte de verdade da navegação,
// e voltar pelo botão do navegador volta para o perfil certo.

import * as db from './db.js';
import { ferramenta, nivelDaFerramenta } from './config.js';
import { toast } from './util.js';
import { deslizarTela } from './movimento.js';

const ganchos = new Map();
export const onEnter = (view, fn) => ganchos.set(view, fn);

export const VIEWS = ['vitrine', 'closet', 'stylist', 'board', 'social', 'tarefas',
  'vestiario', 'perfil', 'personagem', 'usuario', 'colecoes', 'baus', 'ajudas', 'admin', 'praca'];

// Telas sem botão próprio na barra: acendem o botão de onde vieram. Stylist e
// Colagem dividem o Criar; as Roupas (vestiário) moram no perfil.
const BOTAO_DA_VIEW = {
  usuario: 'social', personagem: 'perfil', colecoes: 'tarefas', baus: 'tarefas', admin: 'perfil', praca: 'perfil',
  stylist: 'criar', board: 'criar', vestiario: 'perfil',
};

export function rotaAtual() {
  const [alvo, param] = (location.hash || '').replace('#/', '').split('/');
  return {
    view: VIEWS.includes(alvo) ? alvo : 'vitrine',
    param: param ? decodeURIComponent(param) : null,
  };
}

export const viewAtual = () => rotaAtual().view;
export const paramAtual = () => rotaAtual().param;

const hashDe = (view, param) => '#/' + view + (param ? '/' + encodeURIComponent(param) : '');

export function irPara(view, param = null) {
  if (!VIEWS.includes(view)) view = 'vitrine';
  if (!db.ferramentaLiberada(view)) {
    const f = ferramenta(view);
    toast(`${f?.nome ?? view} abre no nível ${nivelDaFerramenta(view)}.`, 'aviso');
    return;
  }
  const destino = hashDe(view, param);
  // Trocar de perfil sem sair da tela é a mesma view com outro parâmetro:
  // a comparação precisa ser da hash inteira, não só do nome da tela.
  if (location.hash === destino) { aplicar(view); return; }
  location.hash = destino;
}

function aplicar(view) {
  if (!db.ferramentaLiberada(view)) view = 'vitrine';
  const anterior = document.body.dataset.view;
  document.querySelectorAll('.view').forEach(s => { s.hidden = s.dataset.view !== view; });
  const aceso = BOTAO_DA_VIEW[view] || view;
  document.querySelectorAll('.sidebar-btn').forEach(b =>
    b.classList.toggle('ativa', b.dataset.goto === aceso));
  document.body.dataset.view = view;
  if (anterior && anterior !== view) {
    deslizarTela(document.querySelector(`.view[data-view="${view}"]`),
      VIEWS.indexOf(view) > VIEWS.indexOf(anterior) ? 1 : -1);
  }
  ganchos.get(view)?.();
}

// O botão Criar não é uma tela: abre um menu pequeno colado nele, com o
// Stylist e a Colagem. No celular a barra está embaixo e o menu sobe; no PC
// ela está na direita e o menu abre para a esquerda.
function montarMenuCriar() {
  const botao = document.querySelector('.sidebar-btn[data-goto="criar"]');
  const menu = document.getElementById('criar-menu');
  if (!botao || !menu) return;
  const fechar = () => { menu.hidden = true; botao.setAttribute('aria-expanded', 'false'); };
  const abrir = () => {
    menu.hidden = false;
    botao.setAttribute('aria-expanded', 'true');
    const r = botao.getBoundingClientRect();
    const naBase = r.top > innerHeight / 2;
    menu.classList.toggle('sobe', naBase);
    if (naBase) {
      const largura = menu.offsetWidth;
      const centro = Math.min(Math.max(r.left + r.width / 2, largura / 2 + 10), innerWidth - largura / 2 - 10);
      Object.assign(menu.style, { left: `${centro - largura / 2}px`, right: '', top: '', bottom: `${innerHeight - r.top + 10}px` });
    } else {
      Object.assign(menu.style, { left: '', right: `${innerWidth - r.left + 12}px`, top: `${r.top}px`, bottom: '' });
    }
    const atual = viewAtual();
    for (const op of menu.querySelectorAll('.criar-opcao')) op.classList.toggle('ativa', op.dataset.goto === atual);
  };
  botao.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden ? abrir() : fechar(); });
  menu.addEventListener('click', (e) => {
    const op = e.target.closest('.criar-opcao');
    if (!op) return;
    fechar();
    irPara(op.dataset.goto);
  });
  document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) fechar(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(); });
  window.addEventListener('resize', fechar);
  window.addEventListener('hashchange', fechar);
}

export function iniciarRouter() {
  document.querySelectorAll('.sidebar-btn:not([data-goto="criar"])').forEach(b =>
    b.addEventListener('click', () => irPara(b.dataset.goto)));
  montarMenuCriar();
  document.querySelector('.logo-mini')?.addEventListener('click', () => irPara('vitrine'));
  window.addEventListener('hashchange', () => aplicar(viewAtual()));
  aplicar(viewAtual());
}
