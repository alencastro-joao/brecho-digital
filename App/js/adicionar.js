// Adicionar peça.
//
// A tela trabalha com uma fila: você solta um arquivo ou vinte, e cada um vira
// um item com a ficha dele (categoria, raridade, marca, cor, nome) e a medida
// no molde. A ficha do item anterior é herdada pelo seguinte — subir dez tops
// da mesma marca é soltar os dez e ir salvando.
//
// Duas coisas na ficha não são herdadas. A cor é lida da própria imagem assim
// que ela fica pronta, escolhida entre as cores que o jogo já conhece — é
// palpite, então continua sendo campo livre: mexer no campo ou num chip
// encerra o palpite, e ele não volta. O nome começa vazio de propósito: nome
// de arquivo não é nome de peça, e peça sem nome já aparece como "Jaqueta
// Nike" por conta do catálogo.
//
// Dois passos por item: a ficha, e depois o dimensionamento sobre o molde do
// avatar — é ali que a peça ganha o tamanho real dela. O recorte não carrega
// escala nenhuma, então essa medida é a única informação confiável de "quão
// grande é isso no corpo", e é dela que saem o encaixe no Stylist e o tamanho
// nas grades e na prancheta. Quem não quiser medir uma a uma tem dois atalhos:
// "aplicar às demais" (leva a medida para as outras da mesma categoria) e
// "salvar todas", que grava o que sobrou com o tamanho padrão da categoria.
//
// A imagem é recortada pelo alpha, reduzida e convertida para WebP aqui no
// navegador — o mesmo que tools/pipeline.py faz do lado do servidor.
//
// Esta é uma ferramenta de administração: a peça salva aqui vai para o disco
// (assets/cloths/ + assets/acervo.json, via POST no servidor local) e passa a
// existir no jogo para todo mundo, permanentemente. O usuário final não abre
// esta tela — ela só aparece em modo admin (?admin=1).

import { CONFIG, CATEGORIAS, CORES, ORDEM_CATEGORIAS, RARIDADES, RARIDADE, ancoraDaPeca, hexDaCor,
         corDoPixel, distanciaEntreCores } from './config.js';
import { registrarPeca, nomeDaPeca } from './catalog.js';
import * as db from './db.js';
import { svgAvatar } from './avatar.js';
import { el, $, $$, clamp, toast } from './util.js';

const MAX_LADO = 460;          // maior lado da imagem guardada
const QUALIDADE = 0.75;
const MAX_ENVIO = 3000;        // maior lado da foto que sobe para o recorte
const BYTES_ENVIO = 24 * 1024 * 1024;

// Recorte automático de fundo. Quem faz o trabalho é o servidor
// (POST /api/fundo → tools/bgbatch.py): enquanto ele responder, foto de
// estúdio com fundo vira peça recortada sozinha, e o recorte em alta fica
// guardado em assets/mestres/.
//   ligado     — a chave da tela, do administrador.
//   disponivel — o que o servidor mostrou ser verdade. Vira false na primeira
//                recusa para que uma fila de vinte fotos não espere meio
//                minuto por peça só para falhar vinte vezes.
//   saida      — o que fazer a respeito. Cada recusa tem a sua: modelo que
//                falta se resolve baixando, servidor velho se resolve
//                reiniciando, e mandar baixar o modelo nesse caso manda o
//                administrador caçar um problema que ele não tem.
const recorte = { ligado: true, disponivel: null, motivo: '', saida: '' };

let fila = [];                 // itens na ordem em que entraram (ver novoItem)
let indice = 0;                // item que está na tela
let chave = 0;                 // identificador interno de item da fila
let arquivo = null;            // atalho para fila[indice].arquivo, usado no passo 2
let medida = null;             // { x, y, w } em unidades do palco (600×1200)
let raridade = 'common';       // raridade do item na tela
let aoSalvar = null;           // callback de quem abriu
let editando = null;           // peça do acervo em edição (null = subindo peça nova)

// Um item da fila: o arquivo já processado mais a ficha dele. A medida só
// existe depois do passo 2; sem ela vale o padrão da categoria.
function novoItem(file, heranca) {
  return {
    chave: ++chave,
    file,
    arquivo: null,             // { src, w, h, temAlpha, mestre, cor } — chega no fim do processamento
    processando: true,
    etapa: '',                 // o que está acontecendo agora, para o aviso
    erro: '',
    salva: false,
    medida: null,
    corAuto: true,             // a cor ainda é palpite da imagem; mexer no campo desliga
    corDetectada: '',          // o que a imagem disse, para a dica embaixo do campo
    ficha: {
      cat: heranca?.cat ?? ORDEM_CATEGORIAS[0],
      marca: heranca?.marca ?? '',
      // Herdada só até a imagem ficar pronta: se a leitura da cor não der em
      // nada, é ela que fica no lugar de um campo vazio.
      cor: heranca?.cor ?? '',
      raridade: heranca?.raridade ?? 'common',
      nome: '',
    },
  };
}

const atual = () => fila[indice] ?? null;
const pendentes = () => fila.filter(i => !i.salva && i.arquivo);

// ============================ Processar imagem ============================
// Varre o alpha numa cópia de trabalho: daí saem a caixa do que é visível e a
// conta de pixels opacos — que é também o que decide se a foto ainda tem
// fundo para tirar.
function varrerAlpha(bitmap) {
  const escala = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
  const tw = Math.max(1, Math.round(bitmap.width * escala));
  const th = Math.max(1, Math.round(bitmap.height * escala));

  const trab = document.createElement('canvas');
  trab.width = tw; trab.height = th;
  const ctx = trab.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, tw, th);

  const dados = ctx.getImageData(0, 0, tw, th).data;
  let x0 = tw, y0 = th, x1 = -1, y1 = -1, opacos = 0;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const a = dados[(y * tw + x) * 4 + 3];
      if (a < 10) continue;
      opacos++;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  // Sem transparência nenhuma a peça viraria um retângulo na colagem.
  return { trab, tw, th, x0, y0, x1, y1, temAlpha: opacos < tw * th * 0.985 };
}

// A foto que sobe para o recorte. O arquivo vai inteiro sempre que cabe: é
// dele que sai o máster em alta, e reamostrar aqui seria jogar fora justamente
// a resolução que se quer guardar. Foto de câmera grande demais desce para
// MAX_ENVIO — acima disso o modelo não ganha nada e o POST fica impraticável.
async function fotoParaEnvio(file, bitmap) {
  if (file.size <= BYTES_ENVIO
      && Math.max(bitmap.width, bitmap.height) <= MAX_ENVIO) {
    return await new Promise((pronto, falhou) => {
      const leitor = new FileReader();
      leitor.onload = () => pronto(leitor.result);
      leitor.onerror = () => falhou(new Error('não consegui ler o arquivo'));
      leitor.readAsDataURL(file);
    });
  }
  const k = MAX_ENVIO / Math.max(bitmap.width, bitmap.height);
  const lona = document.createElement('canvas');
  lona.width = Math.max(1, Math.round(bitmap.width * k));
  lona.height = Math.max(1, Math.round(bitmap.height * k));
  lona.getContext('2d').drawImage(bitmap, 0, 0, lona.width, lona.height);
  return lona.toDataURL('image/webp', 0.95);
}

// Manda a foto e recebe a peça recortada. O máster em alta não volta pelo
// fio — são alguns MB, e o que o modelo levou meio minuto para calcular não
// deve depender de a ficha ser preenchida até o fim. Ele fica no disco como
// rascunho e o token dele viaja junto, para ser reclamado ao salvar a peça.
async function pedirRecorte(file, bitmap, aoAndar) {
  const corpo = JSON.stringify({
    src: await fotoParaEnvio(file, bitmap),
    max: 1024,
  });

  const inicio = Date.now();
  aoAndar?.('removendo o fundo…');
  const relogio = setInterval(() => {
    aoAndar?.(`removendo o fundo… ${Math.round((Date.now() - inicio) / 1000)}s`);
  }, 1000);

  try {
    const resp = await fetch(CONFIG.API_FUNDO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: corpo,
    });
    const dados = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      // O código importa tanto quanto a mensagem: 404 aqui não é modelo que
      // falta, é servidor de antes desta rota existir — e a saída para um é
      // o oposto da saída para o outro.
      const erro = new Error(dados.erro || `erro ${resp.status}`);
      erro.status = resp.status;
      throw erro;
    }
    recorte.disponivel = true;
    return {
      blob: await (await fetch(dados.src)).blob(),
      mestre: dados.mestre || '',
    };
  } finally {
    clearInterval(relogio);
  }
}

// Servidor fora do ar, modelo não baixado, disco cheio: nada disso impede a
// peça de entrar — ela entra com o fundo, e o aviso de "sem fundo
// transparente" que já existia cobre o resto. A mensagem aparece uma vez só.
function desligarRecorte(erro) {
  const primeira = recorte.disponivel !== false;
  recorte.disponivel = false;
  recorte.motivo = erro?.message || 'servidor fora do ar';
  recorte.saida = saidaDoRecorte(erro);
  atualizarChaveFundo();
  if (primeira) {
    toast(`Sem recorte automático: ${frase(recorte.motivo)} ${recorte.saida} `
        + 'Até lá as fotos entram como estão — use PNG de fundo transparente.',
      'aviso');
  }
}

// O motivo vem do servidor e às vezes é só um pedaço de frase ("rota
// desconhecida"). Emendar a saída nele sem isto dá ponto duplo ou frase colada.
const frase = (texto) => {
  const limpo = (texto || '').trim();
  return /[.!?]$/.test(limpo) ? limpo : limpo + '.';
};

// O que o administrador tem a fazer, pela cara da recusa. Um 404 na rota é
// servidor antigo ainda no ar: a rota /api/fundo nasceu depois dele, e
// nenhum download de modelo conserta isso. O 503 é o servidor certo dizendo
// que não conseguiu recortar — aí sim é modelo, onnxruntime ou memória.
function saidaDoRecorte(erro) {
  if (erro?.status === 404) {
    return 'O servidor no ar é de antes desta rota existir: feche-o e suba de '
         + 'novo com python tools/servidor.py.';
  }
  if (erro?.status === 503) {
    // O servidor já desceu a escada de modelos sozinho antes de reclamar de
    // memória, então aqui não adianta mandar trocar de modelo. No Windows o
    // teto de alocação é o commit, que depende do pagefile — e o pagefile não
    // cresce com o disco cheio. Espaço livre é a primeira coisa a olhar.
    return /mem[oó]ria/i.test(erro.message || '')
      ? 'Feche o que estiver ocupando RAM e veja o espaço livre em disco: '
        + 'com o disco cheio o Windows não tem onde crescer o pagefile, e '
        + 'nenhum modelo carrega.'
      : 'Baixe o modelo com python tools/bgbatch.py --baixar e reinicie o '
        + 'servidor.';
  }
  return 'Confira se o servidor está no ar (python tools/servidor.py).';
}

// A cor da peça, escolhida entre as que o jogo já conhece. Cada pixel opaco
// vota na cor mais próxima dele (config.js faz a comparação) e ganha a mais
// votada. É voto por pixel, não média: a média de uma jaqueta preta com estampa
// branca daria cinza, e o voto mantém ela preta.
//
// Os votos vão para duas urnas, colorido e neutro, e a urna dos coloridos ganha
// mesmo em minoria: peça colorida sempre tem dobra escura e brilho lavado, que
// votam neutro, enquanto peça preta ou branca de verdade quase não tem pixel
// colorido. Sem essa regra todo jeans verde escuro sai preto.
const VOTOS_ALVO = 24000;      // pixels amostrados — acima disso o resultado não muda
const COLORIDA_MIN = 0.25;     // dessa fatia de pixels coloridos para cima, a peça tem cor

function corDaImagem(ctx, w, h) {
  const dados = ctx.getImageData(0, 0, w, h).data;
  const passo = Math.max(1, Math.round(Math.sqrt((w * h) / VOTOS_ALVO)));
  const coloridos = new Map();
  const neutros = new Map();
  let total = 0, quantosColoridos = 0;

  for (let y = 0; y < h; y += passo) {
    for (let x = 0; x < w; x += passo) {
      const i = (y * w + x) * 4;
      // A borda meio transparente é mistura com o fundo que saiu: contar esses
      // pixels pinta a peça com a cor do estúdio.
      if (dados[i + 3] < 200) continue;
      const { nome, colorida } = corDoPixel(dados[i], dados[i + 1], dados[i + 2]);
      const urna = colorida ? coloridos : neutros;
      urna.set(nome, (urna.get(nome) || 0) + 1);
      total++;
      if (colorida) quantosColoridos++;
    }
  }
  if (total < 40) return '';                  // quase nada opaco: não dá para dizer

  const temCor = quantosColoridos >= total * COLORIDA_MIN;
  const urna = temCor ? coloridos : neutros;
  if (!urna.size) return '';

  const ranque = [...urna].sort((a, b) => b[1] - a[1]);
  const votos = ranque.reduce((soma, [, c]) => soma + c, 0);
  const [nome, contagem] = ranque[0];
  const segunda = ranque[1];

  // Duas cores distantes dividindo a peça, nenhuma dominando: é estampa, ou
  // peça de duas cores — e 'Estampado' descreve isso melhor do que qualquer uma
  // das duas sozinha. Só vale entre coloridas: claro e escuro dividindo uma peça
  // neutra é sombra, não estampa.
  if (temCor && segunda
      && contagem / votos < 0.5
      && segunda[1] / votos > 0.25
      && distanciaEntreCores(nome, segunda[0]) > 25) {
    return 'Estampado';
  }
  return nome;
}

async function prepararImagem(file, aoAndar) {
  let bitmap = await createImageBitmap(file);
  let varredura = varrerAlpha(bitmap);
  let mestre = '';

  // Foto sem transparência nenhuma é foto que ainda tem fundo. Enquanto o
  // servidor souber tirá-lo, é ele quem resolve — e no arquivo original, não
  // nesta cópia de 1000 px: o recorte em alta é o que fica guardado.
  if (!varredura.temAlpha && recorte.ligado && recorte.disponivel !== false) {
    try {
      const corte = await pedirRecorte(file, bitmap, aoAndar);
      bitmap.close?.();
      bitmap = await createImageBitmap(corte.blob);
      varredura = varrerAlpha(bitmap);
      mestre = corte.mestre;
    } catch (e) {
      desligarRecorte(e);
    }
  }
  aoAndar?.('');

  const { trab, x0, y0, x1, y1, temAlpha } = varredura;
  if (x1 < 0) throw new Error('A imagem está inteira transparente.');

  const largura = x1 - x0 + 1;
  const altura = y1 - y0 + 1;

  // Recorta na caixa real do objeto e reduz para o tamanho do acervo.
  const k = Math.min(1, MAX_LADO / Math.max(largura, altura));
  const fw = Math.max(1, Math.round(largura * k));
  const fh = Math.max(1, Math.round(altura * k));

  const saida = document.createElement('canvas');
  saida.width = fw; saida.height = fh;
  const pincel = saida.getContext('2d', { willReadFrequently: true });
  pincel.drawImage(trab, x0, y0, largura, altura, 0, 0, fw, fh);

  // A cor sai daqui, da imagem já recortada: é o que sobrou de peça, sem fundo
  // e sem a moldura vazia em volta.
  const cor = corDaImagem(pincel, fw, fh);

  let src;
  try { src = saida.toDataURL('image/webp', QUALIDADE); }
  catch { src = saida.toDataURL('image/png'); }

  bitmap.close?.();
  return { src, w: fw, h: fh, temAlpha, mestre, cor };
}

// ================================= Fila ===================================
// Vários arquivos de uma vez: entram todos como item pendente e são
// processados em sequência (o recorte é pesado; em paralelo trava a tela).
// O primeiro que fica pronto já aparece, para você ir preenchendo enquanto o
// resto termina.
// Modo edição: a fila tem um item só, montado a partir de uma peça que já está
// no acervo. A imagem dela vem do disco (assets/cloths/…), não de um arquivo —
// só é reprocessada se você soltar um PNG novo por cima.
function itemDaPeca(peca) {
  return {
    chave: ++chave,
    file: null,
    arquivo: { src: peca.src, w: peca.w || 1, h: peca.h || 1, temAlpha: true, doDisco: true },
    processando: false,
    erro: '',
    salva: false,
    medida: peca.ancora ? { ...peca.ancora } : medidaPadrao(peca.cat),
    // Peça que já tem cor gravada manda nela; peça antiga sem cor ganha o
    // palpite quando você solta uma imagem nova por cima.
    corAuto: !peca.cor,
    corDetectada: '',
    ficha: {
      cat: peca.cat,
      marca: peca.marca || '',
      cor: peca.cor || '',
      raridade: peca.raridade || 'common',
      nome: peca.nome || '',
    },
  };
}

// A cor lida da imagem entra na ficha enquanto ninguém tiver mexido no campo.
// Cor escolhida na mão vale mais que palpite, sempre.
function aplicarCorDetectada(item) {
  if (!item.corAuto || !item.arquivo?.cor) return;
  item.corDetectada = item.arquivo.cor;
  item.ficha.cor = item.arquivo.cor;
}

async function receberArquivos(lista) {
  const imagens = [...(lista || [])].filter(f => f && f.type.startsWith('image/'));
  if (!imagens.length) {
    return toast('Escolha um arquivo de imagem (PNG de preferência).', 'aviso');
  }
  if (imagens.length < (lista?.length ?? 0)) {
    toast('Alguns arquivos não eram imagem e ficaram de fora.', 'aviso');
  }

  // Editando: o PNG solto troca a imagem da peça, a ficha continua a mesma.
  if (editando) return trocarImagem(imagens[0]);

  const heranca = fichaDaTela() || ultimaFicha();
  const vazia = !fila.length;
  const novos = imagens.map(f => novoItem(f, heranca));
  fila.push(...novos);
  if (vazia) indice = 0;
  montarFila();
  atualizarBotoes();

  for (const item of novos) {
    try {
      // A tira de miniaturas não mostra etapa, só o aviso do item na tela.
      item.arquivo = await prepararImagem(item.file, (texto) => {
        item.etapa = texto;
        if (item === atual()) mostrarAviso(item);
      });
    } catch (e) {
      item.erro = e.message || 'não consegui ler essa imagem';
    }
    aplicarCorDetectada(item);
    item.etapa = '';
    item.processando = false;
    // Enquanto o item na tela ainda não tem imagem, o que ficar pronto assume
    // o lugar dele: você começa a preencher a ficha do primeiro sem esperar o
    // lote inteiro terminar.
    if (item === atual() || !atual()?.arquivo) mostrarItem(fila.indexOf(item));
    else montarFila();
  }
  mostrarItem(indice);
}

// Troca a imagem da peça em edição, mantendo ficha e medida.
async function trocarImagem(file) {
  const item = atual();
  if (!item) return;
  item.processando = true;
  item.erro = '';
  mostrarAviso(item);
  try {
    // sem doDisco: vai subir junto
    item.arquivo = await prepararImagem(file, (texto) => {
      item.etapa = texto;
      mostrarAviso(item);
    });
  } catch (e) {
    item.erro = e.message || 'não consegui ler essa imagem';
  }
  aplicarCorDetectada(item);
  item.etapa = '';
  item.processando = false;
  mostrarItem(indice);
}

// A ficha que o próximo item herda: a do último da fila, ou a da tela se ela
// já estiver preenchida.
function ultimaFicha() {
  const ultimo = fila.at(-1);
  return ultimo ? { ...ultimo.ficha } : null;
}

// Lê os campos como estão agora. Só serve de herança quando existe item na
// tela (senão os campos estão no estado de abertura, sem dono).
function fichaDaTela() {
  if (!atual()) return null;
  capturarFicha();
  return { ...atual().ficha };
}

function capturarFicha() {
  const item = atual();
  if (!item) return;
  item.ficha = {
    cat: $('#mp-cat').value,
    marca: $('#mp-marca').value.trim(),
    cor: $('#mp-cor').value.trim(),
    nome: $('#mp-nome').value.trim(),
    raridade,
  };
}

function mostrarItem(i) {
  if (!fila.length) return limparTela();
  indice = clamp(i, 0, fila.length - 1);
  const item = atual();

  $('#mp-cat').value = item.ficha.cat;
  $('#mp-marca').value = item.ficha.marca;
  $('#mp-cor').value = item.ficha.cor;
  $('#mp-nome').value = item.ficha.nome;
  raridade = item.ficha.raridade;
  montarRaridades();
  montarMarcas();
  montarCores();
  atualizarDicaCor();

  arquivo = item.arquivo;
  const previa = $('#mp-previa');
  previa.hidden = !item.arquivo;
  if (item.arquivo) previa.src = item.arquivo.src;
  else previa.removeAttribute('src');
  $('#mp-solta-vazio').hidden = Boolean(item.arquivo);

  mostrarAviso(item);
  montarFila();
  atualizarBotoes();
}

function mostrarAviso(item) {
  const aviso = $('#mp-aviso');
  if (item.processando) {
    aviso.textContent = item.etapa || 'processando…';
    aviso.classList.remove('alerta');
    return;
  }
  if (item.erro) { aviso.textContent = item.erro; aviso.classList.add('alerta'); return; }
  if (!item.arquivo) { aviso.textContent = ''; aviso.classList.remove('alerta'); return; }

  const kb = Math.round(item.arquivo.src.length / 1024);
  const medida = `${item.arquivo.w}×${item.arquivo.h} · ${kb} KB`;
  // Peça que passou pelo recorte tem alpha por construção: o que interessa
  // dizer é que o máster em alta está guardado.
  if (item.arquivo.mestre) {
    aviso.textContent = `${medida} · fundo removido, máster em alta guardado`;
    aviso.classList.remove('alerta');
    return;
  }
  aviso.textContent = item.arquivo.temAlpha
    ? medida
    : `${medida} — atenção: sem fundo transparente`;
  aviso.classList.toggle('alerta', !item.arquivo.temAlpha);
}

// A chave do recorte na tela. Quando o servidor já recusou, ela fica travada
// desligada com o motivo à vista — não adianta oferecer o que não existe.
function atualizarChaveFundo() {
  const chave = $('#mp-tirar-fundo');
  const dica = $('#mp-fundo-dica');
  const pista = $('#mp-solta-dica');
  if (!chave) return;

  const fora = recorte.disponivel === false;
  chave.disabled = fora;
  chave.checked = recorte.ligado && !fora;

  if (fora) {
    dica.textContent = `Indisponível: ${frase(recorte.motivo)} ${recorte.saida}`;
  } else if (recorte.ligado) {
    dica.textContent = 'A foto vai para o servidor, volta recortada, e o recorte '
      + 'em alta fica guardado em assets/mestres/. Demora alguns segundos por peça.';
  } else {
    dica.textContent = 'Desligado: a foto entra como está. Use PNG de fundo '
      + 'transparente.';
  }
  if (pista) {
    pista.textContent = (recorte.ligado && !fora)
      ? 'foto com fundo serve · o recorte é feito sozinho'
      : 'fundo transparente · o recorte é feito automaticamente';
  }
}

function limparTela() {
  fila = [];
  indice = 0;
  arquivo = null;
  medida = null;
  $('#mp-previa').hidden = true;
  $('#mp-previa').removeAttribute('src');
  $('#mp-solta-vazio').hidden = false;
  $('#mp-nome').value = '';
  atualizarDicaCor();
  $('#mp-aviso').textContent = '';
  $('#mp-aviso').classList.remove('alerta');
  montarFila();
  atualizarBotoes();
}

// A tira de miniaturas: onde a fila fica visível. Clique troca o item em
// edição; o ✕ tira da fila. Com um arquivo só ela some.
function montarFila() {
  const tira = $('#mp-fila');
  tira.innerHTML = '';
  tira.hidden = fila.length < 2;
  if (tira.hidden) return;

  for (const [i, item] of fila.entries()) {
    const classe = 'mp-fila-item'
      + (i === indice ? ' ativa' : '')
      + (item.salva ? ' salva' : '')
      + (item.erro ? ' erro' : '');
    tira.append(el('button', {
      class: classe,
      title: item.erro || item.ficha.nome || item.file.name,
      onclick: () => { capturarFicha(); mostrarItem(i); },
    },
      item.arquivo
        ? el('img', { src: item.arquivo.src, alt: '' })
        : el('span', { class: 'mp-fila-vazio' }, item.erro ? '!' : '…'),
      item.medida ? el('span', { class: 'mp-fila-medida', title: 'já dimensionada' }, '↔') : null,
      item.salva ? el('span', { class: 'mp-fila-ok' }, '✓') : null,
      el('span', {
        class: 'mp-fila-x',
        title: 'tirar da fila',
        onclick: (e) => { e.stopPropagation(); removerDaFila(i); },
      }, '✕'),
    ));
  }

  const restam = pendentes().length;
  tira.append(el('span', { class: 'mp-fila-conta' },
    `${indice + 1} de ${fila.length}${restam < fila.length ? ` · ${restam} por salvar` : ''}`));
}

function removerDaFila(i) {
  fila.splice(i, 1);
  if (!fila.length) return limparTela();
  mostrarItem(indice > i ? indice - 1 : indice);
}

// Os botões dependem do que existe na fila: sem arquivo pronto não há o que
// dimensionar, e "salvar todas" só faz sentido com mais de uma pendente.
function atualizarBotoes() {
  const item = atual();
  const pronto = Boolean(item?.arquivo);
  $('#mp-continuar').disabled = !pronto;
  $('#mp-continuar').textContent = editando
    ? 'Conferir o tamanho →'
    : (fila.length > 1 ? 'Dimensionar esta →' : 'Dimensionar →');

  // Editando é sempre uma peça só: os atalhos de lote não têm o que fazer.
  if (editando) {
    $('#mp-salvar-todas').hidden = true;
    $('#mp-ficha-demais').hidden = true;
    if ($('#mp-aplicar-demais')) $('#mp-aplicar-demais').hidden = true;
    return;
  }

  const restam = pendentes().length;
  const todas = $('#mp-salvar-todas');
  todas.hidden = restam < 2;
  todas.textContent = `Salvar as ${restam} com tamanho padrão`;

  const ficha = $('#mp-ficha-demais');
  ficha.hidden = fila.length < 2;
  ficha.textContent = `Usar esta ficha nas outras ${fila.length - 1}`;

  const demais = $('#mp-aplicar-demais');
  if (demais) {
    const irmas = item ? pendentes().filter(x => x !== item && x.ficha.cat === item.ficha.cat).length : 0;
    demais.hidden = irmas < 1;
    demais.textContent = `Aplicar às outras ${irmas} de ${CATEGORIAS[item?.ficha.cat]?.nome ?? ''}`;
  }
}

// ================================ Passo 1 =================================
// As marcas que você já usou viram sugestão: atalho em chip e autocomplete no
// campo. O registro delas fica no perfil, para carregar mais informação depois.
function montarMarcas() {
  const campo = $('#mp-marca');
  const lista = $('#mp-marcas-lista');
  const chips = $('#mp-marcas');

  lista.innerHTML = '';
  chips.innerHTML = '';

  const marcas = db.marcasOrdenadas();
  if (!marcas.length) return;

  for (const m of marcas) lista.append(el('option', { value: m.nome }));

  for (const m of marcas.slice(0, 6)) {
    chips.append(el('button', {
      class: 'mp-marca-chip' + (campo.value.trim() === m.nome ? ' ativa' : ''),
      title: `${m.usos} ${m.usos === 1 ? 'peça' : 'peças'}`,
      onclick: () => {
        campo.value = campo.value.trim() === m.nome ? '' : m.nome;
        montarMarcas();
      },
    }, m.nome));
  }
}

// A cor funciona igual à marca: campo livre, com o que você já usou virando
// chip e autocomplete. A diferença é a paleta de CONFIG, que entra junto como
// sugestão inicial — e a bolinha, que só aparece em cor conhecida.
function montarCores() {
  const campo = $('#mp-cor');
  const lista = $('#mp-cores-lista');
  const chips = $('#mp-cores');

  lista.innerHTML = '';
  chips.innerHTML = '';

  // Usadas primeiro, depois a paleta — sem repetir nome.
  const usadas = db.coresOrdenadas();
  const vistas = new Set(usadas.map(c => c.nome.toLowerCase()));
  const sugestoes = [
    ...usadas.map(c => c.nome),
    ...CORES.map(c => c.nome).filter(n => !vistas.has(n.toLowerCase())),
  ];

  for (const nome of sugestoes) lista.append(el('option', { value: nome }));

  // A cor escolhida nunca fica de fora dos chips, mesmo vindo do fim da lista:
  // sem isso ela ficaria marcada num chip que não aparece.
  const escolhida = campo.value.trim().toLowerCase();
  const visiveis = sugestoes.slice(0, 8);
  if (escolhida && !visiveis.some(n => n.toLowerCase() === escolhida)) {
    const achada = sugestoes.find(n => n.toLowerCase() === escolhida);
    if (achada) visiveis.splice(7, 1, achada);
  }

  for (const nome of visiveis) {
    const hex = hexDaCor(nome);
    chips.append(el('button', {
      class: 'mp-marca-chip mp-cor-chip' + (campo.value.trim().toLowerCase() === nome.toLowerCase() ? ' ativa' : ''),
      onclick: () => {
        campo.value = campo.value.trim().toLowerCase() === nome.toLowerCase() ? '' : nome;
        marcarCorManual();
        montarCores();
      },
    },
      el('span', {
        class: 'mp-cor-bolha' + (hex === 'estampa' ? ' estampa' : '') + (hex ? '' : ' livre'),
        style: hex && hex !== 'estampa' ? { '--cor': hex } : {},
      }),
      nome
    ));
  }
}

// Escolher a cor na mão encerra o palpite: ele não volta nem quando a imagem
// termina de processar depois.
function marcarCorManual() {
  const item = atual();
  if (item) item.corAuto = false;
  capturarFicha();
  atualizarDicaCor();
}

// A linha embaixo dos chips, que só aparece enquanto a cor é palpite — sem ela
// a cor apareceria preenchida sozinha, sem dizer de onde veio.
function atualizarDicaCor() {
  const dica = $('#mp-cor-dica');
  if (!dica) return;
  const item = atual();
  const palpite = Boolean(item?.corAuto && item?.corDetectada);
  dica.hidden = !palpite;
  if (palpite) {
    dica.textContent = `Reconhecida na imagem: ${item.corDetectada}. `
      + 'Troque no campo ou num atalho se não for.';
  }
}

function montarCategorias() {
  const cat = $('#mp-cat');
  if (cat.options.length) return;            // a lista não muda; montar uma vez basta
  for (const c of ORDEM_CATEGORIAS) {
    cat.append(el('option', { value: c }, `${CATEGORIAS[c].icone}  ${CATEGORIAS[c].nome}`));
  }
}

// Só os chips de raridade são redesenhados a cada escolha — redesenhar o resto
// zerava a categoria que a pessoa tinha acabado de escolher.
function montarRaridades() {
  const box = $('#mp-raridades');
  box.innerHTML = '';
  for (const r of RARIDADES) {
    box.append(el('button', {
      class: 'mp-rar' + (r.id === raridade ? ' ativa' : ''),
      dataset: { id: r.id },
      style: r.aura && r.aura !== 'arco-iris' ? { '--rar': r.aura } : {},
      onclick: () => { raridade = r.id; capturarFicha(); montarRaridades(); },
    },
      el('span', { class: 'mp-rar-bolha' + (r.aura === 'arco-iris' ? ' arco' : '') }),
      r.nome
    ));
  }
}

// Categoria, marca e raridade desta peça viram as de toda a fila. O nome não,
// que é o que distingue uma da outra — e a cor passou a ser assim também: cada
// peça já tem a dela, lida da imagem ou escolhida na mão, e um lote da mesma
// marca costuma vir em cores diferentes. Esta cor só preenche quem ainda está
// sem nenhuma, que é melhor que deixar o campo vazio.
function aplicarFichaAsDemais() {
  capturarFicha();
  const item = atual();
  if (!item) return;
  const outras = fila.filter(x => x !== item && !x.salva);
  for (const o of outras) {
    o.ficha = {
      ...o.ficha,
      cat: item.ficha.cat,
      marca: item.ficha.marca,
      cor: o.ficha.cor || item.ficha.cor,
      raridade: item.ficha.raridade,
    };
    o.medida = null;                 // categoria nova, medida antiga não vale
  }
  montarFila();
  atualizarBotoes();
  toast(`Ficha aplicada a ${outras.length} ${outras.length === 1 ? 'peça' : 'peças'} — `
    + 'o nome e a cor de cada uma ficam.');
}

// ================================ Passo 2 =================================
// Medida padrão de uma categoria: a âncora de CONFIG. É ela que vale em tudo
// que for salvo sem passar pelo molde.
const medidaPadrao = (cat) => {
  const p = CATEGORIAS[cat].anchor;
  return { x: p.x, y: p.y, w: p.w };
};

function irParaMedida() {
  const item = atual();
  if (!item?.arquivo) return;
  capturarFicha();
  medida = item.medida ? { ...item.medida } : medidaPadrao(item.ficha.cat);

  $('#mp-passo1').hidden = true;
  $('#mp-passo2').hidden = false;
  $('#mp-titulo').textContent = editando
    ? `Editar · ${nomeDaPeca(editando)}`
    : (fila.length > 1
      ? `Dimensionar no molde · ${indice + 1} de ${fila.length}`
      : 'Dimensionar no molde');
  // O molde é alto e estreito: no passo 2 a caixa toda cresce para caber o
  // maior molde possível, senão medir vira adivinhação.
  $('#mp-caixa').classList.add('medindo');

  $('#mp-avatar').innerHTML = svgAvatar();
  $('#mp-peca-img').src = item.arquivo.src;
  atualizarBotoes();
  posicionarPeca();
}

function voltarParaFicha() {
  $('#mp-passo2').hidden = true;
  $('#mp-passo1').hidden = false;
  $('#mp-caixa').classList.remove('medindo');
  $('#mp-titulo').textContent = editando ? `Editar · ${nomeDaPeca(editando)}` : 'Adicionar peça';
  mostrarItem(indice);
}

function posicionarPeca() {
  const no = $('#mp-peca');
  const prop = arquivo.w / arquivo.h;
  const alturaUn = medida.w / prop;

  no.style.left = (medida.x / CONFIG.STAGE_W * 100) + '%';
  no.style.top = (medida.y / CONFIG.STAGE_H * 100) + '%';
  no.style.width = (medida.w / CONFIG.STAGE_W * 100) + '%';
  no.style.height = (alturaUn / CONFIG.STAGE_H * 100) + '%';

  const porCorpo = Math.round(medida.w / 224 * 100);   // 224 un = largura dos ombros
  const campo = $('#mp-medida');
  campo.textContent = `largura ${Math.round(medida.w)} un · ${porCorpo}% dos ombros`;

  // Aviso de medida fora da curva. A medida é a verdade sobre o tamanho da
  // peça em todo o app, então errar aqui não aparece agora — aparece depois,
  // com a camisa maior que a calça na loja. Comparar com a largura padrão da
  // categoria pega o caso comum: dimensionar a peça para preencher o molde
  // em vez de encostar no corpo.
  const cat = $('#mp-cat').value;
  const razao = medida.w / CATEGORIAS[cat].anchor.w;
  const fora = razao > 1.55 || razao < 0.6;
  if (fora) {
    campo.textContent += ` — ${razao.toFixed(1).replace('.', ',')}× a largura padrão de ` +
      `${CATEGORIAS[cat].nome}, confira`;
  }
  campo.classList.toggle('alerta', fora);

  if (atual()) atual().medida = { ...medida };
}

// A medida desta peça vira a das outras da mesma categoria que ainda não
// foram salvas: um par de tênis medido resolve os outros nove.
function aplicarAsDemais() {
  const item = atual();
  if (!item) return;
  const irmas = pendentes().filter(x => x !== item && x.ficha.cat === item.ficha.cat);
  for (const outra of irmas) outra.medida = { ...medida };
  atualizarBotoes();
  toast(`Medida aplicada a ${irmas.length} ${irmas.length === 1 ? 'peça' : 'peças'} de ${CATEGORIAS[item.ficha.cat].nome}.`);
}

function ligarPalco() {
  const no = $('#mp-peca');

  no.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const palco = $('#mp-molde').getBoundingClientRect();
    const alca = e.target.dataset?.alca;
    const base = { ...medida };
    const inicio = { x: e.clientX, y: e.clientY };
    const centro = {
      x: palco.left + (medida.x / CONFIG.STAGE_W) * palco.width,
      y: palco.top + (medida.y / CONFIG.STAGE_H) * palco.height,
    };
    const raio0 = Math.hypot(e.clientX - centro.x, e.clientY - centro.y) || 1;

    no.setPointerCapture(e.pointerId);
    no.classList.add('manipulando');

    const mover = (ev) => {
      if (alca) {
        const raio = Math.hypot(ev.clientX - centro.x, ev.clientY - centro.y);
        medida.w = clamp(base.w * (raio / raio0), 20, 600);
      } else {
        medida.x = clamp(base.x + (ev.clientX - inicio.x) / palco.width * CONFIG.STAGE_W, 0, CONFIG.STAGE_W);
        medida.y = clamp(base.y + (ev.clientY - inicio.y) / palco.height * CONFIG.STAGE_H, 0, CONFIG.STAGE_H);
      }
      posicionarPeca();
    };
    const soltar = () => {
      no.classList.remove('manipulando');
      no.removeEventListener('pointermove', mover);
      no.removeEventListener('pointerup', soltar);
      no.removeEventListener('pointercancel', soltar);
    };
    no.addEventListener('pointermove', mover);
    no.addEventListener('pointerup', soltar);
    no.addEventListener('pointercancel', soltar);
  });

  // Roda do mouse também redimensiona.
  $('#mp-molde').addEventListener('wheel', (e) => {
    if ($('#mp-passo2').hidden) return;
    e.preventDefault();
    medida.w = clamp(medida.w * (e.deltaY < 0 ? 1.06 : 0.94), 20, 600);
    posicionarPeca();
  }, { passive: false });
}

// ================================= Salvar =================================
// Um id estável e legível a partir da ficha; o servidor recusa id repetido.
// O sufixo tem um contador junto do relógio porque um lote inteiro sai no
// mesmo milissegundo.
let seq = 0;
function gerarId(ficha) {
  const base = (ficha.nome || ficha.marca || ficha.cat)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
  return (base || 'peca') + '-' + Date.now().toString(36) + (seq++ % 36).toString(36);
}

// Grava um item no acervo do servidor e registra o que voltou. Devolve a peça
// salva, ou lança com a mensagem do servidor.
async function gravarItem(item) {
  const peca = {
    id: gerarId(item.ficha),
    cat: item.ficha.cat,
    marca: item.ficha.marca,
    cor: item.ficha.cor,
    nome: item.ficha.nome,
    src: item.arquivo.src,
    w: item.arquivo.w,
    h: item.arquivo.h,
    // Token do recorte em alta que ficou no servidor: é aqui que ele deixa de
    // ser rascunho e vira assets/mestres/<id>.png.
    mestre: item.arquivo.mestre || '',
    raridade: item.ficha.raridade,
    ancora: (() => {
      const m = item.medida || medidaPadrao(item.ficha.cat);
      return { x: Math.round(m.x), y: Math.round(m.y), w: Math.round(m.w) };
    })(),
  };

  const resp = await fetch(CONFIG.API_PECAS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(peca),
  });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(dados.erro || `erro ${resp.status}`);

  const salva = dados.item;
  db.registrarMarca(salva.marca);
  db.registrarCor(salva.cor);
  registrarPeca(salva, { permanente: true });

  // A peça sempre entra no acervo — agora em disco, para todos. Ir para o
  // guarda-roupa é opcional: sem isso ela fica de estoque, para aparecer na
  // vitrine e ser garimpada.
  if ($('#mp-para-mim').checked) {
    db.adicionarPeca(salva, { origem: 'propria', raridade: item.ficha.raridade });
    db.state.stats.resgates += 1;
  }
  item.salva = true;
  return salva;
}

// Grava a edição da peça que está na tela. O id não muda: é ele que amarra a
// peça ao inventário de quem já a tem, então editar aqui conserta a peça para
// todo mundo em vez de criar outra. A imagem só sobe se você trocou o PNG.
async function gravarEdicao(item) {
  const corpo = {
    cat: item.ficha.cat,
    marca: item.ficha.marca,
    cor: item.ficha.cor,
    nome: item.ficha.nome,
    raridade: item.ficha.raridade,
    ancora: (() => {
      const m = item.medida || medidaPadrao(item.ficha.cat);
      return { x: Math.round(m.x), y: Math.round(m.y), w: Math.round(m.w) };
    })(),
  };
  if (!item.arquivo.doDisco) {
    corpo.src = item.arquivo.src;
    corpo.w = item.arquivo.w;
    corpo.h = item.arquivo.h;
    corpo.mestre = item.arquivo.mestre || '';
  }

  const resp = await fetch(`${CONFIG.API_PECAS}/${encodeURIComponent(editando.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(dados.erro || `erro ${resp.status}`);

  // A imagem trocada mantém o nome do arquivo; sem o sufixo o navegador
  // continuaria mostrando a antiga do cache.
  const salva = { ...dados.item };
  if (!item.arquivo.doDisco) salva.src += '?v=' + Date.now().toString(36);

  db.registrarMarca(salva.marca);
  db.registrarCor(salva.cor);
  registrarPeca(salva, { permanente: true });

  // Quem já tem a peça guarda categoria e raridade na própria cópia: sem
  // atualizar aqui, o guarda-roupa continuaria mostrando a ficha antiga.
  const minha = db.pecaDoInventario(salva.id);
  if (minha) {
    minha.cat = salva.cat;
    minha.raridade = salva.raridade;
  }
  item.salva = true;
  return salva;
}

const erroDeGravacao = (e) =>
  `Não consegui gravar a peça: ${e.message}. O acervo só aceita peça com o servidor no ar (python tools/servidor.py).`;

// Salvar em modo edição: grava e fecha — não há próxima da fila.
async function salvarEdicao(item) {
  const botao = $('#mp-salvar');
  botao.disabled = true;
  $('#mp-medida').textContent = 'gravando alterações…';
  let salva;
  try {
    salva = await gravarEdicao(item);
  } catch (e) {
    botao.disabled = false;
    posicionarPeca();
    return toast(erroDeGravacao(e), 'aviso');
  }
  db.salvar();
  botao.disabled = false;
  toast(`${nomeDaPeca(salva)} atualizada no acervo.`, item.ficha.raridade);
  fechar();
  aoSalvar?.(salva);
}

// Salvar do passo 2: grava a peça na tela e segue para a próxima pendente.
// A fila só fecha o modal quando acaba.
async function salvar() {
  const item = atual();
  if (!item?.arquivo) return;
  if (editando) return salvarEdicao(item);
  const botao = $('#mp-salvar');

  botao.disabled = true;
  $('#mp-medida').textContent = 'gravando no acervo…';
  let salva;
  try {
    salva = await gravarItem(item);
  } catch (e) {
    botao.disabled = false;
    posicionarPeca();
    return toast(erroDeGravacao(e), 'aviso');
  }
  db.salvar();
  botao.disabled = false;

  const paraMim = $('#mp-para-mim').checked;
  toast(paraMim
    ? `${nomeDaPeca(salva)} entrou no jogo e no seu guarda-roupa — ${RARIDADE[item.ficha.raridade].nome}.`
    : `${nomeDaPeca(salva)} entrou no acervo da loja — ${RARIDADE[item.ficha.raridade].nome}.`,
    item.ficha.raridade);

  seguirParaProxima(salva);
}

// Depois de gravar: tira a peça da fila e abre a próxima que ainda falta.
// Sem próxima, fecha — e é aí que quem abriu o modal é avisado.
function seguirParaProxima(salva) {
  fila = fila.filter(i => !i.salva);
  if (!fila.length) {
    fechar();
    aoSalvar?.(salva);
    return;
  }
  indice = clamp(indice, 0, fila.length - 1);
  voltarParaFicha();
  aoSalvar?.(salva);
}

// Salvar em lote: o que sobrou na fila vai com a medida que cada peça já tiver
// (ou o padrão da categoria). Uma de cada vez, para o servidor não engasgar e
// para dar pra dizer onde parou se alguma falhar.
async function salvarTodas() {
  capturarFicha();
  const lote = pendentes();
  if (!lote.length) return;

  const botao = $('#mp-salvar-todas');
  const outros = [$('#mp-continuar'), $('#mp-cancelar')];
  botao.disabled = true;
  outros.forEach(b => { b.disabled = true; });

  let feitas = 0, ultima = null, falha = null;
  for (const item of lote) {
    $('#mp-aviso').textContent = `gravando ${feitas + 1} de ${lote.length}…`;
    try {
      ultima = await gravarItem(item);
      feitas++;
    } catch (e) {
      falha = e;
      break;
    }
    montarFila();
  }
  db.salvar();

  botao.disabled = false;
  outros.forEach(b => { b.disabled = false; });

  if (falha) {
    fila = fila.filter(i => !i.salva);
    indice = 0;
    mostrarItem(0);
    return toast(
      `${feitas} de ${lote.length} gravadas. Parou em "${atual()?.ficha.nome || 'peça'}": ${erroDeGravacao(falha)}`,
      'aviso');
  }

  toast(`${feitas} ${feitas === 1 ? 'peça entrou' : 'peças entraram'} no acervo.`,
    'legendary');
  fila = fila.filter(i => !i.salva);
  if (!fila.length) {
    fechar();
    aoSalvar?.(ultima);
  } else {
    mostrarItem(0);
    aoSalvar?.(ultima);
  }
}

// ================================= Montagem ===============================
export function fechar() {
  $('#modal-peca').hidden = true;
  $('#mp-caixa').classList.remove('medindo');
  document.body.classList.remove('com-modal');
  editando = null;
  $('#mp-caixa').classList.remove('editando');
}

export function abrirAdicionar(callback) {
  aoSalvar = callback;
  editando = null;
  $('#mp-caixa').classList.remove('editando');
  fila = [];
  indice = 0;
  arquivo = null;
  medida = null;
  raridade = 'common';

  $('#mp-passo1').hidden = false;
  $('#mp-passo2').hidden = true;
  $('#mp-titulo').textContent = 'Adicionar peça';
  $('#mp-arquivo').value = '';
  $('#mp-salvar').textContent = 'Salvar peça';
  $('#mp-para-mim').checked = true;
  $('#mp-marca').value = '';
  $('#mp-cor').value = '';
  montarCategorias();
  montarRaridades();
  montarMarcas();
  montarCores();
  limparTela();
  $('#mp-caixa').classList.remove('medindo');

  $('#modal-peca').hidden = false;
  document.body.classList.add('com-modal');
}

// Editar uma peça que já existe no acervo. Mesmo modal, mesma ficha, mesmo
// molde — a diferença é que salva por cima em vez de criar outra, e que a
// imagem já vem carregada (soltar um PNG novo troca só a imagem).
// Só peça do acervo do administrador pode ser editada: as do pipeline não
// moram no acervo.json e o servidor recusaria.
export function abrirEditar(peca, callback) {
  if (!peca) return;
  if (!peca.permanente) {
    return toast('Essa peça veio do catálogo gerado pelo pipeline — só dá para editar as que foram subidas por aqui.', 'aviso');
  }

  aoSalvar = callback;
  editando = peca;
  arquivo = null;
  medida = null;

  montarCategorias();
  fila = [itemDaPeca(peca)];
  indice = 0;
  raridade = fila[0].ficha.raridade;

  $('#mp-passo1').hidden = false;
  $('#mp-passo2').hidden = true;
  $('#mp-caixa').classList.remove('medindo');
  $('#mp-caixa').classList.add('editando');     // esconde o destino e troca o texto do drop
  $('#mp-titulo').textContent = `Editar · ${nomeDaPeca(peca)}`;
  $('#mp-arquivo').value = '';
  $('#mp-salvar').textContent = 'Salvar alterações';

  mostrarItem(0);

  $('#modal-peca').hidden = false;
  document.body.classList.add('com-modal');
}

export function montarAdicionar() {
  montarCategorias();
  montarRaridades();
  montarCores();
  ligarPalco();

  const solta = $('#mp-solta');
  solta.addEventListener('click', () => $('#mp-arquivo').click());
  $('#mp-arquivo').addEventListener('change', (e) => {
    receberArquivos(e.target.files);
    e.target.value = '';           // o mesmo arquivo pode ser escolhido de novo
  });

  for (const evt of ['dragenter', 'dragover']) {
    solta.addEventListener(evt, (e) => { e.preventDefault(); solta.classList.add('sobre'); });
  }
  for (const evt of ['dragleave', 'drop']) {
    solta.addEventListener(evt, (e) => { e.preventDefault(); solta.classList.remove('sobre'); });
  }
  solta.addEventListener('drop', (e) => receberArquivos(e.dataTransfer.files));

  // Campo alterado é ficha do item na tela: sem capturar aqui, trocar de item
  // na tira perderia o que você acabou de digitar.
  for (const sel of ['#mp-cat', '#mp-marca', '#mp-cor', '#mp-nome']) {
    $(sel).addEventListener('change', capturarFicha);
  }
  $('#mp-cat').addEventListener('change', () => { capturarFicha(); atualizarBotoes(); });
  $('#mp-marca').addEventListener('input', () => { capturarFicha(); montarMarcas(); });
  $('#mp-cor').addEventListener('input', () => { marcarCorManual(); montarCores(); });
  $('#mp-nome').addEventListener('input', capturarFicha);

  $('#mp-tirar-fundo').addEventListener('change', (e) => {
    recorte.ligado = e.target.checked;
    atualizarChaveFundo();
  });
  atualizarChaveFundo();

  $('#mp-continuar').addEventListener('click', irParaMedida);
  $('#mp-ficha-demais').addEventListener('click', aplicarFichaAsDemais);
  $('#mp-salvar-todas').addEventListener('click', salvarTodas);
  $('#mp-voltar').addEventListener('click', voltarParaFicha);
  $('#mp-padrao').addEventListener('click', () => {
    medida = medidaPadrao($('#mp-cat').value);
    posicionarPeca();
  });
  $('#mp-aplicar-demais').addEventListener('click', aplicarAsDemais);
  $('#mp-salvar').addEventListener('click', salvar);
  $('#mp-cancelar').addEventListener('click', fechar);
  $('#mp-fechar').addEventListener('click', fechar);

  $('#modal-peca').addEventListener('pointerdown', (e) => {
    if (e.target.id === 'modal-peca') fechar();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#modal-peca').hidden) fechar();
  });
}
