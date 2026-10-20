// Assinatura da pessoa: ela digita um texto ou envia uma imagem (fundo
// branco). A imagem enviada perde o fundo branco (fica só a tinta, que pode mudar de cor) e é reduzida para caber no save.
// Passa a assinar as colagens novas e os looks exportados, no lugar do nome da
// conta. O visual fica em css/perfil.css.

import * as db from './db.js';
import { el, toast } from './util.js';

const MAX_CARACTERES = 60;
const LARGURA_MAX = 700;   // px: de sobra para a colagem e o look

// { texto, imagem } em uso; os dois vazios = vale o nome da conta.
export function assinaturaDoUsuario() {
  const u = db.state.usuario;
  return { texto: u.assinaturaTexto || '', imagem: u.assinaturaImagem || '' };
}

// Quanto mais escuro o pixel, mais opaco; a tinta fica preta.
function tirarFundo(ctx, w, h) {
  const dados = ctx.getImageData(0, 0, w, h);
  const px = dados.data;
  for (let i = 0; i < px.length; i += 4) {
    const v = 255 - Math.min(px[i], px[i + 1], px[i + 2]);
    px[i] = px[i + 1] = px[i + 2] = 0;
    px[i + 3] = v < 25 ? 0 : Math.min(255, (v - 25) * 255 / 150);
  }
  ctx.putImageData(dados, 0, 0);
}

// Assinatura enviada antes de o fundo sair ainda tem a caixa branca: trata uma vez.
export function tratarAssinaturaAntiga() {
  const u = db.state.usuario;
  if (!u.assinaturaImagem) return;
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    if (a < 200 || Math.min(r, g, b) < 200) return;   // já transparente
    tirarFundo(ctx, c.width, c.height);
    u.assinaturaImagem = c.toDataURL('image/png');
    db.salvar();
  };
  img.src = u.assinaturaImagem;
}

// Pinta a tinta de outra cor mantendo a transparência.
function recolorir(src, cor) {
  return new Promise((ok) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = cor;
      ctx.fillRect(0, 0, c.width, c.height);
      ok(c.toDataURL('image/png'));
    };
    img.src = src;
  });
}

function lerImagem(arquivo) {
  return new Promise((ok, erro) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, LARGURA_MAX / img.naturalWidth);
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      // Tira o fundo branco: quanto mais escuro o pixel, mais opaco. A tinta
      // fica preta e transparente em volta; a cor vem depois (recolorir).
      tirarFundo(ctx, c.width, c.height);
      ok(c.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); erro(new Error('imagem inválida')); };
    img.src = url;
  });
}

export function abrirAssinaturas(aoMudar = () => {}) {
  const u = db.state.usuario;
  let imagem = u.assinaturaImagem || '';

  const campo = el('input', {
    class: 'pergunta-campo', type: 'text', autocomplete: 'off', maxlength: MAX_CARACTERES,
    placeholder: 'Digite a sua assinatura', value: u.assinaturaTexto || '',
  });
  const cor = el('input', { type: 'color', value: '#1a1a1a', title: 'Cor da tinta' });
  const rotuloCor = el('label', { class: 'ass-cor' }, 'Cor da tinta ', cor);
  cor.addEventListener('input', async () => { if (imagem) { imagem = await recolorir(imagem, cor.value); desenhar(); } });
  const previa = el('img', { class: 'ass-previa', alt: 'Assinatura enviada' });
  const remover = el('button', { class: 'btn-ghost', type: 'button' }, 'Remover imagem');
  const arquivo = el('input', { type: 'file', accept: 'image/*', hidden: true });
  const enviar = el('button', { class: 'btn-ghost', type: 'button', onclick: () => arquivo.click() }, 'Enviar imagem');
  const cancelar = el('button', { class: 'btn-ghost', type: 'button' }, 'Cancelar');
  const salvar = el('button', { class: 'btn-dark', type: 'button' }, 'Salvar');

  const desenhar = () => {
    previa.hidden = remover.hidden = rotuloCor.hidden = !imagem;
    if (imagem) previa.src = imagem;
    campo.disabled = !!imagem;
  };

  arquivo.addEventListener('change', async () => {
    const f = arquivo.files[0];
    arquivo.value = '';
    if (!f) return;
    try {
      imagem = await recolorir(await lerImagem(f), cor.value);
      campo.value = '';
      desenhar();
    } catch {
      toast('Não consegui abrir essa imagem.', 'aviso');
    }
  });
  remover.addEventListener('click', () => { imagem = ''; desenhar(); campo.focus(); });

  const fundo = el('div', { class: 'modal pergunta' },
    el('div', { class: 'modal-caixa pergunta-caixa ass-caixa', role: 'dialog', 'aria-modal': 'true' },
      el('h2', { class: 'pergunta-titulo' }, 'Minha assinatura'),
      el('p', { class: 'pergunta-texto' },
        'Digite o texto ou envie uma imagem em fundo branco: o branco some e a assinatura combina com o fundo da colagem ou do look. Ela assina as colagens novas e os looks que você compartilha.'),
      campo,
      el('div', { class: 'ass-linha' }, enviar, remover, rotuloCor, arquivo),
      previa,
      el('div', { class: 'pergunta-botoes' }, cancelar, salvar)));

  const fechar = () => { fundo.remove(); document.body.classList.remove('com-modal'); };
  cancelar.addEventListener('click', fechar);
  fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
  campo.addEventListener('keydown', (e) => { if (e.key === 'Enter') salvar.click(); });
  salvar.addEventListener('click', () => {
    u.assinaturaImagem = imagem;
    u.assinaturaTexto = imagem ? '' : campo.value.trim().slice(0, MAX_CARACTERES);
    db.salvar();
    fechar();
    aoMudar();
    toast(imagem || u.assinaturaTexto ? 'Assinatura salva.' : 'Assinatura removida: volta o nome da conta.');
  });

  document.body.append(fundo);
  document.body.classList.add('com-modal');
  desenhar();
  (imagem ? enviar : campo).focus();
}
