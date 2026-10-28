// Sugestão de instalar o app, só no celular: logo depois do fim do tutorial e,
// para quem já passou dele, numa janela ao abrir o site pelo navegador
// (lembrarDeInstalar), no máximo uma vez a cada INTERVALO.
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

const INTERVALO = 3 * 24 * 3600e3;   // 3 dias entre uma sugestão e outra
const CHAVE = 'brecho:instalar-sugerido';
const ultimaVez = () => { try { return Number(localStorage.getItem(CHAVE)) || 0; } catch { return 0; } };
const marcar = () => { try { localStorage.setItem(CHAVE, String(Date.now())); } catch { /* sem storage */ } };

// No boot, fora do tutorial: espera a loja abrir (e o Android mandar o
// beforeinstallprompt) e só abre se nenhuma outra janela estiver na tela.
export function lembrarDeInstalar() {
  if (instalado() || !(ehIos() || ehAndroid())) return;
  if (Date.now() - ultimaVez() < INTERVALO) return;
  setTimeout(() => {
    if (document.body.classList.contains('com-modal')) return;
    sugerirInstalar();
  }, 6000);
}

export async function sugerirInstalar() {
  if (instalado()) return;
  marcar();
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
