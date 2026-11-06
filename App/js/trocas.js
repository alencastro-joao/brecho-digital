// Troca de peças entre amigas.
//
// Como funciona (regras do João, 04/11/2026; números em TROCAS, config.js):
//   1. Na ficha de uma peça de uma amiga aparece o botão Trocar.
//   2. Você marca de 1 a `maxOpcoes` peças suas da mesma raridade e envia.
//   3. Ela recebe no sino, escolhe uma das suas (ou recusa).
//   4. Quem envia já separa as fichas (pela raridade, não pelo número de
//      opções); recusou, cancelou ou venceu, elas voltam. Quem aceita paga ao
//      aceitar. Uma peça vai, a outra vem.
//
// Quem decide é o servidor (nuvem/lambda/trocas.py): ele confere a amizade, a
// raridade e quem é dona de cada cópia numerada, e troca as duas de dono numa
// transação só. O save só aplica o resultado: tira a peça que foi (e os looks
// e colagens que a usavam), põe a que veio e cobra ou devolve as fichas.
// Ofertas e respostas chegam relendo /api/trocas (no boot, de tempos em
// tempos e ao voltar para a aba): não há push.

import * as db from './db.js';
import { TROCAS, RARIDADE } from './config.js';
import { item as pecaDoCatalogo, nomeDaPeca, trocarImagem } from './catalog.js';
import { el, toast } from './util.js';
import { avisarTroca, aoTocarEmTroca, aoTocarEmTutorialTroca } from './avisos.js';
import { esquecerHistorico } from './estoque.js';
import { tocar } from './sons.js';
import { ico } from './icones.js';
import { ordenar, seletorDeOrdem } from './ordenacao.js';
import { agrupamento, grupoDe } from './agrupamento.js';

const INTERVALO = 2 * 60e3;
const LETRA = { c: 'common', u: 'uncommon', r: 'rare', e: 'epic', l: 'legendary' };

let ultimas = [];             // a última leitura de /api/trocas
let online = true;

const registro = () => (db.state.trocas ??= { cobradas: {}, avisadas: [] });
export const custoDa = (raridade) => TROCAS.custo[raridade] ?? 0;
const handle = (h) => String(h || '').startsWith('@') ? h : '@' + h;

async function chamar(rota, corpo) {
  const r = await fetch(rota, {
    method: corpo ? 'POST' : 'GET',
    credentials: 'include',
    headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.erro || 'Não consegui falar com o servidor.');
  return dados;
}

// ------------------------------- A peça dela -------------------------------
// A raridade da peça no guarda-roupa dela: uma letra por peça, na mesma ordem
// da lista (pessoas.js). Sem as letras (versão antiga do app dela), sem troca.
export function raridadeNaPagina(p, id) {
  const i = (p?.guardaRoupa || []).indexOf(id);
  // Sem a letra (o perfil dela ainda não foi reenviado depois da troca
  // existir), vale a raridade fixa da ficha da peça, igual para todo mundo.
  return i < 0 ? null : LETRA[(p.raridades || '')[i]] || db.raridadesFixas.get(id) || null;
}


// As minhas peças que servem: mesma raridade, numeradas e que ela não tem.
function minhasParaOferecer(raridade, p) {
  const dela = new Set(p?.guardaRoupa || []);
  return db.state.inventario.filter(x =>
    x.raridade === raridade && x.numero && !dela.has(x.id) && pecaDoCatalogo(x.id));
}

// Por que não dá para trocar (null = dá).
function bloqueio(peca, p) {
  const rar = raridadeNaPagina(p, peca.id);
  if (!p?.real || !rar) return 'Essa peça não pode ser trocada';
  if (!(p.voceSegue && p.segueVoce)) return 'Só entre amigos (um segue o outro)';
  if (db.nivel() < TROCAS.nivel) return `Libera no nível ${TROCAS.nivel}`;
  if (db.temPeca(peca.id)) return null;          // a ficha já diz que está no seu guarda-roupa
  if (!minhasParaOferecer(rar, p).length) return `Você não tem peça ${RARIDADE[rar].nome.toLowerCase()} para oferecer`;
  if (db.fichas() < custoDa(rar)) return `Faltam fichas (custa ${custoDa(rar)})`;
  return null;
}

// O botão da ficha. Só aparece quando dá para trocar: sem botão apagado nem
// texto de motivo (pedido do João, 04/11/2026).
export function botaoTrocar(peca, p, { antes = null } = {}) {
  if (!p?.real || db.temPeca(peca.id) || !(p.guardaRoupa || []).includes(peca.id)) return null;
  if (bloqueio(peca, p)) return null;
  return el('button', {
    type: 'button', class: 'btn-dark troca-btn',
    title: 'Oferecer uma troca',
    onclick: (e) => {
      e.stopPropagation();
      antes?.();
      abrirProposta(peca, p);
    },
  }, '⇄ Trocar');
}

// --------------------------------- Janelas ---------------------------------
function janela(...conteudo) {
  const caixa = el('div', { class: 'modal-caixa pergunta-caixa troca-caixa', role: 'dialog', 'aria-modal': 'true' }, ...conteudo);
  const fundo = el('div', { class: 'modal pergunta troca-janela' }, caixa);
  const tinha = document.body.classList.contains('com-modal');
  const fechar = () => {
    fundo.remove();
    document.removeEventListener('keydown', tecla, true);
    if (!tinha && !document.querySelector('.modal:not([hidden])')) document.body.classList.remove('com-modal');
  };
  const tecla = (e) => { if (e.key === 'Escape') { e.stopPropagation(); fechar(); } };
  fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
  document.addEventListener('keydown', tecla, true);
  document.body.append(fundo);
  document.body.classList.add('com-modal');
  tocar('janela');
  return { caixa, fundo, fechar };
}

// As telas da troca (propor, ver e responder) ocupam a tela toda, no
// acabamento do jogo: barra pérola em cima (voltar, título, "i"), o corpo em
// painéis e os botões presos embaixo. Só o "i" abre janelinha.
function telaTroca(titulo, corpo, rodape) {
  const voltar = el('button', { type: 'button', class: 'troca-voltar', title: 'Voltar', 'aria-label': 'Voltar' }, ico('seta-esq'));
  const caixa = el('div', { class: 'troca-tela-caixa', role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo },
    el('header', { class: 'troca-topo' }, voltar, el('h2', {}, titulo), botaoInfo()),
    el('div', { class: 'troca-corpo' }, ...corpo),
    el('footer', { class: 'troca-rodape' }, ...rodape));
  const fundo = el('div', { class: 'modal troca-janela troca-tela' }, caixa);
  const tinha = document.body.classList.contains('com-modal');
  const fechar = () => {
    fundo.remove();
    document.removeEventListener('keydown', tecla, true);
    if (!tinha && !document.querySelector('.modal:not([hidden])')) document.body.classList.remove('com-modal');
  };
  const tecla = (e) => {
    if (e.key === 'Escape' && fundo === [...document.querySelectorAll('.troca-janela')].pop()) { e.stopPropagation(); fechar(); }
  };
  voltar.addEventListener('click', () => fechar());
  document.addEventListener('keydown', tecla, true);
  document.body.append(fundo);
  document.body.classList.add('com-modal');
  tocar('janela');
  return { caixa, fechar };
}

// Um painel com rótulo, como os do resto do jogo.
const secao = (rotulo, ...conteudo) =>
  el('section', { class: 'troca-secao' }, rotulo ? el('h3', { class: 'troca-secao-rotulo' }, rotulo) : null, ...conteudo);

// O topo da troca: a peça que vai, as setas e a que vem (ou o lugar dela).
function placar(dou, recebo, { rotuloDou = 'Você dá', rotuloRecebo = 'Você recebe' } = {}) {
  const lado = (rotulo, conteudo) => el('div', { class: 'troca-lado' }, el('span', { class: 'troca-lado-rotulo' }, rotulo), conteudo);
  const vazio = (texto) => el('div', { class: 'troca-fig troca-vazio' }, el('span', {}, '?'), el('small', {}, texto));
  const slotDou = lado(rotuloDou, dou || vazio('escolha'));
  const slotRecebo = lado(rotuloRecebo, recebo || vazio('escolha'));
  const no = el('div', { class: 'troca-placar' }, slotDou,
    el('span', { class: 'troca-setas', 'aria-hidden': 'true' }, ico('atualizar')), slotRecebo);
  no.trocarDou = (fig, texto = 'escolha') => slotDou.lastChild.replaceWith(fig || vazio(texto));
  no.trocarRecebo = (fig, texto = 'escolha') => slotRecebo.lastChild.replaceWith(fig || vazio(texto));
  return no;
}

// O preço no botão: "Aceitar · (moeda) 1".
const comPreco = (texto, rar) => [texto,
  el('span', { class: 'troca-preco' }, el('span', { class: 'ficha-moeda' }), String(custoDa(rar)))];

// `so`: só a foto (nas grades de escolha, sem nome nem número; João, 04/11/2026).
function figura(copia, { rotulo = '', classe = '', so = false } = {}) {
  const peca = pecaDoCatalogo(copia.id);
  const img = el('img', { alt: peca ? nomeDaPeca(peca) : '', loading: 'lazy' });
  if (peca) trocarImagem(img, peca, 220);
  const r = RARIDADE[copia.raridade];
  if (so) {
    img.title = img.alt;
    return el('div', { class: 'troca-fig so ' + classe, style: { '--rar': r?.aura && r.aura !== 'arco-iris' ? r.aura : r?.cor || '#ccc' } }, img);
  }
  return el('div', { class: 'troca-fig ' + classe, style: { '--rar': r?.aura && r.aura !== 'arco-iris' ? r.aura : r?.cor || '#ccc' } },
    img,
    el('span', { class: 'troca-fig-nome' }, peca ? nomeDaPeca(peca) : 'Peça'),
    el('small', {}, r?.nome || ''),
    rotulo ? el('em', {}, rotulo) : null);
}

// Uma grade de peças para escolher: `max` 1 é escolha única.
// `desejadas`: ids que a outra pessoa tem na wishlist; ganham o ♥ no canto.
function grade(copias, max, aoMudar, { desejadas = new Set() } = {}) {
  const marcadas = new Set();
  const botoes = copias.map((c, i) => {
    const quer = desejadas.has(c.id);
    const b = el('button', {
      type: 'button', class: 'troca-opcao' + (quer ? ' desejada' : ''), 'aria-pressed': 'false',
      title: quer ? 'Na wishlist' : null,
    }, figura(c, { so: true }), quer ? el('span', { class: 'troca-desejo', 'aria-label': 'Na wishlist' }, ico('coracao-cheio')) : null);
    b.addEventListener('click', () => {
      if (marcadas.has(i)) { marcadas.delete(i); tocar('desfazer'); }
      else {
        if (max === 1) marcadas.clear();
        if (marcadas.size >= max) { tocar('naocurti'); return toast(`No máximo ${max} peças.`); }
        marcadas.add(i);
        tocar('escolha');
      }
      botoes.forEach((x, j) => x.setAttribute('aria-pressed', String(marcadas.has(j))));
      aoMudar([...marcadas]);
    });
    return b;
  });
  return el('div', { class: 'troca-grade' }, ...botoes);
}

// A grade da proposta, com Filtrar (por categoria) e Organizar em cima, iguais
// aos do guarda-roupa. A marcação fica com a peça ao filtrar ou reordenar.
// As da wishlist da outra pessoa vêm sempre primeiro (João, 04/11/2026).
function gradeComFerramentas(copias, max, aoMudar, { desejadas = new Set() } = {}) {
  const caixa = grade(copias, max, aoMudar, { desejadas });
  const botoes = [...caixa.children];
  let filtro = '';
  const pintar = () => {
    const vez = ordenar(copias.map((c, i) => ({ ...c, _i: i, ordem: c.ordem ?? i })));
    const primeiro = (c) => (desejadas.has(c.id) ? 0 : 1);
    vez.sort((a, b) => primeiro(a) - primeiro(b));     // estável: mantém a ordem escolhida dentro de cada parte
    caixa.replaceChildren(...vez.filter(c => !filtro || grupoDe(c) === filtro).map(c => botoes[c._i]));
  };
  const ag = agrupamento();
  const tem = new Set(copias.map(grupoDe));
  const filtrar = el('select', {
    class: 'ordem-sel', title: 'Filtrar as peças', 'aria-label': 'Filtrar as peças',
    onchange: (e) => { filtro = e.target.value; tocar('toque'); pintar(); },
  }, el('option', { value: '' }, 'Todas'),
    ...ag.ordem.filter(id => tem.has(id)).map(id => el('option', { value: id }, ag.grupos[id]?.nome || id)));
  pintar();
  return [
    el('div', { class: 'troca-ferramentas' },
      el('div', { class: 'troca-campo' }, el('span', {}, 'Filtrar'), filtrar),
      el('div', { class: 'troca-campo' }, el('span', {}, 'Organizar'), seletorDeOrdem(() => { tocar('toque'); pintar(); }))),
    caixa,
  ];
}

// O "i" no canto da janela: a explicação fica em cards, não na tela (João, 04/11/2026).
const CARDS = () => [
  ['usuario', 'Só entre amigos', 'Dá para trocar com quem você segue e também segue você.'],
  ['brilho', 'Mesma raridade', 'Uma peça por uma, sempre da mesma raridade.'],
  ['mao', 'Até 4 opções', `Você marca até ${TROCAS.maxOpcoes} peças suas. A outra pessoa escolhe uma ou recusa.`],
  ['ficha', 'Fichas', 'Quem envia já separa as fichas e, se a troca não sair, elas voltam. Quem aceita paga ao aceitar: ' +
    RARIDADES_CUSTO().join(', ') + '.'],
  ['atualizar', `${TROCAS.porDia} por dia`, `No máximo ${TROCAS.porDia} trocas por dia. A peça que você dá sai dos seus looks e colagens.`],
];
const RARIDADES_CUSTO = () => Object.entries(TROCAS.custo)
  .map(([id, n]) => `${(RARIDADE[id]?.nome || id).toLowerCase()} ${n}`);

function botaoInfo() {
  const b = el('button', { type: 'button', class: 'troca-info-btn', title: 'Como funciona', 'aria-label': 'Como funciona' }, ico('info'));
  b.addEventListener('click', abrirComoFunciona);
  return b;
}

function abrirComoFunciona() {
  {
    const ok = el('button', { type: 'button', class: 'btn-dark' }, 'Entendi');
    const { caixa: info, fechar } = janela(
      el('h2', { class: 'pergunta-titulo' }, 'Como funciona a troca'),
      el('div', { class: 'troca-cards' }, ...CARDS().map(([emoji, titulo, texto]) =>
        el('div', { class: 'troca-card' }, el('span', { class: 'troca-card-ico' },
            emoji === 'ficha' ? el('span', { class: 'ficha-moeda' }) : ico(emoji)),
          el('strong', {}, titulo), el('p', {}, texto)))),
      ok);
    info.classList.add('troca-info');
    ok.addEventListener('click', () => fechar());
  }
}

// ------------------------------ Propor (Ana) -------------------------------
export function abrirProposta(peca, p) {
  const rar = raridadeNaPagina(p, peca.id);
  const minhas = minhasParaOferecer(rar, p);
  let escolhidas = [];
  const enviar = el('button', { type: 'button', class: 'btn-dark troca-aceitar', disabled: true }, ...comPreco('Enviar', rar));
  const topo = placar(null, figura({ id: peca.id, raridade: rar }, { rotulo: `de ${handle(p.handle)}` }),
    { rotuloDou: 'Você oferece', rotuloRecebo: 'Você quer' });
  topo.trocarDou(null, `até ${TROCAS.maxOpcoes}`);
  const [ferramentas, gradeMinha] = gradeComFerramentas(minhas, TROCAS.maxOpcoes, (lista) => {
    escolhidas = lista; enviar.disabled = !lista.length;
    enviar.replaceChildren(...comPreco(lista.length ? `Enviar (${lista.length})` : 'Enviar', rar));
    topo.trocarDou(lista.length ? pilha(lista.map(i => minhas[i])) : null, `até ${TROCAS.maxOpcoes}`);
  }, { desejadas: new Set(p.wishlist || []) });
  const { fechar } = telaTroca('Propor troca',
    [topo, secao(`Suas peças · ${RARIDADE[rar]?.nome || ''}`, ferramentas, gradeMinha)],
    [el('button', { type: 'button', class: 'btn-ghost', onclick: () => fechar() }, 'Cancelar'), enviar]);
  enviar.addEventListener('click', async () => {
    const custo = custoDa(rar);
    if (db.fichas() < custo) return toast(`Faltam fichas: a troca custa ${custo}.`);
    enviar.disabled = true;
    try {
      const { troca } = await chamar('/api/trocas', {
        para: p.id, quero: { id: peca.id, raridade: rar },
        opcoes: escolhidas.map(i => minhas[i]).map(c => ({
          id: c.id, raridade: c.raridade, numero: c.numero,
          origem: c.origem || 'vitrine', desde: c.obtidoEm })),
      });
      // As fichas ficam separadas; voltam se a troca não sair (aplicarPendentes).
      db.state.fichas = db.fichas() - custo;
      registro().cobradas[troca.id] = custo;
      db.salvar();
      ultimas = [troca, ...ultimas.filter(t => t.id !== troca.id)];
      fechar();
      tocar('gastar');
      toast(`Oferta enviada para ${handle(p.handle)}. ${custo} ficha${custo === 1 ? '' : 's'} separada${custo === 1 ? '' : 's'}.`, 'ok');
    } catch (e) {
      enviar.disabled = false;
      tocar('naocurti');
      toast(e.message, 'erro');
    }
  });
}

// As opções marcadas, empilhadas no lado "Você oferece".
function pilha(copias) {
  return el('div', { class: 'troca-fig troca-pilha' },
    el('div', { class: 'troca-pilha-fotos' }, ...copias.slice(0, 4).map(c => figura(c, { so: true }))),
    el('small', {}, `${copias.length} opç${copias.length === 1 ? 'ão' : 'ões'}`));
}

// --------------------------- A oferta (as duas) ----------------------------
export async function abrirOferta(trocaId) {
  let t = ultimas.find(x => x.id === trocaId);
  if (!t || t.estado === 'aberta') { await sincronizarTrocas(); t = ultimas.find(x => x.id === trocaId) || t; }
  if (!t) return toast('Essa troca não está mais aqui.');
  if (t.souEu === 'para' && t.estado === 'aberta') return janelaDeResposta(t);
  const souDe = t.souEu === 'de';
  const outra = souDe ? t.para.handle : t.de.handle;
  const estado = {
    aberta: `Esperando ${outra} escolher`,
    feita: 'Troca feita',
    recusada: `${outra} recusou`,
    cancelada: 'Oferta cancelada',
    vencida: 'Venceu sem resposta',
    invalida: `Não deu certo${t.motivo ? ': ' + t.motivo : ''}`,
  }[t.estado] || '';
  const escolhida = t.opcoes[t.escolhida];
  const quero = figura(t.quero, { rotulo: souDe ? `de ${handle(t.para.handle)}` : '' });
  const outraFig = escolhida ? figura(escolhida) : null;
  const topo = souDe
    ? placar(outraFig, quero, { rotuloDou: 'Você oferece', rotuloRecebo: 'Você quer' })
    : placar(quero, outraFig);
  if (souDe && !escolhida) topo.trocarDou(pilha(t.opcoes));
  const rodape = [];
  if (souDe && t.estado === 'aberta') {
    rodape.push(el('button', {
      type: 'button', class: 'btn-ghost perigo',
      onclick: async () => {
        try {
          guardar((await chamar(`/api/trocas/${t.id}/cancelar`, {})).troca);
          await aplicarPendentes();
          fechar();
          tocar('desfazer');
          toast('Oferta cancelada. As fichas voltaram.');
        } catch (e) { toast(e.message, 'erro'); }
      },
    }, 'Cancelar oferta'));
  }
  rodape.push(el('button', { type: 'button', class: 'btn-dark', onclick: () => fechar() }, 'Fechar'));
  const { fechar } = telaTroca(souDe ? `Sua oferta para ${handle(outra)}` : `Oferta de ${handle(outra)}`,
    [topo,
      el('p', { class: 'troca-estado ' + t.estado }, estado),
      secao('Opções oferecidas', el('div', { class: 'troca-grade' }, ...t.opcoes.map((c, i) =>
        figura(c, { so: true, classe: t.escolhida === i ? 'escolhida' : '' }))))],
    rodape);
}

function janelaDeResposta(t) {
  const rar = t.quero.raridade;
  const minha = db.pecaDoInventario(t.quero.id);
  let escolhida = null;
  const aceitar = el('button', { type: 'button', class: 'btn-dark troca-aceitar', disabled: true }, ...comPreco('Aceitar', rar));
  const recusar = el('button', { type: 'button', class: 'btn-ghost' }, 'Recusar');
  const topo = placar(figura({ ...t.quero, numero: minha?.numero }), null);
  const { fechar } = telaTroca(`Oferta de ${handle(t.de.handle)}`,
    [topo,
      secao(`Escolha o que você recebe`,
        grade(t.opcoes, 1, (lista) => {
          escolhida = lista[0] ?? null;
          aceitar.disabled = escolhida === null;
          topo.trocarRecebo(escolhida === null ? null : figura(t.opcoes[escolhida]));
        }, { desejadas: new Set(db.state.wishlist || []) }))],
    [recusar, aceitar]);
  recusar.addEventListener('click', async () => {
    try {
      guardar((await chamar(`/api/trocas/${t.id}/recusar`, {})).troca);
      fechar();
      tocar('desfazer');
      toast('Oferta recusada.');
    } catch (e) { toast(e.message, 'erro'); }
  });
  aceitar.addEventListener('click', async () => {
    if (!minha) return toast('Essa peça não está mais no seu guarda-roupa.', 'erro');
    if (!minha.numero) return toast('Essa peça ainda não tem número. Tente de novo daqui a pouco.', 'erro');
    if (db.fichas() < custoDa(rar)) return toast(`Faltam fichas: a troca custa ${custoDa(rar)}.`, 'erro');
    if (db.nivel() < TROCAS.nivel) return toast(`A troca libera no nível ${TROCAS.nivel}.`, 'erro');
    aceitar.disabled = true;
    try {
      const { troca } = await chamar(`/api/trocas/${t.id}/aceitar`, {
        escolhida, minha: { numero: minha.numero, origem: minha.origem || 'vitrine', desde: minha.obtidoEm } });
      guardar(troca);
      fechar();
      if (troca.estado === 'feita') { tocar('gastar'); await aplicarPendentes(); }
      else tocar('naocurti'), toast(`A troca não deu certo${troca.motivo ? ': ' + troca.motivo : ''}.`, 'erro');
    } catch (e) {
      aceitar.disabled = false;
      tocar('naocurti');
      toast(e.message, 'erro');
    }
  });
}

const guardar = (troca) => { ultimas = [troca, ...ultimas.filter(t => t.id !== troca.id)]; };

// ------------------------------ Aplicar no save ----------------------------
// O que vai e o que vem para quem está jogando.
function lados(t) {
  const escolhida = t.opcoes[t.escolhida];
  return t.souEu === 'de' ? { dou: escolhida, recebo: t.quero } : { dou: t.quero, recebo: escolhida };
}

// Tira a peça do guarda-roupa e dos looks e colagens que a usavam (regra do João).
function tirar(id) {
  const st = db.state;
  const usou = (look) => (look.camadas || []).some(c => c.itemId === id);
  const naColagem = (b) => (b.itens || []).some(c => c.itemId === id);
  const looks = (st.looks || []).filter(usou).length;
  const colagens = (st.boards || []).filter(naColagem).length;
  st.inventario = st.inventario.filter(p => p.id !== id);
  st.inventario.forEach((p, i) => { p.ordem = i; });
  st.looks = (st.looks || []).filter(l => !usou(l));
  st.boards = (st.boards || []).filter(b => !naColagem(b));
  return { looks, colagens };
}

function aplicarFeita(t) {
  const { dou, recebo } = lados(t);
  const perdidos = db.temPeca(dou.id) ? tirar(dou.id) : { looks: 0, colagens: 0 };
  const peca = pecaDoCatalogo(recebo.id);
  if (peca && !db.temPeca(recebo.id)) {
    const nova = db.adicionarPeca(peca, { origem: 'troca', raridade: recebo.raridade });
    if (nova) nova.numero = recebo.numero;
  }
  if (db.naWishlist(recebo.id)) db.alternarWishlist(recebo.id);
  esquecerHistorico(dou);
  esquecerHistorico(recebo);
  // Quem enviou já separou as fichas ao enviar; quem aceitou paga agora.
  if (!registro().cobradas[t.id]) db.state.fichas = Math.max(0, db.fichas() - custoDa(recebo.raridade));
  delete registro().cobradas[t.id];
  db.progredirMissao('trocar');
  return { dou, recebo, perdidos };
}

// As trocas resolvidas que o save ainda não aplicou: feitas (peças) e as que
// não saíram (fichas de volta para quem pediu).
async function aplicarPendentes() {
  const feitas = [];
  let mudou = false;
  for (const t of ultimas) {
    if (t.aplicada || t.estado === 'aberta') continue;
    if (t.estado === 'feita') {
      feitas.push(aplicarFeita(t));
      if (t.souEu === 'de') avisarTroca({ troca: t.id, quem: t.para.id, texto: `${t.para.handle} aceitou sua troca.` });
    } else if (t.souEu === 'de') {
      const volta = registro().cobradas[t.id] || 0;
      if (volta) { db.state.fichas = db.fichas() + volta; tocar('xp'); }
      delete registro().cobradas[t.id];
      if (t.estado !== 'cancelada') {
        const como = { recusada: 'recusou', vencida: 'não respondeu', invalida: 'não conseguiu fazer' }[t.estado];
        avisarTroca({ troca: t.id, quem: t.para.id,
          texto: `${t.para.handle} ${como} sua troca${volta ? '. As fichas voltaram.' : '.'}` });
      }
    }
    t.aplicada = true;
    mudou = true;
    chamar(`/api/trocas/${t.id}/aplicada`, {}).catch(() => { t.aplicada = false; });
  }
  if (mudou) db.salvar();
  for (const f of feitas) await animarTroca(f);
}

// Oferta nova para mim: vira aviso uma vez só.
function avisarNovas() {
  const r = registro();
  let nova = false;
  for (const t of ultimas) {
    if (t.souEu !== 'para' || t.estado !== 'aberta' || r.avisadas.includes(t.id)) continue;
    const peca = pecaDoCatalogo(t.quero.id);
    avisarTroca({ troca: t.id, quem: t.de.id,
      texto: `${t.de.handle} quer trocar ${peca ? nomeDaPeca(peca) : 'uma peça sua'}.`, acao: 'Ver opções' });
    r.avisadas.push(t.id);
    nova = true;
  }
  if (nova) tocar('aviso');
  r.avisadas = r.avisadas.slice(-60);
}

export async function sincronizarTrocas() {
  if (!online || document.hidden) return;
  try {
    ultimas = (await chamar('/api/trocas')).trocas || [];
  } catch {
    return;
  }
  avisarNovas();
  await aplicarPendentes();
}

// ------------------------------- A animação --------------------------------
// A sua peça sai pela esquerda, a outra cruza para o centro e pula com a aura
// da raridade, como na abertura do baú.
function animarTroca({ dou, recebo, perdidos }) {
  return new Promise((pronto) => {
    const extra = perdidos.looks + perdidos.colagens
      ? `${[perdidos.looks && `${perdidos.looks} look${perdidos.looks > 1 ? 's' : ''}`,
          perdidos.colagens && `${perdidos.colagens} colage${perdidos.colagens > 1 ? 'ns' : 'm'}`]
        .filter(Boolean).join(' e ')} com a peça que foi saíram.`
      : '';
    const palco = el('div', { class: 'troca-palco' },
      figura(dou, { classe: 'troca-vai', rotulo: 'foi' }),
      figura(recebo, { classe: 'troca-vem', rotulo: 'chegou' }));
    const fundo = el('div', { class: 'troca-anim', role: 'dialog', 'aria-label': 'Troca feita' },
      el('h2', {}, 'Troca feita!'),
      palco,
      el('p', { class: 'troca-anim-texto' }, 'Nova no seu guarda-roupa.', extra ? el('small', {}, extra) : null),
      el('button', { type: 'button', class: 'btn-dark' }, 'Oba!'));
    const fechar = () => { fundo.remove(); pronto(); };
    fundo.querySelector('button').addEventListener('click', fechar);
    fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
    document.body.append(fundo);
    tocar('bau');
    setTimeout(() => tocar('pegou', recebo.raridade), 1300);
    requestAnimationFrame(() => fundo.classList.add('rodando'));
  });
}

// --------------------------------- Boot ------------------------------------
export function montarTrocas() {
  aoTocarEmTroca(abrirOferta);
  aoTocarEmTutorialTroca(abrirComoFunciona);
  sincronizarTrocas();
  setInterval(sincronizarTrocas, INTERVALO);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sincronizarTrocas(); });
}

// Sem servidor (file://) não há troca.
if (location.protocol === 'file:') online = false;
