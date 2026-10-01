// Pessoas de verdade: as contas que existem no servidor.
//
// Até aqui o app só conhecia os perfis fictícios do feed (PERFIS_MOCK). Uma conta
// real — a do amigo que você chamou para testar — não aparecia em lugar nenhum:
// o login sabia quem ela era, mas nada a expunha aos outros. Este módulo é a
// ponte. Ele fala com as rotas de pessoas (nuvem/lambda/pessoas.py, e o espelho
// local em tools/pessoas.py) e devolve cada conta no MESMO formato dos perfis
// fictícios, com `real: true` — então o resto do app (retrato, perfil público,
// amigos, seguir) trata os dois do mesmo jeito e só olha a bandeira onde os
// dados de fato diferem.
//
// O que é diferente numa conta real:
//   * os números (seguidores, seguindo) vêm do servidor, não da semente do id;
//   * "segue você" é um fato — o outro lado seguiu de verdade — e não um sorteio;
//   * rosto e roupa são os que a pessoa escolheu, enviados por ela mesma (ver
//     `agendarPerfil`); enquanto ela nunca enviou, cai no sorteio do id, como
//     qualquer perfil fictício;
//   * ela não tem colagens no seu feed: o feed de cada um ainda é local, e o
//     que uma conta publica não chega às outras. Isso é o próximo passo do
//     grafo social, não deste.
//
// Nada aqui é chamado no carregamento do módulo — só em tempo de execução.

import { PERFIS_MOCK } from './config.js';
import * as db from './db.js';
import { roupasSorteadas } from './roupinhas.js';
import { sementeDoTexto } from './util.js';

// Id de conta real: 'u-' e 16 hexadecimais (contas.py). Os fictícios são
// 'u-lia', 'u-tom'... e nunca casam.
const ID_REAL = /^u-[0-9a-f]{16}$/;

const PALETA = PERFIS_MOCK.map(p => p.cor);
const corDe = (id) => PALETA[sementeDoTexto(id) % PALETA.length];

// id → perfil, de tudo que o servidor já mostrou nesta sessão.
const reais = new Map();

export const ehFicticio = (id) => PERFIS_MOCK.some(p => p.id === id);
export const perfilDe = (id) => PERFIS_MOCK.find(p => p.id === id) || reais.get(id);

// Dá para abrir a página de quem ainda não foi carregado: a tela busca no
// servidor. Só não dá para abrir um id que nem parece de uma conta.
export const podeAbrir = (id) => Boolean(perfilDe(id)) || ID_REAL.test(String(id || ''));

// O que o retrato e o avatar vestem. Conta que nunca enviou o perfil cai no
// sorteio do id, como os fictícios.
export const roupasDoPerfil = (p) => p.roupas ?? roupasSorteadas(p.id);

// ------------------------------- O cartão ---------------------------------
function paraPerfil(c) {
  // O avatar sempre tem chaves quando a pessoa enviou (são cinco); vazio quer
  // dizer "nunca enviou". Roupa vazia, ao contrário, é uma escolha: pelada.
  const enviou = c.avatar && Object.keys(c.avatar).length > 0;
  return {
    id: c.id,
    nome: c.nome,
    handle: c.handle,
    cor: corDe(c.id),
    bio: c.bio || '',
    real: true,
    criadoEm: c.criadoEm,
    aparencia: enviou ? c.avatar : undefined,
    roupas: enviou ? c.equipado : undefined,
    nSeguidores: c.seguidores,
    nSeguindo: c.seguindo,
    voceSegue: Boolean(c.voceSegue),
    segueVoce: Boolean(c.segueVoce),
  };
}

function guardar(cartao) {
  const perfil = paraPerfil(cartao);
  reais.set(perfil.id, perfil);
  return perfil;
}

async function chamar(rota, opcoes = {}) {
  const r = await fetch(rota, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...opcoes,
  });
  if (!r.ok) {
    const erro = new Error((await r.json().catch(() => ({}))).erro || 'HTTP ' + r.status);
    erro.status = r.status;
    throw erro;
  }
  return r.json();
}

// ------------------------------- Procurar ---------------------------------
// Sem termo, as contas mais novas — é o que a tela mostra antes de digitar.
export async function buscarReais(termo = '') {
  const { usuarios } = await chamar('/api/usuarios?q=' + encodeURIComponent(termo));
  return usuarios.map(guardar);
}

export async function carregarPerfil(id) {
  const { usuario } = await chamar('/api/usuarios/' + encodeURIComponent(id));
  return guardar(usuario);
}

// ------------------------------- Seguir -----------------------------------
export async function seguirNoServidor(id, segue) {
  const { usuario } = await chamar('/api/seguir', {
    method: 'POST', body: JSON.stringify({ id, segue }),
  });
  return guardar(usuario);
}

// Casa a lista de quem você segue com a do servidor. Os fictícios só existem no
// save (não há o que perguntar ao servidor); as contas reais são do servidor,
// e ele vence: seguir de um aparelho tem que valer no outro, e deixar de seguir
// também. Devolve se algo mudou, para quem chamou saber se precisa repintar.
export async function sincronizarSocial() {
  let dados;
  try {
    dados = await chamar('/api/social');
  } catch (e) {
    // Servidor sem a rota (versão antiga) ou fora do ar: o app segue como estava.
    console.warn('não consegui ler quem você segue no servidor.', e.message);
    return false;
  }

  dados.seguindo.forEach(guardar);
  dados.seguidores.forEach(guardar);

  const u = db.state.usuario;
  const antes = JSON.stringify(u.seguindo);
  u.seguindo = [
    ...u.seguindo.filter(ehFicticio),
    ...dados.seguindo.map(c => c.id),
  ];
  if (JSON.stringify(u.seguindo) === antes) return false;
  db.salvar();
  return true;
}

// ------------------------- O que os outros leem de mim ---------------------
// A bio, o rosto e a roupa moram no save, e o save é meu — outra conta não o
// lê. Então o front manda o pedaço público, pequeno, sempre que ele muda.
const ESPERA_PERFIL = 3000;
let ultimoEnviado = '';
let timerPerfil = null;

const fotoDoPerfil = () => JSON.stringify({
  bio: db.state.usuario.bio || '',
  avatar: { ...db.state.usuario.avatar },
  equipado: db.roupasEquipadas(),
});

async function enviarPerfil() {
  // Depois de sair da conta o estado volta ao inicial ('local-user'): não há
  // quem publicar.
  if (!db.state.usuario || db.state.usuario.id === 'local-user') return;
  const foto = fotoDoPerfil();
  if (foto === ultimoEnviado) return;
  try {
    await chamar('/api/perfil', { method: 'PUT', body: foto });
    ultimoEnviado = foto;
  } catch (e) {
    console.warn('não consegui publicar o seu perfil.', e.message);
  }
}

// Chamado a cada gravação do save (db.onChange): quase todas não mexem no
// perfil, e para isso serve comparar com o último enviado antes de gastar a
// requisição.
export function agendarPerfil() {
  clearTimeout(timerPerfil);
  timerPerfil = setTimeout(enviarPerfil, ESPERA_PERFIL);
}
