// Admin › Roupas do avatar: cadastra as roupas desenhadas que entram nas
// coleções (e por elas dão o efeito da coleção), sem mexer no código. Escolhe
// a imagem, o tamanho, a posição no palco 600×1200 e as coleções; a Lambda
// grava em acervo.json › roupasAvatar (nuvem/lambda/roupasavatar.py) e o jogo
// monta uma peça por coleção marcada (roupinhas.js). Os óculos que já estão no
// código (OCULOS_DESENHADOS) continuam lá e não aparecem aqui.

import { CONFIG, COLECOES, COLECOES_DE_COR, ROUPAS_BASE, OCULOS_ESPINHOS, hexDaCor, idDaCor } from './config.js';
import { SLOTS, ROUPINHA } from './roupinhas.js';
import { lerAcervo } from './roupasavatar.js';
import { svgAvatar } from './avatar.js';
import { el, $, toast } from './util.js';

const PREVIA = 'previa-admin';
const W = CONFIG.STAGE_W, H = CONFIG.STAGE_H;

// Onde uma roupa nova começa, por lugar do corpo: [x, y, w, h] no palco.
const base = (id) => ROUPAS_BASE.find(b => b.id === id)?.caixa;
const CAIXA_INICIAL = {
  acessorio: OCULOS_ESPINHOS.caixa,
  cabeca: [200, 20, 200, 140],
  torso: base('camiseta') || [147, 241, 305, 229],
  pernas: base('calca') || [169, 498, 263, 572],
  pes: base('tenis') || [179, 989, 242, 160],
  cintura: [170, 480, 260, 140],
};
// A roupa base preta, para ver a peça nova por cima de alguém vestido.
const VESTIDO = { torso: 'camiseta-base-preto', pernas: 'calca-base-preto', pes: 'tenis-base-preto' };

const COLECOES_DA_TELA = [
  ...Object.keys(COLECOES_DE_COR).map(n => ({ id: idDaCor(n), nome: n, hex: hexDaCor(n), grupo: 'Cores' })),
  ...COLECOES.map(c => ({ id: c.id, nome: c.marca, efeito: c.efeito?.texto, grupo: 'Marcas' })),
];
const nomeDaColecao = (id) => COLECOES_DA_TELA.find(c => c.id === id)?.nome ?? id;

let lista = [];

export async function renderRoupasAvatar() {
  const caixa = $('#adm-roupas');
  const dados = await lerAcervo();
  lista = Array.isArray(dados?.roupasAvatar) ? dados.roupasAvatar : [];
  caixa.replaceChildren(
    el('p', { class: 'tool-hint' },
      'As roupas desenhadas das coleções. Cada coleção marcada ganha a peça, e quem completa a coleção ganha o efeito dela. Aparece no jogo ao recarregar a página.'),
    el('ul', { class: 'adm-roupas-lista' }, ...lista.map(r => el('li', {},
      el('img', { src: r.src, alt: '' }),
      el('div', {},
        el('strong', {}, r.nome),
        el('small', {}, r.colecoes.map(nomeDaColecao).join(', '))),
      el('button', { class: 'btn-ghost', onclick: () => editar(r) }, 'Editar'),
      el('button', { class: 'btn-ghost danger', onclick: () => apagar(r) }, 'Apagar')))),
    el('div', { class: 'tool-row' },
      el('button', { class: 'btn-dark', onclick: () => editar(null) }, '+ Nova roupa')));
}

async function apagar(r) {
  if (!confirm(`Tirar "${r.nome}" das coleções? Quem já tem a peça deixa de ver.`)) return;
  try {
    const resp = await fetch('/api/roupas-avatar/' + encodeURIComponent(r.id), {
      method: 'DELETE', credentials: 'include',
    });
    const d = await resp.json();
    if (!resp.ok) throw new Error(d.erro || 'HTTP ' + resp.status);
    toast(`${r.nome} saiu das coleções.`);
    renderRoupasAvatar();
  } catch (e) {
    toast(e.message, 'aviso');
  }
}

const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

// A imagem escolhida vira webp de até 1000 px no lado maior: o palco tem 600 de
// largura, e a tela de alta densidade não pede mais que isso.
function lerImagem(arquivo) {
  return new Promise((ok, falha) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      ok({ dataUrl: c.toDataURL('image/webp', 0.92), proporcao: c.height / c.width });
    };
    img.onerror = () => falha(new Error('não consegui abrir essa imagem'));
    img.src = URL.createObjectURL(arquivo);
  });
}

function editar(r) {
  const nova = !r;
  // O que é editado: centro e largura; a altura segue a proporção da imagem.
  const ed = {
    nome: r?.nome || '', id: r?.id || '', slot: r?.slot || 'acessorio',
    src: r?.src || '', imagem: '', colecoes: new Set(r?.colecoes || []),
  };
  let [x, y, w, h] = r?.caixa || CAIXA_INICIAL[ed.slot];
  let cx = x + w / 2, cy = y + h / 2, largura = w, proporcao = h / w;
  let perto = ed.slot === 'acessorio' || ed.slot === 'cabeca', vestido = true;

  const caixa = () => {
    const alt = largura * proporcao;
    return [cx - largura / 2, cy - alt / 2, largura, alt].map(v => Math.round(v * 10) / 10);
  };

  const previa = el('div', { class: 'adm-roupa-previa', title: 'Arraste para posicionar' });
  const nome = el('input', { type: 'text', value: ed.nome, placeholder: 'Óculos estrela', maxlength: 60 });
  const id = el('input', { type: 'text', value: ed.id, placeholder: 'oculos-estrela', maxlength: 40, ...(nova ? {} : { readonly: true }) });
  const slot = el('select', {}, ...Object.entries(SLOTS).map(([k, s]) =>
    el('option', { value: k, ...(k === ed.slot ? { selected: true } : {}) }, s.nome)));
  const arquivo = el('input', { type: 'file', accept: 'image/png,image/webp' });
  const caminho = el('input', { type: 'text', value: ed.src, placeholder: 'ou o caminho: assets/roupas/…webp' });
  const faixa = (rotulo, min, max, valor, mudou) => {
    const n = el('output', {}, String(Math.round(valor)));
    const input = el('input', { type: 'range', min, max, step: 1, value: Math.round(valor) });
    input.addEventListener('input', () => { mudou(+input.value); n.textContent = input.value; desenhar(); });
    const label = el('label', { class: 'tool-campo adm-faixa' }, el('span', {}, rotulo, ' ', n), input);
    label.atualizar = (v) => { input.value = Math.round(v); n.textContent = String(Math.round(v)); };
    return label;
  };
  const fTam = faixa('Tamanho', 10, 600, largura, v => { largura = v; });
  const fX = faixa('Horizontal', 0, W, cx, v => { cx = v; });
  const fY = faixa('Vertical', 0, H, cy, v => { cy = v; });

  const chips = (grupo) => el('div', { class: 'adm-colecoes' },
    ...COLECOES_DA_TELA.filter(c => c.grupo === grupo).map(c => {
      const caixinha = el('input', { type: 'checkbox', ...(ed.colecoes.has(c.id) ? { checked: true } : {}) });
      caixinha.addEventListener('change', () => {
        if (caixinha.checked) ed.colecoes.add(c.id); else ed.colecoes.delete(c.id);
      });
      return el('label', { class: 'adm-colecao', title: c.efeito || '' }, caixinha,
        c.hex ? el('i', { style: { background: c.hex } }) : null, c.nome);
    }));

  const opcao = (rotulo, valor, mudou) => {
    const i = el('input', { type: 'checkbox', ...(valor ? { checked: true } : {}) });
    i.addEventListener('change', () => { mudou(i.checked); desenhar(); });
    return el('label', { class: 'adm-colecao' }, i, rotulo);
  };

  function desenhar() {
    const cx2 = caixa();
    const href = ed.imagem || ed.src;
    ROUPINHA[PREVIA] = href
      ? { id: PREVIA, nome: 'Prévia', slot: ed.slot, raridade: 'common', imagem: { href, caixa: cx2 } }
      : undefined;
    const roupas = { ...(vestido ? VESTIDO : {}), ...(href ? { [ed.slot]: PREVIA } : {}) };
    let recorte = null;
    if (perto) {
      const lado = Math.max(220, Math.max(cx2[2], cx2[3]) * 2.2);
      recorte = [cx - lado / 2, cy - lado / 2, lado, lado];
    }
    previa.classList.toggle('perto', perto);
    previa.innerHTML = svgAvatar({ roupas, recorte });
    previa.dataset.lado = recorte ? recorte[2] : W;
  }

  // Arrastar a prévia move a roupa, na escala em que ela está desenhada.
  let arrasto = null;
  previa.addEventListener('pointerdown', (e) => {
    arrasto = { x: e.clientX, y: e.clientY, cx, cy, k: +previa.dataset.lado / previa.clientWidth };
    previa.setPointerCapture(e.pointerId);
  });
  previa.addEventListener('pointermove', (e) => {
    if (!arrasto) return;
    cx = arrasto.cx + (e.clientX - arrasto.x) * arrasto.k;
    cy = arrasto.cy + (e.clientY - arrasto.y) * arrasto.k;
    fX.atualizar(cx); fY.atualizar(cy);
    desenhar();
  });
  const soltar = () => { arrasto = null; };
  previa.addEventListener('pointerup', soltar);
  previa.addEventListener('pointercancel', soltar);

  nome.addEventListener('input', () => { if (nova) id.value = slug(nome.value); });
  slot.addEventListener('change', () => {
    ed.slot = slot.value;
    if (nova && !ed.imagem && !ed.src) {
      [x, y, w, h] = CAIXA_INICIAL[ed.slot];
      cx = x + w / 2; cy = y + h / 2; largura = w; proporcao = h / w;
      fTam.atualizar(largura); fX.atualizar(cx); fY.atualizar(cy);
    }
    desenhar();
  });
  arquivo.addEventListener('change', async () => {
    const f = arquivo.files?.[0];
    if (!f) return;
    try {
      const lida = await lerImagem(f);
      ed.imagem = lida.dataUrl;
      proporcao = lida.proporcao;
      caminho.value = '';
      desenhar();
    } catch (e) { toast(e.message, 'aviso'); }
  });
  caminho.addEventListener('change', () => {
    ed.src = caminho.value.trim();
    ed.imagem = '';
    arquivo.value = '';
    const img = new Image();
    img.onload = () => { proporcao = img.naturalHeight / img.naturalWidth; desenhar(); };
    img.src = ed.src;
    desenhar();
  });

  const salvar = el('button', { class: 'btn-dark', onclick: async () => {
    const corpo = {
      id: id.value.trim(), nome: nome.value.trim(), slot: ed.slot, caixa: caixa(),
      colecoes: [...ed.colecoes], ...(ed.imagem ? { imagem: ed.imagem } : { src: ed.src }),
    };
    if (!corpo.nome || !corpo.id) { toast('Dê um nome à roupa.', 'aviso'); return; }
    if (!corpo.colecoes.length) { toast('Marque pelo menos uma coleção.', 'aviso'); return; }
    if (!ed.imagem && !ed.src) { toast('Escolha a imagem da roupa.', 'aviso'); return; }
    if (nova && lista.some(o => o.id === corpo.id)) { toast('Já existe roupa com esse id.', 'aviso'); return; }
    salvar.disabled = true;
    try {
      const resp = await fetch('/api/roupas-avatar', {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      });
      const d = await resp.json();
      if (!resp.ok) throw new Error(d.erro || 'HTTP ' + resp.status);
      toast(`${d.item.nome} salva. Recarregue a página para ver no jogo.`);
      delete ROUPINHA[PREVIA];
      renderRoupasAvatar();
    } catch (e) {
      toast(e.message, 'aviso');
      salvar.disabled = false;
    }
  } }, 'Salvar');
  const cancelar = el('button', { class: 'btn-ghost', onclick: () => {
    delete ROUPINHA[PREVIA];
    renderRoupasAvatar();
  } }, 'Cancelar');

  $('#adm-roupas').replaceChildren(el('div', { class: 'adm-roupa-editor' },
    el('div', { class: 'adm-roupa-lado' },
      previa,
      el('div', { class: 'adm-opcoes' },
        opcao('Aproximar', perto, v => { perto = v; }),
        opcao('Com roupa base', vestido, v => { vestido = v; }))),
    el('div', { class: 'adm-roupa-campos' },
      el('label', { class: 'tool-campo' }, 'Nome', nome),
      el('label', { class: 'tool-campo' }, 'Id', id),
      el('label', { class: 'tool-campo' }, 'Lugar do corpo', slot),
      el('label', { class: 'tool-campo' }, 'Imagem (PNG ou WebP com fundo transparente)', arquivo, caminho),
      fTam, fX, fY,
      el('div', { class: 'tool-campo' }, 'Coleções de cor', chips('Cores')),
      el('div', { class: 'tool-campo' }, 'Coleções de marca', chips('Marcas')),
      el('div', { class: 'tool-row' }, cancelar, salvar))));
  desenhar();
}
