// Editar peça do acervo.
//
// Peça nova não entra por aqui: entra pela esteira (esteira.html), que sobe a
// foto, recorta na nuvem e palpita a ficha. Este modal é o conserto de uma peça
// que já existe — ficha, medida no molde e, se for o caso, a imagem.
//
// Dois passos: a ficha (categoria, marca, cor, nome, raridade — e girar ou
// cortar a imagem) e o molde do avatar, onde a peça ganha o tamanho real dela.
// O id não muda: é ele que amarra
// a peça ao inventário de quem já a tem, então editar aqui conserta a peça para
// todo mundo em vez de criar outra.
//
// Trocar a imagem: soltar um PNG de fundo transparente sobre a prévia. Ele é
// aparado pelo alpha, reduzido e convertido para WebP aqui no navegador, e sobe
// junto com a ficha. Foto com fundo vai pela esteira.
//
// Ferramenta de administração: só aparece em modo admin, e quem grava é a API
// (PUT /api/pecas/<id>), que recusa quem não for administrador.

import { CONFIG, CATEGORIAS, CORES, ORDEM_CATEGORIAS, RARIDADES, hexDaCor, ancoraPadrao,
         corDoPixel, distanciaEntreCores, rotuloDeCadastro } from './config.js';
import { registrarPeca, esquecerPeca, nomeDaPeca } from './catalog.js';
import * as db from './db.js';
import { svgAvatar } from './avatar.js';
import { ancoraNoMolde, ancoraNoCorpo } from './proporcao.js';
import { el, $, clamp, toast } from './util.js';

const MAX_LADO = 460;          // maior lado da imagem guardada (= esteira)
const QUALIDADE = 0.75;

let peca = null;               // a peça do acervo em edição
let ficha = null;              // { cat, marca, cor, nome, raridade }
let arquivo = null;            // { src, w, h, novo } — novo = imagem trocada, sobe junto
let medida = null;             // { x, y, w } em unidades do palco (600×1200)
let aoSalvar = null;

// Girar e cortar. Toda edição sai da `origem` (a imagem como chegou, em até
// 1000 px), nunca do resultado da edição anterior: girar quatro vezes não pode
// ir borrando a peça a cada WebP.
let origem = null;             // canvas da imagem sem edição (carregado sob demanda)
let arquivoBase = null;        // o `arquivo` antes de girar/cortar — o "Restaurar"
let passos = 0;                // quartos de volta, sentido horário
let fino = 0;                  // graus do "endireitar", -45 a 45
let corte = null;              // { x, y, w, h } em 0–1 sobre a imagem já girada
let cortando = null;           // o retângulo em edição no modo cortar

const novoCanvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};

// A caixa do que não é transparente; null se não sobrou nada.
function caixaOpaca(canvas) {
  const { width: w, height: h } = canvas;
  const dados = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1, opacos = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (dados[(y * w + x) * 4 + 3] < 10) continue;
      opacos++;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, opacos };
}

// Apara pelo alpha, reduz para o tamanho guardado e vira WebP.
function codificar(canvas) {
  const caixa = caixaOpaca(canvas);
  if (!caixa) throw new Error('Não sobrou nada da peça — o corte ficou só no transparente.');
  const k = Math.min(1, MAX_LADO / Math.max(caixa.w, caixa.h));
  const saida = novoCanvas(caixa.w * k, caixa.h * k);
  const pincel = saida.getContext('2d', { willReadFrequently: true });
  pincel.imageSmoothingQuality = 'high';
  pincel.drawImage(canvas, caixa.x, caixa.y, caixa.w, caixa.h, 0, 0, saida.width, saida.height);

  let src;
  try { src = saida.toDataURL('image/webp', QUALIDADE); }
  catch { src = saida.toDataURL('image/png'); }
  return { src, w: saida.width, h: saida.height, novo: true, cor: corDaImagem(pincel, saida.width, saida.height) };
}

// ============================ Trocar imagem ===============================
// Uma cópia de até 1000 px, aparada pelo alpha: é a origem das edições.
async function prepararImagem(file) {
  const bitmap = await createImageBitmap(file);
  const escala = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
  const trab = novoCanvas(bitmap.width * escala, bitmap.height * escala);
  trab.getContext('2d', { willReadFrequently: true }).drawImage(bitmap, 0, 0, trab.width, trab.height);
  bitmap.close?.();

  const caixa = caixaOpaca(trab);
  if (!caixa) throw new Error('A imagem está inteira transparente.');
  if (caixa.opacos >= trab.width * trab.height * 0.985) {
    throw new Error('Essa imagem tem fundo. Para foto com fundo, use a esteira — ela recorta sozinha.');
  }
  const aparada = novoCanvas(caixa.w, caixa.h);
  aparada.getContext('2d').drawImage(trab, caixa.x, caixa.y, caixa.w, caixa.h, 0, 0, caixa.w, caixa.h);
  return { canvas: aparada, arquivo: codificar(aparada) };
}

// A cor da peça, escolhida entre as que o jogo conhece: cada pixel opaco vota
// na cor mais próxima. Os coloridos ganham mesmo em minoria — dobra escura e
// brilho lavado votam neutro em qualquer peça colorida.
function corDaImagem(ctx, w, h) {
  const dados = ctx.getImageData(0, 0, w, h).data;
  const passo = Math.max(1, Math.round(Math.sqrt((w * h) / 24000)));
  const coloridos = new Map(), neutros = new Map();
  let total = 0, quantosColoridos = 0;
  for (let y = 0; y < h; y += passo) {
    for (let x = 0; x < w; x += passo) {
      const i = (y * w + x) * 4;
      if (dados[i + 3] < 200) continue;
      const { nome, colorida } = corDoPixel(dados[i], dados[i + 1], dados[i + 2]);
      const urna = colorida ? coloridos : neutros;
      urna.set(nome, (urna.get(nome) || 0) + 1);
      total++;
      if (colorida) quantosColoridos++;
    }
  }
  if (total < 40) return '';
  const urna = quantosColoridos >= total * 0.25 ? coloridos : neutros;
  if (!urna.size) return '';
  const ranque = [...urna].sort((a, b) => b[1] - a[1]);
  const votos = ranque.reduce((s, [, c]) => s + c, 0);
  const [nome, contagem] = ranque[0];
  const segunda = ranque[1];
  if (urna === coloridos && segunda && contagem / votos < 0.5 && segunda[1] / votos > 0.25
      && distanciaEntreCores(nome, segunda[0]) > 25) {
    return 'Estampado';
  }
  return nome;
}

async function trocarImagem(file) {
  if (!file?.type.startsWith('image/')) return;
  $('#mp-aviso').textContent = 'processando…';
  let pronta;
  try {
    pronta = await prepararImagem(file);
  } catch (e) {
    return avisar(e.message);
  }
  sairDoCorte();
  zerarEdicao();
  origem = pronta.canvas;
  arquivo = arquivoBase = pronta.arquivo;
  ganharCor();
  mostrarImagem();
}

// Peça antiga sem cor ganha o palpite da imagem nova; cor escrita fica.
function ganharCor() {
  if (ficha.cor || !arquivo.cor) return;
  $('#mp-cor').value = ficha.cor = arquivo.cor;
  montarCores();
}

function avisar(texto) {
  $('#mp-aviso').textContent = texto;
  $('#mp-aviso').classList.add('alerta');
}

function mostrarImagem() {
  $('#mp-previa').src = arquivo.src;
  $('#mp-previa').style.transform = '';
  const aviso = $('#mp-aviso');
  aviso.classList.remove('alerta');
  aviso.textContent = arquivo.novo
    ? `imagem nova · ${arquivo.w}×${arquivo.h} · ${Math.round(arquivo.src.length / 1024)} KB`
    : '';
  $('#mp-restaurar').disabled = arquivo === arquivoBase;
}

// ============================ Girar e cortar ==============================
function zerarEdicao() {
  passos = 0; fino = 0; corte = null;
  $('#mp-fino').value = 0;
  $('#mp-fino-valor').textContent = '0°';
}

// A peça já no editor vem do site (mesma origem), então o canvas pode lê-la.
async function garantirOrigem() {
  if (origem) return origem;
  const img = new Image();
  img.decoding = 'async';
  img.src = arquivoBase.src;
  await img.decode();
  const c = novoCanvas(img.naturalWidth, img.naturalHeight);
  c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0);
  c.getContext('2d').getImageData(0, 0, 1, 1);   // falha já aqui se o canvas ficou bloqueado
  return (origem = c);
}

// A origem girada, no menor retângulo que a contém (cantos transparentes).
function girada() {
  const graus = passos * 90 + fino;
  if (!graus) return origem;
  const rad = graus * Math.PI / 180;
  const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
  const w = origem.width, h = origem.height;
  const c = novoCanvas(w * cos + h * sin, w * sin + h * cos);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(rad);
  ctx.drawImage(origem, -w / 2, -h / 2);
  return c;
}

function recortada(canvas, r) {
  if (!r) return canvas;
  const x = r.x * canvas.width, y = r.y * canvas.height;
  const c = novoCanvas(r.w * canvas.width, r.h * canvas.height);
  c.getContext('2d', { willReadFrequently: true })
    .drawImage(canvas, x, y, c.width, c.height, 0, 0, c.width, c.height);
  return c;
}

// Refaz a imagem a partir da origem com o giro e o corte atuais.
async function aplicarEdicao() {
  try {
    await garantirOrigem();
    if (!passos && !fino && !corte) {
      arquivo = arquivoBase;
    } else {
      arquivo = codificar(recortada(girada(), corte));
      ganharCor();
    }
  } catch (e) {
    return avisar(e.name === 'SecurityError'
      ? 'Não consigo editar esta imagem aqui — solte o arquivo de novo sobre ela.'
      : e.message);
  }
  mostrarImagem();
}

// Um quarto de volta leva o corte junto: o retângulo gira com a imagem.
function girar90(sentido) {
  passos = (passos + sentido + 4) % 4;
  if (corte) {
    const { x, y, w, h } = corte;
    corte = sentido > 0
      ? { x: 1 - y - h, y: x, w: h, h: w }
      : { x: y, y: 1 - x - w, w: h, h: w };
  }
  aplicarEdicao();
}

// O endireitar muda o tamanho da imagem girada; o corte antigo não vale mais.
function endireitar(graus, final) {
  $('#mp-fino-valor').textContent = `${graus > 0 ? '+' : ''}${String(graus).replace('.', ',')}°`;
  if (!final) {
    // Enquanto arrasta, só a prévia gira; a imagem é refeita ao soltar.
    $('#mp-previa').style.transform = `rotate(${graus - fino}deg)`;
    return;
  }
  fino = graus;
  corte = null;
  aplicarEdicao();
}

async function entrarNoCorte() {
  try {
    await garantirOrigem();
  } catch {
    return avisar('Não consigo editar esta imagem aqui — solte o arquivo de novo sobre ela.');
  }
  // Mostra a imagem girada inteira: o retângulo é desenhado sobre ela.
  const g = girada();
  $('#mp-previa').src = g.toDataURL('image/png');
  $('#mp-previa').style.transform = '';
  cortando = corte ? { ...corte } : { x: 0, y: 0, w: 1, h: 1 };
  $('#mp-solta').classList.add('cortando');
  $('#mp-corte').hidden = false;
  $('#mp-ferramentas').hidden = true;
  $('#mp-ferr-corte').hidden = false;
  desenharCorte();
}

function sairDoCorte() {
  if (!cortando) return;
  cortando = null;
  $('#mp-solta').classList.remove('cortando');
  $('#mp-corte').hidden = true;
  $('#mp-ferramentas').hidden = false;
  $('#mp-ferr-corte').hidden = true;
}

async function aplicarCorte() {
  const r = cortando;
  sairDoCorte();
  // Retângulo que pega a imagem inteira é o mesmo que não cortar.
  corte = r.w > 0.995 && r.h > 0.995 ? null : r;
  await aplicarEdicao();
}

function cancelarCorte() {
  sairDoCorte();
  mostrarImagem();
}

function desenharCorte() {
  const caixa = $('#mp-corte-caixa');
  caixa.style.left = cortando.x * 100 + '%';
  caixa.style.top = cortando.y * 100 + '%';
  caixa.style.width = cortando.w * 100 + '%';
  caixa.style.height = cortando.h * 100 + '%';
}

// Arrastar a caixa move; arrastar uma quina redimensiona; arrastar fora dela
// desenha um retângulo novo a partir do ponto clicado.
function ligarCorte() {
  const area = $('#mp-corte');
  const MIN = 0.04;
  area.addEventListener('pointerdown', (e) => {
    if (!cortando) return;
    e.preventDefault();
    e.stopPropagation();
    const ret = area.getBoundingClientRect();
    const ponto = (ev) => ({
      x: clamp((ev.clientX - ret.left) / ret.width, 0, 1),
      y: clamp((ev.clientY - ret.top) / ret.height, 0, 1),
    });
    const p0 = ponto(e);
    const base = { ...cortando };
    let canto = e.target.dataset?.canto;
    const mover = e.target.id === 'mp-corte-caixa';
    if (!canto && !mover) {
      // Retângulo novo: começa num ponto e a quina oposta segue o ponteiro.
      Object.assign(base, { x: p0.x, y: p0.y, w: 0, h: 0 });
      canto = 'se';
    }
    area.setPointerCapture(e.pointerId);

    const arrastar = (ev) => {
      const p = ponto(ev);
      if (mover) {
        cortando.x = clamp(base.x + p.x - p0.x, 0, 1 - base.w);
        cortando.y = clamp(base.y + p.y - p0.y, 0, 1 - base.h);
      } else {
        // A quina arrastada vai com o ponteiro; a oposta fica parada.
        const fixoX = canto.includes('w') ? base.x + base.w : base.x;
        const fixoY = canto.includes('n') ? base.y + base.h : base.y;
        const x0 = Math.min(fixoX, p.x), x1 = Math.max(fixoX, p.x);
        const y0 = Math.min(fixoY, p.y), y1 = Math.max(fixoY, p.y);
        cortando = { x: x0, y: y0, w: Math.max(MIN, x1 - x0), h: Math.max(MIN, y1 - y0) };
        cortando.x = Math.min(cortando.x, 1 - cortando.w);
        cortando.y = Math.min(cortando.y, 1 - cortando.h);
      }
      desenharCorte();
    };
    const soltar = () => {
      area.removeEventListener('pointermove', arrastar);
      area.removeEventListener('pointerup', soltar);
      area.removeEventListener('pointercancel', soltar);
    };
    area.addEventListener('pointermove', arrastar);
    area.addEventListener('pointerup', soltar);
    area.addEventListener('pointercancel', soltar);
  });
  // O clique no corte não pode abrir o seletor de arquivo da área de soltar.
  area.addEventListener('click', (e) => e.stopPropagation());

  $('#mp-girar-esq').addEventListener('click', () => girar90(-1));
  $('#mp-girar-dir').addEventListener('click', () => girar90(1));
  $('#mp-fino').addEventListener('input', (e) => endireitar(Number(e.target.value), false));
  $('#mp-fino').addEventListener('change', (e) => endireitar(Number(e.target.value), true));
  $('#mp-cortar').addEventListener('click', entrarNoCorte);
  $('#mp-corte-aplicar').addEventListener('click', aplicarCorte);
  $('#mp-corte-cancelar').addEventListener('click', cancelarCorte);
  $('#mp-restaurar').addEventListener('click', () => {
    zerarEdicao();
    arquivo = arquivoBase;
    mostrarImagem();
  });
}

// ================================ Ficha ===================================
function capturarFicha() {
  ficha = {
    ...ficha,
    cat: $('#mp-cat').value,
    marca: $('#mp-marca').value.trim(),
    cor: $('#mp-cor').value.trim(),
    nome: $('#mp-nome').value.trim(),
  };
}

// Marca e cor: campo livre, com o que já foi usado virando chip e autocomplete.
function montarChips(campo, lista, chips, sugestoes, comBolha) {
  lista.replaceChildren(...sugestoes.map(n => el('option', { value: n })));
  const escolhida = campo.value.trim().toLowerCase();
  const visiveis = sugestoes.slice(0, 8);
  const achada = sugestoes.find(n => n.toLowerCase() === escolhida);
  if (achada && !visiveis.includes(achada)) visiveis.splice(7, 1, achada);

  chips.replaceChildren(...visiveis.map(nome => {
    const hex = comBolha ? hexDaCor(nome) : null;
    return el('button', {
      class: 'mp-marca-chip' + (comBolha ? ' mp-cor-chip' : '') + (escolhida === nome.toLowerCase() ? ' ativa' : ''),
      onclick: () => {
        campo.value = campo.value.trim().toLowerCase() === nome.toLowerCase() ? '' : nome;
        capturarFicha();
        comBolha ? montarCores() : montarMarcas();
      },
    },
      comBolha ? el('span', {
        class: 'mp-cor-bolha' + (hex === 'estampa' ? ' estampa' : '') + (hex ? '' : ' livre'),
        style: hex && hex !== 'estampa' ? { '--cor': hex } : {},
      }) : null,
      nome);
  }));
}

function montarMarcas() {
  montarChips($('#mp-marca'), $('#mp-marcas-lista'), $('#mp-marcas'),
    db.marcasOrdenadas().map(m => m.nome), false);
}

function montarCores() {
  const usadas = db.coresOrdenadas().map(c => c.nome);
  const vistas = new Set(usadas.map(n => n.toLowerCase()));
  montarChips($('#mp-cor'), $('#mp-cores-lista'), $('#mp-cores'),
    [...usadas, ...CORES.map(c => c.nome).filter(n => !vistas.has(n.toLowerCase()))], true);
}

function montarCategorias() {
  const cat = $('#mp-cat');
  if (cat.options.length) return;
  for (const c of ORDEM_CATEGORIAS) {
    cat.append(el('option', { value: c }, rotuloDeCadastro(c)));
  }
}

function montarRaridades() {
  $('#mp-raridades').replaceChildren(...RARIDADES.map(r => el('button', {
    class: 'mp-rar' + (r.id === ficha.raridade ? ' ativa' : ''),
    style: r.aura && r.aura !== 'arco-iris' ? { '--rar': r.aura } : {},
    onclick: () => { ficha.raridade = r.id; montarRaridades(); },
  },
    el('span', { class: 'mp-rar-bolha' + (r.aura === 'arco-iris' ? ' arco' : '') }),
    r.nome)));
}

// ================================ Molde ===================================
// `medida` é o que se vê: a peça em cima do corpo, na proporção de agora. O
// que se grava é a mesma medida levada de volta ao molde (js/proporcao.js) —
// é nela que as outras telas confiam, e ela não muda se a proporção mudar.
const medidaPadrao = (cat) => {
  const p = ancoraPadrao(cat);
  return { x: p.x, y: p.y, w: p.w };
};
const noMolde = () => ancoraNoMolde(CATEGORIAS[ficha.cat].regiao, medida);

async function irParaMedida() {
  if (cortando) await aplicarCorte();
  capturarFicha();
  $('#mp-passo1').hidden = true;
  $('#mp-passo2').hidden = false;
  $('#mp-caixa').classList.add('medindo');
  $('#mp-avatar').innerHTML = svgAvatar();
  $('#mp-peca-img').src = arquivo.src;
  posicionarPeca();
}

function voltarParaFicha() {
  $('#mp-passo2').hidden = true;
  $('#mp-passo1').hidden = false;
  $('#mp-caixa').classList.remove('medindo');
}

function posicionarPeca() {
  const no = $('#mp-peca');
  const prop = arquivo.w / arquivo.h;
  no.style.left = (medida.x / CONFIG.STAGE_W * 100) + '%';
  no.style.top = (medida.y / CONFIG.STAGE_H * 100) + '%';
  no.style.width = (medida.w / CONFIG.STAGE_W * 100) + '%';
  no.style.height = (medida.w / prop / CONFIG.STAGE_H * 100) + '%';

  // A medida é a verdade sobre o tamanho da peça em todo o app: errar aqui
  // aparece depois, com a camisa maior que a calça na loja.
  const campo = $('#mp-medida');
  const real = noMolde();
  const razao = real.w / CATEGORIAS[ficha.cat].anchor.w;
  const fora = razao > 1.55 || razao < 0.6;
  campo.textContent = `largura ${Math.round(real.w)} un · ${Math.round(real.w / 224 * 100)}% dos ombros`
    + (fora ? ` — ${razao.toFixed(1).replace('.', ',')}× a largura padrão de ${CATEGORIAS[ficha.cat].nome}, confira` : '');
  campo.classList.toggle('alerta', fora);
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
        medida.w = clamp(base.w * (Math.hypot(ev.clientX - centro.x, ev.clientY - centro.y) / raio0), 20, 600);
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

  $('#mp-molde').addEventListener('wheel', (e) => {
    if ($('#mp-passo2').hidden) return;
    e.preventDefault();
    medida.w = clamp(medida.w * (e.deltaY < 0 ? 1.06 : 0.94), 20, 600);
    posicionarPeca();
  }, { passive: false });
}

// ================================ Salvar ==================================
async function salvar() {
  const botao = $('#mp-salvar');
  botao.disabled = true;
  $('#mp-medida').textContent = 'gravando alterações…';

  const real = noMolde();
  const corpo = {
    ...ficha,
    ancora: { x: Math.round(real.x), y: Math.round(real.y), w: Math.round(real.w) },
  };
  if (arquivo.novo) Object.assign(corpo, { src: arquivo.src, w: arquivo.w, h: arquivo.h });

  let salva;
  try {
    const resp = await fetch(`${CONFIG.API_PECAS}/${encodeURIComponent(peca.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
    const dados = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(dados.erro || `erro ${resp.status}`);
    salva = { ...dados.item };
  } catch (e) {
    botao.disabled = false;
    posicionarPeca();
    return toast(`Não consegui gravar a peça: ${e.message}`, 'aviso');
  }
  botao.disabled = false;

  // A imagem trocada mantém o nome do arquivo; sem o sufixo o navegador
  // continuaria mostrando a antiga do cache.
  if (arquivo.novo) salva.src += '?v=' + Date.now().toString(36);
  db.registrarMarca(salva.marca);
  db.registrarCor(salva.cor);
  registrarPeca(salva, { permanente: true });

  // Quem já tem a peça guarda categoria e raridade na própria cópia.
  const minha = db.pecaDoInventario(salva.id);
  if (minha) {
    minha.cat = salva.cat;
    minha.raridade = salva.raridade;
  }
  db.salvar();
  toast(`${nomeDaPeca(salva)} atualizada no acervo.`, salva.raridade);
  fechar();
  aoSalvar?.(salva);
}

// ================================ Apagar ==================================
// De vez: some do acervo, da vitrine e do guarda-roupa de quem já tinha (cada
// conta tira ao abrir o jogo, pela lista `removidas` do acervo.json).
async function apagar() {
  const alvo = peca;
  const nome = nomeDaPeca(alvo);
  const ok = confirm(`Apagar "${nome}" de vez?

`
    + 'Ela some do acervo, da vitrine e do guarda-roupa de quem já tem — '
    + 'inclusive dos looks e colagens. Não dá para desfazer.');
  if (!ok) return;

  const botao = $('#mp-apagar');
  botao.disabled = true;
  $('#mp-aviso').textContent = 'apagando…';
  try {
    const resp = await fetch(`${CONFIG.API_PECAS}/${encodeURIComponent(alvo.id)}`, { method: 'DELETE' });
    const dados = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(dados.erro || `erro ${resp.status}`);
  } catch (e) {
    botao.disabled = false;
    return avisar(`Não consegui apagar: ${e.message}`);
  }
  botao.disabled = false;

  esquecerPeca(alvo.id);
  db.esquecerPecas([alvo.id]);
  toast(`${nome} foi apagada do acervo.`);
  const callback = aoSalvar;
  fechar();
  callback?.(null);
}

// =============================== Montagem =================================
export function fechar() {
  $('#modal-peca').hidden = true;
  $('#mp-caixa').classList.remove('medindo');
  sairDoCorte();
  origem = null;
  document.body.classList.remove('com-modal');
  peca = null;
}

// Só peça do acervo do administrador pode ser editada: as subidas pelo
// navegador (legado) não moram no acervo.json e a API recusaria.
export function abrirEditar(alvo, callback) {
  if (!alvo) return;
  if (!alvo.permanente) {
    return toast('Essa peça foi guardada só neste navegador — só dá para editar as do acervo.', 'aviso');
  }
  peca = alvo;
  aoSalvar = callback;
  ficha = {
    cat: alvo.cat, marca: alvo.marca || '', cor: alvo.cor || '',
    nome: alvo.nome || '', raridade: alvo.raridade || 'common',
  };
  arquivo = arquivoBase = { src: alvo.src, w: alvo.w || 1, h: alvo.h || 1, novo: false };
  origem = null;
  sairDoCorte();
  zerarEdicao();
  medida = alvo.ancora
    ? ancoraNoCorpo(CATEGORIAS[alvo.cat]?.regiao, { ...alvo.ancora })
    : medidaPadrao(alvo.cat);

  montarCategorias();
  $('#mp-cat').value = ficha.cat;
  $('#mp-marca').value = ficha.marca;
  $('#mp-cor').value = ficha.cor;
  $('#mp-nome').value = ficha.nome;
  montarRaridades();
  montarMarcas();
  montarCores();
  mostrarImagem();

  $('#mp-titulo').textContent = `Editar · ${nomeDaPeca(alvo)}`;
  $('#mp-passo1').hidden = false;
  $('#mp-passo2').hidden = true;
  $('#mp-caixa').classList.remove('medindo');
  $('#modal-peca').hidden = false;
  document.body.classList.add('com-modal');
}

export function montarEditar() {
  ligarPalco();
  ligarCorte();

  const solta = $('#mp-solta');
  solta.addEventListener('click', () => { if (!cortando) $('#mp-arquivo').click(); });
  $('#mp-arquivo').addEventListener('change', (e) => {
    trocarImagem(e.target.files[0]);
    e.target.value = '';
  });
  for (const evt of ['dragenter', 'dragover']) {
    solta.addEventListener(evt, (e) => { e.preventDefault(); solta.classList.add('sobre'); });
  }
  for (const evt of ['dragleave', 'drop']) {
    solta.addEventListener(evt, (e) => { e.preventDefault(); solta.classList.remove('sobre'); });
  }
  solta.addEventListener('drop', (e) => trocarImagem(e.dataTransfer.files[0]));

  for (const sel of ['#mp-cat', '#mp-nome']) $(sel).addEventListener('input', capturarFicha);
  $('#mp-marca').addEventListener('input', () => { capturarFicha(); montarMarcas(); });
  $('#mp-cor').addEventListener('input', () => { capturarFicha(); montarCores(); });
  $('#mp-cat').addEventListener('change', () => { capturarFicha(); medida = medidaPadrao(ficha.cat); });

  $('#mp-continuar').addEventListener('click', irParaMedida);
  $('#mp-voltar').addEventListener('click', voltarParaFicha);
  $('#mp-padrao').addEventListener('click', () => { medida = medidaPadrao(ficha.cat); posicionarPeca(); });
  $('#mp-salvar').addEventListener('click', salvar);
  $('#mp-apagar').addEventListener('click', apagar);
  $('#mp-cancelar').addEventListener('click', fechar);
  $('#mp-fechar').addEventListener('click', fechar);
  $('#modal-peca').addEventListener('pointerdown', (e) => {
    if (e.target.id === 'modal-peca') fechar();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#modal-peca').hidden) fechar();
  });
}
