// Botão de compartilhar do Stylist e da Colagem: uma janelinha com "Baixar
// imagem" e "Compartilhar no Instagram".
// O Instagram não tem link que abra o app já com a imagem; o caminho é a folha
// de compartilhar do aparelho (Web Share API com o arquivo), onde a pessoa
// escolhe o Instagram. Sem essa folha (computador, navegador antigo), baixa a
// imagem e abre o site do Instagram.

import { el, toast } from './util.js';
import { baixarArquivo } from './render.js';

const SITE_INSTAGRAM = 'https://www.instagram.com/';

// Dois passos: 1) baixar ou compartilhar; 2) o formato.
// `gerar(formato)` devolve { blob, nome }. `formatos`: [{ id, rotulo }].
export function abrirCompartilhar({ formatos, gerar }) {
  const caixa = el('div', { class: 'modal-caixa pergunta-caixa', role: 'dialog', 'aria-modal': 'true' });
  const fundo = el('div', { class: 'modal pergunta' }, caixa);
  const fechar = () => { fundo.remove(); document.body.classList.remove('com-modal'); };
  const cancelar = el('button', { class: 'btn-ghost', type: 'button', onclick: fechar }, 'Cancelar');

  const passoAcao = () => {
    caixa.replaceChildren(
      el('h2', { class: 'pergunta-titulo' }, 'Compartilhar'),
      el('div', { class: 'pergunta-botoes' },
        el('button', { class: 'btn-dark', type: 'button', onclick: () => passoFormato('baixar') }, 'Baixar'),
        el('button', { class: 'btn-dark', type: 'button', onclick: () => passoFormato('instagram') }, 'Compartilhar')),
      cancelar);
  };
  const passoFormato = (acao) => {
    const fazer = (formato) => async (e) => {
      const botoes = caixa.querySelectorAll('button');
      botoes.forEach((x) => { x.disabled = true; });
      try {
        const imagem = await gerar(formato);
        if (acao === 'baixar') {
          baixarArquivo(imagem.blob, imagem.nome);
          toast('Imagem baixada.');
        } else {
          await noInstagram(imagem);
        }
        fechar();
      } catch (err) {
        botoes.forEach((x) => { x.disabled = false; });
        if (err?.name === 'AbortError') return;       // cancelou a folha de compartilhar
        console.warn('compartilhar', err);
        toast('Não consegui gerar a imagem agora. Tente de novo.', 'aviso');
      }
    };
    caixa.replaceChildren(
      el('h2', { class: 'pergunta-titulo' }, 'Escolha o formato'),
      el('div', { class: 'pergunta-botoes' },
        ...formatos.map((f) => el('button', { class: 'btn-dark', type: 'button', onclick: fazer(f.id) }, f.rotulo))),
      el('button', { class: 'btn-ghost', type: 'button', onclick: passoAcao }, 'Voltar'));
  };

  fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
  passoAcao();
  document.body.append(fundo);
  document.body.classList.add('com-modal');
}

async function noInstagram({ blob, nome }) {
  const arquivo = new File([blob], nome, { type: 'image/png' });
  if (navigator.canShare?.({ files: [arquivo] })) {
    await navigator.share({ files: [arquivo] });     // a pessoa escolhe o Instagram na folha
    return;
  }
  baixarArquivo(blob, nome);
  toast('Imagem baixada. Abrindo o Instagram…');
  window.open(SITE_INSTAGRAM, '_blank', 'noopener');
}
