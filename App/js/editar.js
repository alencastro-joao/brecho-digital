// Editar peça do acervo.
//
// Peça nova não entra por aqui: entra pela esteira (esteira.html), que sobe a
// foto, recorta na nuvem e palpita a ficha. Este modal é o conserto de uma peça
// que já existe — ficha, medida no molde e, se for o caso, a imagem.
//
// Dois passos: a ficha (categoria, marca, cor, nome, raridade) e o molde do
// avatar, onde a peça ganha o tamanho real dela. O id não muda: é ele que amarra
// a peça ao inventário de quem já a tem, então editar aqui conserta a peça para
// todo mundo em vez de criar outra.
//
// Trocar a imagem: soltar um PNG de fundo transparente sobre a prévia. Ele é
// aparado pelo alpha, reduzido e convertido para WebP aqui no navegador, e sobe
// junto com a ficha. Foto com fundo vai pela esteira.
//
// Ferramenta de administração: só aparece em modo admin, e quem grava é a API
// (PUT /api/pecas/<id>), que recusa quem não for administrador.

import { CONFIG, CATEGORIAS, CORES, ORDEM_CATEGORIAS, RARIDADES, hexDaCor,
         corDoPixel, distanciaEntreCores } from './config.js';
import { registrarPeca, nomeDaPeca } from './catalog.js';
import * as db from './db.js';
import { svgAvatar } from './avatar.js';
import { el, $, clamp, toast } from './util.js';

const MAX_LADO = 460;          // maior lado da imagem guardada (= esteira)
const QUALIDADE = 0.75;

let peca = null;               // a peça do acervo em edição
let ficha = null;              // { cat, marca, cor, nome, raridade }
let arquivo = null;            // { src, w, h, novo } — novo = imagem trocada, sobe junto
let medida = null;             // { x, y, w } em unidades do palco (600×1200)
let aoSalvar = null;

// ============================ Trocar imagem ===============================
// Apara pelo alpha numa cópia de até 1000 px, reduz e vira WebP.
async function prepararImagem(file) {
  const bitmap = await createImageBitmap(file);
  const escala = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
  const tw = Math.max(1, Math.round(bitmap.width * escala));
  const th = Math.max(1, Math.round(bitmap.height * escala));
  const trab = document.createElement('canvas');
  trab.width = tw; trab.height = th;
  const ctx = trab.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, tw, th);
  bitmap.close?.();

  const dados = ctx.getImageData(0, 0, tw, th).data;
  let x0 = tw, y0 = th, x1 = -1, y1 = -1, opacos = 0;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      if (dados[(y * tw + x) * 4 + 3] < 10) continue;
      opacos++;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) throw new Error('A imagem está inteira transparente.');
  if (opacos >= tw * th * 0.985) {
    throw new Error('Essa imagem tem fundo. Para foto com fundo, use a esteira — ela recorta sozinha.');
  }

  const largura = x1 - x0 + 1, altura = y1 - y0 + 1;
  const k = Math.min(1, MAX_LADO / Math.max(largura, altura));
  const saida = document.createElement('canvas');
  saida.width = Math.max(1, Math.round(largura * k));
  saida.height = Math.max(1, Math.round(altura * k));
  const pincel = saida.getContext('2d', { willReadFrequently: true });
  pincel.drawImage(trab, x0, y0, largura, altura, 0, 0, saida.width, saida.height);

  let src;
  try { src = saida.toDataURL('image/webp', QUALIDADE); }
  catch { src = saida.toDataURL('image/png'); }
  return { src, w: saida.width, h: saida.height, novo: true, cor: corDaImagem(pincel, saida.width, saida.height) };
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
  try {
    arquivo = await prepararImagem(file);
  } catch (e) {
    $('#mp-aviso').textContent = e.message;
    $('#mp-aviso').classList.add('alerta');
    return;
  }
  // Peça antiga sem cor ganha o palpite da imagem nova; cor escrita fica.
  if (!ficha.cor && arquivo.cor) $('#mp-cor').value = ficha.cor = arquivo.cor;
  mostrarImagem();
  montarCores();
}

function mostrarImagem() {
  $('#mp-previa').src = arquivo.src;
  const aviso = $('#mp-aviso');
  aviso.classList.remove('alerta');
  aviso.textContent = arquivo.novo
    ? `imagem nova · ${arquivo.w}×${arquivo.h} · ${Math.round(arquivo.src.length / 1024)} KB`
    : '';
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
    cat.append(el('option', { value: c }, `${CATEGORIAS[c].icone}  ${CATEGORIAS[c].nome}`));
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
const medidaPadrao = (cat) => {
  const p = CATEGORIAS[cat].anchor;
  return { x: p.x, y: p.y, w: p.w };
};

function irParaMedida() {
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
  const razao = medida.w / CATEGORIAS[ficha.cat].anchor.w;
  const fora = razao > 1.55 || razao < 0.6;
  campo.textContent = `largura ${Math.round(medida.w)} un · ${Math.round(medida.w / 224 * 100)}% dos ombros`
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

  const corpo = {
    ...ficha,
    ancora: { x: Math.round(medida.x), y: Math.round(medida.y), w: Math.round(medida.w) },
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

// =============================== Montagem =================================
export function fechar() {
  $('#modal-peca').hidden = true;
  $('#mp-caixa').classList.remove('medindo');
  document.body.classList.remove('com-modal');
  peca = null;
}

// Só peça do acervo do administrador pode ser editada: as do pipeline não
// moram no acervo.json e a API recusaria.
export function abrirEditar(alvo, callback) {
  if (!alvo) return;
  if (!alvo.permanente) {
    return toast('Essa peça veio do catálogo gerado pelo pipeline — só dá para editar as do acervo.', 'aviso');
  }
  peca = alvo;
  aoSalvar = callback;
  ficha = {
    cat: alvo.cat, marca: alvo.marca || '', cor: alvo.cor || '',
    nome: alvo.nome || '', raridade: alvo.raridade || 'common',
  };
  arquivo = { src: alvo.src, w: alvo.w || 1, h: alvo.h || 1, novo: false };
  medida = alvo.ancora ? { ...alvo.ancora } : medidaPadrao(alvo.cat);

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

  const solta = $('#mp-solta');
  solta.addEventListener('click', () => $('#mp-arquivo').click());
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
  $('#mp-cancelar').addEventListener('click', fechar);
  $('#mp-fechar').addEventListener('click', fechar);
  $('#modal-peca').addEventListener('pointerdown', (e) => {
    if (e.target.id === 'modal-peca') fechar();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#modal-peca').hidden) fechar();
  });
}
