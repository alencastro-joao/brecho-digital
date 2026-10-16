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

import { hojeISO, semanaISO, mulberry32, sementeDoDia } from './util.js';
import {
  CONFIG, RARIDADES, PREMIOS_DE_NIVEL, premioDoNivel, MISSOES, INTRO, MISSOES_SEMANA, PREMIO_SEMANA, COLLAB, ASSINATURA_PADRAO, APARENCIA_PADRAO,
  MARCOS_DIA, MARCOS_SEMANA, BAU_ESPECIAL, FICHAS, premioDoBau, nivelPorXP, progressoDoNivel, nivelDaFerramenta, migrarCategoria,
  COLECOES, normalizarMarca, COLECOES_DE_COR, ESTILOS, idDaCor, idDoEstilo,
} from './config.js';
import {
  ROUPINHAS, ROUPINHA, ORDEM_SLOTS, VESTIARIO_PADRAO, estadoDoDesbloqueio, escolhasDaColecao,
} from './roupinhas.js';
import { bonusDeEfeito, marcasAtivas, bonusDaCor } from './efeitos.js';

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
    inventario: [],            // { id, cat, raridade, obtidoEm, origem, ordem, numero? }
    // A wishlist: ids de peças que você viu (na loja ou no perfil de alguém) e
    // quer. Só entra por ali — não existe lista de todas as peças para escolher.
    wishlist: [],
    // A ordem que você arrumou nas abas do seu perfil (segurar e arrastar):
    // ids por aba — roupas, looks, colagens. O que não está aqui vem depois,
    // na ordem de sempre.
    ordemDoPerfil: {},
    marcas: [],                // marcas já usadas: { nome, usos, em }
    cores: [],                 // cores já usadas: { nome, usos, em }
    dia: { data: hojeISO(), resgates: 0, extras: 0, guardados: 0, posicoes: {} },   // posicoes: peça arrastada no mural
                                                                    // extras: resgates comprados com fichas hoje
                                                                    // guardados: extras de dias anteriores ainda não usados
                                                                    // estoque: semente da vitrine do dia (ver vitrine.js)
    looks: [],                 // { id, nome, criadoEm, camadas[], thumb, publicado }
    boards: [],                // colagens: { id, nome, formato, margem, assinatura, itens[], guias }
    feed: [],                  // posts (meus + dos perfis fictícios)
    conexoes: {                // contas de fora ligadas ao perfil
      instagram: { ligado: false, usuario: '', em: null },
      pinterest: { ligado: false, usuario: '', em: null },
    },
    missoes: missoesDoDia(),   // zera na virada do dia (ver virarODiaSeNecessario)
    semana: missoesDaSemana(), // zera na segunda-feira
    progresso: { xp: 0, nivelVisto: 1 },   // xp só sobe; o nível é derivado dele
    fichas: 0,                 // ganhas nos marcos das missões, trocadas por resgate
    fichasDeRepor: 0,          // prêmio da trilha de níveis: trocam a arara do dia
    baus: [],                  // baús ganhos esperando abrir (tela de Baús)
    semanasFechadas: 0,        // semanas carimbadas desde o último baú semanal
    collab: { mes: COLLAB.mes, liberada: false },
    stats: { resgates: 0, looks: 0, publicacoes: 0, diasCompletos: 0, semanasCompletas: 0 },
    // O sino (js/avisos.js): a lista, até onde você já viu, e a última foto de
    // cada fonte — é comparando com ela que se sabe o que é novo.
    avisos: {
      lista: [],          // { id, tipo, texto, em, ir: [tela, param], quem, junta, qtd }
      vistoEm: null,      // abrir o painel marca tudo até aqui como visto
      posts: {},          // id do seu post → { c: curtidas dos outros, k: ids de comentários }
      seguidores: null,   // ids de quem segue você (null = ainda não olhou)
      dia: null,          // o dia da vitrine que já foi avisado
    },
  };
}

// Registro diário das missões: um bloco por data, para a virada do dia ser
// só trocar o bloco (e para dar pra guardar histórico depois).
function missoesDoDia(data = hojeISO()) {
  return {
    data,
    // "Entrar" nasce feita: quem está vendo a lista está no app.
    progresso: Object.fromEntries(MISSOES.map(m => [m.id, m.evento === 'entrar' ? m.meta : 0])),
    pagas: MISSOES.filter(m => m.evento === 'entrar').map(m => m.id),   // XP já creditado hoje
    marcos: [],         // marcos do dia já resgatados: 'ficha', 'carimbo'
  };
}

// O mesmo bloco, uma vez por semana. `curtidos` guarda os posts que já
// contaram para a missão de curtir: descurtir e curtir de novo não soma.
// `premio` é o que saiu do baú: null até abrir. `carimbos` são os dias da
// semana (ISO) que foram carimbados no cartão.
function missoesDaSemana(data = semanaISO()) {
  return {
    data,
    progresso: Object.fromEntries(MISSOES_SEMANA.map(m => [m.id, 0])),
    pagas: [],
    curtidos: [],
    marcos: [],         // 'fichas' quando o marco de 3 missões já foi resgatado
    carimbos: [],
    premio: null,
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
    // Missão nova que escuta o mesmo evento de uma antiga ("garimpar 1" ao lado
    // de "garimpar 3") começa do progresso da irmã, não do zero.
    for (const m of MISSOES) {
      const antigo = salvo.missoes?.progresso;
      if (!antigo || m.id in antigo) continue;
      const irma = MISSOES.find(o => o.evento === m.evento && o.id in antigo);
      if (irma) estado.missoes.progresso[m.id] = Math.min(m.meta, antigo[irma.id]);
    }
    estado.semana = salvo.semana?.progresso
      ? { ...base.semana, ...salvo.semana,
          progresso: { ...base.semana.progresso, ...salvo.semana.progresso } }
      : base.semana;
    estado.progresso = { ...base.progresso, ...(salvo.progresso || {}) };
    estado.stats = { ...base.stats, ...(salvo.stats || {}) };
    estado.avisos = { ...base.avisos, ...(salvo.avisos || {}) };
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
      ...(estado.inventario || []),
      ...(estado.looks || []).flatMap(l => l?.camadas || []),
      ...(estado.boards || []).flatMap(b => b?.itens || []),
    ];
    for (const p of pecasComCat) if (p?.cat) p.cat = migrarCategoria(p.cat);
    // As peças subidas pelo navegador (as "locais", só deste aparelho) saíram
    // do jogo: peça nova entra pela esteira, no acervo de todo mundo.
    delete estado.pecasProprias;
    estado.inventario = (estado.inventario || []).filter(p => p?.origem !== 'propria');
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
  // Colagem assina com o nome de quem fez. "Alencastrk" foi o padrão de
  // todo mundo por um tempo; só o admin escolheu isso de verdade.
  const assinatura = state.usuario.assinatura;
  if (!assinatura.texto || (assinatura.texto === 'Alencastrk' && conta.papel !== 'admin')) {
    assinatura.texto = conta.nome || '';
  }

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
  semNuvem = false;
  sujo = false;
  versao = undefined;
  pendente = false;
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
//
// Cada save da nuvem tem uma versão (o ETag do S3), e o `PUT` leva de volta a
// versão em que esta aba se baseou: se outro aparelho gravou depois, o servidor
// responde 409 em vez de deixar o estado velho apagar o novo. É o caso da aba
// esquecida aberta no celular durante uma tarde de jogo no computador — antes,
// a primeira mexida nela subia o guarda-roupa da manhã por cima da tarde.
const ESPERA_ENVIO = 4000;
// O navegador recusa `keepalive` com corpo acima de 64 KB. Save maior sai como
// requisição comum: ao esconder a aba ela termina; ao fechar pode morrer, e aí
// é o `pendente` gravado no disco que garante a subida no próximo login.
const TETO_KEEPALIVE = 60 * 1024;

let sincronizado = false;   // trava: antes de ler a nuvem, não se escreve nela
let semNuvem = false;       // a leitura falhou: jogo local, que sobe depois
let timerEnvio = null;
let enviando = null;
let sujo = false;           // mudou desde o último envio (só em memória)
let carregadoEm = '';       // a data que o save tinha no disco ao abrir

// O que este navegador sabe da nuvem, gravado ao lado do save
// (`bd:v1:estado:<id>:nuvem`) para valer no próximo login:
//   versao    a versão da nuvem em que o save daqui se baseia
//             (undefined: não sei; null: a nuvem não tem save)
//   pendente  há mudança daqui que a nuvem ainda não confirmou
// É o par que decide o login sem depender de relógio: versão igual e nada
// pendente, os dois são o mesmo save; versão igual e pendente, o daqui está
// adiante; versão diferente, a nuvem andou sem este aparelho.
let versao;
let pendente = false;
const conflitos = new Set();

const chaveDaNuvem = (conta) => conta + ':nuvem';

function lerNota() {
  try { return JSON.parse(localStorage.getItem(chaveDaNuvem(chave))); } catch { return null; }
}

function anotar(conta, v, p) {
  if (conta === chave) { versao = v; pendente = p; }
  try { localStorage.setItem(chaveDaNuvem(conta), JSON.stringify({ versao: v, pendente: p })); } catch {}
}

/** Avisado quando a nuvem ganhou de uma mudança desta aba. `perdeu` diz se
 *  havia mudança daqui que não chegou a subir. Quem reage é a interface. */
export const onConflito = (fn) => { conflitos.add(fn); return () => conflitos.delete(fn); };

function agendarEnvio() {
  if ((sincronizado || semNuvem) && !pendente) anotar(chave, versao, true);
  if (!sincronizado) return;
  sujo = true;
  clearTimeout(timerEnvio);
  timerEnvio = setTimeout(enviar, ESPERA_ENVIO);
}

async function enviar({ despedida = false } = {}) {
  if (!chave || !sincronizado || !sujo) return;
  if (enviando) return enviando.then(() => enviar({ despedida }));   // um de cada vez, na ordem
  sujo = false;
  clearTimeout(timerEnvio);
  const conta = chave;
  const corpo = JSON.stringify({ estado: state, versao });
  enviando = fetch('/api/estado', {
    method: 'PUT', credentials: 'include',
    // Fechar a aba não pode custar os últimos segundos de jogo: `keepalive`
    // deixa a requisição sair mesmo com a página morrendo.
    keepalive: despedida && new Blob([corpo]).size < TETO_KEEPALIVE,
    headers: { 'Content-Type': 'application/json' },
    body: corpo,
  }).then(async r => {
    if (r.ok) {
      const resposta = await r.json();
      // Continua pendente se a pessoa mexeu enquanto este ia.
      anotar(conta, resposta.versao ?? versao, conta === chave && sujo);
      return;
    }
    if (r.status === 409 && conta === chave) {
      await perderParaANuvem(true);
      return;
    }
    // Sessão vencida ou save grande demais: o jogo não para por isso. O save
    // local está gravado e continua pendente: sobe com a próxima mexida, ou
    // no próximo login.
    console.warn('não consegui gravar o save na nuvem:', r.status);
  }).catch(e => {
    if (conta === chave) sujo = true;   // sem rede: tenta de novo na próxima
    console.warn('sem conexão para gravar o save:', e.message);
  }).finally(() => { enviando = null; });
  return enviando;
}

function despedir() {
  if (!chave || !sincronizado || !sujo) return;
  enviar({ despedida: true });
}

// Sobe agora o que estava esperando e espera a resposta. É o que o botão de
// sair chama antes de encerrar a sessão no servidor: depois dela o PUT volta
// 401, e a última mexida (um resgate segundos antes de sair) não chegava.
export async function descarregar() {
  clearTimeout(timerEnvio);
  if (enviando) await enviando;
  await enviar();
}

// Põe o save da nuvem no lugar do daqui. Passa pelo localStorage de propósito:
// `carregar()` é quem sabe migrar save antigo (missões, vestiário, slots
// renomeados). Trazer da nuvem sem ele seria reimplementar essas migrações.
function adotar(nuvem) {
  localStorage.setItem(chave, JSON.stringify(nuvem.estado));
  anotar(chave, nuvem.versao, false);
  const trazido = carregar();
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, trazido);
  carregadoEm = nuvem.atualizadoEm || '';
  sujo = false;
  sincronizado = true;
  ouvintes.forEach(fn => fn(state));
}

async function lerDaNuvem() {
  const r = await fetch('/api/estado', { credentials: 'include' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// A nuvem andou sem esta aba. Nada mais sobe com a base velha: o save de lá
// entra no lugar do daqui, e quem escuta `onConflito` (o app) recarrega a tela.
// Sem fusão, de propósito — fundir dois guarda-roupas divergentes dá um
// terceiro que não é o de ninguém. Perder os segundos desta aba é melhor do que
// perder a tarde do outro aparelho.
async function perderParaANuvem(perdeu) {
  const conta = chave;
  sincronizado = false;
  clearTimeout(timerEnvio);
  let nuvem;
  try {
    nuvem = await lerDaNuvem();
  } catch (e) {
    // Fica travado até o próximo login, que resolve com a nota no disco.
    console.warn('o save mudou em outro aparelho e não consegui trazê-lo:', e.message);
    return;
  }
  if (conta !== chave) return;
  if (!nuvem.estado) {
    // Apagaram o save de lá: não há com o que conflitar, o daqui recria.
    versao = null;
    sincronizado = true;
    sujo = true;
    return enviar();
  }
  adotar(nuvem);
  conflitos.forEach(fn => fn({ perdeu }));
}

// Voltar para a aba é o momento de perguntar se a nuvem andou: antes de a
// pessoa mexer em qualquer coisa, e só a versão (o save inteiro são megabytes).
async function conferirNuvem() {
  if (!chave || !sincronizado || versao === undefined) return;
  // O que esta aba mandou ao ser escondida volta com a versão nova; sem esperar,
  // a própria escrita pareceria a de outro aparelho.
  if (enviando) await enviando;
  const conta = chave;
  let dela;
  try {
    const r = await fetch('/api/estado?so=versao', { credentials: 'include' });
    if (!r.ok) return;
    dela = (await r.json()).versao;
  } catch { return; }
  if (conta !== chave || !sincronizado || dela === undefined || dela === versao) return;
  await perderParaANuvem(sujo || pendente);
}

if (typeof window !== 'undefined') {
  // pagehide, e não unload: é o único que o Safari e o iOS respeitam, e é o
  // que não impede a página de entrar no cache de navegação.
  window.addEventListener('pagehide', despedir);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') despedir();
    else conferirNuvem();
  });
}

/**
 * Casa o save daqui com o da nuvem. Roda uma vez por login, antes de qualquer
 * tela ser montada — daí em diante `salvar()` já sobe sozinho.
 *
 * Quem decide é a nota gravada ao lado do save (ver `anotar`). Save de antes
 * dela não tem nota, e aí ganha o mais novo pelo `atualizadoEm`, como sempre foi.
 */
export async function sincronizarDaNuvem() {
  if (!chave) return { estado: 'sem conta' };
  const nota = lerNota();
  versao = nota?.versao;
  pendente = !!nota?.pendente;

  let nuvem = null;
  try {
    nuvem = await lerDaNuvem();
  } catch (e) {
    // Sem nuvem o jogo roda igual ao protótipo: local, e só. Mas não liberamos
    // o envio — subir sem ter lido é como apagar o save do outro aparelho. O
    // que se fizer agora fica pendente na nota e sobe no próximo login.
    console.warn('não consegui ler o save da nuvem; seguindo com o local.', e.message);
    semNuvem = true;
    return { estado: 'offline' };
  }
  semNuvem = false;

  if (!nuvem.estado) {
    versao = null;
    sincronizado = true;
    sujo = true;
    await enviar();
    return { estado: 'primeira vez na nuvem' };
  }

  let daqui;   // 'igual' | 'atrás' | 'adiante' | 'conflito'
  if (nota && nota.versao !== undefined && nuvem.versao) {
    const nuvemAndou = nota.versao !== nuvem.versao;
    daqui = nuvemAndou ? (pendente ? 'conflito' : 'atrás')
                       : (pendente ? 'adiante' : 'igual');
  } else {
    const daquiEm = carregadoEm;
    const dalaEm = nuvem.atualizadoEm || '';
    daqui = dalaEm > daquiEm ? 'atrás' : daquiEm > dalaEm ? 'adiante' : 'igual';
  }

  if (daqui === 'atrás' || daqui === 'conflito') {
    adotar(nuvem);
    return { estado: 'veio da nuvem', em: nuvem.atualizadoEm, perdeu: daqui === 'conflito' };
  }

  versao = nuvem.versao;
  sincronizado = true;
  if (daqui === 'adiante') {
    sujo = true;
    await enviar();
    return { estado: 'subiu o local' };
  }
  anotar(chave, versao, false);
  return { estado: 'iguais' };
}

// --- Dia ------------------------------------------------------------------
export function virarODiaSeNecessario() {
  const hoje = hojeISO();
  if (state.dia.data !== hoje) {
    state.dia = { data: hoje, resgates: 0, extras: 0, guardados: extrasQueSobraram(), posicoes: {} };
    state.missoes = missoesDoDia(hoje);   // vitrine nova, missões novas
    salvar();
    return true;
  }
  // Save aberto de ontem: o dia não mudou, mas as missões podem ser de outra data.
  if (state.missoes.data !== hoje) {
    state.missoes = missoesDoDia(hoje);
    salvar();
  }
  virarASemanaSeNecessario();
  return false;
}

// A semana vira sozinha, e o prêmio que ficou sem abrir vai junto: é o que
// faz a segunda-feira pesar.
function virarASemanaSeNecessario() {
  const semana = semanaISO();
  if (state.semana?.data === semana) return false;
  state.semana = missoesDaSemana(semana);
  salvar();
  return true;
}

// Resgate comprado com fichas não vence: o que não foi usado passa para o dia
// seguinte. Os resgates normais do dia são gastos primeiro.
const extrasDoDia = () => (state.dia.extras ?? 0) + (state.dia.guardados ?? 0);

function extrasQueSobraram() {
  const usados = Math.max(0, state.dia.resgates - CONFIG.RESGATES_POR_DIA);
  return Math.max(0, extrasDoDia() - usados);
}

export const resgatesRestantes = (limite) =>
  Math.max(0, limite + extrasDoDia() - state.dia.resgates);

// Quantos dos resgates que sobraram vieram das fichas (os do dia saem antes).
export const resgatesDeFichas = () => extrasQueSobraram();

// --- Fichas ---------------------------------------------------------------
export const fichas = () => state.fichas ?? 0;

export const podeTrocarFichas = () =>
  fichas() >= FICHAS.porResgate && (state.dia.extras ?? 0) < FICHAS.extrasPorDia;

// Troca fichas por um resgate a mais, que fica guardado até ser usado. Devolve se deu certo.
export function trocarFichasPorResgate() {
  virarODiaSeNecessario();
  if (!podeTrocarFichas()) return false;
  state.fichas = fichas() - FICHAS.porResgate;
  state.dia.extras = (state.dia.extras ?? 0) + 1;
  salvar();
  return true;
}

// Onde a peça ficou depois de arrastada. Vale enquanto a página está aberta:
// trocar de tela e voltar mantém a arara como você deixou.
export function guardarPosicao(id, x, y) {
  state.dia.posicoes ??= {};
  state.dia.posicoes[id] = { x: Math.round(x), y: Math.round(y) };
  salvar();
}
export const posicaoGuardada = (id) => state.dia.posicoes?.[id] ?? null;

// A vitrine chama uma vez por carregamento: a posição arrastada é em pixels da
// tela daquela sessão, e em outra tela (o celular) ela cairia fora do lugar.
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
// `ajuste` multiplica o peso de cada raridade (ver modificadoresDaLoja).
export function sortearRaridade(rnd = Math.random, ajuste = {}) {
  const pesoDe = (r) => r.peso * (ajuste[r.id] ?? 1);
  const total = RARIDADES.reduce((acc, r) => acc + pesoDe(r), 0);
  let n = rnd() * total;
  for (const r of RARIDADES) {
    if (n < pesoDe(r)) return r.id;
    n -= pesoDe(r);
  }
  return 'common';
}

// Texto vira número estável (o mesmo id dá sempre a mesma semente).
const numeroDe = (id) => {
  const n = Number(id);
  return Number.isFinite(n) ? n : String(id).split('')
    .reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
};

// A loja é de cada pessoa: a semente do dia mistura a data com o id da conta.
// Cada um encontra uma arara diferente, e a sua continua a mesma do primeiro
// ao último acesso do dia. Sem conta (antes do login) fica só a data.
export function sementeDaLoja(iso = hojeISO()) {
  const id = state.usuario.id;
  return id ? (sementeDoDia(iso) ^ Math.imul(numeroDe(id), 0x9E3779B1)) >>> 0 : sementeDoDia(iso);
}

// O que muda a sorte desta pessoa na loja.
//   peso[raridade]:   multiplica o peso dela no sorteio da raridade do dia
//   naLoja[raridade]: troca a tabela de quantas vêm na arara (ver config.js)
//   marcas:           [{ marcas, pct }] — efeito "mais peças da marca na arara"
//   maisRaras:        pct do efeito "mais chance de peças raras na arara"
//
// Os efeitos de marca valem pelo que estava vestido na primeira olhada do
// dia e ficam gravados em `state.dia.loja`: trocar de roupa não embaralha a
// arara de hoje, vale para a de amanhã. Antes do acervo carregar ninguém tem
// coleção liberada, então a foto só é tirada depois dele.
export function modificadoresDaLoja() {
  const d = state.dia;
  if (!d.loja && state.usuario.id && marcasFixas.size) {
    const eq = roupasEquipadas();
    d.loja = {
      marcas: marcasAtivas(eq)
        .filter(m => m.colecao.efeito.tipo === 'mais-da-marca')
        .map(m => ({ marcas: m.colecao.efeito.marcas || [m.colecao.marca], pct: m.pct })),
      maisRaras: bonusDeEfeito(eq, 'mais-raras'),
    };
  }
  return { peso: {}, naLoja: {}, marcas: [], maisRaras: 0, ...(d.loja || {}) };
}

// Os efeitos de marca que agem na hora do garimpo, em pontos percentuais.
export function efeitosDoGarimpo() {
  const eq = roupasEquipadas();
  return {
    gratis: bonusDeEfeito(eq, 'resgate-gratis'),
    acima: bonusDeEfeito(eq, 'raridade-acima'),
    fichas: bonusDeEfeito(eq, 'fichas'),
  };
}

export function ganharFicha(n = 1) {
  state.fichas = fichas() + n;
}

// XP de missão com o efeito das cores vestidas (+5% a +20% por cor).
const xpDeMissao = (xp) => Math.round(xp * (1 + bonusDaCor(roupasEquipadas()) / 100));

// Raridade do dia de uma peça: mesma semente da vitrine (a da sua loja), então
// o que brilha no mural é exatamente o que entra no guarda-roupa.
export function raridadeDoDia(id, iso = hojeISO()) {
  // Peça do acervo do administrador já nasce com a raridade da ficha; o
  // catálogo preenche esse mapa ao carregar (evita db importar catalog.js).
  if (raridadesFixas.has(id)) return raridadesFixas.get(id);

  return sortearRaridade(mulberry32(sementeDaLoja(iso) + numeroDe(id) * 7919),
    modificadoresDaLoja().peso);
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

// Desfazer o resgate (a loja dá 10 segundos): a foto é tirada antes de pegar,
// com tudo que pegar mexe — o resgate do dia, as fichas, as estatísticas, as
// missões (do dia, da semana e da introdução), o XP que elas pagaram e o aviso
// de missão que caiu no sino. Voltar a foto e tirar a peça deixa o save como se
// o toque não tivesse acontecido; sem isso, pegar e desfazer em sequência
// fechava a missão de resgates.
const FOTO_DO_RESGATE = ['fichas', 'stats', 'missoes', 'semana', 'progresso', 'intro', 'avisos', 'baus'];

export function fotografarResgate() {
  const foto = { resgates: state.dia.resgates };
  for (const k of FOTO_DO_RESGATE) foto[k] = structuredClone(state[k]);
  return foto;
}

export function desfazerResgate(id, foto) {
  const peca = pecaDoInventario(id);
  if (!peca) return null;
  state.inventario = state.inventario.filter(p => p !== peca);
  state.dia.resgates = foto.resgates;
  for (const k of FOTO_DO_RESGATE) state[k] = foto[k];
  salvar();
  avisarIntro();
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
  if (alvo.favorito) progredirMissao('favoritar');
  salvar();
  return alvo.favorito;
}

export const favoritos = (tipo) => colecao(tipo).filter(x => x.favorito);

// --- Wishlist -------------------------------------------------------------
// Peças que você viu e quer. Quem chama é só quem mostra uma peça de verdade
// (a ficha da loja, o perfil de alguém): é o que obriga a garimpar para
// encher a lista. A mais nova vem primeiro.
export const naWishlist = (id) => (state.wishlist ?? []).includes(id);

export function alternarWishlist(id) {
  const lista = state.wishlist ?? [];
  const entra = !lista.includes(id);
  state.wishlist = entra ? [id, ...lista] : lista.filter(x => x !== id);
  salvar();
  return entra;
}

// --- Ordem do perfil -------------------------------------------------------
export const ordemDoPerfil = (aba) => state.ordemDoPerfil?.[aba] ?? [];

export function guardarOrdemDoPerfil(aba, ids) {
  state.ordemDoPerfil = { ...(state.ordemDoPerfil ?? {}), [aba]: ids };
  salvar();
}

// --- Conexões -------------------------------------------------------------
// A ligação de verdade (OAuth) e o token moram no servidor (lambda/redes.py);
// aqui fica só o espelho do @ que ele confirmou, para o perfil desenhar.
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
// Progredir é sempre por aqui, pelo evento (ver MISSOES em config.js): todas as
// missões do dia e da semana que escutam o evento andam juntas. A missão que
// fecha credita o XP na hora, uma vez só; os marcos esperam o toque na tela.
// Evento sem missão (colagem, seguir) não faz nada — a tela pode avisar sempre.
export function progredirMissao(evento, delta = 1) {
  virarODiaSeNecessario();
  progredirIntro(evento);
  progredirSemana(evento, delta);   // a semana conta mesmo depois que a diária fechou
  for (const missao of MISSOES.filter(m => m.evento === evento)) {
    const antes = state.missoes.progresso[missao.id] ?? 0;
    if (antes >= missao.meta) continue;
    state.missoes.progresso[missao.id] = Math.min(missao.meta, antes + delta);
    if (!missaoCompleta(missao.id) || state.missoes.pagas.includes(missao.id)) continue;
    state.missoes.pagas.push(missao.id);
    if (missao.xp) ganharXP(xpDeMissao(missao.xp), `missão: ${missao.nome.toLowerCase()}`);
  }
}

// --- Missões de introdução -----------------------------------------------
// state.intro só existe em conta nova (ou depois de recomeçar em Testes):
// { passo, feitos: [eventos já vistos], fim }. Save sem ele não mostra nada.
const ouvintesIntro = new Set();
export const onIntro = (fn) => { ouvintesIntro.add(fn); return () => ouvintesIntro.delete(fn); };
const avisarIntro = () => ouvintesIntro.forEach(fn => fn(state.intro));

export const introAtiva = () => Boolean(state.intro && !state.intro.fim);

export function comecarIntro() {
  state.intro = { passo: 0, feitos: [], fim: null };
  salvar();
  avisarIntro();
}

function progredirIntro(evento) {
  const i = state.intro;
  if (!introAtiva() || i.feitos.includes(evento)) return;
  i.feitos.push(evento);
  avisarIntro();
}

// A missão da vez está feita (esperando o toque para pegar o prêmio)?
export const introPronta = () =>
  introAtiva() && state.intro.feitos.includes(INTRO[state.intro.passo]?.evento);

// Avança depois que o prêmio foi entregue; a última fecha a introdução.
export function avancarIntro() {
  if (!introAtiva()) return;
  state.intro.passo += 1;
  if (state.intro.passo >= INTRO.length) state.intro.fim = new Date().toISOString();
  salvar();
  avisarIntro();
}

export function pularIntro() {
  if (!state.intro) return;
  state.intro.fim = new Date().toISOString();
  salvar();
  avisarIntro();
}

export const progressoMissao = (id) => state.missoes.progresso[id] ?? 0;

export const missaoCompleta = (id) =>
  progressoMissao(id) >= (MISSOES.find(m => m.id === id)?.meta ?? 1);

export const missoesFeitas = () => MISSOES.filter(m => missaoCompleta(m.id)).length;

const marcoDoDiaPego = (marco) => state.missoes.marcos?.includes(marco);
export const diaCarimbado = () => marcoDoDiaPego('carimbo');

// O próximo prêmio do dia que já dá para resgatar: 'carimbo' (3 missões),
// 'ficha' (2 missões) ou null.
export function marcoDoDiaPronto() {
  const feitas = missoesFeitas();
  if (!marcoDoDiaPego('carimbo') && feitas >= MARCOS_DIA.carimbo.missoes) return 'carimbo';
  if (!marcoDoDiaPego('ficha') && !marcoDoDiaPego('carimbo') &&
      feitas >= MARCOS_DIA.ficha.missoes) return 'ficha';
  return null;
}

// Resgata o marco pronto. Carimbar o dia também paga a ficha dos 2, se ela
// ficou para trás. Devolve { marco, fichas } ou null.
export function resgatarMarcoDoDia() {
  virarODiaSeNecessario();
  const marco = marcoDoDiaPronto();
  if (!marco) return null;
  state.missoes.marcos ??= [];
  let ganhas = 0;
  if (!marcoDoDiaPego('ficha')) { state.missoes.marcos.push('ficha'); ganhas += MARCOS_DIA.ficha.fichas; }
  if (marco === 'carimbo') {
    state.missoes.marcos.push('carimbo');
    ganhas += MARCOS_DIA.carimbo.fichas;
    state.stats.diasCompletos = (state.stats.diasCompletos ?? 0) + 1;
    state.semana.carimbos ??= [];
    if (!state.semana.carimbos.includes(state.missoes.data)) state.semana.carimbos.push(state.missoes.data);
  }
  state.fichas = fichas() + ganhas;
  if (marco === 'carimbo') ganharXP(MARCOS_DIA.carimbo.xp, 'dia carimbado');
  if (marco === 'carimbo') progredirMissao('carimbo');
  salvar();
  return { marco, fichas: ganhas };
}

export const carimbosDaSemana = () => state.semana.carimbos ?? [];

// --- Missões (semanais) ---------------------------------------------------
// Mesma regra das diárias: fechou, paga o XP na hora e uma vez só. `chave`
// serve à missão de curtir — o mesmo post não conta duas vezes na semana.
export function progredirSemana(evento, delta = 1, chave = null) {
  virarASemanaSeNecessario();
  const s = state.semana;
  const missoes = MISSOES_SEMANA.filter(m => m.evento === evento);
  if (!missoes.length) return;

  if (chave != null) {
    if (s.curtidos.includes(chave)) return;
    s.curtidos.push(chave);
  }
  for (const missao of missoes) {
    const antes = s.progresso[missao.id] ?? 0;
    if (antes >= missao.meta) continue;
    s.progresso[missao.id] = Math.min(missao.meta, antes + delta);
    if (s.progresso[missao.id] < missao.meta || s.pagas.includes(missao.id)) continue;
    s.pagas.push(missao.id);
    ganharXP(xpDeMissao(missao.xp), `missão da semana: ${missao.nome.toLowerCase()}`);
  }
}

export const progressoSemanal = (id) => state.semana.progresso[id] ?? 0;

export const semanalCompleta = (id) =>
  progressoSemanal(id) >= (MISSOES_SEMANA.find(m => m.id === id)?.meta ?? 1);

export const semanaCompleta = () => MISSOES_SEMANA.every(m => semanalCompleta(m.id));

export const semanaisFeitas = () => MISSOES_SEMANA.filter(m => semanalCompleta(m.id)).length;

const fichasDaSemanaPegas = () => state.semana.marcos?.includes('fichas');

// As fichas do marco de 3 missões, prontas para resgatar?
export const fichasDaSemanaProntas = () =>
  !fichasDaSemanaPegas() && semanaisFeitas() >= MARCOS_SEMANA.fichas.missoes;

function pagarFichasDaSemana() {
  if (fichasDaSemanaPegas()) return 0;
  state.semana.marcos ??= [];
  state.semana.marcos.push('fichas');
  state.fichas = fichas() + MARCOS_SEMANA.fichas.fichas;
  return MARCOS_SEMANA.fichas.fichas;
}

export function resgatarFichasDaSemana() {
  virarASemanaSeNecessario();
  if (!fichasDaSemanaProntas()) return 0;
  const ganhas = pagarFichasDaSemana();
  salvar();
  return ganhas;
}

// Carimbo da semana: as 5 missões feitas, um toque carimba. Paga junto as
// fichas dos 3, se ficaram para trás, e conta para o baú semanal.
export const semanaCarimbada = () => Boolean(state.semana.marcos?.includes('carimbo'));
export const carimboDaSemanaPronto = () => semanaCompleta() && !semanaCarimbada();

export function carimbarSemana() {
  virarASemanaSeNecessario();
  if (!carimboDaSemanaPronto()) return null;
  const fichasGanhas = pagarFichasDaSemana();
  state.semana.marcos.push('carimbo');
  state.stats.semanasCompletas = (state.stats.semanasCompletas ?? 0) + 1;
  state.semanasFechadas = semanasFechadas() + 1;
  salvar();
  return { fichas: fichasGanhas };
}

// --- Baús -----------------------------------------------------------------
// Pegar um baú paga o XP do degrau do nível (lido antes de o próprio XP subir
// o nível) e guarda o baú fechado. Abrir chega com as peças já sorteadas pela
// tela, que conhece o catálogo: uma lista de { item, raridade }.
function guardarSorteadas(sorteadas, origem) {
  return sorteadas
    .map(({ item, raridade }) => item && adicionarPeca(item, { origem, raridade }))
    .filter(Boolean)
    .map(p => ({ id: p.id, raridade: p.raridade }));
}

// Baú dos dias: 5 dias carimbados na semana. Pegar paga o XP e manda o baú
// para a tela de Baús, onde ele é aberto.
export const bauDosDiasAberto = () => Boolean(state.semana.premio);
export const bauDosDiasPronto = () =>
  !bauDosDiasAberto() && carimbosDaSemana().length >= PREMIO_SEMANA.carimbos;

export function abrirPremioDaSemana() {
  virarASemanaSeNecessario();
  if (!bauDosDiasPronto()) return null;
  const { xp, bau } = premioDoBau(PREMIO_SEMANA, nivel()).atual;
  guardarBau(bau, 'semana', 'Baú dos dias');
  state.semana.premio = { pecas: [], xp, bau, em: new Date().toISOString() };
  ganharXP(xp, 'baú dos dias');
  salvar();
  return { xp, bau };
}

// As peças do baú dos dias desta semana (aceita o formato antigo, de uma peça).
export function pecasDoBauDosDias() {
  const p = state.semana.premio;
  if (!p) return [];
  return p.pecas ?? (p.id ? [{ id: p.id, raridade: p.raridade }] : []);
}

// --- Baú semanal ----------------------------------------------------------
export const semanasFechadas = () => state.semanasFechadas ?? 0;
export const bauEspecialPronto = () => semanasFechadas() >= BAU_ESPECIAL.semanas;

export function abrirBauEspecial() {
  if (!bauEspecialPronto()) return null;
  const { xp, bau } = premioDoBau(BAU_ESPECIAL, nivel()).atual;
  guardarBau(bau, 'bau-especial', 'Baú semanal');
  state.semanasFechadas = semanasFechadas() - BAU_ESPECIAL.semanas;
  ganharXP(xp, 'baú semanal');
  salvar();
  return { xp, bau };
}

// --- Baús guardados --------------------------------------------------------
// Todo baú ganho (dias, semanal, trilha de níveis, missões do tutorial) vem
// para cá fechado: { id, tipo (de BAUS), origem (a das peças), de, em }. As
// peças só são sorteadas na hora de abrir, pela tela, que conhece o catálogo.
export const bausGuardados = () => state.baus ?? [];
// Quem quiser mostrar o baú chegando (a animação dele voando até Tarefas)
// escuta aqui.
const ouvintesBau = new Set();
export const onBauGuardado = (fn) => { ouvintesBau.add(fn); return () => ouvintesBau.delete(fn); };

export function guardarBau(tipo, origem, de) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  state.baus = [...bausGuardados(), { id, tipo, origem, de, em: new Date().toISOString() }];
  salvar();
  ouvintesBau.forEach(fn => fn(tipo));
}

export function abrirBauGuardado(id, sorteadas = []) {
  const bau = bausGuardados().find(b => b.id === id);
  if (!bau) return null;
  state.baus = bausGuardados().filter(b => b !== bau);
  const pecas = guardarSorteadas(sorteadas, bau.origem);
  progredirMissao('abrir-bau');
  salvar();
  return { ...bau, pecas };
}

// --- Trilha de níveis ------------------------------------------------------
// Os níveis cujo prêmio já foi pego ficam em `progresso.premios`. Quem já
// estava num nível alto quando a trilha chegou pega todos os de baixo.
const premiosPegos = () => state.progresso.premios ?? [];
export const premioDoNivelPego = (n) => premiosPegos().includes(n);
export const premioDoNivelPronto = (n) => n >= 2 && n <= nivel() && !premioDoNivelPego(n);
export const premiosDoNivelProntos = () => PREMIOS_DE_NIVEL.filter(p => premioDoNivelPronto(p.nivel));

// Entrega o prêmio do nível n. Baú vai fechado para a tela de Baús.
export function pegarPremioDoNivel(n) {
  if (!premioDoNivelPronto(n)) return null;
  const premio = premioDoNivel(n);
  state.progresso.premios = [...premiosPegos(), n];
  if (premio.tipo === 'fichas') state.fichas = fichas() + premio.qtd;
  else if (premio.tipo === 'repor') state.fichasDeRepor = fichasDeRepor() + premio.qtd;
  else guardarBau(premio.bau, 'nivel', `Nível ${n}`);
  salvar();
  return premio;
}

// A primeira versão da trilha foi toda pega em teste, e o João pediu para
// zerar (2026-10-16): os níveis voltam a esperar o toque, e o que saiu deles
// (fichas, fichas de repor e as peças dos baús) volta. Roda uma vez por save,
// e devolve as peças tiradas para a loja recontar o estoque.
export function zerarTrilhaDeNiveis() {
  if (state.progresso.trilhaZerada) return [];
  state.progresso.trilhaZerada = true;
  const dadas = premiosPegos().map(premioDoNivel)
    .filter(p => p.tipo === 'fichas').reduce((t, p) => t + p.qtd, 0);
  state.fichas = Math.max(0, fichas() - dadas);
  state.fichasDeRepor = 0;
  state.progresso.premios = [];
  const tiradas = state.inventario.filter(p => p.origem === 'nivel');
  state.inventario = state.inventario.filter(p => p.origem !== 'nivel');
  salvar();
  return tiradas.map(p => ({ id: p.id, raridade: p.raridade }));
}

// Ficha de repor a loja: gastar uma troca a arara do dia por outra (a troca
// em si é da vitrine, que conhece o sorteio).
export const fichasDeRepor = () => state.fichasDeRepor ?? 0;
export function gastarFichaDeRepor() {
  if (!fichasDeRepor()) return false;
  state.fichasDeRepor = fichasDeRepor() - 1;
  salvar();
  return true;
}

// --- Pontinhos vermelhos ----------------------------------------------------
// Eles só mostram o caminho até uma coisa nova. Cada coisa nova tem uma chave;
// quando a pessoa chega nela (abre a aba, a trilha, a tela de Baús, a coleção),
// a chave entra em `state.vistos` e o caminho apaga, mesmo que a coisa continue
// lá esperando (um baú fechado, um prêmio não pego).
const vistos = () => state.vistos ?? [];
export const naoVistas = (chaves) => chaves.filter(c => !vistos().includes(c));
export function marcarVistas(chaves) {
  const novas = naoVistas(chaves);
  if (!novas.length) return;
  state.vistos = [...vistos(), ...novas].slice(-400);
  salvar();
}

export const novidadesDoTopo = () => (podeTrocarFichas() ? [`troca:${hojeISO()}`] : []);
export const novidadesDoDia = () => [
  marcoDoDiaPronto() && `dia:${hojeISO()}:${marcoDoDiaPronto()}`,
  bauDosDiasPronto() && `bau-dias:${state.semana.data}`,
].filter(Boolean);
export const novidadesDaSemana = () => [
  carimboDaSemanaPronto() && `carimbo-semana:${state.semana.data}`,
  fichasDaSemanaProntas() && `fichas-semana:${state.semana.data}`,
  bauEspecialPronto() && `bau-semanal:${state.stats.semanasCompletas ?? 0}`,
].filter(Boolean);
export const novidadesDosNiveis = () => premiosDoNivelProntos().map(p => `nivel:${p.nivel}`);
export const novidadesDosBaus = () => bausGuardados().map(b => `bau:${b.id}`);
// Coleção: a chave muda a cada item novo ganho para escolher.
export function novidadeDaColecao(id, c = progressoDasColecoes()[id]) {
  return c?.livres > 0 ? `col:${id}:${c.ganhas}` : null;
}
export const novidadesDasColecoes = () =>
  Object.entries(progressoDasColecoes()).map(([id, c]) => novidadeDaColecao(id, c)).filter(Boolean);

// Ainda há caminho a mostrar? Acende o pontinho do botão de Tarefas.
export const temNovidade = () => naoVistas([
  ...novidadesDoTopo(), ...novidadesDoDia(), ...novidadesDaSemana(),
  ...novidadesDosNiveis(), ...novidadesDosBaus(), ...novidadesDasColecoes(),
]).length > 0;

// Tem prêmio esperando o toque? Acende o pontinho do botão de Tarefas.
export const temPremioParaResgatar = () =>
  Boolean(marcoDoDiaPronto()) || fichasDaSemanaProntas() || carimboDaSemanaPronto() ||
  bauDosDiasPronto() || bauEspecialPronto() || podeTrocarFichas() ||
  premiosDoNivelProntos().length > 0 || bausGuardados().length > 0;

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
  colecoes: progressoDasColecoes(),
});

// --- Coleções -------------------------------------------------------------
// A marca de cada peça do acervo, por id. O catálogo preenche ao carregar
// (como raridadesFixas): db não importa catalog.js.
export const marcasFixas = new Map();
// A cor de cada peça do acervo, por id ('' quando não tem). Toda peça do
// acervo entra aqui, então as chaves também são a lista do acervo.
export const coresFixas = new Map();
// O tema de cada peça do acervo que ganhou um na esteira (id de config.ESTILOS).
export const temasFixos = new Map();

const pecasDaMarca = (marca) => {
  const alvo = normalizarMarca(marca);
  const ids = [];
  for (const [id, m] of marcasFixas) if (normalizarMarca(m) === alvo) ids.push(id);
  return ids;
};

// { [id da coleção]: { tem, total, ids } }: as peças da marca no acervo e
// quantas delas estão no seu guarda-roupa.
// Os itens que cada coleção libera, por id da coleção.
const ITENS_DA_COLECAO = new Map();
for (const r of ROUPINHAS) {
  const d = r.desbloqueio;
  if (d?.tipo !== 'colecao') continue;
  if (!ITENS_DA_COLECAO.has(d.colecao)) ITENS_DA_COLECAO.set(d.colecao, []);
  ITENS_DA_COLECAO.get(d.colecao).push(r.id);
}

// Abre um item da coleção, se ela tem escolha sobrando.
export function escolherItem(colecao, id) {
  const pc = progressoDasColecoes()[colecao];
  if (!pc || pc.livres < 1 || !(ITENS_DA_COLECAO.get(colecao) || []).includes(id)) return false;
  if (pc.escolhidas.includes(id)) return false;
  const v = state.vestiario;
  v.escolhas = { ...(v.escolhas || {}), [colecao]: [...pc.escolhidas, id] };
  progredirMissao('colecao');
  salvar();
  return true;
}

// Quantas escolhas estão esperando, somando todas as coleções.
export const escolhasLivres = () =>
  Object.values(progressoDasColecoes()).reduce((n, c) => n + c.livres, 0);

export function progressoDasColecoes() {
  const minhas = new Set(state.inventario.map(p => p.id));
  const out = {};
  const escolhas = state.vestiario.escolhas || {};
  const herdadas = new Set(state.vestiario.herdadas || []);
  const guardar = (id, ids) => {
    const tem = ids.filter(i => minhas.has(i)).length;
    const itens = ITENS_DA_COLECAO.get(id) || [];
    // Item que saiu da coleção não conta como escolha feita.
    const escolhidas = (escolhas[id] || []).filter(i => itens.includes(i));
    const ganhas = escolhasDaColecao(tem, ids.length, itens.length);
    // Item que você já tinha antes das coleções (herdado) não precisa ser
    // escolhido: a escolha só vale enquanto sobrar item trancado.
    const trancados = itens.filter(i => !escolhidas.includes(i) && !herdadas.has(i)).length;
    out[id] = { ids, total: ids.length, tem, escolhidas, ganhas,
                livres: Math.max(0, Math.min(ganhas - escolhidas.length, trancados)) };
  };
  for (const c of COLECOES) guardar(c.id, pecasDaMarca(c.marca));

  // Cor: as peças daquela cor. Tema: as escolhidas para ele (config.ESTILOS)
  // mais as que receberam o tema na esteira (campo `tema` do acervo).
  const acervo = [...coresFixas.keys()];
  for (const cor of Object.keys(COLECOES_DE_COR)) {
    const alvo = normalizarMarca(cor);
    guardar(idDaCor(cor), acervo.filter(id => normalizarMarca(coresFixas.get(id)) === alvo));
  }
  for (const [id, e] of Object.entries(ESTILOS)) {
    const pecas = new Set(e.pecas || []);
    // O tema gravado na peça manda; a lista de config vale para quem não tem.
    guardar(idDoEstilo(id), acervo.filter(p => (temasFixos.has(p) ? temasFixos.get(p) === id : pecas.has(p))));
  }
  return out;
}

// Os itens que trocaram de regra quando as coleções chegaram. Quem já tinha
// um deles pela regra antiga continua com ele: a lista é tirada uma vez, do
// progresso daquele momento, e gravada no save.
//
// Cada item é conferido uma vez só (`herdadasChecadas`): item que entrar numa
// coleção depois também é conferido, com o progresso do dia em que entrou.
export function roupinhasHerdadas() {
  const v = state.vestiario;
  const checadas = new Set(v.herdadasChecadas || []);
  const novas = ROUPINHAS.filter(r => r.antes && !checadas.has(r.id));
  if (novas.length) {
    const p = progressoDoJogador();
    const herdadas = new Set(v.herdadas || []);
    for (const r of novas) {
      if (estadoDoDesbloqueio({ desbloqueio: r.antes }, p).liberada) herdadas.add(r.id);
      checadas.add(r.id);
    }
    v.herdadas = [...herdadas];
    v.herdadasChecadas = [...checadas];
    salvar();
  }
  return v.herdadas;
}

export function estadoDaRoupinha(r) {
  const p = progressoDoJogador();
  const e = estadoDoDesbloqueio(r, p);
  if (e.liberada || !r.antes || !roupinhasHerdadas().includes(r.id)) return e;
  // Já era sua antes da coleção: a procedência é a regra antiga.
  return { ...estadoDoDesbloqueio({ desbloqueio: r.antes }, p), liberada: true, pct: 100 };
}

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
  progredirMissao('vestir');
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
const ACERVO_DO_ADMIN = ['marcas', 'cores'];

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

