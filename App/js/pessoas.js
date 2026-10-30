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
//   * as publicações dela vêm do feed compartilhado (publicacoes.js), e não
//     do seu save — onde só moram as dos perfis fictícios;
//   * a página dela mostra o mesmo que o perfil dela mostra a ela: os amigos e
//     os favoritos (peças, looks e colagens com estrela), que só vêm na leitura
//     da página (`carregarPerfil`) — a busca e o feed trazem só o cartão.
//
// Nada aqui é chamado no carregamento do módulo — só em tempo de execução.

import { PERFIS_MOCK } from './config.js';
import * as db from './db.js';
import { LIMITE_FAVORITOS } from './favoritos.js';
import { roupasSorteadas } from './roupinhas.js';
import { sementeDoTexto } from './util.js';
import { miniaturaSoltaAtual } from './render.js';
import { meusLooks, minhasColagens, minhasRoupas } from './minhavitrine.js';

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
    bio: c.bio === 'garimpando peça por peça.' ? '' : c.bio || '',   // a bio padrão antiga
    corFavorita: c.corFavorita || '',
    real: true,
    criadoEm: c.criadoEm,
    aparencia: enviou ? c.avatar : undefined,
    roupas: enviou ? c.equipado : undefined,
    nSeguidores: c.seguidores,
    nSeguindo: c.seguindo,
    voceSegue: Boolean(c.voceSegue),
    segueVoce: Boolean(c.segueVoce),
    // Só a página completa traz estes; undefined quer dizer "não sei" (ou
    // versão antiga do app, que não manda).
    favoritos: c.favoritos,
    obras: c.obras,
    guardaRoupa: c.guardaRoupa,
    wishlist: c.wishlist,
    amigos: c.amigos?.map(a => guardar(a).id),
    listaSeguindo: c.listaSeguindo?.map(a => guardar(a).id),
    listaSeguidores: c.listaSeguidores?.map(a => guardar(a).id),
  };
}

function guardar(cartao) {
  const perfil = paraPerfil(cartao);
  // Um cartão curto (busca, feed, seguir) não apaga o que a página já trouxe.
  const antes = reais.get(perfil.id);
  if (antes) {
    for (const k of ['favoritos', 'obras', 'guardaRoupa', 'wishlist', 'amigos', 'listaSeguindo', 'listaSeguidores']) perfil[k] ??= antes[k];
  }
  reais.set(perfil.id, perfil);
  return perfil;
}

// O feed (publicacoes.js) traz o cartão de quem postou e de quem comentou:
// guardado aqui, o retrato e o perfil público dessas pessoas já funcionam.
export const guardarCartao = guardar;

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

// Quem segue você, a cada leitura que deu certo. Os avisos (js/avisos.js)
// comparam com a anterior; quem se inscreve depois do boot recebe a última na
// hora, sem pedir de novo ao servidor.
const leitoresDeSeguidores = new Set();
let ultimosSeguidores = null;
// Quantas contas reais seguem você, pela última leitura do servidor.
export const quantosMeSeguem = () => ultimosSeguidores?.length ?? 0;
// E quem são (os ids; os cartões ficam guardados, ver `guardar`).
export const quemMeSegue = () => ultimosSeguidores ?? [];

export function aoLerSeguidores(fn) {
  leitoresDeSeguidores.add(fn);
  if (ultimosSeguidores) fn(ultimosSeguidores);
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
  ultimosSeguidores = dados.seguidores.map(c => c.id).sort();
  leitoresDeSeguidores.forEach(fn => fn(ultimosSeguidores));

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
// A bio, o rosto, a roupa e os favoritos moram no save, e o save é meu — outra
// conta não o lê. Então o front manda o pedaço público, pequeno, sempre que ele
// muda.
const ESPERA_PERFIL = 3000;
let ultimoEnviado = '';
let timerPerfil = null;

// As miniaturas dos looks e colagens favoritos são data URLs no save: grandes
// demais para irem no perfil. Cada uma sobe uma vez (/api/perfil/miniatura) e
// o perfil leva só o caminho dela no site. O que já subiu fica lembrado neste
// navegador, pela impressão da imagem, para não subir de novo a cada visita.
const CHAVE_MINIATURAS = 'bd-miniaturas-publicas';
const impressao = (dataUrl) => `${sementeDoTexto(dataUrl).toString(16)}-${dataUrl.length}`;

function miniaturasSubidas() {
  try { return JSON.parse(localStorage.getItem(CHAVE_MINIATURAS) || '{}'); } catch { return {}; }
}

async function miniaturaPublica(thumb) {
  if (!thumb || !thumb.startsWith('data:image/')) return '';
  const chave = impressao(thumb);
  const subidas = miniaturasSubidas();
  if (subidas[chave]) return subidas[chave];
  try {
    const { thumb: caminho } = await chamar('/api/perfil/miniatura', {
      method: 'POST', body: JSON.stringify({ thumb }),
    });
    subidas[chave] = caminho;
    try { localStorage.setItem(CHAVE_MINIATURAS, JSON.stringify(subidas)); } catch {}
    return caminho;
  } catch (e) {
    console.warn('não consegui subir a miniatura do favorito.', e.message);
    return '';
  }
}

// Do mais novo para o mais velho, e só as vagas do perfil — como perfil.js.
const obrasFavoritas = (tipo) => db.favoritos(tipo)
  .sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm))
  .slice(0, LIMITE_FAVORITOS[tipo])
  .map(o => ({
    nome: o.nome || '',
    thumb: o.thumb || '',
    pecas: [...new Set((o.camadas || o.itens || []).map(c => c.itemId).filter(Boolean))],
  }));

// Todos os looks e colagens, na ordem do seu perfil (minhavitrine.js), com a
// estrela. O look vai como as camadas (`desenho`): a miniatura pública é ele solto,
// sem fundo, desenhado na hora de enviar (ver enviarPerfil).
const OBRAS_NO_PERFIL = 40;

const fotoDoPerfil = () => ({
  bio: db.state.usuario.bio || '',
  avatar: { ...db.state.usuario.avatar },
  corFavorita: db.state.usuario.corFavorita || '',
  equipado: db.roupasEquipadas(),
  favoritos: {
    pecas: db.favoritos('peca').map(p => p.id),
    looks: obrasFavoritas('look'),
    colagens: obrasFavoritas('colagem'),
  },
  obras: {
    looks: meusLooks().slice(0, OBRAS_NO_PERFIL).map(o => ({
      id: o.id,
      nome: o.nome || '',
      desenho: o.camadas || [],
      pecas: [...new Set((o.camadas || []).map(c => c.itemId).filter(Boolean))],
      favorito: Boolean(o.favorito),
    })),
    colagens: minhasColagens().slice(0, OBRAS_NO_PERFIL).map(o => ({
      id: o.id,
      nome: o.nome || '',
      thumb: o.thumb || '',
      pecas: [...new Set((o.itens || []).map(c => c.itemId).filter(Boolean))],
      favorito: Boolean(o.favorito),
    })),
  },
  guardaRoupa: minhasRoupas().map(p => p.id),
  wishlist: [...(db.state.wishlist || [])],
});

// A foto com cada miniatura trocada pela impressão: é o que diz se algo mudou
// sem carregar data URLs na comparação. O look desenhado depende do rosto,
// que já está na foto (avatar).
const assinatura = (foto) => JSON.stringify(foto, (k, v) =>
  k === 'thumb' && v ? impressao(v) : v);

// O look solto, sem fundo, com o personagem de agora (render.js).
async function thumbDoLook(camadas) {
  if (!camadas.length) return '';
  try { return await miniaturaSoltaAtual(camadas); } catch { return ''; }
}

async function enviarPerfil() {
  // Depois de sair da conta o estado volta ao inicial ('local-user'): não há
  // quem publicar.
  if (!db.state.usuario || db.state.usuario.id === 'local-user') return;
  const foto = fotoDoPerfil();
  const marca = assinatura(foto);
  if (marca === ultimoEnviado) return;
  try {
    // Miniatura que não subiu vai sem imagem agora e tenta de novo depois.
    let faltou = false;
    const { favoritos } = foto;
    for (const obra of foto.obras.looks) {
      obra.thumb = await thumbDoLook(obra.desenho);
      delete obra.desenho;
    }
    for (const obra of [...favoritos.looks, ...favoritos.colagens,
      ...foto.obras.looks, ...foto.obras.colagens]) {
      const tinha = obra.thumb;
      obra.thumb = await miniaturaPublica(tinha);
      if (tinha.startsWith('data:image/') && !obra.thumb) faltou = true;
    }
    await chamar('/api/perfil', { method: 'PUT', body: JSON.stringify(foto) });
    if (!faltou) ultimoEnviado = marca;
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
