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
//
// O arquivo ficou grande e foi dividido por assunto. Aqui moram o `state`, o
// salvar/carregar e a sincronia com a nuvem; o resto está em dbinventario.js
// (dia, fichas, inventário), dbprogresso.js (missões, baús, níveis, XP) e
// dbcolecoes.js (vestiário e coleções). Todos são reexportados abaixo: as telas
// continuam fazendo `import * as db from './db.js'` e não sabem da divisão.

import { hojeISO, semanaISO } from './util.js';
import {
  MISSOES, MISSOES_SEMANA, COLLAB, ASSINATURA_PADRAO, APARENCIA_PADRAO, migrarCategoria,
} from './config.js';
import { VESTIARIO_PADRAO } from './roupinhas.js';
import { virarODiaSeNecessario } from './dbinventario.js';

export * from './dbinventario.js';
export * from './dbprogresso.js';
export * from './dbcolecoes.js';

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
      bio: '',   // o que os outros leem no seu perfil; vazio até a pessoa escrever
      criadoEm: new Date().toISOString(),
      seguindo: [],
      assinatura: { ...ASSINATURA_PADRAO },   // padrão de quem assina as colagens
      assinaturaTexto: '',      // assinatura digitada pela pessoa (vazio = o nome)
      assinaturaImagem: '',     // ou imagem enviada, usada como veio (data URL)
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
    fichasDeRepor: 0,          // missões, trilha ou compradas em Tarefas: trocam a arara do dia
    congeladas: [],            // peças presas na loja com fichas: { id, ate } (ate = último dia, ISO)
    congelamentos: 0,          // compras de congelar feitas em Tarefas, ainda não usadas na loja
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
export function missoesDoDia(data = hojeISO()) {
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
export function missoesDaSemana(data = semanaISO()) {
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

const BIO_ANTIGA = 'garimpando peça por peça.';

function carregar() {
  try {
    const bruto = chave && localStorage.getItem(chave);
    if (!bruto) return estadoInicial();
    const salvo = JSON.parse(bruto);
    const base = estadoInicial();
    const estado = { ...base, ...salvo };
    // A bio padrão antiga não foi a pessoa que escreveu: some.
    if (estado.usuario?.bio === BIO_ANTIGA) estado.usuario.bio = '';
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
