// Parâmetros do protótipo. Tudo que é regra de negócio mora aqui.

export const CONFIG = {
  // Vitrine
  PECAS_NA_VITRINE: 25,     // quantas peças o dono da loja põe no mural por dia
  RESGATES_POR_DIA: 3,      // o "X peças por dia" da descrição técnica
  MIN_DIST_MURAL: 118,      // px entre âncoras no Poisson-disc

  // Fontes de imagem. O catálogo local é gerado por tools/pipeline.py.
  CATALOGO: 'assets/catalog.json',
  // Acervo do administrador: peças publicadas pela esteira (esteira.html),
  // gravado pela Lambda. Fica fora do catalog.json para sobreviver ao pipeline.
  ACERVO: 'assets/acervo.json',
  API_PECAS: 'api/pecas',      // PUT: editar peça (peça nova entra pela esteira)
  S3_FALLBACK: 'https://brecho-system-resources.s3.us-east-1.amazonaws.com/cloths/',

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
export const RARIDADES = [
  { id: 'common',    nome: 'Comum',    peso: 60, tiragem: 1000, cor: '#e8e8e8', bg: '#ffffff', aura: null },
  { id: 'uncommon',  nome: 'Incomum',  peso: 25, tiragem: 500, cor: '#9ae0b5', bg: '#f4fbf6', aura: '#2fbf63' },
  { id: 'rare',      nome: 'Rara',     peso: 11, tiragem: 300, cor: '#b9d6f2', bg: '#f0f7ff', aura: '#2f7ff0' },
  { id: 'epic',      nome: 'Épica',    peso: 3,  tiragem: 100, cor: '#c3a6f2', bg: '#f8f4ff', aura: '#9b46f0' },
  { id: 'legendary', nome: 'Lendária', peso: 1,  tiragem: 25, cor: '#efd469', bg: '#fffdf2', aura: 'arco-iris' },
];
export const RARIDADE = Object.fromEntries(RARIDADES.map(r => [r.id, r]));

// ------------------------- Presente de boas-vindas ------------------------
// Conta nova entra com guarda-roupa vazio, e guarda-roupa vazio é tela vazia:
// o closet sem nada, o Stylist sem o que vestir e o personagem pelado. O
// presente é o mínimo para o jogo existir na primeira sessão — duas de cada uma
// das três categorias que fecham um look (top + calça + calçado), então dá para
// montar e ainda ter troca.
//
// As faixas dizem de quais raridades o presente pode sair: só comum e incomum.
// O presente não compete com o garimpo — rara para cima continua sendo coisa de
// quem apareceu na loja. Dentro dessas duas, o sorteio usa os pesos de RARIDADES
// (60 contra 25), então a incomum sai em ~3 de cada 10 peças, a mesma proporção
// que ela tem na arara.
export const PRESENTE = {
  itens: [
    { cat: 'tops', quantas: 2 },
    { cat: 'pants', quantas: 2 },
    { cat: 'shoes', quantas: 2 },
  ],
  faixas: ['common', 'uncommon'],
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
  coats:   1.00,
  dresses: 0.94,
  pants:   0.90,
  tops:    0.78,
  shoes:   0.58,
  bags:    0.52,
  hats:    0.46,
  acc:     0.34,
  watches: 0.24,
  rings:   0.11,
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
export function ancoraDaPeca(peca) {
  const padrao = CATEGORIAS[peca?.cat]?.anchor ?? { x: 300, y: 500, w: 240, z: 30 };
  if (!peca?.ancora?.w) return padrao;
  return { ...padrao, ...peca.ancora, z: padrao.z };
}

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

// Categorias: rótulo, ícone e como a peça se encaixa no avatar.
// anchor = ponto de ancoragem em unidades de palco; w = largura alvo; z = camada.
// É a "engine de lookbook" do roadmap: z-index fixo por tipo de peça.
export const CATEGORIAS = {
  tops:    { nome: 'Tops',        icone: '👕', anchor: { x: 300, y: 358, w: 250, z: 30 } },
  pants:   { nome: 'Calças',      icone: '👖', anchor: { x: 300, y: 796, w: 236, z: 20 } },
  // Calçado por cima da calça e da barra do vestido: é assim que a bota fica
  // sobre a calça no corpo, e era o que a ordem antiga (z 16) invertia.
  shoes:   { nome: 'Calçados',    icone: '👟', anchor: { x: 300, y: 1096, w: 248, z: 28 } },
  dresses: { nome: 'Vestidos',    icone: '👗', anchor: { x: 300, y: 486, w: 272, z: 25 } },
  coats:   { nome: 'Casacos',     icone: '🧥', anchor: { x: 300, y: 436, w: 310, z: 40 } },
  hats:    { nome: 'Chapéus',     icone: '👒', anchor: { x: 300, y: 84,  w: 176, z: 65 } },
  bags:    { nome: 'Bolsas',      icone: '👜', anchor: { x: 440, y: 646, w: 152, z: 50 } },
  watches: { nome: 'Relógios',    icone: '⌚', anchor: { x: 172, y: 652, w: 72,  z: 55 } },
  rings:   { nome: 'Anéis',       icone: '💍', anchor: { x: 168, y: 700, w: 44,  z: 56 } },
  acc:     { nome: 'Acessórios',  icone: '🕶️', anchor: { x: 300, y: 116, w: 124, z: 60 } },
};
export const ORDEM_CATEGORIAS = Object.keys(CATEGORIAS);

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
// `arte(extra)` devolve as peças com a espessura já resolvida. `extra` é o
// quanto o desenho engorda para virar contorno (ver avatar.js); a cor vem do
// grupo que envolve tudo, então nada aqui pinta a si mesmo.
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
    arte: (extra) => `
    <!-- braços -->
    <path d="M206 262 C 176 344, 168 486, 172 660" fill="none" stroke-width="${46 + extra}"/>
    <path d="M394 262 C 424 344, 432 486, 428 660" fill="none" stroke-width="${46 + extra}"/>
    <circle cx="172" cy="694" r="24"/>
    <circle cx="428" cy="694" r="24"/>
    <!-- pernas -->
    <path d="M268 606 C 256 768, 250 924, 254 1086" fill="none" stroke-width="${76 + extra}"/>
    <path d="M332 606 C 344 768, 350 924, 346 1086" fill="none" stroke-width="${76 + extra}"/>
    <ellipse cx="250" cy="1118" rx="46" ry="26"/>
    <ellipse cx="350" cy="1118" rx="46" ry="26"/>
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
    <!-- pescoço e cabeça -->
    <rect x="279" y="160" width="42" height="62" rx="18"/>
    <ellipse cx="300" cy="112" rx="56" ry="70"/>`,
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
    arte: (extra) => `
    <!-- braços: mais finos, saindo de um ombro estreito para a mesma mão -->
    <path d="M222 262 C 192 344, 168 486, 172 660" fill="none" stroke-width="${38 + extra}"/>
    <path d="M378 262 C 408 344, 432 486, 428 660" fill="none" stroke-width="${38 + extra}"/>
    <circle cx="172" cy="694" r="22"/>
    <circle cx="428" cy="694" r="22"/>
    <!-- pernas: mais finas, e no mesmo pé do outro corpo -->
    <path d="M272 606 C 262 770, 252 926, 252 1088" fill="none" stroke-width="${70 + extra}"/>
    <path d="M328 606 C 338 770, 348 926, 348 1088" fill="none" stroke-width="${70 + extra}"/>
    <ellipse cx="250" cy="1118" rx="43" ry="25"/>
    <ellipse cx="350" cy="1118" rx="43" ry="25"/>
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
    <!-- pescoço e cabeça -->
    <rect x="283" y="160" width="34" height="62" rx="16"/>
    <ellipse cx="300" cy="112" rx="56" ry="70"/>`,
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

export const APARENCIA_PADRAO = {
  corpo: 'masculino', pele: 'clara', cabelo: 'curto',
  corCabelo: '#3d2519', nariz: 'botao',
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
    { id: 'serif',   nome: 'Serifada',  css: "Georgia, 'Times New Roman', serif" },
    { id: 'sans',    nome: 'Sem serifa', css: "'Segoe UI', Helvetica, Arial, sans-serif" },
    { id: 'script',  nome: 'Manuscrita', css: "'Brush Script MT', 'Segoe Script', cursive" },
    { id: 'display', nome: 'Display',    css: "Impact, 'Haettenschweiler', sans-serif" },
    { id: 'mono',    nome: 'Máquina',    css: "Consolas, 'Courier New', monospace" },
  ],

  POSICOES_ASSINATURA: [
    { id: 'inferior',  nome: 'Embaixo' },
    { id: 'superior',  nome: 'Em cima' },
    { id: 'esquerda',  nome: 'Canto esq.' },
    { id: 'direita',   nome: 'Canto dir.' },
  ],
};

export const ASSINATURA_PADRAO = {
  texto: 'Alencastrk',
  fonte: 'serif',
  tamanho: 52,
  cor: '#1a1a1a',
  posicao: 'inferior',
  espaco: 2,
  visivel: true,
};

// ------------------------------- Missões ----------------------------------
// Missões do DIA: zeram junto com a vitrine, na virada da meia-noite. As metas
// cabem num dia só (resgates acompanha RESGATES_POR_DIA) e cada uma paga XP.
export const MISSOES = [
  { id: 'resgates', nome: 'Garimpe 3 peças na vitrine', meta: CONFIG.RESGATES_POR_DIA, xp: 40 },
  { id: 'looks',    nome: 'Monte 1 look no Stylist',    meta: 1, xp: 35 },
  { id: 'publicar', nome: 'Publique 1 colagem no feed', meta: 1, xp: 30 },
  { id: 'board',    nome: 'Monte 1 colagem',            meta: 1, xp: 35 },
  { id: 'seguir',   nome: 'Siga 2 pessoas',             meta: 2, xp: 20 },
];

// Fechar o dia inteiro paga mais do que a soma das partes — é o que faz voltar.
export const XP_BONUS_DIA = 60;

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
    titulo: tituloDoNivel(nivel),
    xpTotal: total,
    xpNoNivel: dentro,
    xpDoNivel: falta,
    xpFaltando: Math.max(0, falta - dentro),
    pct: falta ? Math.min(100, dentro / falta * 100) : 100,
    maximo: nivel >= NIVEL.MAX,
  };
}

// Apelido que aparece junto do número, no perfil e no feed.
export const FAIXAS = [
  { ate: 2,  titulo: 'Curioso de vitrine' },
  { ate: 5,  titulo: 'Garimpeiro' },
  { ate: 9,  titulo: 'Colecionador' },
  { ate: 14, titulo: 'Estilista de rua' },
  { ate: 21, titulo: 'Diretor de arte' },
  { ate: 99, titulo: 'Lenda do brechó' },
];
export const tituloDoNivel = (n) =>
  FAIXAS.find(f => n <= f.ate)?.titulo ?? FAIXAS.at(-1).titulo;

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
    papel: 'Publicar',
    resumo: 'Leva suas colagens para fora.',
    beneficios: [
      'Publicar a colagem direto no feed ou nos stories, sem baixar o PNG',
      'Trazer seu @ e sua foto para o perfil do brechó',
      'Marcar o brechó e o ilustrador do mês na publicação',
    ],
  },
  pinterest: {
    nome: 'Pinterest',
    cor: '#bd081c',
    papel: 'Publicar e importar',
    resumo: 'Vai e volta: publica suas colagens e traz peça de fora.',
    beneficios: [
      'Salvar a colagem como pin num board seu, com link de volta para o brechó',
      'Importar os pins de um board e virar peça no guarda-roupa',
      'Recorte, compressão e catalogação automáticos no que for importado',
    ],
  },
};

// Trilha sonora: o player procura estes arquivos em assets/audio/.
// Sem os arquivos, o player aparece desabilitado com aviso (não quebra).
export const TRILHAS = [
  { id: 'base',      nome: 'Tema base',        sub: 'versão original da casa', src: 'assets/audio/base.mp3' },
  { id: 'collab-01', nome: 'Versão do mês',    sub: 'produtor convidado #01',  src: 'assets/audio/collab-01.mp3' },
];
