// Avisos no celular (Web Push): o jogo avisa fora do app quando chega uma
// proposta de troca, um post-it novo no mural ou a vitrine do dia vira.
// Quem manda é a Lambda (nuvem/lambda/notificacoes.py); quem mostra é o
// service worker (sw.js). Aqui ficam o botão "Avisar no celular", no rodapé
// do sino, e o recado ao servidor de quando chega o próximo post-it.
//
// A permissão só é pedida quando a pessoa toca no botão: o iPhone não deixa
// pedir de outro jeito, e quem recusa um pedido surpresa não vê outro.
// No iPhone o push só existe com o jogo instalado na tela inicial.

import { MURAL } from './config.js';
import { missoes, proximaChegada, vagasDoNivel, completa } from './mural.js';
import * as db from './db.js';
import { $, toast } from './util.js';

const HORA = 3600e3;
const suporta = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const iphoneNoNavegador = () => /iPhone|iPad|iPod/.test(navigator.userAgent)
  && !(navigator.standalone || matchMedia('(display-mode: standalone)').matches);

let chave = null;          // a applicationServerKey (null: servidor sem push, como o local)
let inscricao = null;

async function api(rota, corpo) {
  const r = await fetch('/api/push/' + rota, {
    method: corpo ? 'POST' : 'GET', credentials: 'include',
    headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || 'falha ' + r.status);
  return r.json();
}

const deB64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

// Quando chega o próximo post-it de missão (ms), ou null se o mural não tem
// vaga e nada vai vencer (só missões feitas esperando o resgate).
function proximoPostit() {
  try {
    const agora = Date.now(), lista = missoes(), passo = MURAL.cadaHoras * HORA;
    let livreEm = agora;
    if (lista.length >= vagasDoNivel()) {
      const vencem = lista.filter(m => !completa(m)).map(m => m.vence);
      if (!vencem.length) return null;
      livreEm = Math.min(...vencem);
    }
    let t = proximaChegada();
    if (t < livreEm) t += Math.ceil((livreEm - t) / passo) * passo;
    return t;
  } catch { return null; }
}

// Conta ao servidor quando chega o próximo post-it (e que a pessoa está aqui).
let ultimoPostit, ultimoEnvio = 0;
function contarAgenda(forcar = false) {
  if (!inscricao || !db.state) return;
  const postit = proximoPostit();
  if (!forcar && postit === ultimoPostit && Date.now() - ultimoEnvio < 30 * 60e3) return;
  ultimoPostit = postit;
  ultimoEnvio = Date.now();
  api('agenda', { postit }).catch(() => {});
}

function pintar() {
  const btn = $('#avisos-celular'), dica = $('#avisos-celular-dica');
  if (!btn) return;
  btn.hidden = true;
  dica.hidden = true;
  if (!suporta()) {
    if (iphoneNoNavegador()) {
      dica.hidden = false;
      dica.textContent = 'No iPhone, instale o jogo na tela inicial (Compartilhar › Adicionar à Tela de Início) para receber avisos.';
    }
    return;
  }
  if (!chave) return;
  if (Notification.permission === 'denied') {
    dica.hidden = false;
    dica.textContent = 'Os avisos estão bloqueados neste navegador. Libere nas configurações do site.';
    return;
  }
  btn.hidden = false;
  btn.textContent = inscricao ? 'Avisos no celular ligados · desligar' : 'Avisar no celular';
  btn.classList.toggle('ligado', !!inscricao);
}

async function ligar() {
  const reg = await navigator.serviceWorker.ready;
  if (await Notification.requestPermission() !== 'granted') { pintar(); return; }
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: deB64(chave) });
  await api('inscrever', { endpoint: sub.endpoint, postit: proximoPostit() });
  inscricao = sub;
  toast('Pronto! Vamos avisar de trocas, post-its novos e da vitrine do dia.');
}

async function desligar() {
  const sub = inscricao;
  inscricao = null;
  await api('sair', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
  toast('Avisos no celular desligados.');
}

async function alternar() {
  const btn = $('#avisos-celular');
  btn.disabled = true;
  try { inscricao ? await desligar() : await ligar(); }
  catch (e) { toast('Não deu para ligar os avisos: ' + (e.message || e), 'aviso'); }
  btn.disabled = false;
  pintar();
}

export async function montarNotificacoes() {
  // Veio de um aviso de troca: abre o sino.
  const busca = new URLSearchParams(location.search);
  if (busca.has('sino')) {
    busca.delete('sino');
    const resto = busca.toString();
    history.replaceState(null, '', location.pathname + (resto ? '?' + resto : '') + location.hash);
    setTimeout(() => $('#avisos-btn')?.click(), 400);
  }

  $('#avisos-celular')?.addEventListener('click', (e) => { e.stopPropagation(); alternar(); });
  pintar();
  if (!suporta() || location.protocol === 'file:') return;
  try { chave = (await api('chave')).chave; } catch { chave = null; }
  if (!chave) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    inscricao = await reg.pushManager.getSubscription();
    // Permissão retirada pelo navegador: a inscrição velha não vale mais.
    if (inscricao && Notification.permission !== 'granted') inscricao = null;
  } catch { inscricao = null; }
  pintar();
  if (inscricao) {
    // Conta de novo a cada abertura: o aparelho pode ter trocado de conta.
    api('inscrever', { endpoint: inscricao.endpoint, postit: proximoPostit() }).catch(() => {});
    ultimoPostit = proximoPostit();
    ultimoEnvio = Date.now();
  }
  db.onChange(() => contarAgenda());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) contarAgenda(true); });
}
