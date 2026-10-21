// Editar personagem: tom de pele, corte e cor do cabelo, nariz, sobrancelha,
// brincos e spikes.
//
// O avatar é um SVG desenhado em código (js/avatar.js), então mudar a aparência
// é mudar quatro valores no perfil. A prévia aqui é o mesmo desenho que o
// Stylist, a prancheta e as imagens exportadas usam — não existe uma versão
// "de preview". O rosto tem só o nariz: sem olhos nem boca, a cabeça fica sendo
// silhueta, e uma pele verde ou um focinho não viram uma careta.

import {
  PELES, CORES_CABELO, APARENCIA_PADRAO, CORES_FAVORITAS, SOBRANCELHAS_NO_AR,
  BRINCOS, SPIKES,
} from './config.js';
import { darTrioDaCor } from './presente.js';
import { aplicarPaleta, paletaDaCor } from './paleta.js';
import * as db from './db.js';
import {
  svgAvatar, resolverAparencia, catalogoCorpos, catalogoNarizes, catalogoCabelos,
  catalogoSobrancelhas, brincosDasOrelhas,
} from './avatar.js';
import { recorteNaRegiao } from './proporcao.js';
import { el, $, toast } from './util.js';
import { irPara } from './router.js';

// Trabalha numa cópia: só vai para o perfil quando você salva.
let rascunho = null;
let corFavorita = null;   // fora do avatar: é da pessoa, não do boneco

const aparenciaDoRascunho = () => {
  const pele = PELES.find(p => p.id === rascunho.pele) || PELES[1];
  return {
    corpo: rascunho.corpo,
    pele: pele.cor,
    traco: pele.traco,
    cabelo: rascunho.cabelo,
    corCabelo: rascunho.corCabelo,
    nariz: rascunho.nariz,
    sobrancelha: rascunho.sobrancelha,
    corSobrancelha: rascunho.corSobrancelha,
    brincoEsq: rascunho.brincoEsq,
    brincoDir: rascunho.brincoDir,
    spikeEsq: rascunho.spikeEsq,
    spikeDir: rascunho.spikeDir,
  };
};

// Enquadramentos das miniaturas, no sistema do palco (600×1200): o corte
// precisa da cabeça com folga para os cabelos longos e para o afro e o coque,
// que passam do alto do palco; o nariz, da cara. Os
// dois da cabeça são medidos no molde e seguem a cabeça na proporção de agora.
const CROP_CORPO = [148, 18, 304, 716];
const CROP_CABELO = recorteNaRegiao('cabeca', [180, -12, 240, 258]);
const CROP_NARIZ = recorteNaRegiao('cabeca', [234, 34, 132, 162]);
const CROP_SOBRANCELHA = recorteNaRegiao('cabeca', [248, 72, 104, 60]);
// Brincos: cada orelha de perto, já no palco, como a orelha da artista em que
// eles ficam (a direita é a esquerda espelhada em x=300).
const CROP_ORELHA_ESQ = [198, 126, 52, 56];
const CROP_ORELHA_DIR = [600 - 198 - 52, 126, 52, 56];
// Os spikes ficam no alto da orelha e saem dela: o quadro sobe um pouco.
const CROP_SPIKE_ESQ = [198, 120, 52, 56];
const CROP_SPIKE_DIR = [600 - 198 - 52, 120, 52, 56];

// Zoom no rosto: mexendo em nariz, sobrancelha ou orelhas, a prévia chega
// perto da cabeça (no palco, já na cabeça da artista) para ver o detalhe.
// O SVG é o mesmo; só o viewBox desliza de um enquadramento para o outro.
const ABAS_DO_ROSTO = new Set(['nariz', 'sobrancelha', 'orelha-esq', 'orelha-dir']);
const PALCO_INTEIRO = [0, 0, 600, 1200];
const CROP_ROSTO = [170, -20, 260, 300];
let noRosto = false;
let caixaDaPrevia = null;   // o viewBox de agora, para o próximo zoom partir dele
let animacao = 0;

function enquadrar(svg) {
  const alvo = noRosto ? CROP_ROSTO : PALCO_INTEIRO;
  const de = caixaDaPrevia || alvo;
  const aplicar = (caixa) => {
    caixaDaPrevia = caixa;
    svg.setAttribute('viewBox', caixa.map(v => v.toFixed(1)).join(' '));
    // No corpo inteiro o cabelo alto pode sair da caixa; de perto, o resto
    // do corpo não pode vazar para fora da moldura.
    svg.setAttribute('overflow', caixa === PALCO_INTEIRO ? 'visible' : 'hidden');
  };
  $('#pg-previa').classList.toggle('de-perto', noRosto);
  cancelAnimationFrame(animacao);
  if (de === alvo) { aplicar(alvo); return; }
  const inicio = performance.now();
  const passo = (agora) => {
    const t = Math.min(1, (agora - inicio) / 280);
    const k = 1 - (1 - t) ** 3;
    aplicar(t === 1 ? alvo : de.map((v, i) => v + (alvo[i] - v) * k));
    if (t < 1) animacao = requestAnimationFrame(passo);
  };
  animacao = requestAnimationFrame(passo);
}

// "brincos 2 + 1 · spikes 0 + 3": esquerda e direita, como na tela.
function resumoBrincos() {
  const par = (nome, cat, esq, dir) => {
    const e = cat[rascunho[esq]]?.qtd || 0, d = cat[rascunho[dir]]?.qtd || 0;
    return e || d ? ` · ${nome} ${e} + ${d}` : '';
  };
  return par('brincos', BRINCOS, 'brincoEsq', 'brincoDir') +
    par('spikes', SPIKES, 'spikeEsq', 'spikeDir');
}

function renderPrevia() {
  $('#pg-previa').innerHTML = svgAvatar({ aparencia: aparenciaDoRascunho() });
  enquadrar($('#pg-previa svg'));
  $('#pg-resumo').textContent =
    `${catalogoCorpos()[rascunho.corpo]?.nome ?? '—'} · ` +
    `${PELES.find(p => p.id === rascunho.pele)?.nome ?? '—'} · ` +
    `${catalogoCabelos()[rascunho.cabelo]?.nome ?? '—'} · ` +
    `nariz ${(catalogoNarizes()[rascunho.nariz]?.nome ?? '—').toLowerCase()}` +
    resumoBrincos() +
    (SOBRANCELHAS_NO_AR ? ` · ${catalogoSobrancelhas()[rascunho.sobrancelha]?.nome ?? '—'}` : '');
}

// Humana e fantasia na mesma grade: quem edita está escolhendo uma cor, não
// uma espécie. O grupo continua existindo em config.js só para o sorteio dos
// perfis do feed.
function renderPeles() {
  const caixa = $('#pg-peles');
  caixa.innerHTML = '';
  for (const p of PELES) {
    caixa.append(el('button', {
      class: 'pg-swatch' + (p.id === rascunho.pele ? ' ativa' : ''),
      title: p.nome,
      style: { background: p.cor, borderColor: p.traco },
      onclick: () => { rascunho.pele = p.id; renderTudo(); },
    }));
  }
}

// Miniaturas: o próprio avatar recortado, com o resto da aparência do rascunho.
// Escolher por desenho é mais rápido do que por nome — e o nome fica embaixo
// para quem quiser conferir. `extra` muda mais alguma coisa só na miniatura.
function renderMiniaturas(seletor, ordem, catalogo, campo, recorte, extra = {}) {
  const caixa = $(seletor);
  caixa.innerHTML = '';
  for (const id of ordem) {
    const arte = el('span', { class: 'pg-corte-arte' });
    arte.innerHTML = svgAvatar({
      aparencia: { ...aparenciaDoRascunho(), ...extra, [campo]: id },
      recorte,
    });
    caixa.append(el('button', {
      class: 'pg-corte' + (id === rascunho[campo] ? ' ativa' : ''),
      title: catalogo[id].nome,
      onclick: () => { rascunho[campo] = id; renderTudo(); },
    }, arte, el('small', {}, catalogo[id].nome)));
  }
}

// Cor da sobrancelha: a primeira bolinha é "igual ao cabelo" (vazio), que
// acompanha o cabelo quando ele muda de cor.
function renderCoresSobrancelha() {
  const caixa = $('#pg-cores-sobrancelha');
  caixa.innerHTML = '';
  for (const cor of ['', ...CORES_CABELO]) {
    caixa.append(el('button', {
      class: 'pg-swatch redonda' + (cor ? '' : ' igual') +
        (cor === (rascunho.corSobrancelha || '') ? ' ativa' : ''),
      title: cor ? '' : 'Igual ao cabelo',
      style: { background: cor || rascunho.corCabelo },
      onclick: () => { rascunho.corSobrancelha = cor; renderTudo(); },
    }));
  }
}

function renderCores() {
  const caixa = $('#pg-cores');
  caixa.innerHTML = '';
  for (const cor of CORES_CABELO) {
    caixa.append(el('button', {
      class: 'pg-swatch redonda' + (cor === rascunho.corCabelo ? ' ativa' : ''),
      style: { background: cor },
      onclick: () => { rascunho.corCabelo = cor; renderTudo(); },
    }));
  }
}

// A cor favorita: as cores que têm coleção, em bolinhas com o nome embaixo.
function renderFavoritas() {
  $('#pg-favoritas').replaceChildren(...CORES_FAVORITAS.map(({ nome, hex }) =>
    el('button', {
      type: 'button', class: 'pg-fav' + (nome === corFavorita ? ' ativa' : ''), title: nome,
      onclick: () => { corFavorita = nome; renderFavoritas(); },
    }, el('span', { class: 'pg-fav-cor', style: { background: hex } }), el('small', {}, nome))));
}

function renderTudo() {
  renderFavoritas();
  renderPrevia();
  const corpos = catalogoCorpos(), narizes = catalogoNarizes(), cortes = catalogoCabelos();
  renderMiniaturas('#pg-corpos', Object.keys(corpos), corpos, 'corpo', CROP_CORPO);
  renderPeles();
  renderCores();
  renderMiniaturas('#pg-cortes', Object.keys(cortes), cortes, 'cabelo', CROP_CABELO);
  renderMiniaturas('#pg-narizes', Object.keys(narizes), narizes, 'nariz', CROP_NARIZ);
  // Brincos, uma aba por orelha: sem cabelo na miniatura, que o comprido
  // cobre a orelha.
  renderMiniaturas('#pg-brincos-esq', Object.keys(BRINCOS), BRINCOS, 'brincoEsq',
    CROP_ORELHA_ESQ, { cabelo: 'nenhum' });
  renderMiniaturas('#pg-brincos-dir', Object.keys(BRINCOS), BRINCOS, 'brincoDir',
    CROP_ORELHA_DIR, { cabelo: 'nenhum' });
  renderMiniaturas('#pg-spikes-esq', Object.keys(SPIKES), SPIKES, 'spikeEsq',
    CROP_SPIKE_ESQ, { cabelo: 'nenhum' });
  renderMiniaturas('#pg-spikes-dir', Object.keys(SPIKES), SPIKES, 'spikeDir',
    CROP_SPIKE_DIR, { cabelo: 'nenhum' });
  // Sobrancelha: formato e cor na mesma aba.
  if (!SOBRANCELHAS_NO_AR) return;
  const sobrancelhas = catalogoSobrancelhas();
  renderMiniaturas('#pg-sobrancelhas', Object.keys(sobrancelhas), sobrancelhas, 'sobrancelha',
    CROP_SOBRANCELHA);
  renderCoresSobrancelha();
}

function abrirAba(aba) {
  const painel = $('.pg-painel');
  painel.dataset.aba = aba;
  for (const x of $('#pg-abas').children) x.classList.toggle('ativa', x.dataset.aba === aba);
  noRosto = ABAS_DO_ROSTO.has(aba);
  renderPrevia();
}

function salvar() {
  // A cor favorita é obrigatória: é ela que dá as três primeiras peças.
  if (!corFavorita) {
    abrirAba('favorita');
    $('.pg-bloco[data-aba="favorita"]').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    toast('Escolha sua cor favorita.', 'aviso');
    return;
  }
  db.state.usuario.avatar = { ...rascunho };
  // Cor favorita nova pinta o site com a paleta dela (dá para trocar no Perfil).
  if (corFavorita !== (db.state.usuario.corFavorita || null)) {
    db.state.usuario.preferencias.paleta = aplicarPaleta(paletaDaCor(corFavorita));
  }
  db.state.usuario.corFavorita = corFavorita;
  // As três peças da cor favorita (o primeiro marco da coleção dela). Na conta
  // nova é aqui que elas entram; no tutorial recomeçado, entram de novo se a
  // cor mudou, para a missão das coleções falar da cor favorita.
  if (!db.state.presenteCor || (db.introAtiva() && db.state.presenteCor !== corFavorita)) {
    darTrioDaCor({ cor: corFavorita });
  }
  db.progredirMissao('personagem');
  db.salvar();
  toast('Personagem salvo.');
  irPara('perfil');
}

// A aba Roupas leva ao vestiário. Só aparece depois do tutorial: durante ele,
// esta tela é só o corpo, e a hora de vestir vem depois, na missão própria.
// Com mudança não salva, pede para salvar antes, para não jogar fora.
function irParaRoupas() {
  const salvo = { ...APARENCIA_PADRAO, ...db.state.usuario.avatar };
  const mudou = Object.keys(rascunho).some(k => rascunho[k] !== salvo[k]) ||
    corFavorita !== (db.state.usuario.corFavorita || null);
  if (mudou) { toast('Salve o personagem antes de se vestir.', 'aviso'); return; }
  irPara('vestiario');
}

export function aoEntrarNoPersonagem() {
  rascunho = { ...APARENCIA_PADRAO, ...db.state.usuario.avatar };
  Object.assign(rascunho, brincosDasOrelhas(db.state.usuario.avatar));
  delete rascunho.brincos;
  delete rascunho.ladoBrincos;
  // Corte de código que saiu do catálogo já abre marcado no parecido.
  rascunho.cabelo = resolverAparencia(rascunho).cabelo;
  corFavorita = db.state.usuario.corFavorita || null;
  noRosto = ABAS_DO_ROSTO.has($('.pg-painel').dataset.aba);
  caixaDaPrevia = null;
  $('#pg-abas [data-aba="roupas"]').hidden = db.introAtiva();
  renderTudo();
}

export function montarPersonagem() {
  $('#pg-salvar').addEventListener('click', salvar);
  // Sobrancelhas fora do ar: a aba e o bloco saem da tela (config.js).
  if (!SOBRANCELHAS_NO_AR) {
    document.querySelectorAll('.view-personagem [data-aba="sobrancelha"]').forEach(x => x.remove());
  }
  // Abas do celular: o painel mostra só a parte escolhida (ver mobile.css).
  const painel = $('.pg-painel');
  painel.dataset.aba = 'corpo';
  // No computador não tem aba: o zoom segue o bloco em que a pessoa clicou.
  // Na captura, antes do botão redesenhar o painel e sair da página.
  painel.addEventListener('click', (e) => {
    const bloco = e.target.closest('.pg-bloco');
    if (!bloco || noRosto === ABAS_DO_ROSTO.has(bloco.dataset.aba)) return;
    noRosto = !noRosto;
    renderPrevia();
  }, true);
  $('#pg-abas').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-aba]');
    if (!b) return;
    if (b.dataset.aba === 'roupas') { irParaRoupas(); return; }
    abrirAba(b.dataset.aba);
  });
  $('#pg-voltar').addEventListener('click', () => irPara('perfil'));
  $('#pg-padrao').addEventListener('click', () => {
    rascunho = { ...APARENCIA_PADRAO };
    renderTudo();
  });
}
