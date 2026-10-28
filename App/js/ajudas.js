// Mini games de ajuda: os jogadores ajudam a cadastrar as peças do acervo e
// ganham fichas por isso. Abre por Tarefas (#/ajudas).
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
import { catalogo, nomeDaPeca, srcGrande, proporcao } from './catalog.js';
import * as db from './db.js';
import { svgAvatar } from './avatar.js';
import { ancoraNoMolde } from './proporcao.js';
import { el, $, clamp, toast } from './util.js';
import { ico } from './icones.js';
import { irPara } from './router.js';

const JOGOS = [
  { id: 'avaliar', nome: 'Avaliar', icone: 'coracao', desc: 'Arraste: gostei ou não gostei.' },
  { id: 'ajustar', nome: 'Ajustar', icone: 'mover', desc: 'Encaixe a peça no corpo.' },
  { id: 'preencher', nome: 'Preencher', icone: 'editar', desc: 'Diga a cor e a marca.' },
];

let estado = null;        // resposta de GET /api/ajudas
let jogo = 'avaliar';
let peca = null;          // peça na tela
let enviando = false;

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
  $('#aj-voltar').addEventListener('click', () => irPara('tarefas'));
}

export async function aoEntrarNasAjudas() {
  renderAbas();
  $('#aj-palco').replaceChildren(el('p', { class: 'aj-vazio' }, 'Carregando…'));
  try {
    estado = (await chamar('/api/ajudas')).jogos;
  } catch {
    estado = null;
    $('#aj-palco').replaceChildren(el('p', { class: 'aj-vazio' },
      'Os mini games precisam de internet e da sua conta. Tente de novo daqui a pouco.'));
    return;
  }
  proxima();
}

function renderAbas() {
  $('#aj-abas').replaceChildren(...JOGOS.map(j => el('button', {
    type: 'button', class: 'aj-aba' + (j.id === jogo ? ' ativa' : ''),
    onclick: () => { jogo = j.id; renderAbas(); if (estado) proxima(); },
  }, ico(j.icone), el('span', {}, j.nome))));
  renderCota();
}

function renderCota() {
  const s = estado?.[jogo];
  const j = JOGOS.find(x => x.id === jogo);
  if (!s) { $('#aj-cota').textContent = j.desc; return; }
  const falta = s.porFicha - (s.feitas % s.porFicha);
  $('#aj-cota').replaceChildren(
    el('span', {}, j.desc),
    el('small', {}, `${s.feitas}/${s.limite} ${s.janela === 'hora' ? 'nesta hora' : 'hoje'}` +
      (s.feitas < s.limite ? ` · mais ${falta} para 1 ficha` : '')));
}

// A próxima peça: as mais novas primeiro, pulando as que a pessoa já ajudou.
function escolherPeca() {
  const feitas = new Set(estado[jogo].pecas);
  const cands = catalogo.itens.filter(i => !feitas.has(i.id) && CATEGORIAS[i.cat]);
  cands.sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')));
  // Entre as 10 mais novas, uma qualquer: duas pessoas ao mesmo tempo não
  // ficam votando sempre na mesma.
  return cands[Math.floor(Math.random() * Math.min(10, cands.length))] || null;
}

function proxima() {
  renderCota();
  const s = estado[jogo];
  if (s.feitas >= s.limite) {
    const vira = new Date(s.vira).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return $('#aj-palco').replaceChildren(el('p', { class: 'aj-vazio' },
      `Por ${s.janela === 'hora' ? 'esta hora' : 'hoje'} chega de ${JOGOS.find(j => j.id === jogo).nome.toLowerCase()}. ` +
      `Volta às ${vira}.`));
  }
  peca = escolherPeca();
  if (!peca) {
    return $('#aj-palco').replaceChildren(el('p', { class: 'aj-vazio' },
      'Você já ajudou em todas as peças deste jogo. Obrigado!'));
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
    }
  } catch (e) {
    toast(`Não deu para enviar: ${e.message}`, 'aviso');
  } finally {
    enviando = false;
  }
  proxima();
}

const imagem = (it, classe) => el('img', { class: classe, src: srcGrande(it), alt: nomeDaPeca(it), draggable: 'false' });

// ------------------------------- Avaliar ----------------------------------
function jogoAvaliar() {
  const carta = el('div', { class: 'aj-carta' }, imagem(peca, 'aj-carta-img'),
    el('span', { class: 'aj-selo aj-selo-nao' }, 'Não'),
    el('span', { class: 'aj-selo aj-selo-sim' }, 'Gostei'));
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

  $('#aj-palco').replaceChildren(
    el('div', { class: 'aj-mesa' }, carta),
    el('div', { class: 'aj-botoes' },
      el('button', { type: 'button', class: 'aj-btn aj-btn-nao', title: 'Não gostei', onclick: () => votar(false) }, ico('x')),
      el('button', { type: 'button', class: 'aj-btn aj-btn-sim', title: 'Gostei', onclick: () => votar(true) }, ico('coracao-cheio'))));
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
  const prop = proporcao(peca);
  const no = el('div', { class: 'aj-peca' }, imagem(peca, ''));
  const palco = el('div', { class: 'aj-corpo' });
  const boneco = el('div', { class: 'aj-boneco' });
  boneco.innerHTML = svgAvatar();
  palco.append(boneco);
  palco.append(no);
  const posicionar = () => {
    no.style.left = (medida.x / CONFIG.STAGE_W * 100) + '%';
    no.style.top = (medida.y / CONFIG.STAGE_H * 100) + '%';
    no.style.width = (medida.w / CONFIG.STAGE_W * 100) + '%';
    no.style.height = (medida.w / prop / CONFIG.STAGE_H * 100) + '%';
  };
  posicionar();

  let ini = null;
  no.addEventListener('pointerdown', (e) => {
    ini = { x: e.clientX, y: e.clientY, mx: medida.x, my: medida.y };
    no.setPointerCapture(e.pointerId);
  });
  no.addEventListener('pointermove', (e) => {
    if (!ini) return;
    const r = palco.getBoundingClientRect();
    medida.x = clamp(ini.mx + (e.clientX - ini.x) / r.width * CONFIG.STAGE_W, 0, CONFIG.STAGE_W);
    medida.y = clamp(ini.my + (e.clientY - ini.y) / r.height * CONFIG.STAGE_H, 0, CONFIG.STAGE_H);
    posicionar();
  });
  for (const t of ['pointerup', 'pointercancel']) no.addEventListener(t, () => { ini = null; });
  palco.addEventListener('wheel', (e) => {
    e.preventDefault();
    medida.w = clamp(medida.w * (e.deltaY < 0 ? 1.05 : 0.95), 20, 600);
    posicionar();
  }, { passive: false });

  const tamanho = (k) => { medida.w = clamp(medida.w * k, 20, 600); posicionar(); };
  $('#aj-palco').replaceChildren(
    el('p', { class: 'aj-dica' }, `Arraste ${nomeDaPeca(peca)} até o lugar certo e acerte o tamanho.`),
    el('div', { class: 'aj-mesa' }, palco),
    el('div', { class: 'aj-botoes' },
      el('button', { type: 'button', class: 'aj-btn', title: 'Menor', onclick: () => tamanho(0.94) }, ico('menos')),
      el('button', { type: 'button', class: 'aj-btn', title: 'Maior', onclick: () => tamanho(1.06) }, ico('mais')),
      el('button', { type: 'button', class: 'aj-btn aj-btn-sim', title: 'Pronto', onclick: () => {
        const m = ancoraNoMolde(CATEGORIAS[peca.cat].regiao, medida);
        enviar({ ancora: { x: m.x, y: m.y, w: m.w } });
      } }, ico('ok'))));
}

// ------------------------------ Preencher ---------------------------------
function jogoPreencher() {
  let cor = '';
  const campoMarca = el('input', { class: 'aj-marca', type: 'text', maxlength: '40',
    placeholder: 'Marca (deixe vazio se não souber)', list: 'aj-marcas' });
  const lista = el('datalist', { id: 'aj-marcas' },
    ...db.marcasOrdenadas().slice(0, 40).map(m => el('option', { value: m.nome })));
  const cores = el('div', { class: 'aj-cores' });
  const renderCores = () => cores.replaceChildren(...CORES.map(c => el('button', {
    type: 'button', class: 'aj-cor' + (c.nome === cor ? ' ativa' : ''), title: c.nome,
    style: { '--cor': c.hex === 'estampa' ? '#ccc' : c.hex },
    onclick: () => { cor = cor === c.nome ? '' : c.nome; renderCores(); },
  }, el('span', {}), c.nome)));
  renderCores();

  $('#aj-palco').replaceChildren(
    el('div', { class: 'aj-mesa aj-mesa-baixa' }, imagem(peca, 'aj-carta-img')),
    el('p', { class: 'aj-dica' }, 'Qual a cor principal?'), cores,
    campoMarca, lista,
    el('div', { class: 'aj-botoes' },
      el('button', { type: 'button', class: 'aj-pular', onclick: () => {
        estado[jogo].pecas.push(peca.id); proxima();
      } }, 'Pular'),
      el('button', { type: 'button', class: 'aj-btn aj-btn-sim', title: 'Enviar', onclick: () => {
        if (!cor && !campoMarca.value.trim()) return toast('Escolha a cor ou escreva a marca.', 'aviso');
        enviar({ cor, marca: campoMarca.value.trim() });
      } }, ico('ok'))));
}
