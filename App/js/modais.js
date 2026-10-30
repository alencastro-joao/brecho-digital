// O voltar do aparelho (ou do navegador) fecha a janela aberta, em vez de
// sair da tela e deixar a janela por cima da tela anterior.
//
// Cada janela (.modal) aberta empilha uma entrada no histórico, com a mesma
// hash: `camada` é quantas janelas estão abertas naquela entrada. Voltar cai
// numa entrada com menos camadas e as janelas de cima fecham pelo botão delas
// (para quem abriu fazer a limpeza de sempre). Fechar pelo X, pelo fundo ou
// pelo Esc tira a entrada de volta, para o voltar seguinte não "fechar" uma
// janela já fechada.
//
// Se a tela mudou com a janela aberta (tocar numa pessoa da lista abre o
// perfil dela), as entradas da janela ficam para trás sem dono: voltar até
// elas pula direto para a entrada de baixo, que é a mesma tela.

let pilha = [];           // as janelas abertas, a de baixo primeiro
let andando = false;      // um history.go() nosso a caminho
let deNovo = false;       // mudou algo enquanto ele andava

const aberta = (m) => m.isConnected && !m.hidden;
const camadaDaEntrada = () => history.state?.camada || 0;

// Fecha como a pessoa fecharia: o X (ou o botão de fechar), senão o fundo,
// senão o Esc (as perguntas de janela.js fecham no Esc ou no fundo).
function fechar(m) {
  const botao = m.querySelector('.modal-x, [id$="-fechar"], #bau-ok');
  if (botao) { botao.click(); return; }
  m.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  if (aberta(m)) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

function andar(passos) {
  andando = true;
  history.go(passos);
  // Sem para onde andar, o popstate não vem: não fica preso esperando.
  setTimeout(() => { if (andando) aoVoltar(); }, 400);
}

// Acerta o histórico com as janelas que estão abertas agora.
function sincronizar() {
  const agora = [...document.querySelectorAll('.modal')].filter(aberta);
  pilha = [...pilha.filter(m => agora.includes(m)), ...agora.filter(m => !pilha.includes(m))];
  if (andando) { deNovo = true; return; }
  const entrada = camadaDaEntrada();
  if (pilha.length > entrada) {
    for (let n = entrada + 1; n <= pilha.length; n++) history.pushState({ ...history.state, camada: n }, '');
  } else if (pilha.length < entrada) {
    andar(pilha.length - entrada);
  }
}

function aoVoltar() {
  if (andando) {
    andando = false;
    if (deNovo) { deNovo = false; sincronizar(); }
    return;
  }
  // Hash nova também chega aqui, sem camada: a janela que sobrou aberta de
  // outra tela fecha junto.
  const entrada = camadaDaEntrada();
  if (entrada > pilha.length) { andar(pilha.length - entrada); return; }
  for (const m of pilha.slice(entrada).reverse()) fechar(m);
}

export function iniciarModais() {
  // O hidden das janelas fixas do index.html e as perguntas que entram e saem
  // do body (janela.js, compartilhar.js).
  new MutationObserver(sincronizar)
    .observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(sincronizar).observe(document.body, { childList: true });
  window.addEventListener('popstate', aoVoltar);
  sincronizar();
}
