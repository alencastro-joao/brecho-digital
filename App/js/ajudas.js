// Mini games de ajuda: os jogadores ajudam a cadastrar as peças da esteira e
// ganham fichas por isso. Botão do dado na barra (#/ajudas): abre num menu de
// três botões grandes, um por jogo.
//
//   Avaliar    a peça aparece; arrastar para a direita é "gostei", para a
//              esquerda "não gostei". A média dos votos sugere a raridade.
//   Ajustar    encaixar a peça no corpo (arrastar e mudar o tamanho).
//   Preencher  dizer a cor e a marca da peça.
//
// Quem conta as ajudas, paga a ficha e segura o limite é o servidor
// (nuvem/lambda/ajudas.py, onde também moram os números): aqui só se mostra o
// que ele diz e soma a ficha que ele mandar.

import { CONFIG, CATEGORIAS, CORES, ancoraPadrao } from './config.js';
import { rotuloCategoria } from './catalog.js';
import * as db from './db.js';
import { svgAvatar } from './avatar.js';
import { ancoraNoMolde } from './proporcao.js';
import { el, $, clamp, toast } from './util.js';
import { ico } from './icones.js';
import { alcaMover } from './alcamover.js';

const JOGOS = [
  { id: 'avaliar', nome: 'Avaliar', icone: 'coracao-cheio', cor: 'var(--board)', desc: 'Arraste: gostei ou não gostei.' },
  { id: 'ajustar', nome: 'Ajustar', icone: 'mover', cor: 'var(--inventario)', desc: 'Encaixe a peça no corpo.' },
  { id: 'preencher', nome: 'Preencher', icone: 'editar', cor: 'var(--tarefas)', desc: 'Diga a cor e a marca.' },
];

let estado = null;        // resposta de GET /api/ajudas (a cota de cada jogo)
let itens = [];           // as fotos da esteira que o admin mandou para os jogos
let jogo = null;          // null = o menu dos três botões
let peca = null;          // peça na tela
let enviando = false;
let premiado = null;      // jogo que acabou de pagar ficha (a barra mostra cheia)

async function chamar(rota, corpo) {
  const r = await fetch(rota, {
    method: corpo ? 'POST' : 'GET',
    credentials: 'include',
    headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 409) throw new Error(dados.erro || 'HTTP ' + r.status);
  return dados;
}

export function montarAjudas() {
  $('#mg-voltar').addEventListener('click', () => { jogo = null; renderMenu(); });
}

export async function aoEntrarNasAjudas() {
  jogo = null;
  renderMenu();
  $('#mg-palco').replaceChildren(el('p', { class: 'mg-vazio' }, 'Carregando…'));
  try {
    const r = await chamar('/api/ajudas');
    estado = r.jogos;
    itens = r.itens || [];
  } catch {
    estado = null;
    $('#mg-palco').replaceChildren(el('p', { class: 'mg-vazio' },
      'Os mini games precisam de internet e da sua conta. Tente de novo daqui a pouco.'));
    return;
  }
  renderMenu();
}

// O menu: três quadrados grandes, cada um com sua cor e símbolo.
function renderMenu() {
  const noMenu = !jogo;
  const j = JOGOS.find(x => x.id === jogo);
  $('#mg-menu').hidden = !noMenu;
  $('#mg-painel').hidden = noMenu && !!estado;
  $('#mg-voltar').hidden = noMenu;
  $('#mg-titulo').textContent = noMenu ? 'Mini games' : j.nome;
  $('#mg-titulo-ico').replaceChildren(ico(noMenu ? 'dado' : j.icone));
  $('#mg-titulo-ico').style.setProperty('--cor', noMenu ? 'var(--loja)' : j.cor);
  renderFichas();
  if (!noMenu) return;
  $('#mg-cota').replaceChildren();
  if (estado) $('#mg-palco').replaceChildren();
  $('#mg-menu').replaceChildren(...JOGOS.map(j => {
    const s = estado?.[j.id];
    return el('button', {
      type: 'button', class: 'mg-quadrado', style: { '--cor': j.cor },
      onclick: () => { if (!estado) return; jogo = j.id; renderMenu(); proxima(); },
    }, ico(j.icone), el('strong', {}, j.nome),
    s ? barra(s, j.id, true) : el('small', {}, ''));
  }));
}

// A barra enche a cada ajuda; cheia, paga a ficha e volta a zero. No limite
// da janela ela fica cheia e cinza, com o aviso.
function barra(s, id, curta = false) {
  const esgotou = s.feitas >= s.limite;
  const ganhou = premiado === id;
  const cheia = esgotou || ganhou;
  const passo = s.feitas % s.porFicha;
  const pct = cheia ? 100 : passo / s.porFicha * 100;
  const quando = s.janela === 'hora' ? 'desta hora' : 'de hoje';
  const texto = esgotou ? `Limite ${quando} atingido`
    : ganhou ? '+1 ficha!'
    : curta ? `${passo}/${s.porFicha}` : `${passo}/${s.porFicha} para 1 ficha · ${s.feitas}/${s.limite} ${quando}`;
  return el('div', { class: 'mg-barra' + (esgotou ? ' esgotou' : '') + (ganhou ? ' ganhou' : '') },
    el('div', { class: 'mg-barra-trilho' }, el('div', { class: 'mg-barra-cheio', style: { width: pct + '%' } })),
    el('small', {}, texto));
}

const renderFichas = () => $('#mg-fichas').replaceChildren(
  el('span', { class: 'ficha-moeda', 'aria-hidden': 'true' }), el('b', {}, String(db.fichas())));

// A linha de progresso dentro do jogo, no molde dos pedidos de Tarefas.
function renderCota() {
  const s = estado?.[jogo];
  if (!s) return $('#mg-cota').replaceChildren();
  const esgotou = s.feitas >= s.limite;
  const ganhou = premiado === jogo;
  const passo = s.feitas % s.porFicha;
  const pct = esgotou || ganhou ? 100 : passo / s.porFicha * 100;
  const quando = s.janela === 'hora' ? 'desta hora' : 'de hoje';
  $('#mg-cota').replaceChildren(el('div', {
    class: 'mg-progresso' + (esgotou ? ' esgotou' : '') + (ganhou ? ' ganhou' : ''),
  },
    el('span', { class: 'mg-progresso-ico' }, el('span', { class: 'ficha-moeda', 'aria-hidden': 'true' })),
    el('div', { class: 'mg-progresso-info' },
      el('strong', {}, esgotou ? `Limite ${quando} atingido` : ganhou ? '+1 ficha!' : 'Próxima ficha'),
      el('div', { class: 'mg-progresso-barra' }, el('span', { style: { width: pct + '%' } }))),
    el('small', {}, esgotou ? `${s.feitas}/${s.limite}` : `${ganhou ? s.porFicha : passo}/${s.porFicha}`)));
}

// A próxima peça: as mais novas primeiro, pulando as que a pessoa já ajudou.
function escolherPeca() {
  const feitas = new Set(estado[jogo].pecas);
  const cands = itens.filter(i => !feitas.has(i.id) && CATEGORIAS[i.cat]);
  cands.sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')));
  // Entre as 10 mais novas, uma qualquer: duas pessoas ao mesmo tempo não
  // ficam votando sempre na mesma.
  return cands[Math.floor(Math.random() * Math.min(10, cands.length))] || null;
}

function proxima() {
  // O Avaliar leva a barra para baixo do cartão; os outros a querem no topo.
  $('#mg-palco').before($('#mg-cota'));
  renderCota();
  const s = estado[jogo];
  if (s.feitas >= s.limite) {
    const vira = new Date(s.vira).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return $('#mg-palco').replaceChildren(el('p', { class: 'mg-vazio' },
      `Por ${s.janela === 'hora' ? 'esta hora' : 'hoje'} chega de ${JOGOS.find(j => j.id === jogo).nome.toLowerCase()}. ` +
      `Volta às ${vira}.`));
  }
  peca = escolherPeca();
  if (!peca) {
    return $('#mg-palco').replaceChildren(el('p', { class: 'mg-vazio' },
      'Não tem peça nova para este jogo agora. Volte mais tarde!'));
  }
  ({ avaliar: jogoAvaliar, ajustar: jogoAjustar, preencher: jogoPreencher })[jogo]();
}

async function enviar(corpo) {
  if (enviando) return;
  enviando = true;
  try {
    const r = await chamar('/api/ajudas/' + jogo, { peca: peca.id, ...corpo });
    const s = estado[jogo];
    Object.assign(s, { feitas: r.feitas, limite: r.limite, porFicha: r.porFicha, vira: r.vira });
    if (r.ok || r.motivo === 'repetida') s.pecas.push(peca.id);
    if (r.fichas) {
      db.ganharFicha(r.fichas);
      db.salvar();
      toast(`+${r.fichas} ficha${r.fichas > 1 ? 's' : ''} por ajudar!`);
      renderFichas();
      // A barra fica cheia um instante antes de zerar.
      premiado = jogo;
      setTimeout(() => { premiado = null; if (jogo) renderCota(); }, 1200);
    }
  } catch (e) {
    toast(`Não deu para enviar: ${e.message}`, 'aviso');
  } finally {
    enviando = false;
  }
  proxima();
}

const nomeDaPeca = (it) => (it.nome || rotuloCategoria(it.cat)).toLowerCase();
const imagem = (it, classe) => el('img', { class: classe, src: it.src, alt: nomeDaPeca(it), draggable: 'false' });

// ------------------------------- Avaliar ----------------------------------
function jogoAvaliar() {
  const carta = el('div', { class: 'mg-carta' }, imagem(peca, 'mg-carta-img'),
    el('span', { class: 'mg-selo mg-selo-nao' }, 'Não'),
    el('span', { class: 'mg-selo mg-selo-sim' }, 'Gostei'));
  const votar = (gostei) => {
    carta.classList.add(gostei ? 'sai-dir' : 'sai-esq');
    setTimeout(() => enviar({ gostei }), 220);
  };

  let ini = null;
  carta.addEventListener('pointerdown', (e) => { ini = e.clientX; carta.setPointerCapture(e.pointerId); carta.classList.add('arrastando'); });
  carta.addEventListener('pointermove', (e) => {
    if (ini === null) return;
    const dx = e.clientX - ini;
    carta.style.transform = `translateX(${dx}px) rotate(${dx / 20}deg)`;
    carta.style.setProperty('--sim', clamp(dx / 120, 0, 1));
    carta.style.setProperty('--nao', clamp(-dx / 120, 0, 1));
  });
  const soltar = (e) => {
    if (ini === null) return;
    const dx = e.clientX - ini;
    ini = null;
    carta.classList.remove('arrastando');
    if (Math.abs(dx) > 100) return votar(dx > 0);
    carta.style.transform = '';
    carta.style.setProperty('--sim', 0);
    carta.style.setProperty('--nao', 0);
  };
  carta.addEventListener('pointerup', soltar);
  carta.addEventListener('pointercancel', soltar);

  $('#mg-palco').replaceChildren(
    el('div', { class: 'mg-mesa' }, carta),
    $('#mg-cota'),
    el('div', { class: 'mg-botoes mg-botoes-voto' },
      el('button', { type: 'button', class: 'mg-voto mg-voto-nao', onclick: () => votar(false) }, ico('x'), 'Não curti'),
      el('button', { type: 'button', class: 'mg-voto mg-voto-sim', onclick: () => votar(true) }, ico('coracao-cheio'), 'Gostei')),
    el('p', { class: 'mg-dica' }, 'Ou arraste a peça para um dos lados.'));
}

// ------------------------------- Ajustar ----------------------------------
// A peça começa no lugar padrão da categoria, um pouco torta de propósito,
// para ninguém só apertar "pronto". A medida vai no molde, como no editor.
function jogoAjustar() {
  const p = ancoraPadrao(peca.cat);
  const medida = {
    x: p.x + (Math.random() - 0.5) * 80,
    y: p.y + (Math.random() - 0.5) * 120,
    w: p.w * (0.75 + Math.random() * 0.5),
  };
  const prop = peca.w && peca.h ? peca.w / peca.h : 1;
  const no = el('div', { class: 'mg-peca' }, imagem(peca, ''));
  const palco = el('div', { class: 'mg-corpo' });
  const boneco = el('div', { class: 'mg-boneco' });
  boneco.innerHTML = svgAvatar();
  palco.append(boneco, no);

  // Como no Stylist: a barra em pé do tamanho ao lado do corpo e a alça de
  // quatro setas perto da peça, para o dedo não tapar o que se encaixa.
  const faixa = el('input', { type: 'range', min: '20', max: '600', 'aria-label': 'Tamanho da peça' });
  const tamanho = (w) => { medida.w = clamp(w, 20, 600); posicionar(); };
  const alca = alcaMover(palco, (e) => pegar(e));
  function posicionar() {
    no.style.left = (medida.x / CONFIG.STAGE_W * 100) + '%';
    no.style.top = (medida.y / CONFIG.STAGE_H * 100) + '%';
    no.style.width = (medida.w / CONFIG.STAGE_W * 100) + '%';
    no.style.height = (medida.w / prop / CONFIG.STAGE_H * 100) + '%';
    faixa.value = Math.round(medida.w);
    alca.colocar([no]);
  }

  let ini = null;
  function pegar(e) {
    ini = { x: e.clientX, y: e.clientY, mx: medida.x, my: medida.y };
    const mover = (ev) => {
      const r = palco.getBoundingClientRect();
      medida.x = clamp(ini.mx + (ev.clientX - ini.x) / r.width * CONFIG.STAGE_W, 0, CONFIG.STAGE_W);
      medida.y = clamp(ini.my + (ev.clientY - ini.y) / r.height * CONFIG.STAGE_H, 0, CONFIG.STAGE_H);
      posicionar();
    };
    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      window.removeEventListener('pointercancel', soltar);
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
    window.addEventListener('pointercancel', soltar);
  }
  no.addEventListener('pointerdown', (e) => { e.preventDefault(); pegar(e); });
  palco.addEventListener('wheel', (e) => {
    e.preventDefault();
    tamanho(medida.w * (e.deltaY < 0 ? 1.05 : 0.95));
  }, { passive: false });
  faixa.addEventListener('input', () => tamanho(Number(faixa.value)));

  $('#mg-palco').replaceChildren(
    el('div', { class: 'mg-ajuste' },
      el('div', { class: 'mg-palco-corpo' }, palco),
      el('div', { class: 'mg-tam' },
        el('button', { type: 'button', title: 'Aumentar', onclick: () => tamanho(medida.w * 1.06) }, '+'),
        faixa,
        el('button', { type: 'button', title: 'Diminuir', onclick: () => tamanho(medida.w * 0.94) }, '−'))),
    el('p', { class: 'mg-dica' }, `Arraste a peça (${nomeDaPeca(peca)}) pela alça até o lugar certo.`),
    el('div', { class: 'mg-botoes-voto' },
      el('button', { type: 'button', class: 'mg-voto mg-voto-sim', onclick: () => {
        const m = ancoraNoMolde(CATEGORIAS[peca.cat].regiao, medida);
        enviar({ ancora: { x: m.x, y: m.y, w: m.w } });
      } }, ico('ok'), 'Pronto, ficou certo')));
  posicionar();
}

// ------------------------------ Preencher ---------------------------------
function jogoPreencher() {
  let cor = '';
  const campoMarca = el('input', { class: 'mg-marca', type: 'text', maxlength: '40',
    placeholder: 'Marca (deixe vazio se não souber)', list: 'mg-marcas' });
  const lista = el('datalist', { id: 'mg-marcas' },
    ...db.marcasOrdenadas().slice(0, 40).map(m => el('option', { value: m.nome })));
  const cores = el('div', { class: 'mg-cores' });
  const renderCores = () => cores.replaceChildren(...CORES.map(c => el('button', {
    type: 'button', class: 'mg-cor' + (c.nome === cor ? ' ativa' : ''), title: c.nome,
    style: { '--cor': c.hex === 'estampa' ? '#ccc' : c.hex },
    onclick: () => { cor = cor === c.nome ? '' : c.nome; renderCores(); },
  }, el('span', {}), c.nome)));
  renderCores();

  $('#mg-palco').replaceChildren(
    el('div', { class: 'mg-mesa mg-mesa-baixa' }, imagem(peca, 'mg-carta-img')),
    el('p', { class: 'mg-dica' }, 'Qual a cor principal?'), cores,
    campoMarca, lista,
    el('div', { class: 'mg-botoes' },
      el('button', { type: 'button', class: 'mg-pular', onclick: () => {
        estado[jogo].pecas.push(peca.id); proxima();
      } }, 'Pular'),
      el('button', { type: 'button', class: 'mg-btn mg-btn-sim', title: 'Enviar', onclick: () => {
        if (!cor && !campoMarca.value.trim()) return toast('Escolha a cor ou escreva a marca.', 'aviso');
        enviar({ cor, marca: campoMarca.value.trim() });
      } }, ico('ok'))));
}
