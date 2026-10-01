// Contas conectadas: Instagram e Pinterest.
//
// Os dois publicam a colagem para fora; o Pinterest ainda faz o caminho de
// volta, trazendo pin para virar peça no acervo — que é de onde a curadoria do
// brechó sai hoje.
//
// Sem conta de usuário não há OAuth: aqui a ligação é simulada e guarda só o @
// digitado. Nenhuma senha é pedida e nada sai do navegador. Quando o backend
// existir, é este registro que passa a guardar o token — o resto da interface
// não muda.

import { ADMIN, SERVICOS } from './config.js';
import * as db from './db.js';
import { el, $, toast } from './util.js';

let servicoAtual = null;
let aoMudar = null;

// ============================ Redes no perfil =============================
// O que aparece embaixo da bio, na sua página e na de quem você visita: as
// contas de fora que a pessoa ligou. Só o selo — não é link. Os perfis do feed
// são fictícios, e mandar alguém para um @ de verdade no Instagram levaria a
// uma pessoa que não tem nada a ver com isso. Quando houver OAuth, é aqui que
// o endereço real entra.
export const chipsDeRedes = (redes) => redes
  .filter(r => SERVICOS[r.id])
  .map(r => el('span', {
    class: 'rede-chip',
    style: { '--servico': SERVICOS[r.id].cor },
    title: `${SERVICOS[r.id].nome} · ${SERVICOS[r.id].papel.toLowerCase()}`,
  },
    el('span', { class: 'conexao-ponto' }),
    el('strong', {}, SERVICOS[r.id].nome),
    el('small', {}, '@' + String(r.usuario || '').replace(/^@+/, ''))
  ));

// As suas: as que estão realmente ligadas em db.state.conexoes.
export const minhasRedes = () => Object.keys(SERVICOS)
  .filter(id => db.estaLigado(id))
  .map(id => ({ id, usuario: db.state.conexoes[id].usuario }));

// ================================ Cartões =================================
export function renderConexoes(callback) {
  if (callback) aoMudar = callback;
  const lista = $('#conexao-lista');
  if (!lista) return;
  lista.innerHTML = '';

  for (const [id, s] of Object.entries(SERVICOS)) {
    const c = db.state.conexoes[id] || { ligado: false };
    const cartao = el('div', {
      class: 'conexao' + (c.ligado ? ' ligada' : ''),
      style: { '--servico': s.cor },
    },
      el('div', { class: 'conexao-topo' },
        el('span', { class: 'conexao-ponto' }),
        el('div', { class: 'conexao-nome' },
          el('strong', {}, s.nome),
          el('small', {}, s.papel)
        ),
        c.ligado
          ? el('span', { class: 'conexao-selo' }, 'ligado')
          : null
      ),

      el('p', { class: 'conexao-resumo' },
        c.ligado
          ? `como @${c.usuario} · desde ${new Date(c.em).toLocaleDateString('pt-BR')}`
          : s.resumo),

      el('div', { class: 'conexao-acoes' },
        c.ligado
          ? el('button', { class: 'btn-ghost', onclick: () => desligar(id) }, 'Desconectar')
          : el('button', { class: 'btn-dark', onclick: () => abrirConexao(id) }, `Conectar ${s.nome}`),

        // O caminho de volta do Pinterest: trazer pin para virar peça.
        c.ligado && id === 'pinterest'
          ? el('button', { class: 'btn-ghost', onclick: importarPins }, 'Importar pins')
          : null
      )
    );
    lista.append(cartao);
  }
}

function importarPins() {
  if (!ADMIN) {
    return toast('Com o backend ligado, os pins do board viriam sozinhos.');
  }
  toast('Com o backend ligado, os pins do board viriam sozinhos. Por ora, suba a peça pela esteira.');
  location.href = 'esteira.html';
}

function desligar(id) {
  db.desconectar(id);
  renderConexoes();
  aoMudar?.();
  toast(`${SERVICOS[id].nome} desconectado.`);
}

// ================================= Modal ==================================
function abrirConexao(id) {
  servicoAtual = id;
  const s = SERVICOS[id];

  $('#cx-titulo').textContent = `Conectar ${s.nome}`;
  $('#cx-resumo').textContent = s.resumo;
  $('#modal-conexao').style.setProperty('--servico', s.cor);

  const lista = $('#cx-beneficios');
  lista.innerHTML = '';
  for (const b of s.beneficios) lista.append(el('li', {}, b));

  const campo = $('#cx-usuario');
  campo.value = db.state.conexoes[id]?.usuario || '';
  campo.placeholder = '@seuusuario';

  $('#modal-conexao').hidden = false;
  document.body.classList.add('com-modal');
  setTimeout(() => campo.focus(), 60);
}

function fechar() {
  $('#modal-conexao').hidden = true;
  document.body.classList.remove('com-modal');
  servicoAtual = null;
}

function confirmar() {
  const usuario = $('#cx-usuario').value.trim();
  if (!usuario) {
    return toast('Escreva o seu @ para simular a ligação.', 'aviso');
  }
  db.conectar(servicoAtual, usuario);
  const nome = SERVICOS[servicoAtual].nome;
  fechar();
  renderConexoes();
  aoMudar?.();
  toast(`${nome} conectado como @${usuario.replace(/^@/, '')}.`);
}

export function montarConexoes() {
  $('#cx-fechar').addEventListener('click', fechar);
  $('#cx-cancelar').addEventListener('click', fechar);
  $('#cx-confirmar').addEventListener('click', confirmar);
  $('#cx-usuario').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmar();
  });
  $('#modal-conexao').addEventListener('pointerdown', (e) => {
    if (e.target.id === 'modal-conexao') fechar();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#modal-conexao').hidden) fechar();
  });
}
