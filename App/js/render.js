// Renderiza um look (avatar + camadas) num canvas.
//
// Serve para dois fins: as miniaturas do feed e a exportação para o Instagram
// (Story 1080×1920 e Post 1080×1350), como no "gerador de assets para social".

import { CONFIG, BOARD, CATEGORIAS, ancoraDaPeca } from './config.js';
import { doPadraoParaAtual } from './proporcao.js';
import { item as pecaDoCatalogo, proporcao, srcGrande } from './catalog.js';
import { avatarDataURL, aparenciaAtual } from './avatar.js';
import { alturaDe, posAssinatura, fonteCss } from './boardgeo.js';

export const FORMATOS = {
  story: { w: 1080, h: 1920, nome: 'story' },
  post:  { w: 1080, h: 1350, nome: 'post'  },
  thumb: { w: 360,  h: 600,  nome: 'thumb' },
  feed:  { w: 720,  h: 1200, nome: 'feed'  },   // ver imagemDoFeed
};

const cacheImgs = new Map();

function carregarImagem(src) {
  if (cacheImgs.has(src)) return cacheImgs.get(src);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
  cacheImgs.set(src, p);
  return p;
}

function fundoPapel(ctx, w, h) {
  ctx.fillStyle = '#fdfaf6';
  ctx.fillRect(0, 0, w, h);
  const passo = Math.round(w / 26);
  ctx.fillStyle = 'rgba(0,0,0,.055)';
  for (let y = passo; y < h; y += passo) {
    for (let x = passo; x < w; x += passo) {
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1, w / 900), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export async function renderizarLook(camadas, opts = {}) {
  const {
    formato = 'thumb', fundo = true, assinatura = null,
    avatar = true, guia = false, aparencia = null,
  } = opts;
  const { w, h } = FORMATOS[formato] || FORMATOS.thumb;

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');

  if (fundo) fundoPapel(ctx, w, h); else ctx.clearRect(0, 0, w, h);

  const margemV = assinatura != null ? 0.80 : 0.92;
  const escala = Math.min((w * 0.92) / CONFIG.STAGE_W, (h * margemV) / CONFIG.STAGE_H);
  const larg = CONFIG.STAGE_W * escala;
  const alt = CONFIG.STAGE_H * escala;
  const ox = (w - larg) / 2;
  const oy = (h - alt) / 2 - (assinatura != null ? h * 0.03 : 0);

  const paraTela = (ux, uy) => [ox + ux * escala, oy + uy * escala];

  if (avatar) {
    const av = await carregarImagem(avatarDataURL({ guia, aparencia }));
    ctx.drawImage(av, ox, oy, larg, alt);
  }

  const ordenadas = [...camadas].sort((a, b) => a.z - b.z);
  for (const c of ordenadas) {
    const peca = pecaDoCatalogo(c.itemId);
    if (!peca) continue;
    let img;
    try { img = await carregarImagem(srcGrande(peca)); } catch { continue; }

    const larguraUnidades = ancoraDaPeca(peca).w * (c.escala ?? 1);
    const lw = larguraUnidades * escala;
    const lh = lw / proporcao(peca);
    // Look gravado está no boneco de verdade; o desenho é no de agora.
    const p = doPadraoParaAtual(CATEGORIAS[peca.cat]?.regiao, c);
    const [cx, cy] = paraTela(p.x, p.y);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((c.rot || 0) * Math.PI / 180);
    ctx.scale(c.flip ? -1 : 1, 1);
    ctx.drawImage(img, -lw / 2, -lh / 2, lw, lh);
    ctx.restore();
  }

  // Sem nome, sai sem nada embaixo (sem marca d'água).
  if (assinatura != null) {
    ctx.fillStyle = '#1a1a1a';
    ctx.textAlign = 'center';
    ctx.font = `600 ${Math.round(w * 0.032)}px 'Segoe UI', Helvetica, Arial, sans-serif`;
    if (assinatura.trim()) ctx.fillText(assinatura, w / 2, h - Math.round(h * 0.062));
  }

  return canvas;
}

export async function miniatura(camadas, aparencia = null) {
  const canvas = await renderizarLook(camadas, { formato: 'thumb', fundo: true, aparencia });
  try { return canvas.toDataURL('image/webp', 0.72); }
  catch { return canvas.toDataURL('image/jpeg', 0.7); }
}

// A miniatura de um look salvo desenhada com o personagem de agora, não a
// imagem guardada no save: trocou o cabelo ou o corpo, os looks acompanham.
// Fica na memória por (aparência + camadas), então reabrir a lista não refaz
// nada; `pronta` devolve na hora a que já existe, para o cartão não piscar.
const lookDesenhado = new Map();
const chaveDoLook = (camadas) => JSON.stringify([aparenciaAtual(), camadas]);

export const miniaturaPronta = (camadas) => lookDesenhado.get(chaveDoLook(camadas))?.url || null;

export function miniaturaAtual(camadas) {
  const chave = chaveDoLook(camadas);
  let feita = lookDesenhado.get(chave);
  if (!feita) {
    feita = { promessa: miniatura(camadas) };
    lookDesenhado.set(chave, feita);
    feita.promessa.then(url => { feita.url = url; }, () => lookDesenhado.delete(chave));
  }
  return feita.promessa;
}

// O look solto, sem fundo: o boneco inteiro com as roupas e nada em volta. É
// como os looks aparecem no perfil (o seu e o dos outros). `aparencia` nula é
// o seu personagem de agora; a de outra pessoa desenha o look dela.
const soltoDesenhado = new Map();

export function miniaturaSoltaAtual(camadas, aparencia = null) {
  const chave = JSON.stringify([aparencia || aparenciaAtual(), camadas]);
  let feita = soltoDesenhado.get(chave);
  if (!feita) {
    feita = {
      promessa: renderizarLook(camadas, { formato: 'thumb', fundo: false, aparencia })
        .then(canvas => {
          // webp guarda o transparente; o jpeg de reserva, não — fica no branco.
          try {
            const url = canvas.toDataURL('image/webp', 0.8);
            if (url.startsWith('data:image/webp')) return url;
          } catch {}
          return canvas.toDataURL('image/png');
        }),
    };
    soltoDesenhado.set(chave, feita);
    feita.promessa.then(url => { feita.url = url; }, () => soltoDesenhado.delete(chave));
  }
  return feita.promessa;
}

export const miniaturaSoltaPronta = (camadas, aparencia = null) =>
  soltoDesenhado.get(JSON.stringify([aparencia || aparenciaAtual(), camadas]))?.url || null;

// A imagem do post no feed. A coluna do mural tem ~320 px, e em tela de alta
// densidade isso é o dobro: a miniatura (360 px, bem comprimida) borra. Esta
// sai com o dobro da largura e menos compressão — só para o feed, porque não
// cabe no save do navegador; quem guarda é o servidor (ou a memória, nos
// perfis de exemplo).
const FEED_ESCALA_COLAGEM = 0.68;           // 1080 × 0,68 ≈ 734 px de largura
const FEED_QUALIDADE = 0.86;

const comoWebp = (canvas, qualidade) => {
  try { return canvas.toDataURL('image/webp', qualidade); }
  catch { return canvas.toDataURL('image/jpeg', qualidade); }
};

export async function imagemDoFeed(camadas, aparencia = null) {
  const canvas = await renderizarLook(camadas, { formato: 'feed', fundo: true, aparencia });
  return comoWebp(canvas, FEED_QUALIDADE);
}

export async function imagemDoFeedColagem(board) {
  await fontesDaColagem(board);
  const canvas = await renderizarBoard(board, { escala: FEED_ESCALA_COLAGEM });
  return comoWebp(canvas, FEED_QUALIDADE);
}

// Devolve { blob, nome } do PNG (para baixar ou para a folha de compartilhar).
export async function imagemDoLook(camadas, formato, nomeLook) {
  const canvas = await renderizarLook(camadas, {
    formato, fundo: true, assinatura: nomeLook?.trim() || null,
  });
  return {
    blob: await new Promise((ok) => canvas.toBlob(ok, 'image/png')),
    nome: `brecho-${(nomeLook || 'look').toLowerCase().replace(/\s+/g, '-')}-${formato}.png`,
  };
}

export async function baixarLook(camadas, formato, nomeLook) {
  const { blob, nome } = await imagemDoLook(camadas, formato, nomeLook);
  baixarArquivo(blob, nome);
}

export function baixarArquivo(blob, nome) {
  const a = document.createElement('a');
  a.download = nome;
  a.href = URL.createObjectURL(blob);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ============================ COLAGEM (BOARD) ============================
// Mesmo desenho da tela, só que em pixels de exportação.

export async function renderizarBoard(board, { escala = 1 } = {}) {
  const W = BOARD.W;
  const H = alturaDe(board.formato);
  const [ew, eh] = (BOARD.FORMATOS[board.formato] || BOARD.FORMATOS['4:5']).export;
  const largura = Math.round(ew * escala);
  const k = largura / W;                       // pixels por unidade

  const canvas = document.createElement('canvas');
  canvas.width = largura;
  canvas.height = Math.round(H * k);
  const ctx = canvas.getContext('2d');

  // O fundo da colagem é branco, sempre — igual ao da tela.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W * k, H * k);

  for (const it of [...board.itens].sort((a, b) => a.z - b.z)) {
    // Etiqueta de texto
    if (it.tipo === 'texto') {
      ctx.save();
      ctx.globalAlpha = (it.opacidade ?? 100) / 100;
      ctx.translate(it.x * k, it.y * k);
      ctx.rotate((it.rot || 0) * Math.PI / 180);
      ctx.fillStyle = it.cor;
      ctx.font = `${it.tamanho * k}px ${fonteCss(it.fonte)}`;
      ctx.textAlign = 'center';
      // Na tela a etiqueta é um span com line-height 1 centrado na caixa: a
      // linha de base fica (ascendente - descendente) / 2 abaixo do centro.
      // O 'middle' do canvas punha o texto um pouco mais alto que na tela.
      ctx.textBaseline = 'alphabetic';
      const m = ctx.measureText(it.texto || ' ');
      const base = m.fontBoundingBoxAscent !== undefined
        ? (m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2 : it.tamanho * k * 0.35;
      ctx.fillText(it.texto || '', 0, base);
      ctx.restore();
      continue;
    }

    const peca = pecaDoCatalogo(it.itemId);
    if (!peca) continue;
    let img;
    try { img = await carregarImagem(srcGrande(peca)); } catch { continue; }

    const w = it.w * k;
    const h = w / proporcao(peca);
    ctx.save();
    ctx.globalAlpha = (it.opacidade ?? 100) / 100;
    ctx.translate(it.x * k, it.y * k);
    ctx.rotate((it.rot || 0) * Math.PI / 180);
    ctx.scale(it.flip ? -1 : 1, 1);
    if (it.sombra) {
      ctx.shadowColor = 'rgba(0,0,0,.22)';
      ctx.shadowBlur = 16 * k;
      ctx.shadowOffsetY = 10 * k;
    }
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  const a = board.assinatura;
  if (a?.visivel && a.texto?.trim()) {
    const p = posAssinatura(board, W, H);
    ctx.fillStyle = a.cor;
    ctx.font = `${a.tamanho * k}px ${fonteCss(a.fonte)}`;
    ctx.textAlign = p.align === 'centro' ? 'center' : (p.align === 'direita' ? 'right' : 'left');
    ctx.textBaseline = 'alphabetic';
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = `${a.espaco * k}px`;
    ctx.fillText(a.texto, p.x * k, p.y * k);
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px';
  }

  return canvas;
}

export async function miniaturaBoard(board) {
  await fontesDaColagem(board);
  const canvas = await renderizarBoard(board, { escala: 0.34 });
  try { return canvas.toDataURL('image/webp', 0.72); }
  catch { return canvas.toDataURL('image/jpeg', 0.7); }
}

// Antes de desenhar texto no canvas, as fontes da colagem precisam ter
// chegado: senão a etiqueta sai na fonte reserva do sistema.
export async function fontesDaColagem(board) {
  if (!document.fonts?.load) return;
  const ids = new Set([board.assinatura?.fonte, ...board.itens.filter(i => i.tipo === 'texto').map(i => i.fonte)]);
  await Promise.all([...ids].filter(Boolean).map(id =>
    document.fonts.load(`40px ${fonteCss(id)}`).catch(() => null)));
}

// `story`: a colagem (4:5) no meio de um Story 1080×1920 de fundo branco.
export async function imagemDoBoard(board, { escala = 1, story = false } = {}) {
  await fontesDaColagem(board);
  let canvas = await renderizarBoard(board, { escala });
  if (story) {
    const s = document.createElement('canvas');
    s.width = 1080; s.height = 1920;
    const ctx = s.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, s.width, s.height);
    const h = canvas.height * (s.width / canvas.width);
    ctx.drawImage(canvas, 0, (s.height - h) / 2, s.width, h);
    canvas = s;
  }
  const nome = (board.nome || 'colagem').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return {
    blob: await new Promise((ok) => canvas.toBlob(ok, 'image/png')),
    nome: `brecho-${nome}-${canvas.width}x${canvas.height}.png`,
  };
}

export async function baixarBoard(board, opcoes) {
  const { blob, nome } = await imagemDoBoard(board, opcoes);
  baixarArquivo(blob, nome);
}
