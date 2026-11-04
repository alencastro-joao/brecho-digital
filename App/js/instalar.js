// Sugestão de instalar o app, só no celular: logo depois do fim do tutorial e,
// para quem abre o site pelo navegador do celular, ao entrar (lembrarDeInstalar).
// "Agora não" guarda a data e a janela só volta depois de DIAS_SEM_LEMBRAR.
//
// Android (Chrome, Edge, Samsung): o navegador avisa que dá para instalar pelo
// evento beforeinstallprompt. Ele é guardado aqui, desde o boot, e o botão
// "Instalar" da janela abre a instalação do próprio navegador. Se o evento não
// veio (outro navegador), a janela ensina o caminho pelo menu.
// iPhone/iPad: o Safari não tem esse evento; a janela ensina o "Compartilhar ›
// Adicionar à Tela de Início". PC e app já instalado: não mostra nada.

import { el } from './util.js';
import { confirmar, mostrar } from './janela.js';

let pedido = null;   // o beforeinstallprompt guardado
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); pedido = e; });
window.addEventListener('appinstalled', () => { pedido = null; });

const ua = navigator.userAgent;
// iPad novo se diz Mac; o que entrega é a tela de toque.
const ehIos = () => /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const ehAndroid = () => /Android/.test(ua);
const instalado = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

const passos = (...itens) => el('div', {},
  el('p', { class: 'pergunta-texto' }, 'Com o Brechó na tela inicial, ele abre em tela cheia, como um app.'),
  el('ol', { class: 'pergunta-texto instalar-passos' }, itens.map(t => el('li', {}, t))));

const CHAVE = 'bd-instalar-adiado';
const DIAS_SEM_LEMBRAR = 3;

function adiadoAte() {
  try { return Number(localStorage.getItem(CHAVE)) || 0; } catch { return 0; }
}
function adiar() {
  try { localStorage.setItem(CHAVE, String(Date.now() + DIAS_SEM_LEMBRAR * 864e5)); } catch { /* aba anônima */ }
}

// No boot: celular, no navegador, sem ter fechado a janela há pouco. Espera uns
// segundos (o Chrome manda o beforeinstallprompt um pouco depois de carregar e
// a vitrine abre primeiro) e não entra por cima de outra janela aberta.
export function lembrarDeInstalar() {
  if (instalado() || !(ehIos() || ehAndroid()) || Date.now() < adiadoAte()) return;
  setTimeout(() => {
    if (instalado() || document.querySelector('.modal:not([hidden])')) return;
    sugerirInstalar();
  }, 6000);
}

export async function sugerirInstalar() {
  if (instalado()) return;
  adiar();
  if (ehIos()) {
    await mostrar(passos(
      'Toque no botão Compartilhar do navegador (o quadrado com a seta para cima).',
      'Escolha "Adicionar à Tela de Início".',
      'Toque em "Adicionar".'), { titulo: 'Instale o Brechó no iPhone' });
  } else if (ehAndroid()) {
    if (pedido) {
      const sim = await confirmar('Instale o Brechó no celular: ele fica na tela inicial e abre em tela cheia, como um app.',
        { titulo: 'Instale o Brechó', sim: 'Instalar', nao: 'Agora não' });
      if (sim && pedido) { const p = pedido; pedido = null; p.prompt(); }
    } else {
      await mostrar(passos(
        'Toque no menu do navegador (os três pontinhos).',
        'Escolha "Instalar app" ou "Adicionar à tela inicial".',
        'Confirme em "Instalar".'), { titulo: 'Instale o Brechó no celular' });
    }
  }
}
