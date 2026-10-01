// Painéis redimensionáveis.
//
// Cada tela é uma linha flex: colunas de largura fixa nas laterais e uma área
// elástica no meio. Aqui um puxador fino é encostado na borda interna de cada
// coluna lateral; arrastando, a coluna muda de largura e o meio se acomoda.
//
// A largura fica gravada por painel (no navegador, não no estado do jogo) e é
// reaplicada na próxima visita. Duplo clique no puxador volta ao padrão.

const CHAVE = 'bd:v1:paineis';
const MIN_CENTRO = 300;        // o miolo nunca some para caber uma lateral

const PAINEIS = [
  // seletor                              borda do puxador   mín   máx
  { sel: '.view-closet .cat-rail',        lado: 'dir', min: 62,  max: 240 },
  { sel: '.view-closet .display-section', lado: 'esq', min: 210, max: 620 },
  { sel: '.view-stylist .stylist-palette',  lado: 'dir', min: 200, max: 520 },
  { sel: '.view-stylist .stylist-tools',    lado: 'esq', min: 180, max: 460 },
  { sel: '.view-board .board-palette',    lado: 'dir', min: 200, max: 520 },
  { sel: '.view-board .board-tools',      lado: 'esq', min: 190, max: 500 },
  { sel: '.view-social .feed-side',       lado: 'esq', min: 200, max: 560 },
];

const larguras = carregar();

function carregar() {
  try { return JSON.parse(localStorage.getItem(CHAVE)) || {}; }
  catch { return {}; }
}

function guardar() {
  try { localStorage.setItem(CHAVE, JSON.stringify(larguras)); } catch {}
}

// O vizinho elástico da mesma tela (o que tem flex-grow).
function miolo(painel) {
  const view = painel.closest('.view');
  if (!view) return null;
  return [...view.children].find(n =>
    n !== painel && parseFloat(getComputedStyle(n).flexGrow) > 0);
}

function limites(cfg, painel) {
  // Painel de tela escondida não tem layout: vale só a faixa configurada.
  // Quando a tela aparece, reavaliar() reaplica com as medidas reais.
  if (!painel.offsetParent) return { min: cfg.min, max: cfg.max };
  const centro = miolo(painel);
  const sobra = centro ? Math.max(0, centro.getBoundingClientRect().width - MIN_CENTRO) : 0;
  const atual = painel.getBoundingClientRect().width;
  return { min: cfg.min, max: Math.min(cfg.max, atual + sobra) };
}

function aplicar(cfg, painel, px, { salvar = true } = {}) {
  const { min, max } = limites(cfg, painel);
  const largura = Math.round(Math.min(max, Math.max(min, px)));
  painel.style.width = largura + 'px';
  if (salvar) { larguras[cfg.sel] = largura; guardar(); }
  return largura;
}

function instalar(cfg) {
  const painel = document.querySelector(cfg.sel);
  if (!painel || painel.dataset.redimensionavel) return;
  painel.dataset.redimensionavel = '1';
  painel.style.position = 'relative';

  // O padrão vem do CSS (funciona mesmo com a tela escondida), não do rect.
  const padrao = parseFloat(getComputedStyle(painel).width) || cfg.min;
  painel.dataset.larguraPadrao = String(Math.round(padrao));
  if (larguras[cfg.sel]) aplicar(cfg, painel, larguras[cfg.sel], { salvar: false });

  const puxador = document.createElement('div');
  puxador.className = `divisor divisor-${cfg.lado}`;
  puxador.title = 'Arraste para redimensionar · duplo clique volta ao padrão';
  painel.append(puxador);

  puxador.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const inicio = e.clientX;
    const larguraInicial = painel.getBoundingClientRect().width;
    puxador.setPointerCapture(e.pointerId);
    document.body.classList.add('redimensionando');
    puxador.classList.add('ativo');

    const mover = (ev) => {
      const delta = cfg.lado === 'dir' ? ev.clientX - inicio : inicio - ev.clientX;
      aplicar(cfg, painel, larguraInicial + delta);
    };
    const soltar = () => {
      document.body.classList.remove('redimensionando');
      puxador.classList.remove('ativo');
      puxador.removeEventListener('pointermove', mover);
      puxador.removeEventListener('pointerup', soltar);
      puxador.removeEventListener('pointercancel', soltar);
      // Avisa quem precisa recalcular (grade do closet, encaixe da prancheta).
      window.dispatchEvent(new Event('resize'));
    };
    puxador.addEventListener('pointermove', mover);
    puxador.addEventListener('pointerup', soltar);
    puxador.addEventListener('pointercancel', soltar);
  });

  puxador.addEventListener('dblclick', () => {
    painel.style.width = painel.dataset.larguraPadrao + 'px';
    delete larguras[cfg.sel];
    guardar();
    window.dispatchEvent(new Event('resize'));
  });
}

// Janela menor não pode deixar uma lateral salva espremendo o miolo: aqui as
// laterais devolvem o que falta, uma de cada vez, até o meio voltar ao mínimo.
function reavaliar() {
  for (const cfg of PAINEIS) {
    const painel = document.querySelector(cfg.sel);
    if (!painel || !painel.offsetParent) continue;
    const largura = painel.getBoundingClientRect().width;
    const centro = miolo(painel);
    const falta = centro ? MIN_CENTRO - centro.getBoundingClientRect().width : 0;
    // Falta espaço: a lateral devolve o que falta. Sobra espaço: ela volta à
    // largura que você escolheu (aplicar() já corta no que o miolo pode ceder).
    const desejada = larguras[cfg.sel] || Number(painel.dataset.larguraPadrao) || largura;
    aplicar(cfg, painel, falta > 0 ? largura - falta : desejada, { salvar: false });
  }
}

export function montarPaineis() {
  PAINEIS.forEach(instalar);
  let t;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(reavaliar, 200);
  });
  // Ao trocar de tela, os painéis que estavam escondidos ganham layout:
  // é a hora de conferir se a largura salva ainda cabe.
  window.addEventListener('hashchange', () => setTimeout(reavaliar, 60));
  reavaliar();
}

export const ajustarPaineisDaView = reavaliar;
