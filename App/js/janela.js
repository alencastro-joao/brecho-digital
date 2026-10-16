// Perguntas em janela do jogo (no lugar do confirm() e do prompt() do
// navegador, que abriam a caixa cinza do sistema). Devolvem uma Promise:
//   if (!await confirmar('Apagar?', { sim: 'Apagar', perigo: true })) return;
//   const texto = await pedirTexto('Escreva APAGAR'); // null se cancelou
// O visual fica em css/janelas.css.

import { el } from './util.js';

function abrir(mensagem, { titulo = '', sim = 'Confirmar', nao = 'Cancelar', perigo = false, campo = false } = {}) {
  return new Promise((resolve) => {
    const entrada = campo ? el('input', { class: 'pergunta-campo', type: 'text', autocomplete: 'off' }) : null;
    const botaoNao = el('button', { class: 'btn-ghost', type: 'button' }, nao);
    const botaoSim = el('button', { class: `btn-dark${perigo ? ' perigo' : ''}`, type: 'button' }, sim);
    const caixa = el('div', { class: 'modal-caixa pergunta-caixa', role: 'alertdialog', 'aria-modal': 'true' },
      titulo ? el('h2', { class: 'pergunta-titulo' }, titulo) : null,
      el('p', { class: 'pergunta-texto' }, mensagem),
      entrada,
      el('div', { class: 'pergunta-botoes' }, botaoNao, botaoSim));
    const fundo = el('div', { class: 'modal pergunta' }, caixa);

    const antes = document.activeElement;
    const tinhaModal = document.body.classList.contains('com-modal');
    document.body.append(fundo);
    document.body.classList.add('com-modal');
    (entrada || botaoSim).focus();

    function fechar(valor) {
      document.removeEventListener('keydown', tecla, true);
      fundo.remove();
      if (!tinhaModal && !document.querySelector('.modal:not([hidden])')) {
        document.body.classList.remove('com-modal');
      }
      antes?.focus?.();
      resolve(valor);
    }
    const responder = () => fechar(campo ? entrada.value : true);
    const cancelar = () => fechar(campo ? null : false);

    // Na captura e parando ali: o Esc e o Enter são desta janela, não da que
    // estiver aberta por baixo dela.
    function tecla(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelar(); }
      else if (e.key === 'Enter' && document.activeElement !== botaoNao) {
        e.preventDefault(); e.stopPropagation(); responder();
      }
    }
    document.addEventListener('keydown', tecla, true);
    botaoSim.addEventListener('click', responder);
    botaoNao.addEventListener('click', cancelar);
    fundo.addEventListener('click', (e) => { if (e.target === fundo) cancelar(); });
  });
}

export const confirmar = (mensagem, opcoes) => abrir(mensagem, opcoes);
export const pedirTexto = (mensagem, opcoes) => abrir(mensagem, { ...opcoes, campo: true });
