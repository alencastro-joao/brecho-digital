// Contas conectadas: Instagram e Pinterest, ligados de verdade por OAuth.
//
// Conectar é navegar para /api/redes/<rede>/entrar: o servidor manda para o
// login da rede e, na volta, troca o código por um token, lê o @ verdadeiro e
// devolve a pessoa para /?rede=<rede>#/perfil (ver nuvem/lambda/redes.py). O
// token nunca chega aqui; o save guarda só o espelho do @ (db.conectar), e é o
// servidor quem diz o que está ligado (GET /api/redes).

import { SERVICOS } from './config.js';
import * as db from './db.js';
import { el, $, toast } from './util.js';

let doServidor = null;     // GET /api/redes: { instagram: { pronto, ligado, usuario, em } }
let aoMudar = null;

// ============================ Redes no perfil =============================
// O que aparece embaixo da bio, na sua página e na de quem você visita: as
// contas de fora que a pessoa ligou. Só o selo — não é link. Os perfis do feed
// são fictícios, e mandar alguém para um @ de verdade no Instagram levaria a
// uma pessoa que não tem nada a ver com isso. Quando houver OAuth, é aqui que
// o endereço real entra.
export const chipsDeRedes = (redes) => redes
  .filter(r => SERVICOS[r.id])
  .map(r => el('span', {
    class: 'rede-chip',
    style: { '--servico': SERVICOS[r.id].cor },
    title: SERVICOS[r.id].nome,
  },
    el('span', { class: 'conexao-ponto' }),
    el('strong', {}, SERVICOS[r.id].nome),
    el('small', {}, '@' + String(r.usuario || '').replace(/^@+/, ''))
  ));

// As suas: as que estão realmente ligadas em db.state.conexoes.
export const minhasRedes = () => Object.keys(SERVICOS)
  .filter(id => db.estaLigado(id))
  .map(id => ({ id, usuario: db.state.conexoes[id].usuario }));

// ================================ Cartões =================================
export function renderConexoes(callback) {
  if (callback) aoMudar = callback;
  const lista = $('#conexao-lista');
  if (!lista) return;
  lista.innerHTML = '';

  for (const [id, s] of Object.entries(SERVICOS)) {
    const c = db.state.conexoes[id] || { ligado: false };
    const pronto = doServidor?.[id]?.pronto !== false;
    const cartao = el('div', {
      class: 'conexao' + (c.ligado ? ' ligada' : ''),
      style: { '--servico': s.cor },
    },
      el('div', { class: 'conexao-topo' },
        el('span', { class: 'conexao-ponto' }),
        el('div', { class: 'conexao-nome' },
          el('strong', {}, s.nome),
          el('small', {}, s.papel)
        ),
        c.ligado ? el('span', { class: 'conexao-selo' }, 'ligado') : null
      ),

      el('p', { class: 'conexao-resumo' },
        c.ligado
          ? `como @${c.usuario} · desde ${new Date(c.em).toLocaleDateString('pt-BR')}`
          : pronto ? s.resumo : 'Em breve.'),

      el('div', { class: 'conexao-acoes' },
        c.ligado
          ? el('button', { class: 'btn-ghost', onclick: () => desligar(id) }, 'Desconectar')
          : el('button', { class: 'btn-dark', disabled: !pronto, onclick: () => entrar(id) }, `Conectar ${s.nome}`))
    );
    lista.append(cartao);
  }
}

// O login acontece na página da rede: sai do app e volta depois.
function entrar(id) {
  location.href = `/api/redes/${id}/entrar`;
}

async function desligar(id) {
  try {
    const r = await fetch(`/api/redes/${id}/sair`, { method: 'POST', credentials: 'include' });
    if (r.ok) doServidor = await r.json();
  } catch { /* sem rede: desliga aqui e o servidor acerta na próxima leitura */ }
  db.desconectar(id);
  renderConexoes();
  aoMudar?.();
  toast(`${SERVICOS[id].nome} desconectado.`);
}

// O servidor é quem sabe o que está ligado: o espelho do save segue ele.
async function sincronizar() {
  try {
    const r = await fetch('/api/redes', { credentials: 'include' });
    if (!r.ok) return;
    doServidor = await r.json();
  } catch { return; }
  let mudou = false;
  for (const id of Object.keys(SERVICOS)) {
    const srv = doServidor[id];
    if (!srv) continue;
    const local = db.state.conexoes[id] || {};
    if (srv.ligado && (local.usuario !== srv.usuario || !local.ligado)) {
      db.conectar(id, srv.usuario);
      if (srv.em) db.state.conexoes[id].em = srv.em;
      mudou = true;
    } else if (!srv.ligado && local.ligado) {
      db.desconectar(id);
      mudou = true;
    }
  }
  renderConexoes();
  if (mudou) aoMudar?.();
}

const ERROS = {
  config: 'ainda não está pronto para conectar',
  recusou: 'não foi autorizado',
  falhou: 'não conseguiu confirmar a conta. Lembre que o Instagram só liga conta profissional',
  sessao: 'precisa que você entre na sua conta antes',
};

export async function montarConexoes() {
  // A volta do login da rede: /?rede=instagram&ok=1#/perfil
  const q = new URLSearchParams(location.search);
  const rede = q.get('rede');
  if (rede) history.replaceState(null, '', location.pathname + location.hash);
  await sincronizar();
  if (!SERVICOS[rede]) return;
  const nome = SERVICOS[rede].nome;
  if (q.get('ok')) toast(`${nome} conectado como @${db.state.conexoes[rede]?.usuario || ''}.`);
  else toast(`O ${nome} ${ERROS[q.get('erro')] || ERROS.falhou}.`, 'aviso');
}
