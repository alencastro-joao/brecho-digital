// Parâmetros do protótipo. Tudo que é regra de negócio mora aqui.

import { ancoraNoCorpo, CORPO_EM_TESTE } from './proporcao.js';

export const CONFIG = {
  // Vitrine
  PECAS_NA_VITRINE: 25,     // quantas peças o dono da loja põe no mural por dia
  RESGATES_POR_DIA: 3,      // o "X peças por dia" da descrição técnica
  MIN_DIST_MURAL: 118,      // px entre âncoras no Poisson-disc

  // Acervo do administrador: peças publicadas pela esteira (esteira.html),
  // gravado pela Lambda. É a fonte das peças do jogo.
  ACERVO: 'assets/acervo.json',
  API_PECAS: 'api/pecas',      // PUT: editar peça (peça nova entra pela esteira)

  // O dono da loja some da vitrine enquanto o personagem não volta.
  // Vira true e ele reaparece com o balão de fala, sem mais nenhuma mudança.
  NPC_VISIVEL: false,

  // Palco do Stylist (unidades internas; o CSS escala proporcionalmente)
  STAGE_W: 600,
  STAGE_H: 1200,
};

// ------------------------------- Modo administrador ----------------------
// Subir peça é ferramenta de administração, não função do jogo: o usuário final
// não vê o botão.
//
// Quem é administrador está na conta (coluna `papel`, em tools/contas.py), e é o
// servidor que decide — ele recusa POST/PUT em /api/pecas de quem não for. Esta
// constante é só a interface: mostrar botão a quem não pode usar é ruim, mas
// escondê-lo nunca foi segurança.
//
// `?admin=0` continua existindo, agora com outro sentido: é o administrador
// pedindo para ver o brechó como um usuário comum vê. `?admin=1` desfaz.
function modoDesligado() {
  const q = new URLSearchParams(location.search).get('admin');
  try {
    if (q === '0') localStorage.setItem('bd-admin', 'off');
    if (q === '1') localStorage.removeItem('bd-admin');
    return localStorage.getItem('bd-admin') === 'off';
  } catch {
    return q === '0';
  }
}

// `let` de propósito: o valor só é conhecido depois do login, e os módulos que
// importam ADMIN leem a ligação viva — desde que leiam no uso, não no topo do
// arquivo. O boot chama aplicarPapel() antes de montar qualquer tela.
export let ADMIN = false;

export function aplicarPapel(papel) {
  ADMIN = papel === 'admin' && !modoDesligado();
  return ADMIN;
}

// Hierarquia de raridade.
// A peça já nasce com a sua raridade no sorteio do dia — por isso ela aparece
// com aura na vitrine, antes mesmo de ser resgatada — e o valor fica gravado
// junto da peça quando entra no guarda-roupa (não re-sorteia depois).
//
// cor/bg: borda e fundo do slot no closet.
// aura:   cor do brilho que envolve a peça (null = sem aura).
// tiragem: quantas cópias de cada peça existem no jogo, somando todas as
//          contas. Esgotou, some da vitrine (ver estoque.js).
// naLoja: quantas peças desta raridade a arara do dia leva, com a chance de
//         cada quantidade em % (soma 100). É ela, e não o peso, que decide a
//         loja: o acervo já nasce com raridade fixa na ficha, e sortear as 25
//         peças sem olhar raridade trazia as ~2 épicas que o acervo tem em cada
//         25 — todo santo dia. Comum não tem `naLoja`: ela completa a arara.
// peso:   a raridade de quem não tem ficha (catálogo base, presente).
export const RARIDADES = [
  { id: 'common',    nome: 'Comum',    peso: 60, naLoja: null,
    tiragem: 1000, cor: '#e8e8e8', bg: '#ffffff', aura: null },
  { id: 'uncommon',  nome: 'Incomum',  peso: 25, naLoja: { 4: 25, 5: 45, 6: 30 },
    tiragem: 500, cor: '#9ae0b5', bg: '#f4fbf6', aura: '#2fbf63' },
  { id: 'rare',      nome: 'Rara',     peso: 11, naLoja: { 1: 20, 2: 50, 3: 30 },
    tiragem: 300, cor: '#b9d6f2', bg: '#f0f7ff', aura: '#2f7ff0' },
  { id: 'epic',      nome: 'Épica',    peso: 3,  naLoja: { 0: 25, 1: 63, 2: 12 },
    tiragem: 100, cor: '#c3a6f2', bg: '#f8f4ff', aura: '#9b46f0' },
  { id: 'legendary', nome: 'Lendária', peso: 1,  naLoja: { 0: 93, 1: 7 },
    tiragem: 25, cor: '#efd469', bg: '#fffdf2', aura: 'arco-iris' },
];
export const RARIDADE = Object.fromEntries(RARIDADES.map(r => [r.id, r]));

// Em quantas lojas, de cada 100, aparece pelo menos uma peça desta raridade.
export const chanceNaLoja = (r) => (r?.naLoja ? 100 - (r.naLoja[0] ?? 0) : 100);

// ------------------------- Presente de boas-vindas ------------------------
// Conta nova entra com guarda-roupa vazio, e guarda-roupa vazio é tela vazia:
// o closet sem nada, o Stylist sem o que vestir e o personagem pelado. O
// presente é o mínimo para o jogo existir na primeira sessão — duas de cada uma
// das três categorias que fecham um look (camisa + calça + sapato), então dá para
// montar e ainda ter troca.
//
// As faixas dizem de quais raridades o presente pode sair: só comum e incomum.
// O presente não compete com o garimpo — rara para cima continua sendo coisa de
// quem apareceu na loja. Dentro dessas duas, o sorteio usa os pesos de RARIDADES
// (60 contra 25), então a incomum sai em ~3 de cada 10 peças, a mesma proporção
// que ela tem na arara.
export const PRESENTE = {
  itens: [
    { cat: 'shirts', quantas: 2 },
    { cat: 'pants', quantas: 2 },
    { cat: 'shoes', quantas: 2 },
  ],
  faixas: ['common', 'uncommon'],
  daCor: 3,   // quantas das peças são de uma cor sorteada (1º marco da coleção dela)
};

// ------------------------------- Cores -----------------------------------
// A cor da peça é campo livre, como a marca — esta lista é só o ponto de
// partida: dá o atalho em chip, o autocomplete e a bolinha de cor. Cor digitada
// fora dela funciona igual, só entra sem bolinha colorida.
export const CORES = [
  { nome: 'Preto',     hex: '#1c1a18' },
  { nome: 'Branco',    hex: '#f7f5f1' },
  { nome: 'Cinza',     hex: '#9b958c' },
  { nome: 'Bege',      hex: '#ddcbab' },
  { nome: 'Marrom',    hex: '#6b4a2f' },
  { nome: 'Vermelho',  hex: '#c8342f' },
  { nome: 'Rosa',      hex: '#e78fae' },
  { nome: 'Laranja',   hex: '#e2813a' },
  { nome: 'Amarelo',   hex: '#e8c24a' },
  { nome: 'Verde',     hex: '#4f8f5c' },
  { nome: 'Azul',      hex: '#3c6fb4' },
  { nome: 'Roxo',      hex: '#7d5bb0' },
  { nome: 'Dourado',   hex: '#c9a227' },
  { nome: 'Prateado',  hex: '#b9bcc0' },
  { nome: 'Estampado', hex: 'estampa' },
];

const semAcento = (t) => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const CORES_POR_NOME = new Map(CORES.map(c => [semAcento(c.nome), c]));

// Cor conhecida → hex (ou 'estampa'); cor inventada → null, e a bolinha fica
// neutra. Serve para o chip da ficha e para qualquer tela que mostre a cor.
export const hexDaCor = (nome) => CORES_POR_NOME.get(semAcento(nome))?.hex ?? null;

// --------------------- Reconhecer a cor de uma imagem ---------------------
// Nomear cor é diferente de medir cor. Quem olha uma calça mauve diz "rosa",
// não "cinza levemente quente" — o nome segue o tom, e aguenta bem a peça ser
// mais clara ou mais lavada que a cor da lista. Daí os dois passos daqui:
// primeiro o pixel é neutro ou colorido, e só o colorido é comparado com a
// paleta, num espaço onde o tom pesa mais que o resto.
//
// Dourado e Prateado ficam de fora: metal é brilho, não cor — na foto eles são
// só um amarelo escuro e um cinza claro, e deixá-los concorrendo faz toda peça
// bege virar dourada e toda camiseta branca virar prateada. Continuam à mão,
// que é onde quem está olhando a peça sabe que ela é metálica.

// sRGB → Lab (D65). A comparação tem que sair do RGB: nele um bege escuro fica
// mais perto de cinza do que de marrom.
function paraLab(r, g, b) {
  const linear = (v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const R = linear(r), G = linear(g), B = linear(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = (R * 0.2126 + G * 0.7152 + B * 0.0722);
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : t * 7.787 + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// Distância entre dois Lab com os pesos da nomeação: o tom (o que sobra depois
// de tirar claridade e saturação) vale inteiro, a saturação vale um quarto e a
// claridade um terço. É o que põe um verde-sálvia lavado em "Verde" em vez de
// "Bege", que é onde a distância crua o deixa.
const PESO_L = 3, PESO_C = 4;

function distanciaLab(a, b) {
  const dL = (a[0] - b[0]) / PESO_L;
  const ca = Math.hypot(a[1], a[2]);
  const cb = Math.hypot(b[1], b[2]);
  const dC = (ca - cb) / PESO_C;
  const da = a[1] - b[1], db = a[2] - b[2];
  const dT = Math.max(0, da * da + db * db - (ca - cb) ** 2);   // o tom, ao quadrado
  return Math.sqrt(dL * dL + dC * dC + dT);
}

const LAB_DA_COR = new Map(CORES
  .filter(c => c.hex && c.hex !== 'estampa')
  .map(c => {
    const n = parseInt(c.hex.slice(1), 16);
    return [semAcento(c.nome), paraLab((n >> 16) & 255, (n >> 8) & 255, n & 255)];
  }));

// As cores com tom próprio, que é o que a comparação sabe fazer. Preto, Branco
// e Cinza saem por claridade, e os metálicos não entram (ver acima).
const CROMATICAS = ['Bege', 'Marrom', 'Vermelho', 'Rosa', 'Laranja', 'Amarelo',
  'Verde', 'Azul', 'Roxo']
  .map(nome => ({ nome, lab: LAB_DA_COR.get(semAcento(nome)) }));

// Abaixo de quanta saturação o pixel não tem tom para nomear. O limite sobe com
// a claridade porque cor escura é saturada de menos e cor clara de mais: sem
// isso um jeans preto-esverdeado vira verde e um cinza-claro azulado vira azul.
const limiarDeCroma = (L) => 7 + L * 0.05;

// A cor deste pixel, já dizendo se ela veio do tom ou só da claridade — quem
// chama usa isso para saber se a peça é colorida ou neutra no conjunto.
export function corDoPixel(r, g, b) {
  const lab = paraLab(r, g, b);
  const croma = Math.hypot(lab[1], lab[2]);
  if (croma < limiarDeCroma(lab[0])) {
    const nome = lab[0] < 30 ? 'Preto' : (lab[0] < 75 ? 'Cinza' : 'Branco');
    return { nome, colorida: false };
  }
  let melhor = CROMATICAS[0], menor = Infinity;
  for (const c of CROMATICAS) {
    const d = distanciaLab(lab, c.lab);
    if (d < menor) { menor = d; melhor = c; }
  }
  return { nome: melhor.nome, colorida: true };
}

// Duas cores da paleta são parecidas? Serve para separar sombra de estampa: o
// marrom que aparece na dobra de uma peça vermelha é perto do vermelho, o
// amarelo de uma estampa não é perto de nada dela.
export function distanciaEntreCores(a, b) {
  const la = LAB_DA_COR.get(semAcento(a));
  const lb = LAB_DA_COR.get(semAcento(b));
  return la && lb ? distanciaLab(la, lb) : 0;
}

// ------------------------------- Escala das peças -------------------------
// O recorte não carrega escala nenhuma: o PNG de um anel tem o mesmo tamanho do
// de um casaco. Sem uma tabela, todo lugar que faz a peça "preencher a caixa"
// acaba com relógio do tamanho de calça.
//
// TAMANHO é o tamanho relativo de cada categoria no mundo real, com casaco = 1.
// É a única fonte de verdade; as telas derivam dele.
export const TAMANHO = {
  coats:     1.00,
  dresses:   0.94,
  pants:     0.90,
  shirts:    0.78,
  skirts:    0.66,
  cropped:   0.64,
  shorts:    0.62,
  shoes:     0.58,
  bags:      0.52,
  hats:      0.46,
  belts:     0.40,
  glasses:   0.34,
  necklaces: 0.30,
  watches:   0.24,
  bracelets: 0.20,
};

// Exceções peça a peça (multiplicador). Serve para o casaco extra-longo ou o
// brinco minúsculo que fogem da média da categoria. Ex.: { '39': 1.3 }
export const ESCALA_PECA = {};

// Duas curvas sobre o mesmo número:
//
// grade  — comprimida. Na célula do guarda-roupa a proporção real deixaria o
//          anel do tamanho de um grão; aqui ele fica visivelmente menor que o
//          casaco, mas ainda dá para ver o que é.
// mural  — solta. Na vitrine e na prancheta a peça convive com as outras numa
//          composição, então vale respeitar mais a proporção de verdade.
const LARGURA_REFERENCIA = 310;   // casaco no molde = tamanho 1

// Tamanho relativo de uma peça. Se ela foi dimensionada no molde (peça própria),
// vale a medida dela; senão, cai no padrão da categoria.
export function tamanhoDaPeca(peca) {
  if (peca?.ancora?.w) {
    return Math.min(1.4, Math.max(0.04, peca.ancora.w / LARGURA_REFERENCIA));
  }
  return TAMANHO[peca?.cat] ?? 0.7;
}

// Onde a peça encosta no corpo: a medida da própria peça, quando existe, ou o
// ponto padrão da categoria. A camada (z) é sempre a da categoria — quem veste
// por cima de quem não é escolha da peça.
//
// Medida e ponto padrão estão no molde; o que sai daqui já está no corpo, na
// proporção de agora (js/proporcao.js). O tamanho da peça na vitrine
// (`tamanhoDaPeca`) continua lendo a medida crua: a loja não tem corpo.
export function ancoraDaPeca(peca) {
  const padrao = CATEGORIAS[peca?.cat]?.anchor ?? { x: 300, y: 500, w: 240, z: 30 };
  const molde = peca?.ancora?.w ? { ...padrao, ...peca.ancora, z: padrao.z } : padrao;
  const noCorpo = ancoraNoCorpo(CATEGORIAS[peca?.cat]?.regiao, molde);
  return peca?.ancora?.w && !medidaNoCorpoDaArtista(peca) ? ajustarPecaAntiga(peca.cat, noCorpo) : noCorpo;
}

// ---------------------- Peças medidas no boneco antigo ----------------------
// As medidas são gravadas no molde e levadas ao corpo por uma escala por
// região (js/proporcao.js). Só que o corpo da artista não é o boneco antigo
// esticado: o tronco é uns 15% mais largo, os braços saem mais para fora, as
// mãos ficam ~65 mais baixas e as pernas se separam ~100 mais alto. Cabeça e
// pés batem. Peça medida a olho em cima do boneco antigo sai estreita no
// tronco e com a bolsa acima da mão.
//
// Mudar a escala da região consertaria essas e entortaria as medidas novas
// (que também são gravadas desfazendo a escala de agora). Então a correção é
// só das antigas, na hora de mostrar: nada salvo muda, e medir de novo no
// editor grava a marca `ancora.corpo` e tira a peça daqui.
//
// Quem é antiga: sem a marca, salva no editor antes do corpo novo entrar
// (#74) ou publicada pela esteira antes de ela desenhar o corpo novo (#83).
const CORPO_NOVO_NO_EDITOR = Date.parse('2026-10-16T23:31:47Z');
const CORPO_NOVO_NA_ESTEIRA = Date.parse('2026-10-17T17:21:34Z');

export function medidaNoCorpoDaArtista(peca) {
  if (peca?.ancora?.corpo) return peca.ancora.corpo === 'artista';
  const editada = Date.parse(peca?.editadoEm || '');
  const criada = Date.parse(peca?.criadoEm || '');
  return editada >= CORPO_NOVO_NO_EDITOR || criada >= CORPO_NOVO_NA_ESTEIRA;
}

// Por categoria, em unidades do palco (já no corpo): `k` multiplica a largura
// (e a altura, que segue a foto) em volta da linha `y0`, que fica parada —
// a gola no ombro, o cós na cintura, a sola no chão. `dx` abre para fora
// (espelhado no lado da peça) e `dy` desce. Medido nas silhuetas dos dois
// corpos; calça e saia não ficam perfeitas porque o gancho da foto não sobe
// sem esticar a perna, e essas vão para a revisão no editor.
const TRONCO_ANTIGO = { k: 1.17, y0: 272 };
const PERNA_ANTIGA = { k: 1.1, y0: 505 };
const MAO_ANTIGA = { k: 1, dx: 13, dy: 66 };
export const AJUSTE_PECA_ANTIGA = {
  shirts: TRONCO_ANTIGO, cropped: TRONCO_ANTIGO, coats: TRONCO_ANTIGO, dresses: TRONCO_ANTIGO,
  pants: PERNA_ANTIGA, shorts: PERNA_ANTIGA, skirts: PERNA_ANTIGA,
  shoes: { k: 1.04, y0: 1144 },
  bags: MAO_ANTIGA, watches: MAO_ANTIGA, bracelets: MAO_ANTIGA,
};

// ?ajuste=antes desliga a correção naquele carregamento, para comparar.
const SEM_AJUSTE = (() => {
  try { return new URLSearchParams(globalThis.location?.search || '').get('ajuste') === 'antes'; }
  catch { return false; }
})();

export function ajustarPecaAntiga(cat, a) {
  const aj = AJUSTE_PECA_ANTIGA[cat];
  // O ajuste leva ao corpo da artista; no boneco antigo (?proporcao=padrao)
  // a peça antiga já está no lugar.
  if (!aj || SEM_AJUSTE || CORPO_EM_TESTE !== 'artista') return a;
  const k = aj.k ?? 1;
  const lado = a.x < 300 ? -1 : a.x > 300 ? 1 : 0;
  const y0 = aj.y0 ?? a.y;
  return {
    ...a,
    x: a.x + lado * (aj.dx ?? 0),
    y: y0 + k * (a.y - y0) + (aj.dy ?? 0),
    w: a.w * k,
  };
}

// O ponto padrão de uma categoria, já no corpo: é de onde o molde começa.
export const ancoraPadrao = (cat) =>
  ancoraNoCorpo(CATEGORIAS[cat]?.regiao, CATEGORIAS[cat]?.anchor ?? { x: 300, y: 600, w: 200 });

const excecao = (id) => ESCALA_PECA[id] ?? 1;

export const escalaGrade = (peca) => (0.46 + 0.54 * tamanhoDaPeca(peca)) * excecao(peca?.id);
export const escalaMural = (peca) => (0.30 + 0.70 * tamanhoDaPeca(peca)) * excecao(peca?.id);

// Tamanho no mural da vitrine. Quem manda é a LARGURA: ela é o que foi medido
// no molde, então duas camisas medidas iguais têm que sair iguais na loja,
// mesmo que uma tenha sido recortada mais alta que a outra. A altura vem da
// proporção da imagem, com um teto para o vestido longo não virar cartaz.
// O teto de altura é só um freio contra a peça absurda — precisa ficar acima
// da peça longa legítima. Com ele baixo demais quem pagava era a calça: ela é
// a peça mais alta do acervo, batia no teto e perdia *largura* para caber,
// terminando menor que a camisa. Peça comprida tem que poder ser comprida.
export const LARGURA_MURAL = 252;    // peça de tamanho 1 (casaco), em px
export const ALTURA_MAX_MURAL = 540;

export function tamanhoNoMural(peca, prop) {
  let w = LARGURA_MURAL * escalaMural(peca);
  let h = w / (prop || 1);
  if (h > ALTURA_MAX_MURAL) { h = ALTURA_MAX_MURAL; w = h * (prop || 1); }
  return { w: Math.round(w), h: Math.round(h) };
}

// Categorias: rótulo, ícone, parte do corpo e como a peça se encaixa no avatar.
// anchor = ponto de ancoragem em unidades de palco; w = largura alvo; z = camada.
// É a "engine de lookbook" do roadmap: z-index fixo por tipo de peça.
//
// A peça só guarda a categoria (`cat`). A parte do corpo (`regiao`) sai daqui,
// nunca é gravada: quem cadastra escolhe "Bermuda" e a peça já está em "Perna".
export const CATEGORIAS = {
  shoes:     { nome: 'Sapatos',   icone: '👟', regiao: 'pes',    anchor: { x: 300, y: 1096, w: 248, z: 28 } },
  pants:     { nome: 'Calças',    icone: '👖', regiao: 'perna',  anchor: { x: 300, y: 796, w: 236, z: 20 } },
  shorts:    { nome: 'Bermudas',  icone: '🩳', regiao: 'perna',  anchor: { x: 300, y: 652, w: 240, z: 20 } },
  skirts:    { nome: 'Saias',     icone: '🥻', regiao: 'perna',  anchor: { x: 300, y: 676, w: 250, z: 21 } },
  dresses:   { nome: 'Vestidos',  icone: '👗', regiao: 'tronco', anchor: { x: 300, y: 486, w: 272, z: 25 } },
  shirts:    { nome: 'Camisas',   icone: '👕', regiao: 'tronco', anchor: { x: 300, y: 358, w: 250, z: 30 } },
  coats:     { nome: 'Casacos',   icone: '🧥', regiao: 'tronco', anchor: { x: 300, y: 436, w: 310, z: 40 } },
  cropped:   { nome: 'Tops',      icone: '🎽', regiao: 'tronco', anchor: { x: 300, y: 336, w: 228, z: 31 } },
  watches:   { nome: 'Relógios',  icone: '⌚', regiao: 'maos',   anchor: { x: 172, y: 652, w: 72,  z: 55 } },
  bracelets: { nome: 'Pulseiras', icone: '💍', regiao: 'maos',   anchor: { x: 428, y: 660, w: 62,  z: 54 } },
  necklaces: { nome: 'Colares',   icone: '📿', regiao: 'tronco', anchor: { x: 300, y: 300, w: 120, z: 45 } },
  glasses:   { nome: 'Óculos',    icone: '🕶️', regiao: 'cabeca', anchor: { x: 300, y: 116, w: 124, z: 60 } },
  hats:      { nome: 'Chapéus',   icone: '👒', regiao: 'cabeca', anchor: { x: 300, y: 84,  w: 176, z: 65 } },
  bags:      { nome: 'Bolsas',    icone: '👜', regiao: 'maos',   anchor: { x: 440, y: 646, w: 152, z: 50 } },
  // Cinto: no cós (y=572 do molde, ~517 no corpo da artista) e por cima de
  // toda roupa — calça, saia, vestido, camisa e casaco. É acessório, então vai
  // na escala do tronco (a das mãos). Categoria nova: não tem medida no
  // boneco antigo, então fica fora de AJUSTE_PECA_ANTIGA.
  belts:     { nome: 'Cintos',    icone: '🪢', regiao: 'maos',   anchor: { x: 300, y: 566, w: 365, z: 42 } },
};
export const ORDEM_CATEGORIAS = Object.keys(CATEGORIAS);

// A segunda forma de organizar: por onde a peça vai no corpo, de cima para baixo.
export const REGIOES = {
  cabeca: { nome: 'Cabeça', icone: '🧢' },
  tronco: { nome: 'Tronco', icone: '👚' },
  perna:  { nome: 'Perna',  icone: '👖' },
  pes:    { nome: 'Pés',    icone: '🥾' },
  maos:   { nome: 'Acessórios', icone: '👜' },
};
export const ORDEM_REGIOES = Object.keys(REGIOES);

// Rótulo do seletor de categoria no cadastro: escolhe-se o tipo, e o rótulo já
// mostra a parte do corpo que vem junto ("👕 Camisas · Tronco").
export const rotuloDeCadastro = (cat) =>
  `${CATEGORIAS[cat].icone} ${CATEGORIAS[cat].nome} · ${REGIOES[CATEGORIAS[cat].regiao].nome}`;

// Categorias de antes desta lista. Peça e save antigos continuam gravados com
// elas (o acervo na nuvem, o inventário de cada conta, looks e colagens), então
// toda leitura passa por `migrarCategoria`. O 'tops' de antes era camiseta e
// camisa — por isso o "Tops" de agora (cropped, regata) é `cropped`, e não
// reaproveita a chave: um 'tops' gravado sempre quer dizer Camisas.
const CATEGORIAS_ANTIGAS = { tops: 'shirts', acc: 'glasses', rings: 'bracelets' };
export const migrarCategoria = (cat) => CATEGORIAS_ANTIGAS[cat] ?? cat;

// As duas formas de organizar as telas de roupa (closet, Stylist, Colagem). A
// pessoa escolhe uma — `usuario.preferencias.agrupamento` — e vale nas três.
export const AGRUPAMENTOS = {
  tipo:  { nome: 'Peça',  titulo: 'Por tipo de peça',     grupos: CATEGORIAS, ordem: ORDEM_CATEGORIAS,
           de: (cat) => cat },
  corpo: { nome: 'Corpo', titulo: 'Por parte do corpo',   grupos: REGIOES,    ordem: ORDEM_REGIOES,
           de: (cat) => CATEGORIAS[cat]?.regiao },
};

// Coleção cápsula do mês: fica fora do sorteio diário e só entra no
// guarda-roupa quando todas as missões do mês são concluídas.
export const COLLAB = {
  mes: '2026-09',
  ilustrador: 'Ilustrador convidado #01',
  titulo: 'Cápsula de Setembro',
  descricao: 'Cinco peças desenhadas para os avatares, na estética do artista do mês.',
  itens: ['41', '46', '51', '54', '57'],
};


// ---------------------------- Personagem ----------------------------------
// Corpo: a silhueta que veste o look. Os dois compartilham o que as âncoras de
// CATEGORIAS dependem — mesma cabeça, mesma linha de ombro (y=262), mesma mão
// (172/428, 694), mesmo pé (250/350, 1118) e mesmo chão. O que muda é a
// largura: ombro, cintura, quadril e a grossura de braço e perna. Assim um
// relógio, um anel ou uma bolsa continuam caindo no lugar nos dois.
//
// `partes(extra)` devolve as peças com a espessura já resolvida, separadas por
// região — pernas, tronco (com braços e pescoço) e cabeça —, porque cada uma
// é desenhada na escala dela (ver js/proporcao.js). `extra` é o quanto o
// desenho engorda para virar contorno (ver avatar.js); a cor vem do grupo que
// envolve tudo, então nada aqui pinta a si mesmo.
//
// O pescoço começa bem dentro da cabeça (y=120, escondido por ela): com a
// cabeça maior e o ombro mais baixo, a emenda entre os dois continua coberta.
export const CORPOS = {
  masculino: {
    nome: 'Masculino',
    // Medidas que as roupinhas usam para caber neste corpo (ver js/roupinhas.js).
    // Meia-largura em cada linha do corpo, mais os pontos de controle do braço
    // e da perna — a manga e a calça são o próprio membro, engordado.
    medidas: {
      pescoco: 21, ombro: 112, peito: 104, cintura: 80, barra: 87,
      quadril: 92, virilha: 74, braco: 23, mangaX: 180, mao: 24,
      coxa: 38, pe: 46,
      bracoX: [206, 176, 168, 172],
      pernaX: [268, 256, 250, 254],
    },
    partes: (extra) => ({
      pernas: `
    <path d="M268 606 C 256 768, 250 924, 254 1086" fill="none" stroke-width="${76 + extra}"/>
    <path d="M332 606 C 344 768, 350 924, 346 1086" fill="none" stroke-width="${76 + extra}"/>
    <ellipse cx="250" cy="1118" rx="46" ry="26"/>
    <ellipse cx="350" cy="1118" rx="46" ry="26"/>`,
      tronco: `
    <!-- braços -->
    <path d="M206 262 C 176 344, 168 486, 172 660" fill="none" stroke-width="${46 + extra}"/>
    <path d="M394 262 C 424 344, 432 486, 428 660" fill="none" stroke-width="${46 + extra}"/>
    <circle cx="172" cy="694" r="24"/>
    <circle cx="428" cy="694" r="24"/>
    <!-- tronco: ombro largo, cintura discreta, quadril estreito que fecha na coxa -->
    <path d="M300 208 C 356 208, 404 234, 412 262
             C 420 322, 400 408, 384 470
             C 374 524, 388 562, 392 598
             C 390 634, 380 658, 374 676
             L 226 676
             C 220 658, 210 634, 208 598
             C 212 562, 226 524, 216 470
             C 200 408, 180 322, 188 262
             C 196 234, 244 208, 300 208 Z"/>
    <!-- pescoço -->
    <rect x="279" y="120" width="42" height="102" rx="18"/>`,
      cabeca: `
    <ellipse cx="300" cy="112" rx="56" ry="70"/>`,
    }),
  },

  feminino: {
    nome: 'Feminino',
    medidas: {
      pescoco: 17, ombro: 88, peito: 75, cintura: 59, barra: 73,
      quadril: 86, virilha: 72, braco: 19, mangaX: 190, mao: 22,
      coxa: 35, pe: 43,
      bracoX: [222, 192, 168, 172],
      pernaX: [272, 262, 252, 252],
    },
    partes: (extra) => ({
      // pernas: mais finas, e no mesmo pé do outro corpo
      pernas: `
    <path d="M272 606 C 262 770, 252 926, 252 1088" fill="none" stroke-width="${70 + extra}"/>
    <path d="M328 606 C 338 770, 348 926, 348 1088" fill="none" stroke-width="${70 + extra}"/>
    <ellipse cx="250" cy="1118" rx="43" ry="25"/>
    <ellipse cx="350" cy="1118" rx="43" ry="25"/>`,
      tronco: `
    <!-- braços: mais finos, saindo de um ombro estreito para a mesma mão -->
    <path d="M222 262 C 192 344, 168 486, 172 660" fill="none" stroke-width="${38 + extra}"/>
    <path d="M378 262 C 408 344, 432 486, 428 660" fill="none" stroke-width="${38 + extra}"/>
    <circle cx="172" cy="694" r="22"/>
    <circle cx="428" cy="694" r="22"/>
    <!-- tronco: ombro estreito, cintura marcada, quadril cheio. Diferente do
         outro corpo, ele não para na linha do quadril: desce afinando até a
         largura exata das coxas (232–368), senão a quina do quadril vira saia -->
    <path d="M300 206 C 348 206, 382 232, 388 262
             C 394 316, 376 384, 356 440
             C 340 500, 392 552, 386 612
             C 382 650, 374 672, 370 690
             L 230 690
             C 226 672, 218 650, 214 612
             C 208 552, 260 500, 244 440
             C 224 384, 206 316, 212 262
             C 218 232, 252 206, 300 206 Z"/>
    <!-- pescoço -->
    <rect x="283" y="120" width="34" height="102" rx="16"/>`,
      cabeca: `
    <ellipse cx="300" cy="112" rx="56" ry="70"/>`,
    }),
  },
};
export const ORDEM_CORPOS = Object.keys(CORPOS);

// Tom de pele: a cor do corpo e o traço que a acompanha. As humanas vêm
// primeiro (o avatar cai em PELES[1] quando não conhece o id) e as de fantasia
// depois — o personagem não precisa ser gente, e a paleta assume isso.
export const PELES = [
  { id: 'porcelana', nome: 'Porcelana', cor: '#f3ddc9', traco: '#dcc2aa', grupo: 'humana' },
  { id: 'clara',     nome: 'Clara',     cor: '#e7ded4', traco: '#cfc2b3', grupo: 'humana' },
  { id: 'bege',      nome: 'Bege',      cor: '#e2c39d', traco: '#c5a075', grupo: 'humana' },
  { id: 'media',     nome: 'Média',     cor: '#c9935f', traco: '#a5723f', grupo: 'humana' },
  { id: 'castanha',  nome: 'Castanha',  cor: '#96603a', traco: '#75462a', grupo: 'humana' },
  { id: 'escura',    nome: 'Escura',    cor: '#5f3c26', traco: '#42281a', grupo: 'humana' },

  { id: 'menta',    nome: 'Menta',     cor: '#9ed8bb', traco: '#68a68c', grupo: 'fantasia' },
  { id: 'folha',    nome: 'Folha',     cor: '#7fb069', traco: '#548a44', grupo: 'fantasia' },
  { id: 'bruma',    nome: 'Bruma',     cor: '#dfe8ef', traco: '#adbcc9', grupo: 'fantasia' },
  { id: 'ceu',      nome: 'Céu',       cor: '#a9cfeb', traco: '#78a6c8', grupo: 'fantasia' },
  { id: 'oceano',   nome: 'Oceano',    cor: '#5c8ecb', traco: '#3c6697', grupo: 'fantasia' },
  { id: 'lavanda',  nome: 'Lavanda',   cor: '#cbb6e8', traco: '#9f89c2', grupo: 'fantasia' },
  { id: 'ametista', nome: 'Ametista',  cor: '#8a6bb8', traco: '#61458b', grupo: 'fantasia' },
  { id: 'quartzo',  nome: 'Quartzo',   cor: '#f2b8c6', traco: '#cf889a', grupo: 'fantasia' },
  { id: 'coral',    nome: 'Coral',     cor: '#ef8f6e', traco: '#c5694b', grupo: 'fantasia' },
  { id: 'brasa',    nome: 'Brasa',     cor: '#cf4b3c', traco: '#94301f', grupo: 'fantasia' },
  { id: 'dourado',  nome: 'Dourado',   cor: '#e8c46a', traco: '#bd993c', grupo: 'fantasia' },
  { id: 'pedra',    nome: 'Pedra',     cor: '#b6b6b2', traco: '#8b8b86', grupo: 'fantasia' },
  { id: 'grafite',  nome: 'Grafite',   cor: '#5d6168', traco: '#3c4047', grupo: 'fantasia' },
  { id: 'breu',     nome: 'Breu',      cor: '#2b2a33', traco: '#15141b', grupo: 'fantasia' },
];

// Cortes de cabelo. `atras` é desenhado antes do corpo (fica por trás da
// cabeça e dos ombros); `frente` vem depois. {cor} é trocado pela cor escolhida.
export const CABELOS = {
  nenhum: { nome: 'Raspado', frente: '' },

  curto: {
    nome: 'Curto',
    frente: `<path d="M244 112 C244 58 266 40 300 40 C334 40 356 58 356 112
                       C350 86 330 78 300 78 C270 78 250 86 244 112 Z" fill="{cor}"/>`,
  },

  franja: {
    nome: 'Franja',
    frente: `<path d="M244 116 C244 56 266 38 300 38 C334 38 356 56 356 116
                       C352 94 342 84 300 94 C258 104 248 98 244 116 Z" fill="{cor}"/>`,
  },

  chanel: {
    nome: 'Chanel',
    atras: `<path d="M238 112 C238 48 264 30 300 30 C336 30 362 48 362 112
                      L362 212 C346 222 330 218 326 206 L326 120 L274 120 L274 206
                      C270 218 254 222 238 212 Z" fill="{cor}"/>`,
    frente: `<path d="M244 112 C244 56 266 38 300 38 C334 38 356 56 356 112
                       C348 88 330 80 300 80 C270 80 252 88 244 112 Z" fill="{cor}"/>`,
  },

  longo: {
    nome: 'Longo',
    atras: `<path d="M240 112 C240 48 264 30 300 30 C336 30 360 48 360 112
                      L372 430 C352 446 336 440 330 424 L322 130 L278 130 L270 424
                      C264 440 248 446 228 430 Z" fill="{cor}"/>`,
    frente: `<path d="M244 112 C244 56 266 38 300 38 C334 38 356 56 356 112
                       C348 88 330 80 300 80 C270 80 252 88 244 112 Z" fill="{cor}"/>`,
  },

  coque: {
    nome: 'Coque',
    frente: `<g fill="{cor}">
               <circle cx="300" cy="26" r="25"/>
               <path d="M244 110 C244 60 268 42 300 42 C332 42 356 60 356 110
                        C350 86 328 78 300 78 C272 78 250 86 244 110 Z"/>
             </g>`,
  },

  cacheado: {
    nome: 'Cacheado',
    frente: `<g fill="{cor}">
               <circle cx="300" cy="52" r="32"/>
               <circle cx="258" cy="74" r="27"/>
               <circle cx="342" cy="74" r="27"/>
               <circle cx="244" cy="108" r="21"/>
               <circle cx="356" cy="108" r="21"/>
               <path d="M248 110 C248 66 270 48 300 48 C330 48 352 66 352 110
                        C346 92 328 84 300 84 C272 84 254 92 248 110 Z"/>
             </g>`,
  },

  trancas: {
    nome: 'Tranças',
    atras: `<g fill="{cor}">
              <path d="M244 110 C244 52 266 34 300 34 C334 34 356 52 356 110 L356 130
                       L244 130 Z"/>
              <rect x="232" y="120" width="22" height="210" rx="11"/>
              <rect x="346" y="120" width="22" height="210" rx="11"/>
            </g>`,
    frente: `<path d="M244 112 C244 58 268 40 300 40 C332 40 356 58 356 112
                       C350 88 328 80 300 80 C272 80 250 88 244 112 Z" fill="{cor}"/>`,
  },

  pixie: {
    nome: 'Pixie',
    frente: `<path d="M240 122 C238 58 264 36 300 36 C338 36 360 60 356 112
                       C350 88 340 78 322 74 C300 86 272 104 252 104
                       C246 110 242 116 240 122 Z" fill="{cor}"/>`,
  },

  espetado: {
    nome: 'Espetado',
    frente: `<g fill="{cor}">
               <path d="M244 108 C244 60 268 42 300 42 C332 42 356 60 356 108
                        C350 84 328 76 300 76 C272 76 250 84 244 108 Z"/>
               <path d="M256 66 L238 32 L278 52 Z"/>
               <path d="M282 50 L294 12 L312 48 Z"/>
               <path d="M320 52 L362 34 L342 70 Z"/>
             </g>`,
  },

  moicano: {
    nome: 'Moicano',
    frente: `<path d="M270 108 C266 74 280 34 300 24 C320 34 334 74 330 108
                       C322 120 278 120 270 108 Z" fill="{cor}"/>`,
  },

  topete: {
    nome: 'Topete',
    frente: `<g fill="{cor}">
               <path d="M244 112 C244 62 268 44 300 44 C332 44 356 62 356 112
                        C350 88 330 80 300 80 C270 80 250 88 244 112 Z"/>
               <path d="M254 88 C252 40 290 12 326 24 C350 32 358 58 348 76
                        C338 50 306 38 284 50 C268 58 258 74 254 88 Z"/>
             </g>`,
  },

  afro: {
    nome: 'Black power',
    atras: `<circle cx="300" cy="84" r="86" fill="{cor}"/>`,
    frente: `<path d="M240 118 C236 62 262 40 300 40 C338 40 364 62 360 118
                       C352 88 332 78 300 78 C268 78 248 88 240 118 Z" fill="{cor}"/>`,
  },

  dreads: {
    nome: 'Dreads',
    atras: `<g fill="{cor}">
              <path d="M244 110 C244 50 266 32 300 32 C334 32 356 50 356 110
                       L356 130 L244 130 Z"/>
              <rect x="224" y="100" width="18" height="256" rx="9"/>
              <rect x="246" y="112" width="18" height="206" rx="9"/>
              <rect x="336" y="112" width="18" height="206" rx="9"/>
              <rect x="358" y="100" width="18" height="256" rx="9"/>
            </g>`,
    frente: `<path d="M244 112 C244 56 268 38 300 38 C332 38 356 56 356 112
                       C350 86 328 78 300 78 C272 78 250 86 244 112 Z" fill="{cor}"/>`,
  },

  rabo: {
    nome: 'Rabo de cavalo',
    atras: `<g fill="{cor}">
              <ellipse cx="352" cy="86" rx="21" ry="17"/>
              <path d="M352 78 C402 98 406 190 382 252 C372 282 346 288 340 268
                       C364 234 374 158 344 106 Z"/>
            </g>`,
    frente: `<path d="M244 112 C244 54 266 36 300 36 C334 36 356 54 356 112
                       C350 84 332 74 300 74 C268 74 250 84 244 112 Z" fill="{cor}"/>`,
  },

  chiquinhas: {
    nome: 'Chiquinhas',
    atras: `<g fill="{cor}">
              <path d="M246 98 C206 108 198 172 212 228 C220 260 242 266 248 250
                       C230 216 226 152 248 118 Z"/>
              <path d="M354 98 C394 108 402 172 388 228 C380 260 358 266 352 250
                       C370 216 374 152 352 118 Z"/>
              <circle cx="240" cy="102" r="19"/>
              <circle cx="360" cy="102" r="19"/>
            </g>`,
    frente: `<path d="M244 114 C244 56 266 38 300 38 C334 38 356 56 356 114
                       C350 90 332 82 300 82 C268 82 250 90 244 114 Z" fill="{cor}"/>`,
  },

  ondulado: {
    nome: 'Ondulado',
    atras: `<path d="M240 112 C240 48 264 30 300 30 C336 30 360 48 360 112
                      C384 164 348 196 374 250 C398 302 356 340 380 404
                      C358 428 336 420 330 400 L322 130 L278 130 L270 400
                      C264 420 242 428 220 404 C244 340 202 302 226 250
                      C252 196 216 164 240 112 Z" fill="{cor}"/>`,
    frente: `<path d="M244 112 C244 56 266 38 300 38 C334 38 356 56 356 112
                       C348 88 330 80 300 80 C270 80 252 88 244 112 Z" fill="{cor}"/>`,
  },

  cortina: {
    nome: 'Cortininha',
    atras: `<path d="M244 110 C244 50 266 32 300 32 C334 32 356 50 356 110
                      L360 232 C344 244 330 238 326 226 L322 128 L278 128 L274 226
                      C270 238 256 244 240 232 Z" fill="{cor}"/>`,
    frente: `<path d="M244 116 C244 52 268 32 300 32 C332 32 356 52 356 116
                       C352 92 344 80 330 74 C324 100 314 116 300 126
                       C286 116 276 100 270 74 C256 80 248 92 244 116 Z" fill="{cor}"/>`,
  },

  coques: {
    nome: 'Coques duplos',
    frente: `<g fill="{cor}">
               <circle cx="256" cy="34" r="23"/>
               <circle cx="344" cy="34" r="23"/>
               <path d="M244 112 C244 58 268 40 300 40 C332 40 356 58 356 112
                        C350 88 328 80 300 80 C272 80 250 88 244 112 Z"/>
             </g>`,
  },

  chifres: {
    nome: 'Chifres',
    atras: `<g fill="{cor}">
              <path d="M250 84 C230 64 222 32 230 10 C256 24 278 50 286 74 Z"/>
              <path d="M350 84 C370 64 378 32 370 10 C344 24 322 50 314 74 Z"/>
            </g>`,
    frente: `<path d="M244 112 C244 58 268 40 300 40 C332 40 356 58 356 112
                       C350 88 328 80 300 80 C272 80 250 88 244 112 Z" fill="{cor}"/>`,
  },
};
export const ORDEM_CABELOS = Object.keys(CABELOS);

// Cor do cabelo em duas famílias: a paleta que existe na cabeça de alguém e a
// que só existe na do personagem. A lista achatada é o que o sorteio usa.
export const CORES_CABELO_NATURAIS = [
  '#1b1614', '#3d2519', '#6b4226', '#a86a3d', '#d4a35a', '#ecd79b',
  '#a83b28', '#7a6a5f', '#9a9a9a', '#f0ece6',
];

export const CORES_CABELO_FANTASIA = [
  '#d1345b', '#f06fa8', '#f5a3c7', '#e8552f', '#f2922b', '#ffd23f',
  '#9ad14a', '#3fbf5f', '#12a58c', '#00c2d1', '#2f7ff0', '#3a3fb8',
  '#7b4fc4', '#b06ef0', '#c6d3e8', '#2f2a3d',
];

export const CORES_CABELO = [...CORES_CABELO_NATURAIS, ...CORES_CABELO_FANTASIA];

// Nariz: a única marca do rosto. Tudo aqui é traço (sem preenchimento), salvo
// quando a arte diz o contrário; {traco} vira a cor de contorno da pele.
export const NARIZES = {
  nenhum: { nome: 'Sem nariz', arte: '' },

  botao: {
    nome: 'Botão',
    arte: `<path d="M292 143 q8 8 16 -1"/>`,
  },

  reto: {
    nome: 'Reto',
    arte: `<path d="M297 119 L295 142 q9 6 15 -3"/>`,
  },

  arrebitado: {
    nome: 'Arrebitado',
    arte: `<path d="M303 119 C293 134 288 145 300 147 C306 148 310 145 313 141"/>`,
  },

  aquilino: {
    nome: 'Aquilino',
    arte: `<path d="M295 117 C305 128 313 140 303 147 C298 150 292 148 288 144"/>`,
  },

  largo: {
    nome: 'Largo',
    arte: `<path d="M288 124 C281 135 281 142 290 145
                     C296 147 304 147 310 145 C319 142 319 135 312 124"/>`,
  },

  pontudo: {
    nome: 'Pontudo',
    arte: `<path d="M300 120 L291 146 L309 146 Z"/>`,
  },

  focinho: {
    nome: 'Focinho',
    arte: `<path d="M286 134 q14 -11 28 0 q5 14 -14 18 q-19 -4 -14 -18 Z"
                 fill="{traco}" stroke="none" opacity=".75"/>
           <path d="M300 144 L300 152"/>`,
  },
};
export const ORDEM_NARIZES = Object.keys(NARIZES);

// Chave das sobrancelhas: false desliga o desenho no avatar e tira a aba do
// Personagem (fora do ar de novo desde 21/10/2026, pedido do João).
export const SOBRANCELHAS_NO_AR = false;

// Sombra do rosto (escolhida pelo João, 21/10/2026): arco embaixo de cada
// olho e a sombra do nariz subindo até o olho, sem desenhar olho nem boca. Só
// na cara da artista. Para tirar, troque para false. Medidas em avatar.js
// (OLHEIRA, sombraDoRosto).
export const SOMBRA_ROSTO_NO_AR = true;

// Sobrancelhas: formas cheias pintadas na cor do cabelo (um pouco mais escura).
// Cada arte é a sobrancelha da esquerda da tela, numa caixa de 30 de largura:
// x=0 é a ponta de fora, x=30 a de dentro (perto do nariz), y=0 a linha da
// sobrancelha. O avatar põe ela na testa do molde e espelha para a direita.
export const SOBRANCELHAS = {
  nenhuma: { nome: 'Sem sobrancelha', arte: '' },

  arco: {
    nome: 'Arco longo',
    arte: `<path d="M0 6 Q14 -3 30 -1 Q15 0.5 0 6 Z"/>`,
  },

  pincel: {
    nome: 'Pincelada',
    arte: `<path d="M3 -2 L5 -3.5 L7 -2.6 L9 -3.8 L11 -2.4 L13 -3.4 L15 -1.6
                    L17 -2.6 L19 -0.6 L21 -1.4 L23 0.8 L25.5 2 L26.5 3.4
                    Q14 1.6 3 -2 Z"/>`,
  },

  reta: {
    nome: 'Reta fina',
    arte: `<path d="M0 0.5 Q15 -1.6 30 0.6 Q15 1.8 0 0.5 Z"/>`,
  },

  arredondada: {
    nome: 'Arredondada',
    arte: `<path d="M0 3 C6 -3 18 -4 28 -1 C31 0 31 3 28 3.4 C20 1.5 10 0.5 0 3 Z"/>`,
  },

  pontinho: {
    nome: 'Pontinho',
    arte: `<path d="M12 -1 C15 -3.5 22 -1.5 25 1.5 C26.5 3 24 4 22 3
                    C18 1.5 14 1.5 12 -1 Z"/>`,
  },

  fio: {
    nome: 'Fio',
    arte: `<path d="M2 3 Q15 -4 28 3 Q15 -2 2 3 Z"/>`,
  },

  grossa: {
    nome: 'Reta grossa',
    arte: `<path d="M0 0 C8 -2.5 20 -2.5 26 -0.5 C28 0.3 29.5 2 30 3.5
                    C26 1.5 20 1.8 12 2 C6 2.2 2 2 0 0 Z"/>`,
  },

  curta: {
    nome: 'Curta',
    arte: `<path d="M4 2 C10 -0.5 18 -2.5 26 -2.6 C27.5 -2.6 27.5 0.5 26 0.6
                    C18 1 10 2 4 2 Z"/>`,
  },

  suave: {
    nome: 'Arco suave',
    arte: `<path d="M1 3 Q15 -5 29 2 Q15 -1.4 1 3 Z"/>`,
  },

  arqueada: {
    nome: 'Arqueada',
    arte: `<path d="M0 0 C8 -5 18 -3 29 4 Q30 5.5 28.5 5.5 C18 0.6 8 -2 0 0 Z"/>`,
  },

  cheia: {
    nome: 'Arqueada grossa',
    arte: `<path d="M0 -1 C8 -6.5 18 -5 29 3 C30.5 4.5 29 6.5 27 5.5
                    C18 1 9 -1.5 0 -1 Z"/>`,
  },

  caida: {
    nome: 'Caída',
    arte: `<path d="M0 -1 C10 -3 20 0 29 3.5 Q30 5 28 5 C19 2.5 10 0 0 -1 Z"/>`,
  },

  gancho: {
    nome: 'Gancho',
    arte: `<path d="M12 0 C15 -3.5 20 -3.8 24 -1 C26 0.5 27 2.5 27.5 4
                    C25 2 22 0 18.5 0 C16 0 14 1 12 0 Z"/>`,
  },

  triangulo: {
    nome: 'Triângulo',
    arte: `<path d="M0 -1 L29 1 L27 5 Z"/>`,
  },

  ponta: {
    nome: 'Ponta fina',
    arte: `<path d="M0 0 Q14 1 24 2.4 L29.5 1.2 L27 5.5 Q14 2.4 0 0 Z"/>`,
  },
};

// Piercings (pedidos do João, 21/10/2026), no traço granulado da artista.
// Cada orelha combina os tipos que quiser (guardados juntos, 'bolinhas+argolas';
// 'nenhum' é sem nada): três bolinhas na borda de baixo (da maior, no lóbulo,
// para cima), três spikes na de cima e duas argolas grossas na borda de trás,
// como na foto de referência. O lado é o da tela, como num espelho.
export const PIERCINGS_ORELHA = {
  bolinhas: { nome: 'Bolinhas' },
  spikes: { nome: 'Spikes' },
  argolas: { nome: 'Argolas' },
};
// Bridge: a barrinha que atravessa o alto do nariz, entre os olhos; aparecem
// as duas pontas, bolinhas ou spikes.
export const PIERCINGS_BRIDGE = {
  nenhum: { nome: 'Nada' },
  bolinhas: { nome: 'Bolinhas', bolinhas: true },
  spikes: { nome: 'Spikes', spikes: true },
};
// Sardas: manchas no palco [cx, cy, rx, ry, quantas] onde as pintinhas se
// espalham (a cara no meio em x=300: nariz em y≈158, bochechas em y≈171),
// o raio de cada uma [mín, máx], o espaço mínimo entre elas e a força. Ou
// `fixas`: pintinhas postas à mão [x, y, r]. Só na cara da artista; o desenho
// fica em avatar.js.
const NARIZ = [300, 158, 15, 8], BOCH_E = [268, 171, 14, 8], BOCH_D = [332, 171, 14, 8];
const com = ([cx, cy, rx, ry], n) => [cx, cy, rx, ry, n];
export const SARDAS = {
  nenhuma: { nome: 'Nada' },
  muitas: { nome: 'Muitas', manchas: [com(NARIZ, 14), com(BOCH_E, 15), com(BOCH_D, 15)] },
  grandes: { nome: 'Pintas grandes', raio: [1.5, 2.1], afastamento: 6, opacidade: 0.55,
    manchas: [com(NARIZ, 4), com(BOCH_E, 5), com(BOCH_D, 5)] },
};

export const APARENCIA_PADRAO = {
  corpo: 'masculino', pele: 'clara', cabelo: 'curto',
  corCabelo: '#3d2519', nariz: 'botao', sobrancelha: 'nenhuma',
  corSobrancelha: '',   // vazio: a do cabelo, um pouco mais escura
  orelhaEsq: 'nenhum', orelhaDir: 'nenhum', bridge: 'nenhum', sardas: 'nenhuma',
};

// ----------------------------- Colagem (Board) ----------------------------
// Colagem livre em fundo branco, no espírito das pranchetas de moda:
// peças recortadas, tudo enquadrado e a assinatura embaixo.
// O board tem 1000 unidades de largura; a altura sai do formato.
export const BOARD = {
  W: 1000,
  // A colagem é sempre no formato de post. Os outros formatos ficam aqui
  // porque o renderizador já os suporta, mas não aparecem na interface.
  FORMATO_PADRAO: '4:5',
  SNAP: 8,              // tolerância do ímã, em unidades
  MARGEM_PADRAO: 60,    // margem interna: área útil das peças e alvo do ímã

  FORMATOS: {
    '4:5':  { nome: 'Post 4:5',    h: 1250, export: [1080, 1350] },
    '1:1':  { nome: 'Quadrado',    h: 1000, export: [1080, 1080] },
    '3:4':  { nome: 'Retrato 3:4', h: 1333, export: [1080, 1440] },
    '9:16': { nome: 'Story 9:16',  h: 1778, export: [1080, 1920] },
  },

  FONTES: [
    // Fontes do próprio site (assets/fontes, @font-face em base.css): a
    // etiqueta e a assinatura saem iguais no PC, no celular e no PNG. As do
    // sistema ficam de reserva enquanto a fonte não chega.
    { id: 'serif',   nome: 'Serifada',  css: "'BD Lora', Georgia, 'Times New Roman', serif" },
    { id: 'sans',    nome: 'Sem serifa', css: "'BD Inter', 'Segoe UI', Helvetica, Arial, sans-serif" },
    { id: 'script',  nome: 'Manuscrita', css: "'BD Caveat', 'Segoe Script', cursive" },
    { id: 'display', nome: 'Display',    css: "'BD Anton', Impact, sans-serif" },
    { id: 'mono',    nome: 'Máquina',    css: "'BD Courier Prime', Consolas, 'Courier New', monospace" },
  ],

  POSICOES_ASSINATURA: [
    { id: 'inferior',  nome: 'Embaixo' },
    { id: 'superior',  nome: 'Em cima' },
    { id: 'esquerda',  nome: 'Canto esq.' },
    { id: 'direita',   nome: 'Canto dir.' },
  ],
};

export const ASSINATURA_PADRAO = {
  texto: '',   // vazio = o nome da conta (db.js põe no login)
  fonte: 'serif',
  tamanho: 52,
  cor: '#1a1a1a',
  posicao: 'inferior',
  espaco: 2,
  visivel: true,
};

// ------------------------------- Missões ----------------------------------
// O formato segue o Pokémon TCG Pocket: uma lista fixa de pedidos simples, e
// cumprir só uma parte já paga. Cada missão escuta um `evento` (o que a tela
// avisa com db.progredirMissao) — duas missões podem ouvir o mesmo, como
// "garimpar 1" e "garimpar 3". A missão paga um pouco de XP ao fechar; os
// prêmios de verdade saem dos marcos, resgatados com um toque na tela.

// Missões do DIA: zeram junto com a vitrine, na virada da meia-noite. "Entrar"
// já nasce feita (quem vê a lista está no app): é o progresso de presente.
export const MISSOES = [
  { id: 'entrar',   evento: 'entrar',   nome: 'Entrar no app',    meta: 1, xp: 0 },
  { id: 'garimpo1', evento: 'resgates', nome: 'Garimpar 1 peça',  meta: 1, xp: 20 },
  { id: 'resgates', evento: 'resgates', nome: 'Garimpar 3 peças', meta: CONFIG.RESGATES_POR_DIA, xp: 30 },
  { id: 'looks',    evento: 'looks',    nome: 'Montar 1 look',    meta: 1, xp: 35 },
  { id: 'publicar', evento: 'publicar', nome: 'Publicar 1 look',  meta: 1, xp: 30 },
];

// Cada missão do dia fechada paga 2 fichas na hora. As 5 feitas liberam o
// carimbo do dia, que guarda um Baú incomum.
export const MARCOS_DIA = { fichasPorMissao: 2, carimbo: { missoes: 5, bau: 'incomum', xp: 40 } };

// Missões da SEMANA: zeram na segunda-feira, à meia-noite. São as diárias em
// dose maior. Curtir é provisória: a vaga é de "ativar um efeito de coleção",
// que entra quando os atributos das roupinhas existirem.
export const MISSOES_SEMANA = [
  { id: 'resgates', evento: 'resgates', nome: 'Garimpar 12 peças',           meta: 12, xp: 120 },
  { id: 'raras',    evento: 'raras',    nome: 'Garimpar 2 peças raras',      meta: 2,  xp: 100 },
  { id: 'looks',    evento: 'looks',    nome: 'Montar 5 looks',              meta: 5,  xp: 100 },
  { id: 'publicar', evento: 'publicar', nome: 'Publicar 3 looks',            meta: 3,  xp: 100 },
  { id: 'curtir',   evento: 'curtir',   nome: 'Curtir 10 looks de outras pessoas', meta: 10, xp: 80 },
];

// Cada missão da semana fechada paga 4 fichas na hora. As 5 feitas liberam o
// carimbo da semana, que guarda um Baú épico; 4 semanas carimbadas (o carimbo
// mensal) abrem o Baú lendário (BAU_ESPECIAL).
export const MARCOS_SEMANA = { fichasPorMissao: 4, carimbo: { bau: 'epico' } };

// Baú dos dias: 5 dias carimbados na mesma semana dão um Baú raro.
export const PREMIO_SEMANA = {
  carimbos: 5,
  porNivel: [{ desde: 1, xp: 200, bau: 'raro' }],
};

// Baú mensal: 4 semanas carimbadas (seguidas ou não) dão um Baú lendário.
export const BAU_ESPECIAL = {
  semanas: 4,
  porNivel: [{ desde: 1, xp: 500, bau: 'lendario' }],
};

// O prêmio de um baú para o nível dado, e o próximo degrau (null no topo).
export function premioDoBau(bau, nivel) {
  const i = bau.porNivel.findLastIndex(f => nivel >= f.desde);
  return { atual: bau.porNivel[Math.max(0, i)], proximo: bau.porNivel[i + 1] ?? null };
}

// Ordem de tentativa para uma faixa: ela, as de baixo (da mais perto para a
// mais longe), depois as de cima.
export function faixasDeTroca(faixa) {
  const ids = RARIDADES.map(r => r.id);
  const i = ids.indexOf(faixa);
  return [faixa, ...ids.slice(0, i).reverse(), ...ids.slice(i + 1)];
}

// Fichas: o prêmio que vira garimpo, como as ampulhetas do TCG Pocket. O nome
// é provisório até a lore do jogo. Acumulam sem teto, e dá para trocar
// quantas vezes quiser no dia (pedido do João, 2026-10-17).
export const FICHAS = {
  porResgate: 6,       // quantas fichas valem um resgate a mais
  porRepor: 12,        // repor a loja: arara nova, resgates do dia continuam contados
  porCongelar: 2,      // congelar uma peça: ela fica na loja até o fim do dia seguinte
};

// ------------------------------- Níveis -----------------------------------
// O XP só sobe; o nível é derivado do total acumulado (nivelPorXP). Assim,
// mexer na curva aqui recalcula o nível de todo mundo sem migração de save.
export const NIVEL = {
  XP_BASE: 120,   // XP para sair do nível 1
  XP_PASSO: 40,   // quanto cada nível seguinte pede a mais que o anterior
  MAX: 40,
};

// Custo para sair do nível n.
export const xpParaSubir = (n) => NIVEL.XP_BASE + (n - 1) * NIVEL.XP_PASSO;

// XP acumulado necessário para chegar ao nível n (soma da PA acima).
export const xpAcumuladoAte = (n) =>
  (n - 1) * NIVEL.XP_BASE + NIVEL.XP_PASSO * (n - 1) * (n - 2) / 2;

export function nivelPorXP(total) {
  let n = 1;
  while (n < NIVEL.MAX && total >= xpAcumuladoAte(n + 1)) n++;
  return n;
}

// Tudo que a interface precisa para desenhar a barra do nível.
export function progressoDoNivel(total) {
  const nivel = nivelPorXP(total);
  const base = xpAcumuladoAte(nivel);
  const falta = nivel >= NIVEL.MAX ? 0 : xpParaSubir(nivel);
  const dentro = total - base;
  return {
    nivel,
    xpTotal: total,
    xpNoNivel: dentro,
    xpDoNivel: falta,
    xpFaltando: Math.max(0, falta - dentro),
    pct: falta ? Math.min(100, dentro / falta * 100) : 100,
    maximo: nivel >= NIVEL.MAX,
  };
}

// --------------------------- Trilha de níveis -----------------------------
// Cada nível, do 2 ao NIVEL.MAX, tem um prêmio que espera o toque na trilha
// (Tarefas → tocar no nível). Três tipos:
//   fichas: `qtd` fichas (FICHAS.porResgate viram um resgate)
//   repor:  `qtd` fichas de repor a loja — usar uma troca a arara do dia
//   bau:    um baú de BAUS, com peças sorteadas por CHANCE_NO_BAU
// A cada 5 níveis um baú épico; a cada 10, o lendário.
export const BAUS = {
  comum:    { nome: 'Baú comum',    min: 1,  max: 2 },
  incomum:  { nome: 'Baú incomum',  min: 2,  max: 3 },
  raro:     { nome: 'Baú raro',     min: 3,  max: 5 },
  epico:    { nome: 'Baú épico',    min: 5,  max: 8 },
  lendario: { nome: 'Baú lendário', min: 10, max: 15 },
};

// A raridade de cada peça de baú, em %: a mesma para os cinco baús (o que
// muda entre eles é a quantidade). Diferente da loja, que tem a cota fixa da
// arara. Comum e incomum são o normal; épica é um "oooh"; lendária é festa.
// Por peça: num baú lendário (10 a 15 peças) sai uma lendária ~6% das vezes
// e pelo menos uma épica ~30%.
export const CHANCE_NO_BAU = { common: 55, uncommon: 30, rare: 11.5, epic: 3, legendary: 0.5 };

export function premioDoNivel(n) {
  if (n % 10 === 0) return { nivel: n, tipo: 'bau', bau: 'lendario' };
  if (n % 5 === 0) return { nivel: n, tipo: 'bau', bau: 'epico' };
  switch (n % 5) {
    case 1: return { nivel: n, tipo: 'fichas', qtd: 3 + Math.floor(n / 10) * 2 };
    case 2: return { nivel: n, tipo: 'repor', qtd: n >= 20 ? 2 : 1 };
    case 3: return { nivel: n, tipo: 'bau', bau: n >= 20 ? 'raro' : n >= 10 ? 'incomum' : 'comum' };
    default: return { nivel: n, tipo: 'fichas', qtd: FICHAS.porResgate };
  }
}

export const PREMIOS_DE_NIVEL = Array.from({ length: NIVEL.MAX - 1 }, (_, i) => premioDoNivel(i + 2));

// ------------------------------ Coleções ----------------------------------
// Cada coleção é uma marca da loja. Garimpar as peças dela vai liberando as
// roupinhas do avatar que ela adotou: a primeira com a 1ª peça, a do meio com
// metade da coleção e a última com ela completa (ver roupinhas.js).
//
// `marca` casa com o campo marca do acervo (sem diferenciar maiúscula). O
// tamanho da coleção não fica aqui: é quantas peças daquela marca o acervo tem,
// então peça nova cadastrada com a marca entra sozinha.
//
// Os itens de uma coleção ficam em lugares diferentes do corpo: dá para vestir
// todos ao mesmo tempo, e é isso que conta como coleção completa vestida.
//
// `efeito` é o que vestir itens da marca faz no garimpo; quem aplica é quem lê
// `efeito.tipo` (db.efeitosDoGarimpo, db.modificadoresDaLoja, vitrine.js).
// O bônus vestido (+5% a +20%, ver efeitos.js) é a chance, em pontos
// percentuais; nos efeitos de arara ele é multiplicado (ver poolDoDia).
//
// O logo da marca fica em assets/marcas/<id>.webp, todos no mesmo molde
// (tools/logos.py). Coleção fora de MARCAS_COM_LOGO usa a foto de uma peça.
export const MARCAS_COM_LOGO = new Set(['puma', 'adidas', 'swear-london', 'jnco', 'ecko', 'borra', 'tapout', 'true-religion', 'nike', 'alex-clayton', 'happy99', 'sixth-dimension']);
// Tema usa o `icone` dele em ESTILOS: bandeira redonda do circle-flags (MIT,
// github.com/HatScripts/circle-flags; licença em assets/temas).
export const logoDaColecao = (c) => c.icone
  ?? (MARCAS_COM_LOGO.has(c.id) ? `assets/marcas/${c.id}.webp` : null);
export const COLECOES = [
  { id: 'puma', marca: 'Puma',
    itens: ['cano-alto', 'legging', 'corta-vento'],
    efeito: { tipo: 'resgate-gratis', texto: 'Chance de o resgate não gastar o limite do dia' } },
  { id: 'adidas', marca: 'Adidas',
    itens: ['moletom', 'moletom-calca', 'gorro'],
    efeito: { tipo: 'mais-da-marca', marcas: ['Adidas', 'Puma'], texto: 'Mais peças Adidas e Puma na sua arara' } },
  { id: 'swear-london', marca: 'Swear London',
    itens: ['coturno', 'luvas', 'fones'],
    efeito: { tipo: 'raridade-acima', texto: 'Chance de a peça vir uma raridade acima' } },
  { id: 'borra', marca: 'Borra',
    itens: ['jeans', 'corrente', 'suspensorios'],
    efeito: { tipo: 'fichas', texto: 'Chance de ganhar 1 ficha a cada garimpo' } },
  { id: 'jnco', marca: 'Jnco',
    itens: ['cargo', 'cinto'],
    efeito: { tipo: 'mais-da-marca', texto: 'Mais peças Jnco na sua arara' } },
  { id: 'ecko', marca: 'Ecko',
    itens: ['bucket', 'pochete'],
    efeito: { tipo: 'mais-raras', texto: 'Chance de uma peça rara a mais na sua arara' } },
  // Marcas cujos itens são feitos para elas: um item que já existe, com outra
  // tinta e o nome da marca (como os das coleções de cor). Ver `variantes`
  // em roupinhas.js: id do item novo -> [item de base, nome, cor].
  { id: 'tapout', marca: 'Tapout',
    itens: ['regata-tapout', 'bermuda-tapout', 'bone-tapout'],
    variantes: {
      'regata-tapout': ['regata', 'Regata Tapout', '#1f1f1f'],
      'bermuda-tapout': ['bermuda', 'Bermuda de luta Tapout', '#8e1b1b'],
      'bone-tapout': ['bone', 'Boné Tapout', '#2a2a2a'],
    },
    efeito: { tipo: 'mais-da-marca', texto: 'Mais peças Tapout na sua arara' } },
  { id: 'true-religion', marca: 'True Religion',
    itens: ['jeans-true-religion', 'bone-true-religion', 'cinto-true-religion'],
    variantes: {
      'jeans-true-religion': ['jeans', 'Jeans True Religion', '#34506e'],
      'bone-true-religion': ['bone', 'Boné True Religion', '#e3d6bd'],
      'cinto-true-religion': ['cinto', 'Cinto True Religion', '#6b4423'],
    },
    efeito: { tipo: 'raridade-acima', texto: 'Chance de a peça vir uma raridade acima' } },
  { id: 'nike', marca: 'Nike',
    itens: ['tenis-nike', 'moletom-nike', 'viseira-nike'],
    variantes: {
      'tenis-nike': ['tenis', 'Tênis Nike', '#f2f0ec'],
      'moletom-nike': ['moletom', 'Moletom Nike', '#8f8f8f'],
      'viseira-nike': ['viseira', 'Viseira Nike', '#1f1f1f'],
    },
    efeito: { tipo: 'resgate-gratis', texto: 'Chance de o resgate não gastar o limite do dia' } },
  // Logo com nome próprio: o primeiro oakley.webp (provisório) pode estar no cache.
  { id: 'oakley', marca: 'Oakley', icone: 'assets/marcas/oakley-logo.webp',
    itens: ['oculos-oakley', 'viseira-oakley', 'corta-vento-oakley'],
    variantes: {
      'oculos-oakley': ['oculos-sol', 'Óculos Oakley', '#2f5f8f'],
      'viseira-oakley': ['viseira', 'Viseira Oakley', '#e9e6df'],
      'corta-vento-oakley': ['corta-vento', 'Corta-vento Oakley', '#3d4a3a'],
    },
    efeito: { tipo: 'mais-raras', texto: 'Chance de uma peça rara a mais na sua arara' } },
  { id: 'alex-clayton', marca: 'Alex Clayton',
    itens: ['camiseta-alex-clayton', 'gorro-alex-clayton', 'corrente-alex-clayton'],
    variantes: {
      'camiseta-alex-clayton': ['camiseta', 'Camiseta Alex Clayton', '#f4f1ea'],
      'gorro-alex-clayton': ['gorro', 'Gorro Alex Clayton', '#1f1f1f'],
      'corrente-alex-clayton': ['corrente', 'Corrente Alex Clayton', '#c9c9c9'],
    },
    efeito: { tipo: 'fichas', texto: 'Chance de ganhar 1 ficha a cada garimpo' } },
  { id: 'happy99', marca: 'Happy99',
    itens: ['tenis-happy99', 'moletom-happy99', 'tiracolo-happy99'],
    variantes: {
      'tenis-happy99': ['tenis', 'Tênis Happy99', '#c3c9d1'],
      'moletom-happy99': ['moletom', 'Moletom Happy99', '#f2a7c3'],
      'tiracolo-happy99': ['tiracolo', 'Bolsa Happy99', '#e9e6df'],
    },
    efeito: { tipo: 'raridade-acima', texto: 'Chance de a peça vir uma raridade acima' } },
  // Logo com nome próprio: o primeiro coldf33t.webp (cinza) pode estar no cache.
  { id: 'coldf33t', marca: 'Coldf33t', icone: 'assets/marcas/coldf33t-logo.webp',
    itens: ['moletom-coldf33t', 'bone-coldf33t', 'gravata-coldf33t'],
    variantes: {
      'moletom-coldf33t': ['moletom', 'Moletom grafitado Coldf33t', '#3f6fd1'],
      'bone-coldf33t': ['bone', 'Boné grafitado Coldf33t', '#2f9fd8'],
      'gravata-coldf33t': ['gravata', 'Gravata grafitada Coldf33t', '#d0407a'],
    },
    efeito: { tipo: 'mais-raras', texto: 'Chance de uma peça rara a mais na sua arara' } },
  { id: 'sixth-dimension', marca: 'Sixth Dimension',
    itens: ['moletom-sixth-dimension', 'camiseta-sixth-dimension', 'sueter-sixth-dimension'],
    variantes: {
      'moletom-sixth-dimension': ['moletom', 'Moletom de patinha Sixth Dimension', '#5b3a8c'],
      'camiseta-sixth-dimension': ['camiseta', 'Camiseta de gatinhos Sixth Dimension', '#23264a'],
      'sueter-sixth-dimension': ['sueter', 'Suéter Sixth Dimension', '#b98ad8'],
    },
    efeito: { tipo: 'fichas', texto: 'Chance de ganhar 1 ficha a cada garimpo' } },
];
export const colecao = (id) => COLECOES.find(c => c.id === id) || null;
// Compara só letras e números, sem acento: "Happy 99", "happy99" e "HAPPY-99"
// são a mesma marca (a esteira grava a marca como foi digitada ou lida na peça).
// Guarda o resultado por texto: o acervo é comparado inteiro a cada consulta
// de progresso, e normalizar milhares de vezes por toque travava o celular.
const _marcasNormalizadas = new Map();
export const normalizarMarca = (m) => {
  const k = String(m || '');
  let v = _marcasNormalizadas.get(k);
  if (v === undefined) {
    v = k.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    _marcasNormalizadas.set(k, v);
  }
  return v;
};

// Estilos dos itens do avatar: entram os de `itens`. Item que não combina com
// nenhum fica sem. Estilo e marca são independentes: o item de uma marca só
// tem estilo se estiver nesta lista.
//
// Cada estilo também é uma coleção de peças da loja (tela de Coleções, aba
// Estilos): as de `pecas`, escolhidas olhando as fotos, peça por peça.
export const ESTILOS = {
  futebol: {
    nome: 'Futebol', brilho: '#3fae5a', icone: 'assets/temas/bola.svg',
    itens: ['tenis', 'bermuda', 'viseira', 'chinelo', 'polo'],
    libera: ['chinelo', 'viseira', 'polo'],
    pecas: [
      'puma-muvc1c7y05', 'puma-muvc1eqe0c', 'puma-muvc1fuk92', 'puma-muvc1hlva9', // tênis e chuteiras
      'umbro-mugft6wx2',           // regata da Inglaterra
      'umbro-muvc1crzbc',          // chuteira
      'uspa-muvl3amr99',           // polo
      'billabong-muynwwod46',      // bermuda branca de listra
      'gel-nimbus-mudyvj7o', 'gel-nimbus-mudywpih',
      'kenner-mugxru6y0',          // chinelo
      'shirts-muvkxbg688',         // camisa 20
      'tops-mug1f83z7', 'tops-mug1fgbz8', // polos
      'tops-mugfthcl3',            // camisa do Brasil
      'tops-murfcnyh82', 'tops-murfdqtm4c', // jaquetas de agasalho
    ],
  },
  skate: {
    nome: 'Skate', brilho: '#f08a24', icone: 'assets/temas/skate.svg',
    itens: ['bone', 'mochila', 'xadrez', 'oculos-sol'],
    libera: ['mochila', 'oculos-sol', 'xadrez'],
    pecas: [
      'ecko-muynwvri84', 'ecko-muynx06b99', 'jnco-muvqo387b7', 'jnco-muvqo5vdeb', // camisetas
      'hysteric-muvqo40be1',       // jaqueta college
      'hats-muvavz1s7f', 'hats-muvaw0j02f', 'hats-muvaw89z47', // boné e gorros
      'pants-mug1egkr5', 'pants-muplm2007',                    // bermudas
      'pants-muplqhfkd', 'pants-muplr0eie', 'pants-muplu7paj', // calças largas
      'shoes-mugxi1y81', 'shoes-mugxikcg3',                    // tênis grossos
      'shorts-muvm058s17', 'shorts-muvqo58le3', 'shorts-muynx0zt7f', // cargo
      'tops-murfehjt0d',                                       // manga longa por baixo
    ],
  },
  // Peças a escolher pelo João; os itens que libera vêm junto com elas.
  brasil: {
    nome: 'Brasil', brilho: '#e6b800', icone: 'assets/temas/brasil.svg',
    itens: [],
    libera: [],
    pecas: [],
  },
  portugal: {
    nome: 'Portugal', brilho: '#c8102e', icone: 'assets/temas/portugal.svg',
    itens: [],
    libera: [],
    pecas: [],
  },
  jamaica: {
    nome: 'Jamaica', brilho: '#009b3a', icone: 'assets/temas/jamaica.svg',
    itens: [],
    libera: [],
    pecas: [],
  },
  animal: {
    nome: 'Animal print', brilho: '#c8893a', icone: 'assets/temas/animal.svg',
    itens: [],
    libera: [],
    pecas: [],
  },
  militar: {
    nome: 'Militar print', brilho: '#6b7340', icone: 'assets/temas/militar.svg',
    itens: [],
    libera: [],
    pecas: [],
  },
};

// Coleções de cor: todas as peças da loja de uma cor. Cada uma libera 3 itens
// do avatar novos, que são um item que já existe pintado na cor dela — a
// "Bota azul" é a bota com outra tinta. Eles não têm marca nem estilo.
// Mesma regra das marcas: 1ª peça, metade e coleção completa.
// [item de base, nome do item novo]
export const COLECOES_DE_COR = {
  Preto:    [['galocha', 'Galocha preta'], ['jaqueta', 'Jaqueta preta'], ['tiracolo', 'Bolsa a tiracolo preta']],
  Branco:   [['bota', 'Bota branca'], ['cropped', 'Cropped branco'], ['cachecol', 'Cachecol branco']],
  Cinza:    [['sapatilha', 'Sapatilha cinza'], ['sueter', 'Suéter cinza'], ['boina', 'Boina cinza']],
  Bege:     [['sapato', 'Sapato bege'], ['blazer', 'Blazer bege'], ['cinto', 'Cinto bege']],
  Marrom:   [['tenis', 'Tênis marrom'], ['gola-alta', 'Gola alta marrom'], ['gorro', 'Gorro marrom']],
  Vermelho: [['cano-alto', 'Cano alto vermelho'], ['moletom', 'Moletom vermelho'], ['luvas', 'Luvas vermelhas']],
  Rosa:     [['coturno', 'Coturno rosa'], ['colete', 'Colete rosa'], ['fones', 'Fones rosa']],
  Laranja:  [['chinelo', 'Chinelo laranja'], ['regata', 'Regata laranja'], ['bucket', 'Bucket laranja']],
  Amarelo:  [['salto', 'Salto amarelo'], ['camisa', 'Camisa amarela'], ['tiara', 'Tiara amarela']],
  Verde:    [['pantufa', 'Pantufa verde'], ['cargo', 'Cargo verde'], ['bone', 'Boné verde']],
  Azul:     [['bota', 'Bota azul'], ['jeans', 'Jeans azul'], ['viseira', 'Viseira azul']],
  Roxo:     [['sapatilha', 'Sapatilha roxa'], ['kimono', 'Kimono roxo'], ['relogio', 'Relógio roxo']],
};
export const idDaCor = (nome) => 'cor-' + semAcento(nome);

// As três primeiras peças de toda coleção de cor: roupas desenhadas pela
// artista (tools/roupas_base.py), recoloridas em assets/roupas/<id>-<cor>.webp.
// `caixa` é [x, y, w, h] no palco 600×1200; `feminino` é a cor concordando.
export const ROUPAS_BASE_VERSAO = 'v3';   // igual a VERSAO em tools/roupas_base.py
export const ROUPAS_BASE = [
  { id: 'tenis',    nome: 'Tênis',    slot: 'pes',    caixa: [179.2, 988.7, 241.6, 160.2], fem: false },
  { id: 'camiseta', nome: 'Camiseta', slot: 'torso',  caixa: [147.3, 241.1, 305.4, 229.2], fem: true },
  { id: 'calca',    nome: 'Calça',    slot: 'pernas', caixa: [168.8, 497.7, 263.1, 572.4], fem: true },
];
// Óculos de espinhos da artista (tools/oculos_espinhos.py), recolorido só em
// algumas coleções de cor; entra logo depois das três roupas base. `caixa` é
// [x, y, w, h] no palco 600×1200, na frente dos olhos.
export const OCULOS_ESPINHOS = {
  id: 'oculos-espinhos', nome: 'Óculos de espinhos', slot: 'acessorio', z: 62, versao: 'v1',
  caixa: [212, 110, 172, 82],
  cores: { Preto: 'pretos', Verde: 'verdes', Azul: 'azuis', Vermelho: 'vermelhos', Rosa: 'rosa', Roxo: 'roxos' },
};
// Óculos máscara da artista (tools/oculos_mascara.py): lente única cinza, sem
// haste, só no Preto. A armação vai do canto de fora de um olho ao do outro,
// com a lente cobrindo os dois e o vão de baixo em cima do nariz.
export const OCULOS_MASCARA = {
  id: 'oculos-mascara', nome: 'Óculos máscara', slot: 'acessorio', z: 62, versao: 'v1',
  caixa: [238, 113, 124, 69.8],
  cores: { Preto: 'pretos' },
};
// Os óculos desenhados, na ordem em que entram nas coleções de cor.
export const OCULOS_DESENHADOS = [OCULOS_ESPINHOS, OCULOS_MASCARA];
const COR_FEMININA = { Preto: 'preta', Branco: 'branca', Vermelho: 'vermelha', Amarelo: 'amarela', Roxo: 'roxa' };
// Enquanto for true, só as roupas desenhadas (ROUPAS_BASE) aparecem no jogo;
// as de código ficam ocultas, sem apagar nada dos saves. false desfaz.
export const SO_ROUPAS_DESENHADAS = true;
export const nomeDaRoupaBase = (b, cor) => `${b.nome} ${b.fem ? (COR_FEMININA[cor] || cor.toLowerCase()) : cor.toLowerCase()}`;
// A cor favorita (aba do Personagem): uma das cores que têm coleção, com a
// bolinha de CORES. Aparece no perfil e dá as três primeiras peças do tutorial.
export const CORES_FAVORITAS = Object.keys(COLECOES_DE_COR)
  .map(nome => ({ nome, hex: CORES.find(c => c.nome === nome)?.hex ?? '#999' }));
export const idDoEstilo = (id) => 'estilo-' + id;

// O nome que a regra de desbloqueio mostra ("Garimpe 1 peça da Puma").
export function nomeDaColecao(id) {
  if (id.startsWith('cor-')) {
    const c = Object.keys(COLECOES_DE_COR).find(n => idDaCor(n) === id);
    return { nome: c ?? id, de: `da cor ${c ?? id}` };
  }
  if (id.startsWith('estilo-')) {
    const e = ESTILOS[id.slice(7)];
    return { nome: e?.nome ?? id, de: `de ${e?.nome ?? id}` };
  }
  const m = colecao(id)?.marca ?? id;
  return { nome: m, de: `da ${m}` };
}

// ---------------------------- Ferramentas ---------------------------------
// Cada tela é uma ferramenta com nível mínimo. Hoje está tudo em 1 (nada
// travado); subir o número aqui já tranca o botão na sidebar e a navegação,
// sem mexer em mais nada — é por aqui que o desbloqueio por nível vai entrar.
export const FERRAMENTAS = [
  { id: 'vitrine',    nome: 'Vitrine',       nivel: 1, desc: 'O mural do dia.' },
  { id: 'closet',     nome: 'Guarda-roupa',  nivel: 1, desc: 'Suas peças resgatadas.' },
  { id: 'stylist',    nome: 'Stylist',       nivel: 1, desc: 'Vestir o avatar.' },
  { id: 'board',      nome: 'Colagem',       nivel: 1, desc: 'Colagem livre.' },
  { id: 'social',     nome: 'Feed',          nivel: 1, desc: 'Publicar e seguir.' },
  { id: 'tarefas',    nome: 'Tarefas',       nivel: 1, desc: 'Missões do dia e níveis.' },
  { id: 'vestiario',  nome: 'Inventário',    nivel: 1, desc: 'As roupinhas da coleção.' },
  { id: 'perfil',     nome: 'Perfil',        nivel: 1, desc: 'A sua página no brechó.' },
  { id: 'personagem', nome: 'Personagem',    nivel: 1, desc: 'Corpo, pele e cabelo.' },
];
// Missões de introdução (js/tutorial.js): a primeira sessão de conta nova. Um
// passo por vez, na ordem, cada um levando à tela de que fala. Passo com
// `evento` é missão: pede uma ação e paga um prêmio que sobe com a cadeia (a
// última é um baú épico; baú segue BAUS e CHANCE_NO_BAU, como os de Tarefas). Passo sem `evento` só explica e segue no "Entendi".
// `evento` é o mesmo de progredirMissao; fazer a coisa antes de chegar na
// missão já vale.
// `pecas` é uma faixa por peça (sem peça na faixa, desce: ver faixasDeTroca).
// `bau` é um baú de BAUS: a quantidade e as raridades seguem a mesma regra
// dos baús de Tarefas (CHANCE_NO_BAU).
// `dicaCelular` (opcional) troca a dica no celular, quando o gesto é outro.
// `demo: 'peca'` abre uma peça da pessoa na tela do passo, para mostrar.
// `brinde` ('congelamento' | 'repor') dá um item de recarga de graça quando o
// passo abre, uma vez só, para a missão poder ser feita com ele.
// `lugar` é onde o cartão fica no celular enquanto a missão é feita: em cima
// (sobre o cabeçalho) quando o que se toca na tela está embaixo — a mochila,
// a paleta, a ficha da peça — e embaixo quando está em cima.
export const INTRO = [
  { evento: 'personagem', ir: 'personagem', lugar: 'cima', nome: 'Crie o seu personagem',
    dica: 'Vamos criar o seu personagem! Escolha corpo, pele e cabelo. Na última aba, escolha a sua cor favorita. Depois toque em Salvar.',
    premio: { xp: 20 } },
  { ir: 'vitrine', lugar: 'cima', nome: 'Esta é a loja',
    dica: 'Toda manhã o dono repõe o mural, então a loja muda todo dia. Você pode pegar 3 peças por dia.' },
  // Os dois itens de recarga da loja, com um de cada de brinde (`brinde`, dado
  // quando o passo abre): primeiro congelar, para ver a peça ficar no repor.
  { evento: 'congelar', ir: 'vitrine', lugar: 'cima', brinde: 'congelamento', nome: 'Congele uma peça',
    dica: 'Tome um congelamento de presente! Toque numa peça do mural e em Congelar: ela fica na loja até o fim de amanhã. ' +
      'Mais congelamentos você troca por fichas em Tarefas.',
    premio: { xp: 20 } },
  { evento: 'repor', ir: 'vitrine', lugar: 'baixo', brinde: 'repor', nome: 'Reponha a loja',
    dica: 'E uma ficha de repor! Toque no ↻ ao lado dos resgates para trocar o mural por um novo. ' +
      'A peça congelada fica, e os resgates de hoje continuam contados.',
    premio: { xp: 20 } },
  { evento: 'resgates', ir: 'vitrine', lugar: 'cima', nome: 'Pegue uma roupa',
    dica: 'Toque numa peça do mural e resgate. As mais raras ficam por baixo: arraste as de cima para garimpar.',
    premio: { bau: 'incomum' } },
  // Logo depois do primeiro baú: a tela onde ele (e todo baú) fica guardado.
  { evento: 'abrir-bau', ir: 'baus', lugar: 'baixo', nome: 'Abra o seu baú',
    dica: 'Você ganhou um baú! Todo baú fica guardado aqui, na tela de Baús, dentro de Tarefas. Toque nele para abrir.',
    premio: { xp: 20 } },
  { ir: 'closet', demo: 'peca', lugar: 'cima', nome: 'O seu closet',
    dica: 'Tudo o que você pega fica aqui. A cor da borda mostra a raridade, de comum a lendária. ' +
      'Toque numa peça para ver a ficha com marca, cor e estilo.' },
  { ir: 'colecoes', lugar: 'cima', nome: 'Coleções',
    dica: 'Peças da mesma marca, cor ou estilo formam uma coleção. Com 3 peças você libera um item para o avatar, e com mais, libera mais.' },
  { evento: 'colecao', ir: 'colecoes', lugar: 'cima', nome: 'Resgate o seu item',
    dica: 'Toque no item liberado para levá-lo ao seu inventário.',
    premio: { xp: 20 } },
  { evento: 'vestir', ir: 'vestiario', lugar: 'cima', nome: 'Vista o seu personagem',
    dica: 'Este é o Inventário, com as roupinhas do avatar. Clique no item que você resgatou (ou arraste para o corpo) para vestir.',
    dicaCelular: 'Este é o Inventário, com as roupinhas do avatar. Toque no item que você resgatou para vestir.',
    premio: { xp: 20, fichas: 1 } },
  { ir: 'vestiario', lugar: 'cima', nome: 'Combos',
    dica: 'Itens vestidos com a mesma marca, cor ou estilo fazem combo: 2 ativam um efeito, 3 ou mais reforçam. ' +
      'Cor dá mais XP, marca ajuda no garimpo e estilo faz o avatar brilhar. Veja os ativos em Efeitos.' },
  { evento: 'looks', ir: 'stylist', lugar: 'cima', nome: 'Monte e salve um look',
    dica: 'No Stylist, o avatar veste as peças do seu closet. Toque nelas (ou sorteie um look) e salve.',
    premio: { xp: 40 } },
  { evento: 'board', ir: 'board', lugar: 'cima', nome: 'Salve uma colagem',
    dica: 'Arraste as peças pelo fundo branco do jeito que quiser e salve.',
    premio: { bau: 'incomum', xp: 20 } },
  { evento: 'publicar', ir: 'stylist', lugar: 'cima', nome: 'Publique no feed',
    dica: 'Publique um look ou uma colagem.',
    premio: { bau: 'raro', xp: 30 } },
  { evento: 'seguir', ir: 'social', lugar: 'cima', nome: 'Siga alguém',
    dica: 'Aqui ficam os looks de todo mundo. Toque em Seguir em quem você curtir. Para achar amigos, busque pelo nome ou @.',
    premio: { fichas: 2 } },
  { evento: 'carimbo', ir: 'tarefas', lugar: 'cima', nome: 'Carimbe o seu dia',
    dica: 'Aqui ficam as missões do dia, e cada uma paga 2 fichas. Com as 5 feitas, carimbe o dia e ganhe um baú. ' +
      '5 dias carimbados na semana dão mais um baú.',
    premio: { bau: 'epico', fichas: 1, xp: 50 } },
];

export const ferramenta = (id) => FERRAMENTAS.find(f => f.id === id);
export const nivelDaFerramenta = (id) => ferramenta(id)?.nivel ?? 1;

// Falas do dono da loja. Uma escolhida por contexto.
export const FALAS = {
  boasVindas: [
    'Bem-vindo de volta. Separei peça nova hoje.',
    'Chegou gente. Dá uma olhada no mural, tem coisa boa.',
    'Hoje o garimpo tá generoso. Fica à vontade.',
  ],
  presente: [
    'Conta nova ganha brinde: separei umas peças pra você começar.',
    'Ninguém entra aqui de mãos vazias. Já pendurei um básico no seu closet.',
    'Toma, é por conta da casa. Dá pra montar um look já.',
  ],
  pegou: [
    'Ótima escolha. Já tá no seu guarda-roupa.',
    'Essa aí combina com você. Guardei pra você.',
    'Boa. Essa peça tava esperando alguém.',
  ],
  raro: [
    'Opa! Essa é rara, viu. Cuida bem dela.',
    'Essa quase não aparece no mural. Sorte sua.',
  ],
  lendario: [
    'Não acredito. Essa é lendária. Não sai peça assim todo mês.',
  ],
  acabou: [
    'Por hoje é só. Volta amanhã que eu reponho a vitrine.',
    'Seus resgates de hoje acabaram. Amanhã tem mais.',
  ],
  jaTem: [
    'Essa já tá no seu closet. Deixa pra outra pessoa.',
  ],
  dica: [
    'Já montou look no Stylist? É ali no ícone amarelo.',
    'As missões do mês liberam a cápsula do ilustrador convidado.',
  ],
};

// Perfis fictícios para o feed (o social graph real vem no backend).
//
// Os dez primeiros são os de sempre — quem já jogava continua seguindo as
// mesmas pessoas, porque o que fica gravado é o id. Os outros entraram com a
// busca de pessoas (js/busca.js): procurar gente num diretório de dez é filtrar
// uma lista, não buscar. Perfil novo não custa cadastro nenhum — rosto, roupa,
// números, data de entrada e colagens saem todos da semente do id (avatar.js,
// roupinhas.js, usuario.js), então basta a linha aqui.
export const PERFIS_MOCK = [
  { id: 'u-lia',   nome: 'Lia Moreno',   handle: '@liamoreno',  cor: '#ffccbc', bio: 'colagem é diário' },
  { id: 'u-tom',   nome: 'Tom Arruda',   handle: '@tomarruda',  cor: '#b2ebf2', bio: 'só peça pesada' },
  { id: 'u-nina',  nome: 'Nina Cardoso', handle: '@ninacard',   cor: '#d1c4e9', bio: 'acervo dos anos 2000' },
  { id: 'u-rafa',  nome: 'Rafa Pinto',   handle: '@rafapinto',  cor: '#fff9c4', bio: 'monto look e sumo' },
  { id: 'u-bia',   nome: 'Bia Salles',   handle: '@biasalles',  cor: '#c8e6c9', bio: 'garimpo é esporte' },
  { id: 'u-duda',  nome: 'Duda Rocha',   handle: '@dudarocha',  cor: '#f8bbd0', bio: 'camadas e mais camadas' },
  { id: 'u-jo',    nome: 'Jô Vasques',   handle: '@jovasques',  cor: '#ffe0b2', bio: 'bota pesada, resto leve' },
  { id: 'u-vic',   nome: 'Vic Andrade',  handle: '@vicandrade', cor: '#b3e5fc', bio: 'arquivo vivo' },
  { id: 'u-ian',   nome: 'Ian Prado',    handle: '@ianprado',   cor: '#e1bee7', bio: 'y2k sem ironia' },
  { id: 'u-mel',   nome: 'Mel Fontes',   handle: '@melfontes',  cor: '#dcedc8', bio: 'só o que cabe na mala' },

  { id: 'u-caio',  nome: 'Caio Bastos',       handle: '@caiobastos',     cor: '#ffe6cc', bio: 'alfaiataria com tênis surrado' },
  { id: 'u-sol',   nome: 'Sol Ferraz',        handle: '@solferraz',      cor: '#ffecb3', bio: 'brechó de rua, sempre' },
  { id: 'u-theo',  nome: 'Theo Lacerda',      handle: '@theolacerda',    cor: '#cfd8dc', bio: 'preto, cinza e mais preto' },
  { id: 'u-ana',   nome: 'Ana Quintela',      handle: '@anaquintela',    cor: '#f0f4c3', bio: 'costuro o que não serve' },
  { id: 'u-pedro', nome: 'Pedro Sanches',     handle: '@pedrosanches',   cor: '#bbdefb', bio: 'jaqueta é personalidade' },
  { id: 'u-lu',    nome: 'Lu Teixeira',       handle: '@luteixeira',     cor: '#f8d7da', bio: 'cor demais nunca é demais' },
  { id: 'u-gabi',  nome: 'Gabi Nakamura',     handle: '@gabinaka',       cor: '#e0f7fa', bio: 'silhueta larga, gola alta' },
  { id: 'u-enzo',  nome: 'Enzo Ribeiro',      handle: '@enzoribeiro',    cor: '#d7ccc8', bio: 'couro e jeans, fim' },
  { id: 'u-clara', nome: 'Clara Bittencourt', handle: '@clarabit',       cor: '#fce4ec', bio: 'vestido o ano inteiro' },
  { id: 'u-noah',  nome: 'Noah Estrela',      handle: '@noahestrela',    cor: '#c5cae9', bio: 'boné em toda foto' },
  { id: 'u-tata',  nome: 'Tatá Menezes',      handle: '@tatamenezes',    cor: '#ffcdd2', bio: 'anos 70 sem fantasia' },
  { id: 'u-rui',   nome: 'Rui Coutinho',      handle: '@ruicoutinho',    cor: '#b2dfdb', bio: 'workwear até no verão' },
  { id: 'u-isa',   nome: 'Isa Meirelles',     handle: '@isameirelles',   cor: '#f3e5f5', bio: 'renda, cetim e coturno' },
  { id: 'u-bento', nome: 'Bento Alencar',     handle: '@bentoalencar',   cor: '#dcedc8', bio: 'compro grande e ajusto' },
  { id: 'u-kika',  nome: 'Kika Andrada',      handle: '@kikaandrada',    cor: '#ffe0e6', bio: 'estampa em cima de estampa' },
  { id: 'u-davi',  nome: 'Davi Peixoto',      handle: '@davipeixoto',    cor: '#e8eaf6', bio: 'uniforme diário, sem drama' },
  { id: 'u-yumi',  nome: 'Yumi Watanabe',     handle: '@yumiwatanabe',   cor: '#fff3e0', bio: 'camadas finas e transparência' },
  { id: 'u-leo',   nome: 'Léo Maranhão',      handle: '@leomaranhao',    cor: '#c8e6c9', bio: 'esportivo dos pés à cabeça' },
  { id: 'u-fran',  nome: 'Fran Delgado',      handle: '@frandelgado',    cor: '#ffd9c0', bio: 'tudo herdado de alguém' },
  { id: 'u-zeca',  nome: 'Zeca Portela',      handle: '@zecaportela',    cor: '#d0e8f2', bio: 'listra é neutro' },
  { id: 'u-maya',  nome: 'Maya Cavalcanti',   handle: '@mayacavalcanti', cor: '#f5e1ff', bio: 'só peça de uma cor só' },
  { id: 'u-otto',  nome: 'Otto Vilela',       handle: '@ottovilela',     cor: '#e6e0d4', bio: 'sobretudo o ano inteiro' },
];

// Frases que os perfis fictícios usam para comentar. Servem para o feed nascer
// com vida — e para você testar a thread sem ter que escrever tudo à mão.
export const COMENTARIOS_MOCK = [
  'essa bota mudou tudo',
  'preciso saber de onde é a saia',
  'combinação absurda',
  'roubei a ideia, avisando',
  'a cor do casaco 👏',
  'isso é muito você',
  'tô usando isso amanhã',
  'onde garimpou essa peça?',
  'o acessório fez o look',
  'nunca teria pensado nessa mistura',
  'clean e pesado ao mesmo tempo, gostei',
  'salvando pra referência',
  'perfeito pro inverno',
  'esse é o melhor que você postou',
];

export const NOMES_LOOK_MOCK = [
  'tarde de sábado', 'camadas', 'saída rápida', 'cápsula pessoal',
  'preto no preto', 'garimpo da semana', 'segunda difícil', 'sem esforço',
  'prova de rua', 'arquivo 02', 'clima seco', 'volta pra casa',
];

// ------------------------------- Conexões ---------------------------------
// Instagram é saída (publicar o que você monta); Pinterest é entrada (trazer
// peça de fora). Por isso cada um descreve um benefício diferente.
export const SERVICOS = {
  instagram: {
    nome: 'Instagram',
    cor: '#e1306c',
    papel: 'Seu @ no perfil',
    resumo: 'Mostra o seu @ do Instagram no perfil. Precisa ser conta profissional (Criador ou Comercial).',
  },
  pinterest: {
    nome: 'Pinterest',
    cor: '#bd081c',
    papel: 'Seu @ no perfil',
    resumo: 'Mostra o seu @ do Pinterest no perfil.',
  },
};
