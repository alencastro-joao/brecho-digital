// Assinaturas da pessoa: ela sobe uma imagem com texto em fundo branco, o
// texto é lido no navegador (OCR), vira uma linha de CSV e, depois de
// conferido, passa a assinar as colagens e os looks exportados no lugar do
// nome da conta. O visual fica em css/perfil.css.

import * as db from './db.js';
import { el, toast } from './util.js';

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const MAX_ASSINATURAS = 12;
const MAX_CARACTERES = 60;

const lista = () => db.state.usuario.assinaturas;

// A assinatura em uso, ou '' quando a pessoa não cadastrou nenhuma.
export function assinaturaDoUsuario() {
  const u = db.state.usuario;
  return u.assinaturas?.[u.assinaturaAtiva] || '';
}

// ------------------------------- CSV --------------------------------------
// Uma coluna ("assinatura"), uma linha por assinatura; aspas quando precisa.
const campoCsv = (t) => /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;

export const paraCsv = (textos) => ['assinatura', ...textos.map(campoCsv)].join('\n');

export function deCsv(csv) {
  const linhas = csv.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (linhas[0]?.toLowerCase() === 'assinatura') linhas.shift();
  return linhas.map(l => (/^".*"$/.test(l) ? l.slice(1, -1).replace(/""/g, '"') : l));
}

// Limpa o que o OCR devolve: espaços, lixo de borda e linhas vazias.
export const limparTexto = (cru) => cru.split(/\r?\n/)
  .map(l => l.replace(/\s+/g, ' ').replace(/^[^\p{L}\p{N}@#]+|[^\p{L}\p{N}.!?)]+$/gu, '').trim())
  .filter(l => l.length > 1)
  .map(l => l.slice(0, MAX_CARACTERES));

// ------------------------------- OCR --------------------------------------
let carregando = null;
const carregarTesseract = () => carregando ||= new Promise((ok, erro) => {
  if (window.Tesseract) return ok(window.Tesseract);
  const s = el('script', { src: TESSERACT });
  s.onload = () => ok(window.Tesseract);
  s.onerror = () => { carregando = null; erro(new Error('sem rede para o leitor de texto')); };
  document.head.append(s);
});

async function lerImagem(arquivo, aoProgredir) {
  const T = await carregarTesseract();
  const r = await T.recognize(arquivo, 'por', {
    logger: m => { if (m.status === 'recognizing text') aoProgredir(Math.round(m.progress * 100)); },
  });
  return limparTexto(r.data.text || '');
}

// ------------------------------- Janela -----------------------------------
export function abrirAssinaturas(aoMudar = () => {}) {
  const u = db.state.usuario;
  let ativa = u.assinaturaAtiva;
  const rascunho = [...lista()];

  const campo = el('textarea', {
    class: 'ass-campo', rows: 5, spellcheck: 'false',
    placeholder: 'Uma assinatura por linha. Suba uma imagem ou escreva aqui.',
  });
  campo.value = rascunho.join('\n');
  const estado = el('p', { class: 'ass-estado' });
  const escolha = el('div', { class: 'ass-escolha' });
  const arquivo = el('input', { type: 'file', accept: 'image/*', hidden: true });

  const textos = () => campo.value.split('\n').map(l => l.trim().slice(0, MAX_CARACTERES))
    .filter(Boolean).slice(0, MAX_ASSINATURAS);

  function desenharEscolha() {
    const t = textos();
    if (ativa >= t.length) ativa = 0;
    escolha.replaceChildren(...t.map((txt, i) => el('label', { class: 'ass-opcao' },
      el('input', { type: 'radio', name: 'ass-ativa', checked: i === ativa, onchange: () => { ativa = i; } }),
      el('span', {}, txt))));
  }
  campo.addEventListener('input', desenharEscolha);

  arquivo.addEventListener('change', async () => {
    const f = arquivo.files[0];
    arquivo.value = '';
    if (!f) return;
    estado.textContent = 'Carregando o leitor de texto…';
    botaoImagem.disabled = true;
    try {
      const achadas = await lerImagem(f, p => { estado.textContent = `Lendo a imagem… ${p}%`; });
      if (!achadas.length) {
        estado.textContent = 'Não achei texto nessa imagem. Tente uma com letras mais escuras e o fundo bem branco.';
      } else {
        campo.value = [...textos(), ...achadas].slice(0, MAX_ASSINATURAS).join('\n');
        estado.textContent = 'Conferiu? O reconhecimento erra, principalmente com letra manuscrita: corrija o que precisar antes de salvar.';
        desenharEscolha();
      }
    } catch (err) {
      console.warn('ler assinatura', err);
      estado.textContent = 'Não consegui ler a imagem agora. Você pode escrever a assinatura no campo.';
    } finally {
      botaoImagem.disabled = false;
    }
  });

  const botaoImagem = el('button', { class: 'btn-ghost', type: 'button', onclick: () => arquivo.click() },
    'Enviar imagem');
  const botaoCsv = el('button', { class: 'btn-ghost', type: 'button', onclick: () => {
    const a = el('a', { download: 'assinaturas.csv',
      href: URL.createObjectURL(new Blob([paraCsv(textos())], { type: 'text/csv;charset=utf-8' })) });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } }, 'Baixar CSV');
  const cancelar = el('button', { class: 'btn-ghost', type: 'button' }, 'Cancelar');
  const salvar = el('button', { class: 'btn-dark', type: 'button' }, 'Salvar');

  const fundo = el('div', { class: 'modal pergunta' },
    el('div', { class: 'modal-caixa pergunta-caixa ass-caixa', role: 'dialog', 'aria-modal': 'true' },
      el('h2', { class: 'pergunta-titulo' }, 'Minhas assinaturas'),
      el('p', { class: 'pergunta-texto' },
        'Envie uma imagem com o texto em fundo branco. O texto lido vira a sua assinatura nas colagens e nos looks exportados.'),
      el('div', { class: 'ass-linha' }, botaoImagem, botaoCsv, arquivo),
      campo, estado,
      el('p', { class: 'pergunta-texto' }, 'Em uso:'), escolha,
      el('div', { class: 'pergunta-botoes' }, cancelar, salvar)));

  const fechar = () => { fundo.remove(); document.body.classList.remove('com-modal'); };
  cancelar.addEventListener('click', fechar);
  fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
  salvar.addEventListener('click', () => {
    const t = textos();
    u.assinaturas = t;
    u.assinaturaAtiva = t.length ? Math.min(ativa, t.length - 1) : 0;
    db.salvar();
    fechar();
    aoMudar();
    toast(t.length ? 'Assinatura salva.' : 'Assinaturas removidas: volta o nome da conta.');
  });

  document.body.append(fundo);
  document.body.classList.add('com-modal');
  desenharEscolha();
  campo.focus();
}
