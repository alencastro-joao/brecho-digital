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

const ganchos = new Map();
export const onEnter = (view, fn) => ganchos.set(view, fn);

export const VIEWS = ['vitrine', 'closet', 'stylist', 'board', 'social', 'tarefas',
  'vestiario', 'perfil', 'personagem', 'usuario'];

// Telas sem botão próprio na barra: acendem o botão de onde vieram.
const BOTAO_DA_VIEW = { usuario: 'social', personagem: 'perfil' };

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
  document.querySelectorAll('.view').forEach(s => { s.hidden = s.dataset.view !== view; });
  const aceso = BOTAO_DA_VIEW[view] || view;
  document.querySelectorAll('.sidebar-btn').forEach(b =>
    b.classList.toggle('ativa', b.dataset.goto === aceso));
  document.body.dataset.view = view;
  ganchos.get(view)?.();
}

export function iniciarRouter() {
  document.querySelectorAll('.sidebar-btn').forEach(b =>
    b.addEventListener('click', () => irPara(b.dataset.goto)));
  document.querySelector('.logo-mini')?.addEventListener('click', () => irPara('vitrine'));
  window.addEventListener('hashchange', () => aplicar(viewAtual()));
  aplicar(viewAtual());
}
