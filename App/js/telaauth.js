// A tela de entrar / criar conta.
//
// É a única tela que roda antes do app existir, então não importa db.js, nem o
// roteador, nem o catálogo: ela só sabe falar com js/auth.js e devolver a conta
// para quem a chamou (js/app.js). Enquanto ninguém entra, nada do jogo é
// montado — é o que garante que nenhuma tela leia o guarda-roupa de ninguém.

import * as auth from './auth.js';
import { $ } from './util.js';

const abas = {
  entrar: { aba: '#aba-entrar', form: '#form-entrar', erro: '#entrar-erro' },
  criar: { aba: '#aba-criar', form: '#form-criar', erro: '#criar-erro' },
};

function trocarAba(qual) {
  for (const [nome, ids] of Object.entries(abas)) {
    $(ids.aba).classList.toggle('ativa', nome === qual);
    $(ids.form).hidden = nome !== qual;
    esconderErro(ids.erro);
  }
  // O primeiro campo da aba que abriu recebe o cursor: entrar é para digitar.
  $(abas[qual].form).querySelector('input')?.focus();
}

const esconderErro = (id) => { $(id).hidden = true; };

// Conferência dos campos repetidos, antes de gastar uma requisição com eles.
// Joga o erro para `enviar()`, que é quem sabe mostrá-lo — e devolve o cursor
// para o campo que não bate, porque o erro fica embaixo do botão e não diz por
// si qual dos quatro campos corrigir.
//
// O e-mail é comparado sem caixa: quem digita "Voce@" e depois "voce@" não
// errou nada (o servidor guarda o e-mail normalizado). A senha é comparada
// exatamente como foi digitada — em senha, maiúscula é diferença de verdade.
function conferirRepetidos() {
  const email = $('#criar-email').value.trim();
  const email2 = $('#criar-email2').value.trim();
  if (email.toLowerCase() !== email2.toLowerCase()) {
    $('#criar-email2').focus();
    throw new Error('Os dois e-mails não são iguais.');
  }

  const senha = $('#criar-senha').value;
  if (senha !== $('#criar-senha2').value) {
    $('#criar-senha2').focus();
    throw new Error('As duas senhas não são iguais.');
  }
  return { email, senha };
}

function mostrarErro(id, mensagem) {
  const alvo = $(id);
  alvo.textContent = mensagem;
  alvo.hidden = false;
}

// O envio é assíncrono e o formulário aceita Enter: sem travar, dois Enter
// seguidos viram dois cadastros (ou dois logins, e um cookie sobrescrevendo o
// outro). `enviando` desliga o botão e marca o formulário pelo CSS.
async function enviar(form, erroId, acao) {
  if (form.classList.contains('enviando')) return null;
  form.classList.add('enviando');
  esconderErro(erroId);
  try {
    return await acao();
  } catch (e) {
    mostrarErro(erroId, e.message || 'Não deu certo. Tente de novo.');
    return null;
  } finally {
    form.classList.remove('enviando');
  }
}

/**
 * Mostra a tela e resolve assim que alguém entra ou se cadastra. Só volta
 * quando há sessão de verdade: quem chamou pode seguir direto para o boot.
 *
 * `nova` diz se a conta nasceu agora, e é só daqui que se sabe: no login
 * seguinte a conta é idêntica a qualquer outra. O boot usa isso para entregar o
 * presente de boas-vindas uma única vez (ver js/presente.js).
 *
 * @param {string} aviso  linha extra no rodapé (ex.: servidor fora do ar).
 * @returns {Promise<{conta: object, nova: boolean}>}
 */
export function pedirConta({ aviso = '' } = {}) {
  const tela = $('#tela-auth');
  tela.hidden = false;
  if (aviso) mostrarErro('#entrar-erro', aviso);

  return new Promise((resolver) => {
    const pronto = (conta, nova = false) => {
      tela.hidden = true;
      resolver({ conta, nova });
    };

    document.querySelectorAll('.auth-aba').forEach(botao =>
      botao.addEventListener('click', () => trocarAba(botao.dataset.aba)));

    const formEntrar = $('#form-entrar');
    formEntrar.addEventListener('submit', async (e) => {
      e.preventDefault();
      const conta = await enviar(formEntrar, '#entrar-erro', () => auth.entrar({
        email: $('#entrar-email').value.trim(),
        senha: $('#entrar-senha').value,
      }));
      if (conta) pronto(conta);
    });

    const formCriar = $('#form-criar');
    formCriar.addEventListener('submit', async (e) => {
      e.preventDefault();
      const conta = await enviar(formCriar, '#criar-erro', () => {
        const { email, senha } = conferirRepetidos();
        return auth.registrar({
          email,
          senha,
          nome: $('#criar-nome').value.trim(),
          handle: $('#criar-handle').value.trim(),
        });
      });
      if (conta) pronto(conta, true);
    });

    $('#entrar-email').focus();
  });
}
