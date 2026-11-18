// Sugestão de instalar o app, só no celular: logo depois do fim do tutorial e,
// para quem abre o site pelo navegador do celular, ao entrar (lembrarDeInstalar).
// "Agora não" guarda a data e a janela só volta depois de DIAS_SEM_LEMBRAR.
//
// Android (Chrome, Edge, Samsung): o navegador avisa que dá para instalar pelo
// evento beforeinstallprompt. Ele é guardado aqui, desde o boot, e o botão
// "Instalar" da janela abre a instalação do próprio navegador. Se o evento não
// veio (iPhone, outro navegador), o mesmo botão "Baixar" leva a um passo a passo
// que depende do navegador. PC e app já instalado: não mostra nada.

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

const cartao = (texto) => el('div', { class: 'instalar-cartao' },
  el('img', { class: 'instalar-logo', src: 'assets/app/icone-192.png', alt: 'Brechó', width: 72, height: 72 }),
  el('p', { class: 'pergunta-texto' }, texto));

// Passo a passo para quem não tem instalação em um clique. O texto muda com o
// navegador: no Safari o Compartilhar fica na barra de baixo; no Chrome do
// iPhone, no canto de cima; nos navegadores embutidos (Instagram etc.) não dá.
function passos() {
  const n = (i, txt) => el('div', { class: 'instalar-passo' }, el('span', { class: 'instalar-num' }, String(i)), el('span', {}, txt));
  const caixa = (...p) => el('div', { class: 'instalar-passos' }, ...p);
  if (/Instagram|FBAN|FBAV|Line\/|TikTok|Snapchat/.test(ua)) {
    return caixa(n(1, 'Este navegador não deixa instalar. Toque nos três pontinhos e escolha "Abrir no navegador".'),
      n(2, 'Lá, toque em Baixar de novo.'));
  }
  if (ehIos()) {
    const chrome = /CriOS|EdgiOS|FxiOS/.test(ua);
    return caixa(
      n(1, chrome ? 'Toque no ícone de compartilhar (quadrado com seta), no canto de cima.' : 'Toque em Compartilhar (quadrado com seta), na barra de baixo.'),
      n(2, 'Role a lista e escolha "Adicionar à Tela de Início".'),
      n(3, 'Toque em Adicionar, no canto de cima.'));
  }
  return caixa(
    n(1, 'Abra o menu do navegador (⋮).'),
    n(2, 'Escolha "Instalar app" ou "Adicionar à tela inicial".'),
    n(3, 'Confirme em Instalar.'));
}

export async function sugerirInstalar() {
  if (instalado() || !(ehIos() || ehAndroid())) return;
  adiar();
  // O mesmo botão Baixar em todo celular: com instalação em um clique ela
  // abre na hora; sem, o botão leva ao passo a passo.
  const sim = await confirmar(cartao('Fica na tela inicial e abre em tela cheia, como um app.'),
    { titulo: 'Brechó', sim: 'Baixar', nao: 'Agora não' });
  if (!sim) return;
  if (pedido) { const p = pedido; pedido = null; p.prompt(); return; }
  await mostrar(passos(), { titulo: 'Baixar o Brechó' });
}
