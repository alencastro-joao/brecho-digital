// Tela de administração (#/admin): só a conta do dono da loja. Quem é admin
// é o servidor que diz (lambda/contas.py, pelo e-mail); aqui qualquer outra
// conta que caia nesta hash volta para a loja.
//
// Junta o que antes ficava espalhado nos ajustes do perfil: os números do dia
// (painel.js), a esteira, as contas (perfil.js › montarLimpeza) e os testes da
// própria conta (perfil.js › montarTestes), mais fichas e baús de teste.

import { ADMIN, BAUS } from './config.js';
import * as db from './db.js';
import { renderPainel } from './painel.js';
import { irPara } from './router.js';
import { el, $, toast } from './util.js';

export function montarAdmin() {
  $('#adm-voltar').addEventListener('click', () => irPara('perfil'));

  $('#adm-fichas').addEventListener('click', () => {
    db.ganharFicha(5);
    db.salvar();
    toast('+5 fichas.');
  });

  $('#adm-baus').replaceChildren(...Object.entries(BAUS).map(([tipo, b]) =>
    el('button', {
      class: 'btn-ghost',
      onclick: () => { db.guardarBau(tipo, 'teste', 'Teste'); toast(`${b.nome} guardado em Baús.`); },
    }, '+ ' + b.nome)));
}

export function aoEntrarNoAdmin() {
  if (!ADMIN) { irPara('vitrine'); return; }
  renderPainel();
}
