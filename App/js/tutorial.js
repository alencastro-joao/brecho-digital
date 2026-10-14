// Missões de introdução: o tutorial de conta nova, em forma de missão.
//
// Uma missão por vez (INTRO em config.js), cada uma ensinando uma parte do app
// — personagem, roupas, loja, Stylist, colagem, feed, seguir, favoritos — e
// pagando um prêmio que cresce com a cadeia: XP, fichas e peças, até a épica
// da última. O progresso vem dos mesmos eventos das missões do dia
// (db.progredirMissao), então fazer a coisa já conta, esteja onde estiver.
//
// Na tela é um cartão fixo acima da barra (no celular) ou ao lado dela (no
// computador): aberto mostra a missão inteira; minimizado vira uma faixa com a
// missão da vez e o botão de ir até ela. Fechar a missão abre o cartão sozinho,
// com o prêmio esperando o toque.
//
// Começa sozinho na conta nova. Para testar de novo: Perfil › Testes ›
// "Recomeçar missões de introdução", ou abrir o site com ?tutorial.

import { INTRO, RARIDADE, faixasDeTroca } from './config.js';
import { catalogo, nomeDaPeca } from './catalog.js';
import * as db from './db.js';
import * as estoque from './estoque.js';
import { irPara } from './router.js';
import { montarVitrine } from './vitrine.js';
import { el, $ } from './util.js';

let caixa = null;
let modo = 'barra';       // 'boasvindas' | 'aberta' | 'barra' | 'premio'
let ganhos = null;        // o que saiu no último prêmio (para o cartão 'premio')
let estavaPronta = false;

export function montarTutorial() {
  $('#btn-tutorial')?.addEventListener('click', () => {
    $('#aj-fechar')?.click();   // fecha o modal de Testes antes
    comecar();
  });
  db.onIntro(() => {
    // A missão da vez acabou de ser cumprida: o cartão abre com o prêmio.
    const pronta = db.introPronta();
    if (pronta && !estavaPronta && modo !== 'premio' && modo !== 'boasvindas') modo = 'aberta';
    estavaPronta = pronta;
    desenhar();
  });
  estavaPronta = db.introPronta();
  desenhar();
}

// ?tutorial no endereço: o jeito de testar de qualquer aparelho.
export function pediuTutorialNaUrl() {
  return new URLSearchParams(location.search).has('tutorial');
}

export function comecar() {
  // Tira o ?tutorial do endereço: recarregar não recomeça de novo.
  if (pediuTutorialNaUrl()) history.replaceState(null, '', location.pathname + location.hash);
  modo = 'boasvindas';
  ganhos = null;
  db.comecarIntro();
}

// ------------------------------- Prêmios ----------------------------------
// Uma peça por faixa pedida: que você não tem, que não esgotou e que não saiu
// neste mesmo prêmio. Sem nenhuma na faixa, tenta a vizinha (faixasDeTroca).
function sortearPecas(faixas) {
  const escolhidas = new Set();
  const out = [];
  for (const pedida of faixas) {
    for (const faixa of faixasDeTroca(pedida)) {
      const lista = catalogo.itens.filter(it => !escolhidas.has(it.id) &&
        !db.temPeca(it.id) && db.raridadeDoDia(it.id) === faixa && !estoque.esgotada(it.id, faixa));
      if (!lista.length) continue;
      const item = lista[Math.floor(Math.random() * lista.length)];
      escolhidas.add(item.id);
      out.push({ item, raridade: faixa });
      break;
    }
  }
  return out;
}

function entregar(premio) {
  const r = { xp: premio.xp || 0, fichas: premio.fichas || 0, pecas: [] };
  for (const { item, raridade } of sortearPecas(premio.pecas || [])) {
    const peca = db.adicionarPeca(item, { origem: 'missao', raridade });
    if (peca) r.pecas.push({ item, peca });
  }
  if (r.fichas) db.ganharFicha(r.fichas);
  if (r.xp) db.ganharXP(r.xp, 'missão de introdução');
  db.salvar();
  if (r.pecas.length) {
    const pecas = r.pecas.map(({ peca }) => peca);
    estoque.levar(pecas.map(p => ({ id: p.id, raridade: p.raridade })))
      .then(() => { estoque.numerar(pecas); db.salvar(); });
    montarVitrine();   // a peça ganha sai do mural, se estava nele
  }
  return r;
}

function pegarPremio() {
  const m = INTRO[db.state.intro.passo];
  ganhos = { ...entregar(m.premio), ultima: db.state.intro.passo === INTRO.length - 1 };
  modo = 'premio';
  db.avancarIntro();
}

// ------------------------------- Desenho ----------------------------------
const nomeFaixa = (f) => RARIDADE[f]?.nome?.toLowerCase() ?? f;

function rotuloDoPremio(p) {
  const partes = [];
  for (const f of p.pecas || []) partes.push(`peça ${nomeFaixa(f)}`);
  if (p.fichas) partes.push(p.fichas === 1 ? '1 ficha' : `${p.fichas} fichas`);
  if (p.xp) partes.push(`${p.xp} XP`);
  return partes.join(' + ');
}

function pontos(passo) {
  return `<div class="intro-pontos">${INTRO.map((_, i) =>
    `<i class="${i < passo ? 'feito' : i === passo ? 'ativo' : ''}"></i>`).join('')}</div>`;
}

function htmlBoasVindas() {
  return `
    <p class="intro-sobre">Missões de introdução</p>
    <h2>Bem-vindo ao Brechó Digital!</h2>
    <p class="intro-dica">São ${INTRO.length} missões rápidas que mostram tudo o que dá pra fazer aqui.
      Cada uma dá um prêmio, e a última é uma <b>peça épica</b>.</p>
    <div class="intro-acoes">
      <button class="btn-ghost" data-acao="pular" type="button">Agora não</button>
      <button class="btn-dark" data-acao="abrir" type="button">Começar</button>
    </div>`;
}

function htmlAberta(m, passo, pronta) {
  return `
    <div class="intro-topo">
      <span class="intro-sobre">Missão ${passo + 1} de ${INTRO.length}</span>
      <button class="intro-min" data-acao="minimizar" type="button" aria-label="Minimizar">–</button>
    </div>
    <h2>${pronta ? '✓ ' : ''}${m.nome}</h2>
    <p class="intro-dica">${pronta ? 'Missão cumprida! O prêmio é seu.' : m.dica}</p>
    <p class="intro-premio">🎁 ${rotuloDoPremio(m.premio)}</p>
    ${pontos(passo)}
    <div class="intro-acoes">
      ${pronta
        ? '<button class="btn-dark intro-pegar" data-acao="pegar" type="button">Pegar prêmio</button>'
        : `<button class="btn-ghost" data-acao="pular" type="button">Pular introdução</button>
           <button class="btn-dark" data-acao="ir" type="button">Ir para lá</button>`}
    </div>`;
}

function htmlBarra(m, passo, pronta) {
  return `
    <button class="intro-faixa" data-acao="abrir" type="button">
      <span class="intro-num">${passo + 1}/${INTRO.length}</span>
      <span class="intro-texto"><b>${m.nome}</b><small>🎁 ${rotuloDoPremio(m.premio)}</small></span>
    </button>
    ${pronta
      ? '<button class="btn-dark intro-pegar" data-acao="pegar" type="button">Pegar</button>'
      : '<button class="btn-dark" data-acao="ir" type="button">Ir</button>'}`;
}

function htmlPremio() {
  const g = ganhos;
  const pecas = g.pecas.map(({ item, peca }) => `
    <figure class="intro-peca" style="--fundo:${RARIDADE[peca.raridade]?.bg};--borda:${RARIDADE[peca.raridade]?.cor}">
      <img src="${item.src}" alt="">
      <figcaption>${nomeDaPeca(item)}<small>${RARIDADE[peca.raridade]?.nome ?? ''}</small></figcaption>
    </figure>`).join('');
  const extras = [g.fichas && `+${g.fichas} ${g.fichas === 1 ? 'ficha' : 'fichas'}`, g.xp && `+${g.xp} XP`]
    .filter(Boolean).join(' · ');
  return `
    <p class="intro-sobre">${g.ultima ? 'Introdução completa' : 'Missão cumprida'}</p>
    <h2>${g.ultima ? 'Você já sabe tudo! 🎉' : 'Você ganhou'}</h2>
    ${pecas ? `<div class="intro-pecas">${pecas}</div>` : ''}
    ${extras ? `<p class="intro-extras">${extras}</p>` : ''}
    ${g.pecas.length ? '<p class="intro-dica">A peça já está no seu closet.</p>' : ''}
    ${g.ultima ? '<p class="intro-dica">Agora as missões do dia, em Tarefas, continuam dando prêmio.</p>' : ''}
    <div class="intro-acoes">
      <button class="btn-dark" data-acao="${g.ultima ? 'fechar' : 'abrir'}" type="button">
        ${g.ultima ? 'Começar a garimpar' : 'Próxima missão'}</button>
    </div>`;
}

function desenhar() {
  const ativa = db.introAtiva();
  if (!ativa && modo !== 'premio') { fechar(); return; }

  if (!caixa) {
    caixa = el('div', { class: 'intro', role: 'region', 'aria-label': 'Missões de introdução' });
    caixa.addEventListener('click', clique);
    document.body.append(caixa);
    document.body.classList.add('com-intro');
  }

  const passo = db.state.intro.passo;
  const m = INTRO[passo];
  const pronta = db.introPronta();
  caixa.dataset.modo = modo;
  caixa.classList.toggle('pronta', pronta);
  caixa.innerHTML =
    modo === 'boasvindas' ? htmlBoasVindas() :
    modo === 'premio' ? htmlPremio() :
    modo === 'aberta' ? htmlAberta(m, passo, pronta) :
    htmlBarra(m, passo, pronta);
}

function fechar() {
  caixa?.remove();
  caixa = null;
  document.body.classList.remove('com-intro');
}

function clique(e) {
  const acao = e.target.closest('[data-acao]')?.dataset.acao;
  if (!acao) return;
  if (acao === 'abrir') { modo = 'aberta'; desenhar(); }
  else if (acao === 'minimizar') { modo = 'barra'; desenhar(); }
  else if (acao === 'ir') { modo = 'barra'; irPara(INTRO[db.state.intro.passo].ir); desenhar(); }
  else if (acao === 'pegar') pegarPremio();
  else if (acao === 'pular') { modo = 'barra'; db.pularIntro(); }
  else if (acao === 'fechar') { modo = 'barra'; ganhos = null; fechar(); irPara('vitrine'); }
}
