// Camada de persistência do protótipo.
//
// Tudo fica em localStorage, mas o formato já imita o que vai para o DynamoDB:
// um registro por usuário, com inventário, looks, estado diário e social.
// Trocar por uma API (Lambda + API Gateway) é substituir carregar()/salvar() —
// e só isso: nenhuma tela chama localStorage, todas passam por aqui.
//
// O registro é por conta: a chave é `bd:v1:estado:<id do usuário>`, o mesmo id
// que o banco de contas dá no login (ver js/auth.js e tools/contas.py). Duas
// pessoas no mesmo navegador têm dois guarda-roupas; a mesma pessoa em dois
// navegadores ainda tem dois, porque o save é local — é exatamente esse o
// buraco que a nuvem fecha, e por isso carregar/salvar já estão isolados.
//
// Nada é lido antes de `iniciarEstado(conta)`, que o boot chama depois de saber
// quem entrou. Até lá `state` existe (as telas importam a referência no topo do
// arquivo) mas está no estado inicial.

import { hojeISO, mulberry32, sementeDoDia } from './util.js';
import {
  RARIDADES, MISSOES, COLLAB, ASSINATURA_PADRAO, APARENCIA_PADRAO,
  XP_BONUS_DIA, nivelPorXP, progressoDoNivel, nivelDaFerramenta, migrarCategoria,
} from './config.js';
import {
  ROUPINHAS, ROUPINHA, ORDEM_SLOTS, VESTIARIO_PADRAO, estadoDoDesbloqueio,
} from './roupinhas.js';

const CHAVE_BASE = 'bd:v1:estado';

// Definida por iniciarEstado(). Enquanto for nula, salvar() não grava nada:
// sem saber de quem é o estado, gravar é gravar por cima de alguém.
let chave = null;
const chaveDe = (id) => `${CHAVE_BASE}:${id}`;

function estadoInicial() {
  return {
    schema: 1,
    // Quando este save foi gravado. É o que decide quem ganha quando o save
    // daqui e o da nuvem discordam — ver sincronizarDaNuvem().
    atualizadoEm: null,
    // Quando o presente de boas-vindas foi entregue (ver js/presente.js). Nulo =
    // ainda não. É o que garante que ninguém ganhe duas vezes, mesmo depois de
    // devolver tudo para a loja ou de abrir o save em outro navegador.
    boasVindas: null,
    usuario: {
      id: 'local-user',
      nome: 'Você',
      handle: '@voce',
      bio: 'garimpando peça por peça.',   // o que os outros leem no seu perfil
      criadoEm: new Date().toISOString(),
      seguindo: [],
      seguidores: 12,
      assinatura: { ...ASSINATURA_PADRAO },   // padrão de quem assina as colagens
      preferencias: {
        sombra: true,               // padrão da sombra nas peças da colagem
        agrupamento: 'tipo',        // telas de roupa por 'tipo' de peça ou parte do 'corpo'
        // ordem: o "Organizar" das telas de roupa (ordenacao.js); sem valor, vale o antigo do closet
      },
      avatar: { ...APARENCIA_PADRAO },        // pele, corte, cor do cabelo e nariz
    },
    // Roupinhas: o que está vestido (lugar do corpo → id da peça), quais o
    // jogador já viu abrir e em que ordem ele arrumou o saco. O que está
    // *liberado* não mora aqui — é lido do progresso, como o nível é lido do
    // XP (ver roupinhaLiberada).
    vestiario: { equipado: { ...VESTIARIO_PADRAO }, conhecidas: [], novas: [], ordem: [] },
    inventario: [],            // { id, cat, raridade, obtidoEm, origem, ordem }
    pecasProprias: [],         // peças que você mesmo subiu: { id, cat, marca, nome, src, w, h, ancora }
    marcas: [],                // marcas já usadas: { nome, usos, em }
    cores: [],                 // cores já usadas: { nome, usos, em }
    dia: { data: hojeISO(), resgates: 0, posicoes: {} },   // posicoes: peça arrastada no mural
    looks: [],                 // { id, nome, criadoEm, camadas[], thumb, publicado }
    boards: [],                // colagens: { id, nome, formato, margem, assinatura, itens[], guias }
    feed: [],                  // posts (meus + dos perfis fictícios)
    conexoes: {                // contas de fora ligadas ao perfil
      instagram: { ligado: false, usuario: '', em: null },
      pinterest: { ligado: false, usuario: '', em: null },
    },
    missoes: missoesDoDia(),   // zera na virada do dia (ver virarODiaSeNecessario)
    progresso: { xp: 0, nivelVisto: 1 },   // xp só sobe; o nível é derivado dele
    collab: { mes: COLLAB.mes, liberada: false },
    stats: { resgates: 0, looks: 0, publicacoes: 0, diasCompletos: 0 },
  };
}

// Registro diário das missões: um bloco por data, para a virada do dia ser
// só trocar o bloco (e para dar pra guardar histórico depois).
function missoesDoDia(data = hojeISO()) {
  return {
    data,
    progresso: Object.fromEntries(MISSOES.map(m => [m.id, 0])),
    pagas: [],          // missões cujo XP já foi creditado hoje
    bonusPago: false,   // bônus de fechar o dia inteiro
  };
}

function carregar() {
  try {
    const bruto = chave && localStorage.getItem(chave);
    if (!bruto) return estadoInicial();
    const salvo = JSON.parse(bruto);
    const base = estadoInicial();
    const estado = { ...base, ...salvo };
    // Chaves novas (missões, assinatura) precisam existir mesmo em save antigo.
    // Save antigo guardava missoes como mapa plano id->contagem, sem data:
    // esse formato não tem como virar o dia, então recomeça zerado.
    estado.missoes = salvo.missoes?.progresso
      ? { ...base.missoes, ...salvo.missoes,
          progresso: { ...base.missoes.progresso, ...salvo.missoes.progresso } }
      : base.missoes;
    estado.progresso = { ...base.progresso, ...(salvo.progresso || {}) };
    estado.stats = { ...base.stats, ...(salvo.stats || {}) };
    estado.usuario = { ...base.usuario, ...(salvo.usuario || {}) };
    estado.usuario.assinatura = { ...base.usuario.assinatura, ...(salvo.usuario?.assinatura || {}) };
    estado.usuario.avatar = { ...base.usuario.avatar, ...(salvo.usuario?.avatar || {}) };
    estado.usuario.preferencias = { ...base.usuario.preferencias, ...(salvo.usuario?.preferencias || {}) };
    estado.conexoes = { ...base.conexoes, ...(salvo.conexoes || {}) };
    // Save anterior ao inventário entra vestido com o básico, não pelado.
    estado.vestiario = { ...base.vestiario, ...(salvo.vestiario || {}) };
    estado.vestiario.equipado = salvo.vestiario?.equipado ?? { ...VESTIARIO_PADRAO };
    // Save de quando a peça tinha paleta guardava { id, cor }; agora a cor é
    // da peça, e o que se veste é só o id.
    for (const [slot, eq] of Object.entries(estado.vestiario.equipado)) {
      if (eq && typeof eq === 'object') estado.vestiario.equipado[slot] = eq.id;
    }
    // Save de quando eram sete lugares do corpo: rosto e maos viraram um
    // acessorio so, e costas virou cintura. Sem isto a peca continua gravada
    // numa chave que nao existe mais e o avatar volta sem ela.
    const RENOMEADOS = { rosto: 'acessorio', maos: 'acessorio', costas: 'cintura' };
    for (const [antigo, novo] of Object.entries(RENOMEADOS)) {
      const id = estado.vestiario.equipado[antigo];
      delete estado.vestiario.equipado[antigo];
      if (id && !estado.vestiario.equipado[novo]) estado.vestiario.equipado[novo] = id;
    }
    // Save de antes das categorias atuais: 'tops' virou Camisas, 'acc' virou
    // Óculos e 'rings' virou Pulseiras (ver migrarCategoria em config.js). Toda
    // cópia de `cat` que o save guarda passa por aqui.
    const pecasComCat = [
      ...(estado.inventario || []), ...(estado.pecasProprias || []),
      ...(estado.looks || []).flatMap(l => l?.camadas || []),
      ...(estado.boards || []).flatMap(b => b?.itens || []),
    ];
    for (const p of pecasComCat) if (p?.cat) p.cat = migrarCategoria(p.cat);
    return estado;
  } catch {
    return estadoInicial();
  }
}

// A identidade deste objeto nunca muda: as telas fazem `db.state.inventario` a
// partir de um import que aconteceu no boot. Trocar de conta troca o *conteúdo*
// (ver iniciarEstado), nunca a referência.
export const state = estadoInicial();

const ouvintes = new Set();
export const onChange = (fn) => { ouvintes.add(fn); return () => ouvintes.delete(fn); };

// O save de antes das contas, quando havia um estado só no navegador. A
// primeira conta que entrar nesta máquina o adota — senão quem já vinha jogando
// abriria a conta nova com o guarda-roupa vazio e acharia que perdeu tudo.
function herdarSaveAntigo() {
  const antigo = localStorage.getItem(CHAVE_BASE);
  if (!antigo) return;
  // Já herdado por outra conta: o save antigo não é mais de ninguém, e some.
  if (Object.keys(localStorage).some(k => k.startsWith(CHAVE_BASE + ':'))) {
    localStorage.removeItem(CHAVE_BASE);
    return;
  }
  // Mudar de chave, não copiar. Uma partida inteira carrega as miniaturas dos
  // looks e das colagens e chega perto da cota do navegador sozinha: guardar
  // duas cópias — ainda que só por um instante, como backup — estoura. Por isso
  // a chave velha sai antes de a nova entrar.
  try {
    localStorage.removeItem(CHAVE_BASE);
    localStorage.setItem(chave, antigo);
  } catch (e) {
    // Nem assim coube (outra aba escrevendo, cota já no limite): devolve o save
    // para onde ele estava. Ninguém perde partida por causa de uma migração.
    try { localStorage.setItem(CHAVE_BASE, antigo); } catch { /* sem volta */ }
    console.warn('Não consegui herdar o save anterior às contas.', e);
  }
}

// Chamado pelo boot logo depois do login, e de novo a cada troca de conta.
// `conta` é o que /api/auth/eu devolve: { id, nome, handle, email, papel }.
export function iniciarEstado(conta) {
  chave = chaveDe(conta.id);
  herdarSaveAntigo();

  const carregado = carregar();
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, carregado);

  // A data que estava gravada no disco, antes de qualquer coisa desta sessão
  // mexer nela. É com ela que sincronizarDaNuvem() compara — e não com
  // `state.atualizadoEm`, que o `salvar()` no fim desta função já teria
  // trocado pela de agora. Comparar com a de agora faria um save vazio recém
  // aberto parecer mais novo que a nuvem, e apagaria o guarda-roupa de verdade.
  carregadoEm = carregado.atualizadoEm || '';

  // Quem a pessoa é vem da conta, não do save: nome e @ mudam no banco (tela de
  // perfil → PUT /api/auth/eu) e o estado local só acompanha. O que é do jogo —
  // bio, avatar, assinatura, preferências — continua sendo do save.
  state.usuario.id = conta.id;
  state.usuario.nome = conta.nome;
  state.usuario.handle = conta.handle;
  state.usuario.email = conta.email;
  state.usuario.papel = conta.papel;
  state.usuario.criadoEm = state.usuario.criadoEm || conta.criadoEm;

  virarODiaSeNecessario();
  salvar();
  return state;
}

// Sair devolve o estado ao inicial na memória, sem tocar no disco: o save da
// conta fica lá, esperando o próximo login dela.
export function encerrarEstado() {
  // O que estava por subir sobe agora: sair da conta não é motivo para perder
  // os últimos segundos. Depois a trava volta — sem conta não se escreve nada.
  despedir();
  clearTimeout(timerEnvio);
  sincronizado = false;
  sujo = false;
  carregadoEm = '';
  chave = null;
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, estadoInicial());
}

export function salvar() {
  if (!chave) return;               // ninguém logado: não há onde gravar
  state.atualizadoEm = new Date().toISOString();
  try {
    localStorage.setItem(chave, JSON.stringify(state));
  } catch (e) {
    // Quota estourada costuma ser culpa das miniaturas dos looks.
    console.warn('Não consegui salvar (quota?). Descartando miniaturas.', e);
    state.looks.forEach(l => delete l.thumb);
    state.boards.forEach(b => delete b.thumb);
    state.feed.forEach(p => { if (p.autor === state.usuario.id) delete p.thumb; });
    try { localStorage.setItem(chave, JSON.stringify(state)); } catch {}
  }
  agendarEnvio();
  ouvintes.forEach(fn => fn(state));
}


// --- A nuvem --------------------------------------------------------------
// O localStorage continua sendo a verdade da sessão: grava na hora, funciona
// sem rede, e é dele que as telas leem. A nuvem (`GET`/`PUT /api/estado`) é a
// cópia durável — é ela que faz a mesma conta abrir o mesmo guarda-roupa no
// celular e no computador, o buraco que o protótipo tinha.
//
// Só sobe alguns segundos depois de a pessoa parar de mexer. Arrastar uma peça
// pela vitrine chama salvar() dezenas de vezes; sem a espera seriam dezenas de
// requisições para gravar o mesmo estado final.
const ESPERA_ENVIO = 4000;

let sincronizado = false;   // trava: antes de ler a nuvem, não se escreve nela
let timerEnvio = null;
let enviando = null;
let sujo = false;
let carregadoEm = '';       // a data que o save tinha no disco ao abrir

function agendarEnvio() {
  if (!sincronizado) return;
  sujo = true;
  clearTimeout(timerEnvio);
  timerEnvio = setTimeout(enviar, ESPERA_ENVIO);
}

async function enviar() {
  if (!chave || !sincronizado || !sujo) return;
  if (enviando) return enviando.then(enviar);   // um de cada vez, na ordem
  sujo = false;
  const corpo = JSON.stringify({ estado: state });
  enviando = fetch('/api/estado', {
    method: 'PUT', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: corpo,
  }).then(r => {
    // Sessão vencida ou save grande demais: o jogo não para por isso. O save
    // local está gravado, e a próxima tentativa vai junto com a próxima mexida.
    if (!r.ok) console.warn('não consegui gravar o save na nuvem:', r.status);
  }).catch(e => {
    sujo = true;                       // sem rede: tenta de novo na próxima
    console.warn('sem conexão para gravar o save:', e.message);
  }).finally(() => { enviando = null; });
  return enviando;
}

// Fechar a aba não pode custar os últimos segundos de jogo. `keepalive` deixa a
// requisição sair mesmo com a página morrendo; é o que sobrou de útil do
// sendBeacon depois que ele perdeu o direito de mandar Content-Type.
function despedir() {
  if (!chave || !sincronizado || !sujo) return;
  clearTimeout(timerEnvio);
  sujo = false;
  try {
    fetch('/api/estado', {
      method: 'PUT', credentials: 'include', keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: state }),
    });
  } catch { /* aba já indo embora */ }
}

if (typeof window !== 'undefined') {
  // pagehide, e não unload: é o único que o Safari e o iOS respeitam, e é o
  // que não impede a página de entrar no cache de navegação.
  window.addEventListener('pagehide', despedir);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') despedir();
  });
}

/**
 * Casa o save daqui com o da nuvem. Roda uma vez por login, antes de qualquer
 * tela ser montada — daí em diante `salvar()` já sobe sozinho.
 *
 * Ganha o mais novo, pelo `atualizadoEm`. Não é fusão: fundir dois guarda-roupas
 * divergentes dá um terceiro que não é o de ninguém — e o caso real aqui não é
 * edição simultânea em dois lugares, é a mesma pessoa trocando de aparelho.
 */
export async function sincronizarDaNuvem() {
  if (!chave) return { estado: 'sem conta' };
  let nuvem = null;
  try {
    const r = await fetch('/api/estado', { credentials: 'include' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    nuvem = await r.json();
  } catch (e) {
    // Sem nuvem o jogo roda igual ao protótipo: local, e só. Mas não liberamos
    // o envio — subir sem ter lido é como apagar o save do outro aparelho.
    console.warn('não consegui ler o save da nuvem; seguindo com o local.', e.message);
    return { estado: 'offline' };
  }

  const daquiEm = carregadoEm;
  const dalaEm = nuvem.atualizadoEm || '';

  if (nuvem.estado && dalaEm > daquiEm) {
    // Passa pelo localStorage de propósito: `carregar()` é quem sabe migrar
    // save antigo (missões, vestiário, slots renomeados). Trazer da nuvem sem
    // ele seria reimplementar essas migrações aqui.
    localStorage.setItem(chave, JSON.stringify(nuvem.estado));
    const trazido = carregar();
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, trazido);
    carregadoEm = dalaEm;
    sincronizado = true;
    ouvintes.forEach(fn => fn(state));
    return { estado: 'veio da nuvem', em: dalaEm };
  }

  sincronizado = true;
  // Local mais novo (ou nuvem vazia): a nuvem é que está atrasada.
  if (daquiEm > dalaEm || !nuvem.estado) {
    sujo = true;
    await enviar();
    return { estado: nuvem.estado ? 'subiu o local' : 'primeira vez na nuvem' };
  }
  return { estado: 'iguais' };
}

// --- Dia ------------------------------------------------------------------
export function virarODiaSeNecessario() {
  const hoje = hojeISO();
  if (state.dia.data !== hoje) {
    state.dia = { data: hoje, resgates: 0, posicoes: {} };
    state.missoes = missoesDoDia(hoje);   // vitrine nova, missões novas
    salvar();
    return true;
  }
  // Save aberto de ontem: o dia não mudou, mas as missões podem ser de outra data.
  if (state.missoes.data !== hoje) {
    state.missoes = missoesDoDia(hoje);
    salvar();
  }
  return false;
}

export const resgatesRestantes = (limite) => Math.max(0, limite - state.dia.resgates);

// Onde a peça ficou depois de arrastada. Vale enquanto a página está aberta:
// trocar de tela e voltar mantém a arara como você deixou.
export function guardarPosicao(id, x, y) {
  state.dia.posicoes ??= {};
  state.dia.posicoes[id] = { x: Math.round(x), y: Math.round(y) };
  salvar();
}
export const posicaoGuardada = (id) => state.dia.posicoes?.[id] ?? null;

// A vitrine chama uma vez por carregamento: a arrumação é sorteada de novo a
// cada recarga, então posição guardada na sessão anterior só atrapalharia —
// a peça arrastada ontem voltaria sozinha para o canto de ontem.
export function limparPosicoes() {
  if (!state.dia.posicoes || !Object.keys(state.dia.posicoes).length) return;
  state.dia.posicoes = {};
  salvar();
}

// --- Inventário -----------------------------------------------------------
export const temPeca = (id) => state.inventario.some(p => p.id === id);
export const pecaDoInventario = (id) => state.inventario.find(p => p.id === id);

// Peça que o admin apagou do acervo sai do guarda-roupa de quem a tinha. A
// lista vem explícita no acervo.json — e não "o que não está no catálogo" —
// porque catálogo que falhou ao carregar esvaziaria o guarda-roupa de todo mundo.
export function esquecerPecas(ids) {
  const fora = new Set(ids || []);
  if (!fora.size) return 0;
  const antes = state.inventario.length;
  state.inventario = state.inventario.filter(p => !fora.has(p.id));
  const tiradas = antes - state.inventario.length;
  if (tiradas) salvar();
  return tiradas;
}

// Raridade é sorteada uma única vez, no resgate, e gravada com a peça.
export function sortearRaridade(rnd = Math.random) {
  const total = RARIDADES.reduce((acc, r) => acc + r.peso, 0);
  let n = rnd() * total;
  for (const r of RARIDADES) {
    if (n < r.peso) return r.id;
    n -= r.peso;
  }
  return 'common';
}

// Raridade do dia de uma peça: mesma semente da vitrine, então o que brilha no
// mural é exatamente o que entra no guarda-roupa.
export function raridadeDoDia(id, iso = hojeISO()) {
  // Peça do acervo do administrador já nasce com a raridade da ficha; o
  // catálogo preenche esse mapa ao carregar (evita db importar catalog.js).
  if (raridadesFixas.has(id)) return raridadesFixas.get(id);

  // Peça que você subiu já tem raridade escolhida na ficha.
  const propria = state.pecasProprias.find(p => p.id === id);
  if (propria?.raridade) return propria.raridade;

  const n = Number(id);
  const semente = Number.isFinite(n) ? n : id.split('')
    .reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return sortearRaridade(mulberry32(sementeDoDia(iso) + semente * 7919));
}

// Raridades gravadas na própria peça (acervo permanente), por id.
export const raridadesFixas = new Map();

export function adicionarPeca(item, { origem = 'vitrine', raridade = null } = {}) {
  if (temPeca(item.id)) return null;
  const peca = {
    id: item.id,
    cat: item.cat,
    raridade: raridade || raridadeDoDia(item.id),
    obtidoEm: new Date().toISOString(),
    origem,
    ordem: state.inventario.length,
  };
  state.inventario.push(peca);
  return peca;
}

export function reordenarInventario(idA, idB) {
  const a = pecaDoInventario(idA), b = pecaDoInventario(idB);
  if (!a || !b) return;
  [a.ordem, b.ordem] = [b.ordem, a.ordem];
  salvar();
}

// Devolver à loja: o contrário do resgate. A peça sai do guarda-roupa e volta a
// ser estoque da vitrine — e só isso. Nada é apagado do jogo: a roupa continua
// no acervo com a mesma ficha, os looks e as colagens já montados continuam de
// pé (eles guardam o id da peça, que não deixou de existir) e o nível, o XP e as
// estatísticas ficam como estavam. O que se desfaz é a posse.
//
// Os resgates do dia voltam junto: se a peça não foi levada, o resgate também
// não foi gasto.
export function devolverTudoParaALoja() {
  const devolvidas = state.inventario.length;
  state.inventario = [];
  state.dia.resgates = 0;
  salvar();
  return devolvidas;
}

// --- Peças próprias -------------------------------------------------------
// A imagem vem comprimida em WebP e mora no próprio registro (data URL). Para
// um acervo grande o caminho é o pipeline; aqui é para subir peça avulsa.
export function guardarPecaPropria(peca) {
  const antes = state.pecasProprias.findIndex(p => p.id === peca.id);
  if (antes >= 0) state.pecasProprias[antes] = peca;
  else state.pecasProprias.push(peca);
  return peca;
}

export function removerPecaPropria(id) {
  state.pecasProprias = state.pecasProprias.filter(p => p.id !== id);
  state.inventario = state.inventario.filter(p => p.id !== id);
  salvar();
}

// Espaço que as peças próprias ocupam no navegador, em KB.
export const pesoDasPecas = () =>
  Math.round(state.pecasProprias.reduce((t, p) => t + (p.src?.length ?? 0), 0) / 1024);

// --- Marcas ---------------------------------------------------------------
// Toda marca digitada ao subir uma peça fica registrada. Hoje serve para
// completar o campo na próxima vez; o registro já é uma lista de objetos para
// receber depois o que mais a marca precisar carregar (logo, descrição, país).
export function registrarMarca(nome) {
  const limpo = (nome || '').trim();
  if (!limpo) return null;

  const igual = state.marcas.find(m => m.nome.toLowerCase() === limpo.toLowerCase());
  if (igual) {
    igual.usos += 1;
    return igual;
  }
  const nova = { nome: limpo, usos: 1, em: new Date().toISOString() };
  state.marcas.push(nova);
  return nova;
}

// Mais usadas primeiro; em empate, a mais recente.
export const marcasOrdenadas = () =>
  [...state.marcas].sort((a, b) => b.usos - a.usos || new Date(b.em) - new Date(a.em));

export function esquecerMarca(nome) {
  state.marcas = state.marcas.filter(m => m.nome !== nome);
  salvar();
}

// --- Cores ----------------------------------------------------------------
// Mesmo registro das marcas: a cor é campo livre, e o que já foi digitado vira
// atalho na próxima peça. A paleta de CONFIG entra junto, como sugestão.
export function registrarCor(nome) {
  const limpo = (nome || '').trim();
  if (!limpo) return null;

  const igual = state.cores.find(c => c.nome.toLowerCase() === limpo.toLowerCase());
  if (igual) {
    igual.usos += 1;
    return igual;
  }
  const nova = { nome: limpo, usos: 1, em: new Date().toISOString() };
  state.cores.push(nova);
  return nova;
}

export const coresOrdenadas = () =>
  [...state.cores].sort((a, b) => b.usos - a.usos || new Date(b.em) - new Date(a.em));

export function esquecerCor(nome) {
  state.cores = state.cores.filter(c => c.nome !== nome);
  salvar();
}

// --- Favoritos ------------------------------------------------------------
// O que você escolheu mostrar no perfil: peça do guarda-roupa, look do Stylist
// e colagem. A marca mora na própria coisa (campo `favorito`), não numa lista
// à parte — assim apagar um look leva o favorito junto, e save antigo entra
// sem migração: o que não tem o campo simplesmente não é favorito.
const COLECAO = { peca: 'inventario', look: 'looks', colagem: 'boards' };

const colecao = (tipo) => state[COLECAO[tipo]] ?? [];

export const ehFavorito = (tipo, id) =>
  Boolean(colecao(tipo).find(x => x.id === id)?.favorito);

// Devolve como ficou, para quem chamou já saber o que dizer no toast.
export function alternarFavorito(tipo, id) {
  const alvo = colecao(tipo).find(x => x.id === id);
  if (!alvo) return false;
  alvo.favorito = !alvo.favorito;
  salvar();
  return alvo.favorito;
}

export const favoritos = (tipo) => colecao(tipo).filter(x => x.favorito);

// --- Conexões -------------------------------------------------------------
// Sem backend não há OAuth: aqui a ligação é simulada e guarda só o @ digitado.
// Quando virar real, é este registro que passa a guardar o token.
export function conectar(servico, usuario) {
  state.conexoes[servico] = {
    ligado: true,
    usuario: (usuario || '').replace(/^@/, '').trim(),
    em: new Date().toISOString(),
  };
  salvar();
}
export function desconectar(servico) {
  state.conexoes[servico] = { ligado: false, usuario: '', em: null };
  salvar();
}
export const estaLigado = (servico) => Boolean(state.conexoes?.[servico]?.ligado);

// --- Missões (diárias) ----------------------------------------------------
// Progredir é sempre por aqui: a missão que fecha credita o XP na hora, uma vez
// por dia, e o bônus sai quando as cinco estão completas.
export function progredirMissao(id, delta = 1) {
  virarODiaSeNecessario();
  const missao = MISSOES.find(m => m.id === id);
  if (!missao || !(id in state.missoes.progresso)) return;

  const antes = state.missoes.progresso[id];
  if (antes >= missao.meta) return;

  state.missoes.progresso[id] = Math.min(missao.meta, antes + delta);
  if (!missaoCompleta(id) || state.missoes.pagas.includes(id)) return;

  state.missoes.pagas.push(id);
  ganharXP(missao.xp, `missão: ${missao.nome}`);

  if (todasMissoesCompletas() && !state.missoes.bonusPago) {
    state.missoes.bonusPago = true;
    state.stats.diasCompletos = (state.stats.diasCompletos ?? 0) + 1;
    ganharXP(XP_BONUS_DIA, 'todas as missões do dia');
  }
}

export const progressoMissao = (id) => state.missoes.progresso[id] ?? 0;

export const missaoCompleta = (id) =>
  progressoMissao(id) >= (MISSOES.find(m => m.id === id)?.meta ?? 1);

export const todasMissoesCompletas = () => MISSOES.every(m => missaoCompleta(m.id));

export const missoesFeitas = () => MISSOES.filter(m => missaoCompleta(m.id)).length;

// --- Nível e XP -----------------------------------------------------------
// Quem quiser reagir ao XP (badge da sidebar, toast de nível novo) escuta aqui:
// db não conhece a interface, só avisa o que aconteceu.
const ouvintesXP = new Set();
export const onXP = (fn) => { ouvintesXP.add(fn); return () => ouvintesXP.delete(fn); };

export const xpTotal = () => state.progresso.xp;
export const nivel = () => nivelPorXP(state.progresso.xp);
export const progresso = () => progressoDoNivel(state.progresso.xp);

export function ganharXP(quantidade, motivo = '') {
  const qtd = Math.max(0, Math.round(quantidade));
  if (!qtd) return null;

  const antes = nivel();
  state.progresso.xp += qtd;
  const depois = nivel();
  state.progresso.nivelVisto = depois;

  const evento = { xp: qtd, motivo, nivel: depois, subiu: depois > antes, de: antes };
  ouvintesXP.forEach(fn => fn(evento));
  return evento;
}

// --- Ferramentas ----------------------------------------------------------
// O gate por nível mora aqui para a sidebar, o roteador e a aba Tarefas darem
// sempre a mesma resposta.
export const ferramentaLiberada = (id) => nivel() >= nivelDaFerramenta(id);

// --- Vestiário (roupinhas) ------------------------------------------------
// O catálogo e as regras de desbloqueio ficam em js/roupinhas.js; aqui mora o
// que é do jogador: o que ele já abriu e o que está vestindo.
//
// Nada fica gravado como "desbloqueado". A condição é lida do progresso na
// hora, igual ao nível sendo lido do XP: mexer numa meta lá revale para todo
// mundo sem migração de save, e nada que abriu fecha de novo — tudo que
// alimenta isso (nível, resgates, looks, publicações, dias fechados) só sobe.

// O que as condições das roupinhas leem. Um lugar só, para a grade, o toast e
// a barra de progresso dizerem sempre a mesma coisa.
export const progressoDoJogador = () => ({
  nivel: nivel(),
  resgates: state.stats.resgates ?? 0,
  looks: state.stats.looks ?? 0,
  publicacoes: state.stats.publicacoes ?? 0,
  dias: state.stats.diasCompletos ?? 0,
});

export const estadoDaRoupinha = (r) => estadoDoDesbloqueio(r, progressoDoJogador());

export const roupinhaLiberada = (id) => {
  const r = ROUPINHA[id];
  return Boolean(r) && estadoDaRoupinha(r).liberada;
};

export const roupinhasLiberadas = () =>
  ROUPINHAS.filter(r => estadoDaRoupinha(r).liberada);

// O que o avatar veste: lugar do corpo → id da peça. Peça que saiu do catálogo
// — ou que não está mais liberada, se uma meta mudar — some daqui sozinha, em
// vez de quebrar o desenho: o que se veste é derivado do que existe hoje.
export function roupasEquipadas() {
  const vestido = {};
  for (const slot of ORDEM_SLOTS) {
    const id = state.vestiario?.equipado?.[slot];
    if (!id || !roupinhaLiberada(id) || ROUPINHA[id].slot !== slot) continue;
    vestido[slot] = id;
  }
  return vestido;
}

// A ordem do saco e sua: arrastar uma peca sobre outra muda onde ela fica, e
// isso fica gravado. Quem nao esta na lista entra no fim, na ordem dos lugares
// do corpo — peca que abriu hoje nao embaralha o que voce ja arrumou ontem.
export function ordenarRoupinhas(lista) {
  const ordem = state.vestiario?.ordem || [];
  const pos = (r) => {
    const i = ordem.indexOf(r.id);
    return i === -1 ? Infinity : i;
  };
  return [...lista].sort((a, b) =>
    pos(a) - pos(b) || ORDEM_SLOTS.indexOf(a.slot) - ORDEM_SLOTS.indexOf(b.slot));
}

// Poe `id` na frente de `antesDe` — ou no fim do saco, quando o alvo e uma
// casa vazia. A lista gravada e a ordem inteira, nao so o que mudou: assim ela
// continua valendo quando o filtro de categoria esconde metade das pecas.
export function moverRoupinha(id, antesDe = null) {
  const todas = ordenarRoupinhas(roupinhasLiberadas()).map(r => r.id);
  const de = todas.indexOf(id);
  if (de === -1) return false;
  todas.splice(de, 1);
  const alvo = antesDe ? todas.indexOf(antesDe) : -1;
  todas.splice(alvo === -1 ? todas.length : alvo, 0, id);
  state.vestiario.ordem = todas;
  salvar();
  return true;
}

export function equiparRoupinha(id) {
  const r = ROUPINHA[id];
  if (!r || !roupinhaLiberada(id)) return false;
  state.vestiario.equipado[r.slot] = id;
  salvar();
  return true;
}

export function tirarRoupinha(slot) {
  if (!state.vestiario.equipado[slot]) return false;
  delete state.vestiario.equipado[slot];
  salvar();
  return true;
}

export function tirarTudo() {
  state.vestiario.equipado = {};
  salvar();
}

// O que abriu desde a última olhada. Quem chama decide o que fazer com a
// lista (toast, pontinho na grade) — db não conhece a interface.
export function roupinhasNovas() {
  const v = state.vestiario;
  const liberadas = roupinhasLiberadas().map(r => r.id);
  const inedito = liberadas.filter(id => !v.conhecidas.includes(id));
  if (!inedito.length) return [];

  // A primeira vez não é novidade: o save nasce conhecendo o que já estava
  // aberto, senão o jogador leva 6 toasts na primeira tela que abrir.
  const estreia = !v.conhecidas.length;
  v.conhecidas = liberadas;
  if (!estreia) v.novas = [...new Set([...v.novas, ...inedito])];
  salvar();
  return estreia ? [] : inedito;
}

export const ehNova = (id) => state.vestiario.novas.includes(id);

export function marcarVista(id) {
  if (!ehNova(id)) return;
  state.vestiario.novas = state.vestiario.novas.filter(x => x !== id);
  salvar();
}

// --- Reset (para testes) --------------------------------------------------
// Apaga o progresso do jogador — inventário, looks, colagens, feed, XP — mas
// não o que foi cadastrado como conteúdo: as peças subidas e o registro de
// marcas e cores continuam. Esse cadastro é acervo, não partida: um dia ele vai
// migrar para a base oficial do site, e perder isso num botão de teste seria
// perder trabalho de verdade. (As peças gravadas em assets/acervo.json já
// vivem em disco; aqui ficam as de save antigo, guardadas no próprio estado.)
const ACERVO_DO_ADMIN = ['pecasProprias', 'marcas', 'cores'];

export function resetar({ manterAcervo = true } = {}) {
  const guardado = manterAcervo
    ? Object.fromEntries(ACERVO_DO_ADMIN.map(k => [k, state[k]]))
    : null;
  if (chave) localStorage.removeItem(chave);
  const conta = {
    id: state.usuario.id, nome: state.usuario.nome, handle: state.usuario.handle,
    email: state.usuario.email, papel: state.usuario.papel,
  };
  Object.assign(state, estadoInicial(), guardado || {});
  Object.assign(state.usuario, conta);   // resetar a partida não desloga ninguém
  salvar();
}

// O contrapeso do de cima: apagar também o cadastro. Fica separado porque nada
// aqui volta — nem a peça nem a lista de marcas.
export function apagarAcervoLocal() {
  state.pecasProprias = [];
  state.marcas = [];
  state.cores = [];
  salvar();
}
