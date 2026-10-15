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
//      admin confere, marca os cartões e publica pela barra de cima — peça
//      sem medida passa pelo molde antes de entrar no jogo.
//
// Nada fica só neste navegador: a ficha mexida é guardada na esteira (PUT), e
// por isso dá para fotografar no celular e revisar no computador.
//
// Página separada do jogo de propósito. Ela não precisa do save, do catálogo
// nem das telas — só da conta (para saber que é admin) e do molde do avatar.

import {
  CONFIG, CATEGORIAS, ORDEM_CATEGORIAS, CORES, RARIDADES, RARIDADE, hexDaCor,
  migrarCategoria, rotuloDeCadastro,
  ESTILOS,
} from './config.js';
import { ancoraNoCorpo, ancoraNoMolde } from './proporcao.js';
import { carregarSessao } from './auth.js';
import { svgAvatar } from './avatar.js';
import { el, $, $$, clamp, toast } from './util.js';
import { alcaMover } from './alcamover.js';

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
  await atualizar();                    // entram na contagem de "sendo cortadas"

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

// ============================== Pinterest =================================
// Pastas do Pinterest vinculadas: a API guarda quais são e, toda vez que a
// esteira abre, traz o pin que nunca passou por ela (nuvem/lambda/esteira.py).
// Publicar ou descartar não faz o pin voltar, então tudo pode ficar na pasta.
// Quem baixa as fotos é a API: o navegador não lê o Pinterest (CORS).
//
// Peça que já está no jogo não precisa ser desmarcada: o trabalhador reconhece
// a imagem e ela sai da esteira sozinha (ver `atualizar`).
let pastasPinterest = [];              // as vinculadas, como a API guarda
const estadoDaPasta = new Map();       // id -> o que aconteceu na última leitura
let relendo = false;
let ultimaLeitura = 0;
const RELER_MS = 60 * 1000;            // voltar para a aba relê, no máximo uma vez por minuto

const nFotos = (n) => `${n} ${n === 1 ? 'foto' : 'fotos'}`;

function resumo(r) {
  if (r.erro) return r.erro;
  if (r.adiada) return 'na fila…';
  const partes = [];
  if (r.entraram) partes.push(`${r.entraram} ${r.entraram === 1 ? 'novo entrou' : 'novos entraram'}`);
  if (r.falharam) partes.push(`${r.falharam} não ${r.falharam === 1 ? 'baixou' : 'baixaram'}`);
  if (r.faltam) partes.push(`${r.faltam} ainda chegando`);
  if (r.continua && !r.recusada) {
    partes.push(r.quantos && r.varridos
      ? `conferidos ${Math.min(r.varridos, r.quantos)} de ${r.quantos}…` : 'lendo o resto da pasta…');
  }
  // Sem login, o Pinterest às vezes não deixa rolar a pasta: aquela leitura
  // viu só os 25 mais recentes, e a seguinte tenta de novo de onde parou.
  if (r.recusada) partes.push(`${r.falha || 'o Pinterest não deixou rolar a pasta'}; tento de novo`);
  else if (r.tentativas > 1) partes.push(`liberou na ${r.tentativas}ª visita`);
  const lidos = r.quantos ? `${r.quantos} pins na pasta · ` : '';
  return lidos + (partes.join(', ') || (r.inteira ? 'tudo aqui' : 'nada novo'));
}

function desenharPastas() {
  const lista = $('#es-pinterest-pastas');
  lista.replaceChildren(...pastasPinterest.map(p => el('li', { class: 'es-pin-pasta' },
    el('a', { href: `https://www.pinterest.com/${p.usuario}/${p.pasta}/`, target: '_blank', rel: 'noopener' },
      '📌 ', p.titulo),
    p.cat ? el('span', { class: 'es-pin-cat' }, rotuloDeCadastro(p.cat)) : null,
    el('span', { class: 'es-pin-estado' }, estadoDaPasta.get(p.id) || ''),
    el('button', {
      class: 'es-pin-tirar', type: 'button', title: 'Desvincular', 'aria-label': `Desvincular ${p.titulo}`,
      onclick: () => desvincularPasta(p),
    }, '×'))));
  lista.hidden = !pastasPinterest.length;
  $('#es-pinterest-procurar').hidden = !pastasPinterest.length;
}

async function montarPinterest() {
  try {
    ({ pastas: pastasPinterest } = await api('/pinterest'));
  } catch (e) {
    return toast(`Não consegui ler as pastas do Pinterest: ${e.message}`, 'aviso');
  }
  desenharPastas();
  await reler();
}

// Cada chamada importa o que cabe no tempo da API (uns 20 s). O que sobra
// volta como `faltam` (pasta grande) ou `adiada` (não deu tempo de ler), e
// aqui se chama de novo até acabar — antes ficava para a próxima abertura da
// esteira, e pasta grande parecia nunca chegar inteira. `feitas` são as
// pastas que já terminaram nesta rodada, para a API não reler.
const MAX_RODADAS = 400;              // pasta de milhares de pins vai de 40 em 40

async function reler({ varrer = false } = {}) {
  if (relendo || !pastasPinterest.length) return false;
  relendo = true;
  const botao = $('#es-pinterest-procurar');
  botao.disabled = true;
  botao.textContent = varrer ? 'Procurando…' : 'Lendo…';
  ultimaLeitura = Date.now();
  for (const p of pastasPinterest) estadoDaPasta.set(p.id, 'lendo…');
  desenharPastas();
  const feitas = [];
  const soma = new Map();               // id -> { entraram, falharam } desta rodada
  const recusas = new Map();            // id -> vezes seguidas que o Pinterest não deixou rolar
  let total = 0;
  try {
    for (let rodada = 0; rodada < MAX_RODADAS; rodada++) {
      const corpo = { reler: true, feitas, ...(varrer && !rodada ? { varrer: true } : {}) };
      const { pastas, ocupado } = await api('/pinterest', { metodo: 'POST', corpo });
      // Outra tela (o celular, outra aba) está lendo agora: espera a vez dela
      // passar em vez de ler junto e trazer cada pin duas vezes.
      if (ocupado) {
        for (const p of pastasPinterest) if (!feitas.includes(p.id)) estadoDaPasta.set(p.id, 'lendo em outra tela…');
        desenharPastas();
        await new Promise(ok => setTimeout(ok, 8000));
        rodada -= varrer && !rodada ? 1 : 0;   // o pedido de varrer ainda não foi atendido
        continue;
      }
      let continuar = false;
      let andou = 0;
      for (const r of pastas) {
        const s = soma.get(r.id) || { entraram: 0, falharam: 0 };
        s.entraram += r.entraram || 0;
        s.falharam += r.falharam || 0;
        soma.set(r.id, s);
        andou += (r.entraram || 0) + (r.falharam || 0) + (r.adiada ? 0 : 1);
        total += r.entraram || 0;
        // O Pinterest recusando a visita seguidas vezes: deixa para a próxima abertura.
        recusas.set(r.id, r.recusada ? (recusas.get(r.id) || 0) + 1 : 0);
        if (r.adiada || ((r.faltam || r.continua) && !r.erro && recusas.get(r.id) < 3)) continuar = true;
        else feitas.push(r.id);
        estadoDaPasta.set(r.id, r.adiada ? resumo(r) : resumo({ ...r, ...s }));
      }
      desenharPastas();
      if (pastas.some(r => r.entraram)) await atualizar();
      if (!continuar || !andou) break;
    }
    if (total) toast(`${nFotos(total)} nova${total === 1 ? '' : 's'} do Pinterest: aparece${total === 1 ? '' : 'm'} na esteira assim que estiver${total === 1 ? '' : 'em'} cortada${total === 1 ? '' : 's'} e classificada${total === 1 ? '' : 's'}.`, 'rare');
    else if (varrer) {
      const recusou = [...recusas.values()].some(n => n > 0);
      toast(recusou ? 'O Pinterest não deixou ler a pasta inteira agora. Tente de novo daqui a pouco.'
        : 'Procurei nas pastas inteiras: nada faltando.', recusou ? 'aviso' : 'rare');
    }
  } catch (e) {
    for (const p of pastasPinterest) {
      if (!feitas.includes(p.id)) estadoDaPasta.set(p.id, `não consegui ler: ${e.message}`);
    }
  } finally {
    relendo = false;
    botao.disabled = false;
    botao.textContent = 'Procurar pins';
    desenharPastas();
  }
  return true;
}

// O botão percorre as pastas de novo do começo: pega pin novo e também o
// antigo que tenha ficado para trás (foto que não baixou, leitura cortada).
async function procurarPins() {
  if (!(await reler({ varrer: true }))) toast('Já estou lendo as pastas; espere terminar.', 'aviso');
}

// Colar o link vincula a pasta e já traz o que a esteira nunca viu.
async function vincularPasta(link) {
  const botao = $('#es-pinterest-ir');
  botao.disabled = true;
  botao.textContent = 'Trazendo…';
  try {
    const r = await api('/pinterest', { metodo: 'POST', corpo: { link } });
    $('#es-pinterest-link').value = '';
    pastasPinterest = r.pastas;
    estadoDaPasta.set(r.pasta.id, resumo(r));
    desenharPastas();
    toast(`"${r.pasta.titulo}" vinculada${r.entraram ? `: ${nFotos(r.entraram)} na esteira` : ''}. ` +
      'Pin novo nela entra sozinho quando a esteira abre.', 'rare');
    if (r.entraram) await atualizar();
    if (r.faltam || r.continua) reler();  // o resto chega sozinho, sem travar a tela
  } catch (e) {
    toast(`Pinterest: ${e.message}`, 'aviso');
  } finally {
    botao.disabled = false;
    botao.textContent = 'Vincular';
  }
}

async function desvincularPasta(p) {
  if (!confirm(`Parar de ler "${p.titulo}"? O que já veio dela continua na esteira.`)) return;
  try {
    ({ pastas: pastasPinterest } = await api('/pinterest', { metodo: 'POST', corpo: { desvincular: p.id } }));
  } catch (e) {
    return toast(`Não consegui desvincular: ${e.message}`, 'aviso');
  }
  estadoDaPasta.delete(p.id);
  desenharPastas();
}

// ============================== Lista =====================================
async function atualizar() {
  let dados;
  try {
    dados = await api('');
  } catch (e) {
    return toast(`Não consegui ler a esteira: ${e.message}`, 'aviso');
  }
  // Foto que o trabalhador reconheceu como peça que já existe: a API já tirou
  // ela da esteira, a tela só avisa.
  const repetidas = dados.repetidas || [];
  if (repetidas.length) {
    const noJogo = repetidas.filter(r => r.de?.onde === 'acervo').length;
    toast(repetidas.length === 1
      ? `"${repetidas[0].arquivo || 'uma foto'}" ${noJogo ? 'já está no jogo' : 'já estava na esteira'} e saiu sozinha.`
      : `${repetidas.length} fotos já ${noJogo === repetidas.length ? 'estavam no jogo' : 'existiam'} e saíram da esteira sozinhas.`);
  }
  const antes = new Map(itens.map(i => [i.id, i]));
  const agora = Date.now();
  const emUso = document.activeElement?.closest?.('.es-cartao')?.dataset.id;
  itens = dados.itens.map(novo => {
    const velho = antes.get(novo.id);
    if (!velho) return { ...novo, previaEm: agora };
    // O cartão em que a pessoa está mexendo fica como está até ela sair dele.
    if (novo.id === emUso) return velho;
    const junto = { ...novo, previaEm: agora };
    // Ficha que está sendo digitada não é atropelada pela que veio do servidor.
    if (guardando.has(novo.id)) Object.assign(junto, { ficha: velho.ficha, medida: velho.medida, corte: velho.corte });
    // A prévia vem com assinatura nova a cada leitura: trocar o src fazia
    // toda imagem baixar de novo a cada 3 s. A velha vale até perto de vencer.
    if (velho.previa && junto.previa && agora - velho.previaEm < PREVIA_VALE) {
      Object.assign(junto, { previa: velho.previa, previaEm: velho.previaEm });
    }
    // Nada mudou: fica o mesmo objeto, e o cartão dele não é refeito.
    return chaveDe(junto) === chaveDe(velho) ? velho : junto;
  });
  for (const id of [...selecionadas]) if (!itens.some(i => i.id === id && selecionavel(i))) selecionadas.delete(id);
  desenhar();

  const andando = itens.some(i => i.estado === 'enviando' || i.estado === 'processando');
  clearTimeout(vigia);
  if (andando) vigia = setTimeout(atualizar, VIGIA_MS);
}

function alternar(id) {
  selecionadas.has(id) ? selecionadas.delete(id) : selecionadas.add(id);
  desenhar();
}

// A fileira é a linha da grade em que o cartão está (quantos cabem depende da
// largura da tela). Se ela já está toda marcada, o toque desmarca.
function alternarFileira(id) {
  const grade = $('#es-grade');
  const topo = $(`.es-cartao[data-id="${id}"]`, grade)?.offsetTop;
  const ids = $$('.es-cartao', grade)
    .filter(c => c.offsetTop === topo)
    .map(c => c.dataset.id)
    .filter(i => itens.some(x => x.id === i && selecionavel(x)));
  const todas = ids.every(i => selecionadas.has(i));
  for (const i of ids) todas ? selecionadas.delete(i) : selecionadas.add(i);
  desenhar();
}

// O tema da peça (coleção de Temas, config.ESTILOS). Marca e cor já são
// campos da ficha; o tema vai para o acervo no campo `tema`.
const opcoesDeTema = (vazio) => [
  el('option', { value: '' }, vazio),
  ...Object.entries(ESTILOS).map(([id, e]) => el('option', { value: id }, e.nome)),
];

// Pronta vai para publicar; com erro, só para descartar. As duas se marcam.
const selecionavel = (item) => item.estado === 'pronta' || item.estado === 'erro';
const marcadas = () => itens.filter(i => selecionadas.has(i.id));

const fichaDe = (item) => {
  const f = { cat: '', cor: '', nome: '', marca: '', raridade: 'common', tema: '', ...(item.ficha || {}) };
  // Peça que entrou na esteira antes das categorias atuais ('tops', 'acc').
  f.cat = migrarCategoria(f.cat);
  return f;
};

// Cartão já desenhado, por id. Redesenhar a grade inteira a cada leitura
// (de 3 em 3 s enquanto chega foto) fechava select, tirava o cursor do campo
// e engolia o toque: agora só o cartão que mudou é refeito, e os outros nós
// ficam onde estão.
const PREVIA_VALE = 45 * 60 * 1000;    // a URL assinada vence em 1 h
const desenhados = new Map();          // id -> { item, chave, no }
const ordenado = (v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, ordenado(v[k])])) : v);
const chaveDe = (item) => JSON.stringify(ordenado({
  estado: item.estado, erro: item.erro, ficha: fichaDe(item), medida: item.medida, corte: item.corte,
  previa: item.previa, sugestao: item.sugestao, arquivo: item.arquivo, sel: selecionadas.has(item.id),
}));

// A peça só aparece depois de cortada e classificada: a que ainda está
// chegando ou processando entra só na contagem acima da grade.
const aparece = (item) => item.estado !== 'enviando' && item.estado !== 'processando';

function desenhar() {
  const grade = $('#es-grade');
  const foco = document.activeElement?.closest?.('.es-cartao')?.dataset.id;
  const campoFoco = document.activeElement?.dataset?.campo;
  const visiveis = itens.filter(aparece);
  const chegando = itens.length - visiveis.length;
  const aviso = $('#es-chegando');
  aviso.hidden = !chegando;
  aviso.textContent = chegando
    ? `${chegando} ${chegando === 1 ? 'peça sendo cortada e classificada' : 'peças sendo cortadas e classificadas'}…`
    : '';

  const nos = visiveis.map(item => {
    const chave = chaveDe(item);
    let d = desenhados.get(item.id);
    if (!d || d.item !== item || d.chave !== chave) {
      d = { item, chave, no: cartao(item) };
      desenhados.set(item.id, d);
    }
    return d.no;
  });
  const vivos = new Set(visiveis.map(i => i.id));
  for (const id of desenhados.keys()) if (!vivos.has(id)) desenhados.delete(id);
  // Só mexe no DOM onde a ordem mudou (peça nova entra no topo).
  let ref = grade.firstChild;
  for (const no of nos) {
    if (no === ref) ref = ref.nextSibling;
    else grade.insertBefore(no, ref);
  }
  while (ref) { const prox = ref.nextSibling; ref.remove(); ref = prox; }
  grade.classList.toggle('selecionando', selecionadas.size > 0);
  $('#es-vazio').hidden = itens.length > 0;   // com peça chegando, a contagem já diz
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
    ...ORDEM_CATEGORIAS.map(c => el('option', { value: c }, rotuloDeCadastro(c)))));
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
      selecionavel(item) ? el('label', { class: 'es-cartao-marca', title: 'selecionar' },
        el('input', {
          type: 'checkbox', checked: selecionadas.has(item.id),
          onchange: (e) => { e.target.checked ? selecionadas.add(item.id) : selecionadas.delete(item.id); desenhar(); },
        })) : null,
      selecionavel(item) ? el('button', {
        class: 'es-cartao-fileira', type: 'button', title: 'Selecionar a fileira inteira',
        'aria-label': 'Selecionar a fileira inteira', onclick: () => alternarFileira(item.id),
      }, '⇔ fileira') : null,
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
      (() => {
        const tema = campo('tema', el('select', { 'aria-label': 'Tema' }, ...opcoesDeTema('Tema…')));
        tema.value = ESTILOS[f.tema] ? f.tema : '';
        return tema;
      })(),
    ),

    pronta && ia.cat
      ? el('p', { class: 'es-ia', title: ia.modelo || '' },
          `✦ palpite da IA${conf != null ? ` · ${conf}% de certeza na categoria` : ''}`
          + (marcaIa ? ' · marca lida na peça' : ''))
      : null,

    // Publicar e descartar são da barra de cima, sobre as selecionadas.
    el('footer', { class: 'es-acoes' },
      item.estado === 'erro'
        ? el('button', { class: 'es-btn mini', onclick: () => refazer(item) }, 'Tentar de novo')
        : el('button', { class: 'es-btn mini', disabled: !pronta, onclick: () => abrirMolde(item) }, 'Medir')),
  );

  // Com alguma peça marcada, tocar em qualquer parte de outro cartão (fora dos
  // campos e botões) marca ou desmarca ele: não precisa acertar o quadradinho.
  no.addEventListener('click', (e) => {
    if (!selecionadas.size || !selecionavel(item)) return;
    if (e.target.closest('input, select, button, label, a, textarea')) return;
    alternar(item.id);
  });

  no.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === 'Enter' && pronta) { e.preventDefault(); publicar([item]); }
    if ((e.key === 'm' || e.key === 'M') && pronta) { e.preventDefault(); abrirMolde(item); }
    if (e.key === 'Delete') { e.preventDefault(); descartar([item]); }
  });
  return no;
}

// ============================== Ficha =====================================
function mudarFicha(item, campo, valor) {
  item.ficha = { ...fichaDe(item), [campo]: valor };
  // O campo na tela já mostra o valor novo: o cartão não precisa ser refeito.
  const d = desenhados.get(item.id);
  if (d?.item === item) d.chave = chaveDe(item);
  // Bolinha de cor e botão de publicar dependem disso. Mexe só neles: recriar o
  // cartão a cada tecla jogava o cursor para o começo do campo e embaralhava o
  // que se digitava (e fechava a lista de sugestões).
  const no = $(`.es-cartao[data-id="${item.id}"]`);
  if (no && campo === 'cor') {
    const hex = hexDaCor(valor);
    const bolha = $('.es-bolha', no);
    bolha.className = 'es-bolha' + (hex === 'estampa' ? ' estampa' : '') + (hex ? '' : ' livre');
    if (hex && hex !== 'estampa') bolha.style.setProperty('--cor', hex);
    else bolha.style.removeProperty('--cor');
  }
  guardarDepois(item);
}

function guardarDepois(item) {
  clearTimeout(guardando.get(item.id));
  guardando.set(item.id, setTimeout(async () => {
    try {
      await api(`/${item.id}`, { metodo: 'PUT', corpo: { ficha: item.ficha, medida: item.medida, corte: item.corte } });
    } catch (e) {
      toast(`Não consegui guardar a ficha: ${e.message}`, 'aviso');
    } finally {
      guardando.delete(item.id);
    }
  }, GUARDA_MS));
}

// ============================== Ações =====================================
// Peças passando pelo molde uma atrás da outra. Publicar sem ter medido abre
// o molde (`publicar: true`); cada "Próxima" passa para a seguinte sem medida
// e, quando não sobra nenhuma, publica todas. "Medir peças" abre a mesma fila
// só para medir (`publicar: false`), e no fim só guarda. "← Anterior" volta uma
// peça (para corrigir a categoria ou a medida); Cancelar ou Esc desiste, e as
// medidas já confirmadas ficam guardadas.
let fila = null;                       // { itens, publicar }

async function publicar(lista) {
  // Peça sem categoria fica para trás, mas não segura o lote inteiro.
  const semCat = lista.filter(i => i.estado === 'pronta' && !fichaDe(i).cat);
  const prontas = lista.filter(i => i.estado === 'pronta' && fichaDe(i).cat);
  if (semCat.length && !fila) {
    toast(`${semCat.length === 1 ? 'Uma peça ficou' : `${semCat.length} peças ficaram`} de fora: falta a categoria.`, 'aviso');
  }
  const semMedida = prontas.filter(i => !i.medida);
  if (semMedida.length) {
    fila = { itens: prontas, publicar: true };
    abrirMolde(semMedida[0]);
    return;
  }
  fila = null;
  let feitas = 0;
  for (const item of prontas) {
    clearTimeout(guardando.get(item.id));
    guardando.delete(item.id);
    try {
      const { item: peca } = await api(`/${item.id}/publicar`, {
        metodo: 'POST', corpo: { ficha: fichaDe(item), medida: item.medida || null },
      });
      feitas++;
      itens = itens.filter(i => i.id !== item.id);   // por id: a lista pode ter sido relida enquanto media
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

// Os dois atalhos de cima, que não dependem de seleção.
const prontaComCat = (i) => i.estado === 'pronta' && fichaDe(i).cat;

function publicarMedidas() {
  const lista = itens.filter(i => prontaComCat(i) && i.medida);
  if (!lista.length) return toast('Nenhuma peça medida esperando.', 'aviso');
  if (!confirm(`Publicar ${lista.length === 1 ? 'a peça já medida' : `as ${lista.length} peças já medidas`}?`)) return;
  publicar(lista);
}

function medirTodas() {
  const semCat = itens.filter(i => i.estado === 'pronta' && !fichaDe(i).cat && !i.medida).length;
  const lista = itens.filter(i => prontaComCat(i) && !i.medida);
  if (semCat) {
    toast(`${semCat === 1 ? 'Uma peça ficou' : `${semCat} peças ficaram`} de fora: falta a categoria.`, 'aviso');
  }
  if (!lista.length) return semCat ? null : toast('Todas as peças já estão medidas.');
  fila = { itens: lista, publicar: false };
  abrirMolde(lista[0]);
}

function atualizarAtalhos() {
  const medidas = itens.filter(i => prontaComCat(i) && i.medida).length;
  const semMedida = itens.filter(i => i.estado === 'pronta' && !i.medida).length;
  $('#es-atalhos-lote').hidden = !medidas && !semMedida;
  const pub = $('#es-pub-medidas');
  pub.disabled = !medidas;
  pub.textContent = medidas ? `Publicar ${medidas} já medida${medidas > 1 ? 's' : ''}` : 'Publicar já medidas';
  const med = $('#es-medir-todas');
  med.disabled = !semMedida;
  med.textContent = semMedida ? `Medir ${semMedida} sem medida` : 'Medir peças';
}

async function descartar(lista) {
  if (!lista.length) return;
  const pergunta = lista.length === 1
    ? `Descartar "${fichaDe(lista[0]).nome || lista[0].arquivo || 'esta peça'}"?`
    : `Descartar ${lista.length} peças?`;
  if (lista.some(i => i.estado === 'pronta') && !confirm(pergunta)) return;
  for (const item of lista) {
    try {
      await api(`/${item.id}`, { metodo: 'DELETE' });
    } catch (e) {
      toast(`Não consegui descartar: ${e.message}`, 'aviso');
      break;
    }
    itens = itens.filter(i => i.id !== item.id);   // por id: a lista pode ter sido relida enquanto media
    selecionadas.delete(item.id);
  }
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
  atualizarAtalhos();
  const marcaveis = itens.filter(selecionavel);
  $('#es-lote').hidden = !marcaveis.length;
  const sel = marcadas();
  const n = sel.length;
  const publicaveis = sel.filter(i => i.estado === 'pronta').length;
  $('#es-sel-conta').textContent = n ? `${n} selecionada${n > 1 ? 's' : ''}` : 'selecionar todas';
  $('#es-todas').checked = n > 0 && n === marcaveis.length;
  $('#es-lote-aplicar').disabled = !publicaveis;
  $('#es-lote-descartar').disabled = !n;
  $('#es-lote-descartar').textContent = n > 1 ? `Descartar ${n}` : 'Descartar';
  $('#es-lote-publicar').disabled = !publicaveis;
  $('#es-lote-publicar').textContent = publicaveis > 1 ? `Publicar ${publicaveis}` : 'Publicar';
}

function aplicarLote() {
  const cat = $('#es-lote-cat').value;
  const raridade = $('#es-lote-rar').value;
  const marca = $('#es-lote-marca').value.trim();
  const tema = $('#es-lote-tema').value;
  for (const item of marcadas().filter(i => i.estado === 'pronta')) {
    const f = fichaDe(item);
    // Medida é de categoria: trocar a categoria invalida o que foi medido.
    if (cat && cat !== f.cat) item.medida = false;   // false: apaga também a guardada
    item.ficha = { ...f, ...(cat && { cat }), ...(raridade && { raridade }), ...(marca && { marca }), ...(tema && { tema }) };
    guardarDepois(item);
  }
  desenhar();
  toast('Aplicado às selecionadas.');
}

// ============================== Molde =====================================
let medindo = null;                    // o item no molde
let medida = null;                     // { x, y, w } em unidades do palco (600×1200)

// `medida` é a peça em cima do corpo, na proporção de agora; `item.medida` é
// a mesma levada de volta ao molde (js/proporcao.js), que é o que se grava.
//
// Peça nova abre do tamanho e no lugar em que as já medidas da mesma
// categoria costumam ficar: a mediana do acervo, lida ao abrir a esteira
// (`medidasDoAcervo`). As âncoras de CATEGORIAS ficaram bem menores do que
// o que se mede de verdade (camisa 250 contra ~430), por isso não servem.
// Antes da leitura chegar, ou em categoria com menos de 3 medidas, vale a
// tabela tirada do acervo em 14/10/2026. Tudo no molde (ver paraGravar).
const PADRAO_MEDIDO = {
  shoes: { x: 300, y: 1081, w: 266 },
  pants: { x: 300, y: 842, w: 358 },
  shorts: { x: 300, y: 752, w: 354 },
  skirts: { x: 300, y: 685, w: 319 },
  shirts: { x: 300, y: 408, w: 431 },
  coats: { x: 300, y: 414, w: 486 },
  cropped: { x: 300, y: 379, w: 297 },
  glasses: { x: 300, y: 125, w: 134 },
  hats: { x: 300, y: 84, w: 144 },
  bags: { x: 432, y: 667, w: 252 },
};
const medidasDoAcervo = new Map();     // cat -> { x, y, w } no molde

function lerMedidasDoAcervo(items) {
  const porCat = new Map();
  for (const i of items) {
    const a = i.ancora;
    if (!(a?.w > 0)) continue;
    const cat = migrarCategoria(i.cat);
    if (!CATEGORIAS[cat]) continue;
    if (!porCat.has(cat)) porCat.set(cat, []);
    porCat.get(cat).push(a);
  }
  const mediana = (v) => {
    const o = [...v].sort((a, b) => a - b);
    const m = o.length >> 1;
    return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
  };
  for (const [cat, lista] of porCat) {
    if (lista.length < 3) continue;
    // Peça do meio do corpo fica no meio: só a bolsa e o relógio vão de lado.
    const centrada = CATEGORIAS[cat].anchor.x === 300;
    medidasDoAcervo.set(cat, {
      x: centrada ? 300 : Math.round(mediana(lista.map(a => a.x))),
      y: Math.round(mediana(lista.map(a => a.y))),
      w: Math.round(mediana(lista.map(a => a.w))),
    });
  }
}

const padraoNoMolde = (cat) =>
  medidasDoAcervo.get(cat) || PADRAO_MEDIDO[cat] || CATEGORIAS[cat]?.anchor || { x: 300, y: 600, w: 200 };
const medidaPadrao = (cat) => {
  const a = ancoraNoCorpo(CATEGORIAS[cat]?.regiao, padraoNoMolde(cat));
  return { x: a.x, y: a.y, w: a.w };
};
const regiaoDe = (item) => CATEGORIAS[fichaDe(item).cat]?.regiao;
const paraGravar = () => {
  const a = ancoraNoMolde(regiaoDe(medindo), medida);
  return { x: Math.round(a.x), y: Math.round(a.y), w: Math.round(a.w) };
};

function abrirMolde(item) {
  const f = fichaDe(item);
  if (!f.cat) return toast('Escolha a categoria antes de medir.', 'aviso');
  medindo = item;
  medida = item.medida ? ancoraNoCorpo(regiaoDe(item), { ...item.medida }) : medidaPadrao(f.cat);
  $('#es-avatar').innerHTML = svgAvatar();
  $('#es-peca-img').src = item.previa;
  fecharCorte();
  $('#es-molde-modal').hidden = false;
  $('#es-molde-cat').value = f.cat;
  atualizarNavegacao();
  posicionar();
}

// Medindo para publicar: em que peça da fila se está, o que o botão faz
// depois, e se dá para voltar à anterior.
function atualizarNavegacao() {
  const lista = fila?.itens;
  const pos = lista ? lista.indexOf(medindo) : -1;
  $('#es-molde-passo').textContent = lista && lista.length > 1 ? `Peça ${pos + 1} de ${lista.length}` : '';
  $('#es-molde-voltar').hidden = !(pos > 0);
  $('#es-molde-ok').textContent = rotuloDoPronto(medindo);
}

function rotuloDoPronto(item) {
  if (!fila) return 'Pronto';
  const faltam = fila.itens.filter(i => i !== item && !i.medida).length;
  if (faltam) return `Próxima (falta${faltam > 1 ? 'm' : ''} ${faltam})`;
  if (!fila.publicar) return 'Concluir';
  return fila.itens.length > 1 ? `Publicar ${fila.itens.length}` : 'Publicar';
}

// Volta à peça anterior da fila para refazer a medida ou trocar a categoria.
// O que se mexeu na de agora sem confirmar fica para trás; ela continua sem
// medida, então o "Próxima" de lá traz de volta para ela.
function voltarNaFila() {
  const pos = fila?.itens.indexOf(medindo) ?? -1;
  if (pos > 0) abrirMolde(fila.itens[pos - 1]);
}

// Categoria errada descoberta no molde. A medida é da categoria, então a que
// havia não serve mais: a peça volta ao tamanho padrão da nova.
function trocarCategoriaNoMolde(cat) {
  if (!cat || cat === fichaDe(medindo).cat) return;
  const atual = itens.find(i => i.id === medindo.id);
  for (const i of new Set([medindo, atual].filter(Boolean))) {
    i.ficha = { ...fichaDe(i), cat };
    i.medida = false;                   // false: apaga também a guardada (ver guardar na API)
  }
  guardarDepois(medindo);
  medida = medidaPadrao(cat);
  desenhar();
  atualizarNavegacao();
  posicionar();
}

function fecharMolde(guardar) {
  if (guardar && medindo) {
    medindo.medida = paraGravar();
    // A lista pode ter sido relida enquanto media: o cartão novo também ganha.
    const atual = itens.find(i => i.id === medindo.id);
    if (atual) atual.medida = medindo.medida;
    guardarDepois(medindo);
    desenhar();
  }
  medindo = null;
  $('#es-molde-modal').hidden = true;
  const f = fila;
  fila = null;
  if (f && guardar) seguirNaFila(f);
  else if (f) toast(f.publicar ? 'Publicação cancelada.' : 'Medição interrompida. As medidas feitas ficaram guardadas.');
}

// Depois de uma peça: a próxima sem medida, ou o fim da fila.
function seguirNaFila(f) {
  if (f.publicar) return publicar(f.itens);  // ela mesma abre a próxima sem medida
  const proxima = f.itens.find(i => !i.medida);
  if (proxima) {
    fila = f;
    abrirMolde(proxima);
  } else {
    toast(f.itens.length > 1 ? `${f.itens.length} peças medidas.` : 'Peça medida.');
  }
}

// Peça que não presta, descoberta na hora de medir: sai da esteira ali mesmo
// e a fila segue para a próxima sem medida. Numa fila de publicar, se só
// sobraram medidas, não publica sozinha: fecha e deixa o botão fazer isso.
async function excluirNoMolde() {
  const item = medindo;
  if (!item) return;
  if (!confirm(`Excluir "${fichaDe(item).nome || item.arquivo || 'esta peça'}" da esteira?`)) return;
  try {
    await api(`/${item.id}`, { metodo: 'DELETE' });
  } catch (e) {
    return toast(`Não consegui excluir: ${e.message}`, 'aviso');
  }
  clearTimeout(guardando.get(item.id));
  guardando.delete(item.id);
  itens = itens.filter(i => i.id !== item.id);
  selecionadas.delete(item.id);
  desenhar();

  const f = fila;
  fila = null;
  medindo = null;
  $('#es-molde-modal').hidden = true;
  toast('Peça excluída.');
  if (!f) return;
  f.itens = f.itens.filter(i => i.id !== item.id);
  const proxima = f.itens.find(i => !i.medida);
  if (proxima) {
    fila = f;
    abrirMolde(proxima);
  }
}

function posicionar() {
  const no = $('#es-peca');
  const c = corteDe(medindo);
  const prop = ((medindo.w || 1) * c.w) / ((medindo.h || 1) * c.h);
  enquadrar($('#es-peca-img'), c);
  no.style.left = `${medida.x / CONFIG.STAGE_W * 100}%`;
  no.style.top = `${medida.y / CONFIG.STAGE_H * 100}%`;
  no.style.width = `${medida.w / CONFIG.STAGE_W * 100}%`;
  no.style.height = `${(medida.w / prop) / CONFIG.STAGE_H * 100}%`;

  const cat = fichaDe(medindo).cat;
  const real = paraGravar();
  const razao = real.w / padraoNoMolde(cat).w;
  const fora = razao > 1.55 || razao < 0.6;
  const texto = $('#es-medida');
  texto.textContent = `largura ${real.w} un · ${Math.round(real.w / 224 * 100)}% dos ombros`
    + (fora ? ` — ${razao.toFixed(1).replace('.', ',')}× o padrão de ${CATEGORIAS[cat].nome}, confira` : '');
  texto.classList.toggle('alerta', fora);
  alcaMov?.colocar([no]);
}

// A alça de quatro setas ao lado da peça: arrastar sem tapar a peça (celular).
let alcaMov = null;

function ligarMolde() {
  const no = $('#es-peca');
  const pegar = (e) => {
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
      if (alca && alca !== 'mov') {
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
  };
  no.addEventListener('pointerdown', pegar);
  alcaMov = alcaMover($('#es-molde'), pegar);

  $('#es-molde').addEventListener('wheel', (e) => {
    e.preventDefault();
    medida.w = clamp(medida.w * (e.deltaY < 0 ? 1.06 : 0.94), 20, 600);
    posicionar();
  }, { passive: false });

  ligarCorte();
  $('#es-molde-ok').addEventListener('click', () => fecharMolde(true));
  $('#es-molde-cancelar').addEventListener('click', () => fecharMolde(false));
  $('#es-molde-voltar').addEventListener('click', voltarNaFila);
  $('#es-molde-excluir').addEventListener('click', excluirNoMolde);
  const cat = $('#es-molde-cat');
  cat.append(...ORDEM_CATEGORIAS.map(c => el('option', { value: c }, rotuloDeCadastro(c))));
  cat.addEventListener('change', () => trocarCategoriaNoMolde(cat.value));
  $('#es-molde-modal').addEventListener('pointerdown', (e) => {
    if (e.target.id === 'es-molde-modal' && !cortando) fecharMolde(true);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && cortando) fecharCorte();
    else if (e.key === 'Escape' && medindo) fecharMolde(false);
  });
}

// ============================== Cortar ====================================
// Na hora de medir dá para cortar a foto (sobrou braço, cabide, outra peça).
// O corte é uma caixa em 0–1 sobre a prévia, guardada na ficha da esteira; o
// molde já mostra a peça cortada e a API corta as imagens ao publicar.
const INTEIRA = { x: 0, y: 0, w: 1, h: 1 };
const MIN_CORTE = 0.05;
let cortando = null;                   // a caixa em edição

const corteDe = (item) => (item?.corte && item.corte.w > 0 && item.corte.h > 0 ? item.corte : INTEIRA);

// A imagem dentro de uma janela de overflow escondido mostra só o corte.
function enquadrar(img, c) {
  img.style.width = `${100 / c.w}%`;
  img.style.height = `${100 / c.h}%`;
  img.style.left = `${-c.x / c.w * 100}%`;
  img.style.top = `${-c.y / c.h * 100}%`;
}

function abrirCorte() {
  if (!medindo) return;
  cortando = { ...corteDe(medindo) };
  $('#es-corte-img').src = medindo.previa;
  for (const id of ['es-molde', 'es-medida', 'es-molde-rodape', 'es-molde-dica']) $('#' + id).hidden = true;
  $('#es-corte').hidden = false;
  desenharCorte();
}

function fecharCorte() {
  cortando = null;
  $('#es-corte').hidden = true;
  for (const id of ['es-molde', 'es-medida', 'es-molde-rodape', 'es-molde-dica']) $('#' + id).hidden = false;
}

function desenharCorte() {
  for (const no of [$('#es-corte-caixa'), $('#es-corte-furo')]) {
    no.style.left = `${cortando.x * 100}%`;
    no.style.top = `${cortando.y * 100}%`;
    no.style.width = `${cortando.w * 100}%`;
    no.style.height = `${cortando.h * 100}%`;
  }
}

// O corte novo vale para a peça e para o cartão. A largura medida acompanha:
// cortar metade da largura deixa a peça com metade do tamanho no corpo, e não
// esticada de volta ao tamanho antigo.
function aplicarCorte(novo) {
  const antes = corteDe(medindo);
  const inteira = !novo || (novo.w > 0.995 && novo.h > 0.995);
  const corte = inteira ? false : {
    x: +novo.x.toFixed(4), y: +novo.y.toFixed(4), w: +novo.w.toFixed(4), h: +novo.h.toFixed(4),
  };
  const atual = itens.find(i => i.id === medindo.id);
  for (const i of new Set([medindo, atual].filter(Boolean))) i.corte = corte;
  medida.w = clamp(medida.w * corteDe(medindo).w / antes.w, 20, 600);
  guardarDepois(medindo);
  fecharCorte();
  posicionar();
}

function ligarCorte() {
  const caixa = $('#es-corte-caixa');
  caixa.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const palco = $('#es-corte-palco').getBoundingClientRect();
    const canto = e.target.dataset?.canto || '';
    const base = { ...cortando };
    const x0 = e.clientX, y0 = e.clientY;
    caixa.setPointerCapture(e.pointerId);
    const mover = (ev) => {
      const dx = (ev.clientX - x0) / palco.width;
      const dy = (ev.clientY - y0) / palco.height;
      if (!canto) {
        cortando.x = clamp(base.x + dx, 0, 1 - base.w);
        cortando.y = clamp(base.y + dy, 0, 1 - base.h);
      } else {
        let { x, y } = base;
        let x2 = base.x + base.w, y2 = base.y + base.h;
        if (canto.includes('o')) x = clamp(base.x + dx, 0, x2 - MIN_CORTE);
        if (canto.includes('e')) x2 = clamp(x2 + dx, x + MIN_CORTE, 1);
        if (canto.startsWith('n')) y = clamp(base.y + dy, 0, y2 - MIN_CORTE);
        if (canto.startsWith('s')) y2 = clamp(y2 + dy, y + MIN_CORTE, 1);
        Object.assign(cortando, { x, y, w: x2 - x, h: y2 - y });
      }
      desenharCorte();
    };
    const soltar = () => {
      caixa.removeEventListener('pointermove', mover);
      caixa.removeEventListener('pointerup', soltar);
      caixa.removeEventListener('pointercancel', soltar);
    };
    caixa.addEventListener('pointermove', mover);
    caixa.addEventListener('pointerup', soltar);
    caixa.addEventListener('pointercancel', soltar);
  });
  $('#es-molde-cortar').addEventListener('click', abrirCorte);
  $('#es-corte-ok').addEventListener('click', () => aplicarCorte(cortando));
  $('#es-corte-tirar').addEventListener('click', () => aplicarCorte(null));
  $('#es-corte-cancelar').addEventListener('click', fecharCorte);
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
  $('#es-pinterest-procurar').addEventListener('click', procurarPins);
  $('#es-pinterest').addEventListener('submit', (e) => {
    e.preventDefault();
    const link = $('#es-pinterest-link').value.trim();
    if (link) vincularPasta(link);
  });
  $('#es-arquivos').addEventListener('change', (e) => { enviar(e.target.files, 'tela'); e.target.value = ''; });
  $('#es-camera').addEventListener('change', (e) => { enviar(e.target.files, 'celular'); e.target.value = ''; });
}

function ligarLote() {
  for (const c of ORDEM_CATEGORIAS) $('#es-lote-cat').append(el('option', { value: c }, rotuloDeCadastro(c)));
  for (const r of RARIDADES) $('#es-lote-rar').append(el('option', { value: r.id }, r.nome));
  for (const c of CORES) $('#es-cores').append(el('option', { value: c.nome }));
  $('#es-lote-tema').append(...opcoesDeTema('Tema…'));

  $('#es-todas').addEventListener('change', (e) => {
    selecionadas.clear();
    if (e.target.checked) itens.filter(selecionavel).forEach(i => selecionadas.add(i.id));
    desenhar();
  });
  $('#es-lote-aplicar').addEventListener('click', aplicarLote);
  $('#es-lote-publicar').addEventListener('click', () => publicar(marcadas()));
  $('#es-lote-descartar').addEventListener('click', () => descartar(marcadas()));
  $('#es-pub-medidas').addEventListener('click', publicarMedidas);
  $('#es-medir-todas').addEventListener('click', medirTodas);
}

// As marcas do acervo viram autocomplete: escrever "Nike" sempre do mesmo jeito.
// As medidas dele viram o tamanho padrão do molde.
async function carregarAcervo() {
  try {
    const r = await fetch(CONFIG.ACERVO, { cache: 'no-cache' });
    const { items = [] } = await r.json();
    lerMedidasDoAcervo(items);
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
  carregarAcervo();
  await atualizar();
  montarPinterest();
  // Voltou para a aba (ex.: depois de fotografar no celular ou de salvar pin
  // novo): confere a esteira e relê as pastas do Pinterest.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    atualizar();
    if (Date.now() - ultimaLeitura > RELER_MS) reler();
  });
}

iniciar();
