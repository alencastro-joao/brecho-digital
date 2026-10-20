// Botão de compartilhar do Stylist e da Colagem: uma janelinha com "Baixar
// imagem" e "Compartilhar no Instagram".
// O Instagram não tem link que abra o app já com a imagem; o caminho é a folha
// de compartilhar do aparelho (Web Share API com o arquivo), onde a pessoa
// escolhe o Instagram. Sem essa folha (computador, navegador antigo), baixa a
// imagem e abre o site do Instagram.

import { el, toast } from './util.js';
import { baixarArquivo } from './render.js';

const SITE_INSTAGRAM = 'https://www.instagram.com/';

// `gerar(formato)` devolve { blob, nome }. `formatos`: [{ id, rotulo, dica }].
export function abrirCompartilhar({ formatos, gerar, vazio }) {
  const fechar = () => { fundo.remove(); document.body.classList.remove('com-modal'); };
  const fazer = (acao) => async (e) => {
    const botao = e.currentTarget;
    botao.disabled = true;
    try {
      const imagem = await gerar(seletor.value);
      if (acao === 'baixar') {
        baixarArquivo(imagem.blob, imagem.nome);
        toast('PNG gerado. Confere os downloads.');
      } else {
        await noInstagram(imagem);
      }
      fechar();
    } catch (err) {
      if (err?.name === 'AbortError') { botao.disabled = false; return; }   // cancelou a folha
      console.warn('compartilhar', err);
      toast('Não consegui gerar a imagem agora. Tente de novo.', 'aviso');
      botao.disabled = false;
    }
  };
  const seletor = el('select', { class: 'pergunta-campo', 'aria-label': 'Formato' },
    ...formatos.map((f) => el('option', { value: f.id }, f.rotulo)));
  const fundo = el('div', { class: 'modal pergunta' },
    el('div', { class: 'modal-caixa pergunta-caixa', role: 'dialog', 'aria-modal': 'true' },
      el('h2', { class: 'pergunta-titulo' }, 'Compartilhar'),
      seletor,
      el('div', { class: 'pergunta-botoes' },
        el('button', { class: 'btn-ghost', type: 'button', onclick: fazer('baixar') }, 'Baixar imagem'),
        el('button', { class: 'btn-dark', type: 'button', onclick: fazer('instagram') }, 'Compartilhar no Instagram')),
      el('button', { class: 'btn-ghost', type: 'button', onclick: fechar }, 'Cancelar')));
  fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
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
