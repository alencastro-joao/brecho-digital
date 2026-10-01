// Esteira de peças — a página do administrador para colocar roupa no jogo.
//
// O caminho de uma foto:
//
//   1. Aqui: a API reserva um id e assina um POST para o S3, e a foto sobe
//      direto para o bucket (nada passa pela Lambda da API, então tamanho e
//      quantidade não importam).
//   2. Na nuvem: a fila chama o trabalhador (nuvem/esteira/trabalhador.py),
//      que tira o fundo, faz a prévia e o contorno, e pede ao Claude o palpite
//      da ficha.
//   3. Aqui de novo: o cartão aparece com a prévia e a ficha já preenchida. O
//      admin confere, mede no molde se quiser, e publica — sozinha ou em lote.
//
// Nada fica só neste navegador: a ficha mexida é guardada na esteira (PUT), e
// por isso dá para fotografar no celular e revisar no computador.
//
// Página separada do jogo de propósito. Ela não precisa do save, do catálogo
// nem das telas — só da conta (para saber que é admin) e do molde do avatar.

import { CONFIG, CATEGORIAS, ORDEM_CATEGORIAS, CORES, RARIDADES, RARIDADE, hexDaCor } from './config.js';
import { carregarSessao } from './auth.js';
import { svgAvatar } from './avatar.js';
import { el, $, $$, clamp, toast } from './util.js';

const API = 'api/esteira';
const VIGIA_MS = 3000;                 // enquanto houver foto processando
const GUARDA_MS = 700;                 // espera de digitação antes de guardar a ficha

let itens = [];                        // o que a API devolveu, mais o estado da tela
const selecionadas = new Set();
const guardando = new Map();           // id -> timer de guardar ficha
let vigia = null;

// ================================ API =====================================
async function api(rota, { metodo = 'GET', corpo } = {}) {
  const r = await fetch(API + rota, {
    method: metodo,
    credentials: 'include',
    headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.erro || `erro ${r.status}`);
  return dados;
}

// ================================ Envio ===================================
// Uma foto de cada vez por conexão seria lento demais num lote de trinta; todas
// juntas engasgam o 4G. Três em paralelo é o meio-termo.
const PARALELO = 3;

async function enviar(arquivos, origem) {
  const fotos = [...arquivos].filter(f => /^image\/(jpeg|png|webp)$/.test(f.type));
  if (fotos.length < arquivos.length) {
    toast('Só JPG, PNG ou WebP. No iPhone, a câmera daqui já manda JPG.', 'aviso');
  }
  if (!fotos.length) return;

  let reserva;
  try {
    reserva = await api('', {
      metodo: 'POST',
      corpo: { origem, arquivos: fotos.map(f => ({ nome: f.name, tipo: f.type, bytes: f.size })) },
    });
  } catch (e) {
    return toast(`Não consegui começar o envio: ${e.message}`, 'aviso');
  }

  const fila = reserva.envios.map((envio, i) => ({ envio, foto: fotos[i], linha: linhaDeEnvio(fotos[i]) }));
  await atualizar();                    // os cartões "enviando" já aparecem

  const trabalhar = async () => {
    for (let t = fila.shift(); t; t = fila.shift()) {
      try {
        await subir(t.envio, t.foto, (p) => t.linha.progresso(p));
        t.linha.pronto();
      } catch (e) {
        t.linha.falhou(e.message);
      }
    }
  };
  await Promise.all(Array.from({ length: PARALELO }, trabalhar));
  await atualizar();
}

// POST de formulário para o S3, com os campos que a API assinou. XHR e não
// fetch: é o único jeito de ter o progresso do upload.
function subir(envio, foto, aoAndar) {
  return new Promise((pronto, falhou) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(envio.campos)) form.append(k, v);
    form.append('file', foto);          // o arquivo tem de ser o último campo
    const xhr = new XMLHttpRequest();
    xhr.open('POST', envio.url);
    xhr.upload.onprogress = (e) => e.lengthComputable && aoAndar(e.loaded / e.total);
    xhr.onload = () => (xhr.status < 300 ? pronto() : falhou(new Error(`S3 respondeu ${xhr.status}`)));
    xhr.onerror = () => falhou(new Error('a conexão caiu'));
    xhr.send(form);
  });
}

function linhaDeEnvio(foto) {
  const barra = el('span', { class: 'es-envio-barra' });
  const linha = el('li', { class: 'es-envio' },
    el('span', { class: 'es-envio-nome' }, foto.name),
    el('span', { class: 'es-envio-trilho' }, barra));
  $('#es-envios').append(linha);
  return {
    progresso: (p) => { barra.style.width = `${Math.round(p * 100)}%`; },
    pronto: () => { linha.classList.add('ok'); setTimeout(() => linha.remove(), 2500); },
    falhou: (msg) => { linha.classList.add('erro'); linha.title = msg; },
  };
}

// ============================== Lista =====================================
async function atualizar() {
  let dados;
  try {
    dados = await api('');
  } catch (e) {
    return toast(`Não consegui ler a esteira: ${e.message}`, 'aviso');
  }
  const antes = new Map(itens.map(i => [i.id, i]));
  itens = dados.itens.map(novo => {
    const velho = antes.get(novo.id);
    // Ficha que está sendo digitada não é atropelada pela que veio do servidor.
    if (velho && guardando.has(novo.id)) return { ...novo, ficha: velho.ficha, medida: velho.medida };
    return novo;
  });
  for (const id of [...selecionadas]) if (!itens.some(i => i.id === id && i.estado === 'pronta')) selecionadas.delete(id);
  desenhar();

  const andando = itens.some(i => i.estado === 'enviando' || i.estado === 'processando');
  clearTimeout(vigia);
  if (andando) vigia = setTimeout(atualizar, VIGIA_MS);
}

const fichaDe = (item) => ({
  cat: '', cor: '', nome: '', marca: '', raridade: 'common',
  ...(item.ficha || {}),
});

function desenhar() {
  const grade = $('#es-grade');
  const foco = document.activeElement?.closest?.('.es-cartao')?.dataset.id;
  const campoFoco = document.activeElement?.dataset?.campo;

  grade.replaceChildren(...itens.map(cartao));
  $('#es-vazio').hidden = itens.length > 0;
  atualizarLote();

  // Redesenhar não pode tirar o cursor do campo que a pessoa está usando.
  if (foco && campoFoco) $(`.es-cartao[data-id="${foco}"] [data-campo="${campoFoco}"]`)?.focus();
}

const ROTULO = {
  enviando: 'enviando…', processando: 'processando…', pronta: 'pronta', erro: 'erro',
};

function cartao(item) {
  const f = fichaDe(item);
  const pronta = item.estado === 'pronta';
  const ia = item.sugestao || {};

  const campo = (nome, no) => {
    no.dataset.campo = nome;
    no.disabled = !pronta;
    no.addEventListener('input', () => mudarFicha(item, nome, no.value));
    return no;
  };

  const cat = campo('cat', el('select', { 'aria-label': 'Categoria' },
    el('option', { value: '' }, 'Categoria…'),
    ...ORDEM_CATEGORIAS.map(c => el('option', { value: c }, `${CATEGORIAS[c].icone} ${CATEGORIAS[c].nome}`))));
  cat.value = f.cat;

  const rar = campo('raridade', el('select', { 'aria-label': 'Raridade' },
    ...RARIDADES.map(r => el('option', { value: r.id }, r.nome))));
  rar.value = f.raridade;

  const cor = campo('cor', el('input', { value: f.cor, placeholder: 'Cor', list: 'es-cores', 'aria-label': 'Cor' }));
  const hex = hexDaCor(f.cor);

  const marcaIa = ia.marca && ia.marca === f.marca;
  const conf = typeof ia.confianca === 'number' ? Math.round(ia.confianca * 100) : null;

  const no = el('article', {
    class: `es-cartao ${item.estado}` + (selecionadas.has(item.id) ? ' sel' : ''),
    dataset: { id: item.id },
    tabindex: '-1',
  },
    el('div', { class: 'es-cartao-imagem' },
      item.previa
        ? el('img', { src: item.previa, alt: f.nome || item.arquivo || '', loading: 'lazy' })
        : el('span', { class: 'es-cartao-espera' }, ROTULO[item.estado] || item.estado),
      pronta ? el('label', { class: 'es-cartao-marca', title: 'selecionar' },
        el('input', {
          type: 'checkbox', checked: selecionadas.has(item.id),
          onchange: (e) => { e.target.checked ? selecionadas.add(item.id) : selecionadas.delete(item.id); desenhar(); },
        })) : null,
      el('span', { class: `es-selo ${item.estado}` }, ROTULO[item.estado] || item.estado),
      item.medida ? el('span', { class: 'es-medido', title: 'já tem medida no molde' }, 'medida ✓') : null),

    item.estado === 'erro'
      ? el('p', { class: 'es-erro' }, item.erro || 'falhou')
      : null,

    el('div', { class: 'es-campos' },
      campo('nome', el('input', { value: f.nome, placeholder: 'Nome da peça', 'aria-label': 'Nome' })),
      el('div', { class: 'es-dupla' }, cat, rar),
      el('div', { class: 'es-dupla' },
        el('span', { class: 'es-cor' },
          el('span', {
            class: 'es-bolha' + (hex === 'estampa' ? ' estampa' : '') + (hex ? '' : ' livre'),
            style: hex && hex !== 'estampa' ? { '--cor': hex } : {},
          }),
          cor),
        campo('marca', el('input', { value: f.marca, placeholder: 'Marca', list: 'es-marcas', 'aria-label': 'Marca' }))),
    ),

    pronta && (ia.cat || ia.nome)
      ? el('p', { class: 'es-ia', title: ia.modelo || '' },
          `✦ palpite da IA${conf != null ? ` · ${conf}% de certeza na categoria` : ''}`
          + (marcaIa ? ' · marca lida na peça' : ''))
      : null,

    el('footer', { class: 'es-acoes' },
      el('button', { class: 'es-btn mini', onclick: () => descartar(item) }, 'Descartar'),
      item.estado === 'erro'
        ? el('button', { class: 'es-btn mini', onclick: () => refazer(item) }, 'Tentar de novo')
        : el('button', { class: 'es-btn mini', disabled: !pronta, onclick: () => abrirMolde(item) }, 'Medir'),
      el('button', { class: 'es-btn mini escuro', disabled: !pronta || !f.cat, onclick: () => publicar([item]) },
        'Publicar')),
  );

  no.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === 'Enter' && pronta) { e.preventDefault(); publicar([item]); }
    if ((e.key === 'm' || e.key === 'M') && pronta) { e.preventDefault(); abrirMolde(item); }
    if (e.key === 'Delete') { e.preventDefault(); descartar(item); }
  });
  return no;
}

// ============================== Ficha =====================================
function mudarFicha(item, campo, valor) {
  item.ficha = { ...fichaDe(item), [campo]: valor };
  if (campo === 'cat' || campo === 'cor') {
    // Bolinha de cor e botão de publicar dependem disso: redesenha só o cartão.
    const velho = $(`.es-cartao[data-id="${item.id}"]`);
    const ativo = document.activeElement?.dataset?.campo;
    const novo = cartao(item);
    velho?.replaceWith(novo);
    if (ativo) $(`[data-campo="${ativo}"]`, novo)?.focus();
  }
  guardarDepois(item);
}

function guardarDepois(item) {
  clearTimeout(guardando.get(item.id));
  guardando.set(item.id, setTimeout(async () => {
    try {
      await api(`/${item.id}`, { metodo: 'PUT', corpo: { ficha: item.ficha, medida: item.medida } });
    } catch (e) {
      toast(`Não consegui guardar a ficha: ${e.message}`, 'aviso');
    } finally {
      guardando.delete(item.id);
    }
  }, GUARDA_MS));
}

// ============================== Ações =====================================
async function publicar(lista) {
  // Peça sem categoria fica para trás, mas não segura o lote inteiro.
  const semCat = lista.filter(i => i.estado === 'pronta' && !fichaDe(i).cat);
  const prontas = lista.filter(i => i.estado === 'pronta' && fichaDe(i).cat);
  if (semCat.length) {
    toast(`${semCat.length === 1 ? 'Uma peça ficou' : `${semCat.length} peças ficaram`} de fora: falta a categoria.`, 'aviso');
  }
  let feitas = 0;
  for (const item of prontas) {
    clearTimeout(guardando.get(item.id));
    guardando.delete(item.id);
    try {
      const { item: peca } = await api(`/${item.id}/publicar`, {
        metodo: 'POST', corpo: { ficha: fichaDe(item), medida: item.medida || null },
      });
      feitas++;
      itens = itens.filter(i => i !== item);
      selecionadas.delete(item.id);
      if (prontas.length === 1) {
        toast(`${peca.nome || 'Peça'} entrou no jogo — ${RARIDADE[peca.raridade]?.nome ?? ''}.`, peca.raridade);
      }
    } catch (e) {
      toast(`Parou em "${fichaDe(item).nome || item.arquivo}": ${e.message}`, 'aviso');
      break;
    }
    desenhar();
  }
  if (prontas.length > 1 && feitas) toast(`${feitas} peças entraram no jogo.`, 'legendary');
  desenhar();
}

async function descartar(item) {
  if (item.estado === 'pronta' && !confirm(`Descartar "${fichaDe(item).nome || item.arquivo}"?`)) return;
  try {
    await api(`/${item.id}`, { metodo: 'DELETE' });
  } catch (e) {
    return toast(`Não consegui descartar: ${e.message}`, 'aviso');
  }
  itens = itens.filter(i => i !== item);
  selecionadas.delete(item.id);
  desenhar();
}

async function refazer(item) {
  try {
    await api(`/${item.id}/refazer`, { metodo: 'POST' });
  } catch (e) {
    return toast(`Não deu para refazer: ${e.message}`, 'aviso');
  }
  atualizar();
}

// ============================== Lote ======================================
function atualizarLote() {
  const prontas = itens.filter(i => i.estado === 'pronta');
  $('#es-lote').hidden = prontas.length < 2;
  const n = selecionadas.size;
  $('#es-sel-conta').textContent = n ? `${n} selecionada${n > 1 ? 's' : ''}` : 'selecionar todas as prontas';
  $('#es-todas').checked = n > 0 && n === prontas.length;
  $('#es-lote-aplicar').disabled = !n;
  $('#es-lote-publicar').disabled = !n;
  $('#es-lote-publicar').textContent = n ? `Publicar ${n}` : 'Publicar selecionadas';
}

function aplicarLote() {
  const cat = $('#es-lote-cat').value;
  const raridade = $('#es-lote-rar').value;
  const marca = $('#es-lote-marca').value.trim();
  for (const item of itens.filter(i => selecionadas.has(i.id))) {
    const f = fichaDe(item);
    // Medida é de categoria: trocar a categoria invalida o que foi medido.
    if (cat && cat !== f.cat) item.medida = null;
    item.ficha = { ...f, ...(cat && { cat }), ...(raridade && { raridade }), ...(marca && { marca }) };
    guardarDepois(item);
  }
  desenhar();
  toast('Aplicado às selecionadas.');
}

// ============================== Molde =====================================
let medindo = null;                    // o item no molde
let medida = null;                     // { x, y, w } em unidades do palco (600×1200)

const medidaPadrao = (cat) => {
  const a = CATEGORIAS[cat]?.anchor ?? { x: 300, y: 600, w: 200 };
  return { x: a.x, y: a.y, w: a.w };
};

function abrirMolde(item) {
  const f = fichaDe(item);
  if (!f.cat) return toast('Escolha a categoria antes de medir.', 'aviso');
  medindo = item;
  medida = item.medida ? { ...item.medida } : medidaPadrao(f.cat);
  $('#es-avatar').innerHTML = svgAvatar();
  $('#es-peca-img').src = item.previa;
  $('#es-molde-modal').hidden = false;
  posicionar();
}

function fecharMolde(guardar) {
  if (guardar && medindo) {
    medindo.medida = { x: Math.round(medida.x), y: Math.round(medida.y), w: Math.round(medida.w) };
    guardarDepois(medindo);
    desenhar();
  }
  medindo = null;
  $('#es-molde-modal').hidden = true;
}

function posicionar() {
  const no = $('#es-peca');
  const prop = (medindo.w || 1) / (medindo.h || 1);
  no.style.left = `${medida.x / CONFIG.STAGE_W * 100}%`;
  no.style.top = `${medida.y / CONFIG.STAGE_H * 100}%`;
  no.style.width = `${medida.w / CONFIG.STAGE_W * 100}%`;
  no.style.height = `${(medida.w / prop) / CONFIG.STAGE_H * 100}%`;

  const cat = fichaDe(medindo).cat;
  const razao = medida.w / CATEGORIAS[cat].anchor.w;
  const fora = razao > 1.55 || razao < 0.6;
  const texto = $('#es-medida');
  texto.textContent = `largura ${Math.round(medida.w)} un · ${Math.round(medida.w / 224 * 100)}% dos ombros`
    + (fora ? ` — ${razao.toFixed(1).replace('.', ',')}× o padrão de ${CATEGORIAS[cat].nome}, confira` : '');
  texto.classList.toggle('alerta', fora);
}

function usarNasIrmas() {
  const cat = fichaDe(medindo).cat;
  const irmas = itens.filter(i => i !== medindo && i.estado === 'pronta' && fichaDe(i).cat === cat);
  for (const i of irmas) { i.medida = { ...medida }; guardarDepois(i); }
  toast(`Medida aplicada a ${irmas.length} ${irmas.length === 1 ? 'peça' : 'peças'} de ${CATEGORIAS[cat].nome}.`);
}

function ligarMolde() {
  const no = $('#es-peca');
  no.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const palco = $('#es-molde').getBoundingClientRect();
    const alca = e.target.dataset?.alca;
    const base = { ...medida };
    const inicio = { x: e.clientX, y: e.clientY };
    const centro = {
      x: palco.left + (medida.x / CONFIG.STAGE_W) * palco.width,
      y: palco.top + (medida.y / CONFIG.STAGE_H) * palco.height,
    };
    const raio0 = Math.hypot(e.clientX - centro.x, e.clientY - centro.y) || 1;
    no.setPointerCapture(e.pointerId);

    const mover = (ev) => {
      if (alca) {
        medida.w = clamp(base.w * (Math.hypot(ev.clientX - centro.x, ev.clientY - centro.y) / raio0), 20, 600);
      } else {
        medida.x = clamp(base.x + (ev.clientX - inicio.x) / palco.width * CONFIG.STAGE_W, 0, CONFIG.STAGE_W);
        medida.y = clamp(base.y + (ev.clientY - inicio.y) / palco.height * CONFIG.STAGE_H, 0, CONFIG.STAGE_H);
      }
      posicionar();
    };
    const soltar = () => {
      no.removeEventListener('pointermove', mover);
      no.removeEventListener('pointerup', soltar);
      no.removeEventListener('pointercancel', soltar);
    };
    no.addEventListener('pointermove', mover);
    no.addEventListener('pointerup', soltar);
    no.addEventListener('pointercancel', soltar);
  });

  $('#es-molde').addEventListener('wheel', (e) => {
    e.preventDefault();
    medida.w = clamp(medida.w * (e.deltaY < 0 ? 1.06 : 0.94), 20, 600);
    posicionar();
  }, { passive: false });

  $('#es-molde-ok').addEventListener('click', () => fecharMolde(true));
  $('#es-molde-padrao').addEventListener('click', () => { medida = medidaPadrao(fichaDe(medindo).cat); posicionar(); });
  $('#es-molde-irmas').addEventListener('click', usarNasIrmas);
  $('#es-molde-modal').addEventListener('pointerdown', (e) => {
    if (e.target.id === 'es-molde-modal') fecharMolde(true);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && medindo) fecharMolde(false);
  });
}

// ============================== Montagem ==================================
function ligarEntrada() {
  const solta = $('#es-solta');
  for (const evt of ['dragenter', 'dragover']) {
    solta.addEventListener(evt, (e) => { e.preventDefault(); solta.classList.add('sobre'); });
  }
  for (const evt of ['dragleave', 'drop']) {
    solta.addEventListener(evt, (e) => { e.preventDefault(); solta.classList.remove('sobre'); });
  }
  solta.addEventListener('drop', (e) => enviar(e.dataTransfer.files, 'tela'));
  // Colar print/imagem da área de transferência também entra na esteira.
  document.addEventListener('paste', (e) => {
    const fotos = [...(e.clipboardData?.files || [])];
    if (fotos.length) enviar(fotos, 'colado');
  });
  $('#es-arquivos').addEventListener('change', (e) => { enviar(e.target.files, 'tela'); e.target.value = ''; });
  $('#es-camera').addEventListener('change', (e) => { enviar(e.target.files, 'celular'); e.target.value = ''; });
}

function ligarLote() {
  for (const c of ORDEM_CATEGORIAS) $('#es-lote-cat').append(el('option', { value: c }, CATEGORIAS[c].nome));
  for (const r of RARIDADES) $('#es-lote-rar').append(el('option', { value: r.id }, r.nome));
  for (const c of CORES) $('#es-cores').append(el('option', { value: c.nome }));

  $('#es-todas').addEventListener('change', (e) => {
    selecionadas.clear();
    if (e.target.checked) itens.filter(i => i.estado === 'pronta').forEach(i => selecionadas.add(i.id));
    desenhar();
  });
  $('#es-lote-aplicar').addEventListener('click', aplicarLote);
  $('#es-lote-publicar').addEventListener('click', () => publicar(itens.filter(i => selecionadas.has(i.id))));
}

// As marcas do acervo viram autocomplete: escrever "Nike" sempre do mesmo jeito.
async function carregarMarcas() {
  try {
    const r = await fetch(CONFIG.ACERVO, { cache: 'no-cache' });
    const { items = [] } = await r.json();
    const marcas = [...new Set(items.map(i => (i.marca || '').trim()).filter(Boolean))].sort();
    $('#es-marcas').replaceChildren(...marcas.map(m => el('option', { value: m })));
  } catch { /* sem autocomplete, segue */ }
}

async function iniciar() {
  let conta = null;
  try { conta = await carregarSessao(); } catch { /* cai no aviso abaixo */ }
  const aviso = $('#es-sem-acesso');
  if (!conta) {
    aviso.hidden = false;
    aviso.replaceChildren(el('p', {}, 'Entre na sua conta de administrador primeiro.'),
      el('a', { class: 'es-btn escuro', href: './' }, 'Ir para o login'));
    return;
  }
  $('#es-conta').textContent = conta.nome || conta.email || '';
  if (conta.papel !== 'admin') {
    aviso.hidden = false;
    aviso.replaceChildren(el('p', {}, 'Esta página é só do administrador.'));
    return;
  }
  $('#es-main').hidden = false;
  ligarEntrada();
  ligarLote();
  ligarMolde();
  carregarMarcas();
  await atualizar();
  // Voltou para a aba (ex.: depois de fotografar no celular): confere a esteira.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) atualizar(); });
}

iniciar();
