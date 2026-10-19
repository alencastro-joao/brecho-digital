// "Meus stylists" e "Minhas colagens": o mesmo painel com os itens salvos,
// para abrir, renomear, favoritar, duplicar e apagar. No PC é um modal com
// uma grade de cartões; no celular ocupa a tela toda, duas colunas (ver
// stylist.css, classes ms-*). Cada tela passa os seus textos e o que fazer.
//
// Os ids no HTML seguem um prefixo: `${p}-busca`, `${p}-ordem`, `${p}-filtros`,
// `${p}-grade`, `${p}-sub`, `${p}-fechar`, `${p}-novo`.
import { el, $, toast } from './util.js';
import { ico } from './icones.js';
import { estrelaFavorito } from './favoritos.js';
import { confirmar } from './janela.js';
import { jaPublicado, apagarDoFeedPorOrigem } from './publicacoes.js';
import * as db from './db.js';

const quando = (x) => x.editadoEm || x.criadoEm || '';

function ordenarItens(itens, ordem) {
  const lista = [...itens];
  if (ordem === 'nome') return lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  // Sem data (save muito antigo), vale a posição na lista: o último salvo é o mais novo.
  const pos = new Map(itens.map((x, i) => [x.id, i]));
  lista.sort((a, b) => quando(b).localeCompare(quando(a)) || pos.get(b.id) - pos.get(a.id));
  return ordem === 'antigos' ? lista.reverse() : lista;
}

function dataCurta(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
    .replace(/ de /g, ' ').replace('.', '');
}

// Id novo que não repete nem duplicando duas vezes no mesmo milissegundo.
export const idNovo = (prefixo) =>
  prefixo + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Primeiro "Look N" (ou "Colagem N") livre: com Look 1 apagado e Look 2 salvo,
// o próximo é o 3, não outro 2.
export function nomeLivre(base, itens) {
  const usados = new Set(itens.map(x => x.nome));
  let n = itens.length + 1;
  while (usados.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/*
  opcoes = {
    prefixo: 'ms' | 'mc',
    botao: '#btn-meus-stylists',
    modal: '#modal-meus',
    lista: () => db.state.looks,
    tipoFav: 'look' | 'colagem',
    origem: 'look' | 'board',          // apagarDoFeedPorOrigem
    campo: 'lookId' | 'boardId',       // jaPublicado
    prefixoId: 'l' | 'bd',
    maxNome: 40,
    feminino: false,                   // "salvo/salva", "Todos/Todas"…
    nomes: ['look', 'looks'],
    lugar: 'no palco',                 // selo do item aberto
    vazio: ['Nenhum look salvo ainda', 'Vista o avatar… "Salvar look"…'],
    abertoId: () => id do item na mesa,
    imagem: (item) => elemento,
    pecas: (item) => número de peças,
    abrir: (id) => põe na mesa,
    novo: async () => limpa a mesa (pode perguntar),
    aoRenomear: (id, nome) => {},      // item aberto: atualiza o campo do nome
    aoApagar: (id) => {},              // item aberto: deixa de ser ele
    aoMudar: () => {},                 // contador do botão
  }
*/
export function criarPainel(op) {
  const p = op.prefixo;
  const f = op.feminino;
  const [um, varios] = op.nomes;
  let filtro = 'todos';
  let menuAberto = null;    // id com o menu ⋯ aberto
  let renomeando = null;    // id com o nome virando campo
  let focoAntes = null;

  const modal = $(op.modal);
  const aberto = () => !modal.hidden;

  $(op.botao).addEventListener('click', abrir);
  $(`#${p}-fechar`).addEventListener('click', fechar);
  $(`#${p}-novo`).addEventListener('click', async () => {
    fechar();
    await op.novo();
  });
  $(`#${p}-busca`).addEventListener('input', render);
  $(`#${p}-ordem`).addEventListener('change', render);
  modal.addEventListener('pointerdown', (e) => { if (e.target === modal) fechar(); });
  // Clicar fora do ⋯ fecha o menu dele.
  modal.addEventListener('click', (e) => {
    if (menuAberto && !e.target.closest('.ms-menu, .ms-mais')) { menuAberto = null; render(); }
  });
  document.addEventListener('keydown', (e) => {
    if (!aberto()) return;
    // O Tab fica preso no painel: sem isso ele ia para a tela escondida atrás.
    if (e.key === 'Tab') {
      const focaveis = [...modal.querySelectorAll('button, input, select, [tabindex]:not([tabindex="-1"])')]
        .filter(n => !n.disabled && n.offsetParent !== null);
      if (!focaveis.length) return;
      const [primeiro, ultimo] = [focaveis[0], focaveis.at(-1)];
      if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
      else if (!modal.contains(document.activeElement)) { e.preventDefault(); primeiro.focus(); }
      return;
    }
    if (e.key !== 'Escape' || renomeando || document.querySelector('.modal.pergunta')) return;
    if (menuAberto) { menuAberto = null; render(); return; }
    fechar();
  });

  function abrir() {
    menuAberto = null;
    renomeando = null;
    focoAntes = document.activeElement;
    $(`#${p}-busca`).value = '';
    modal.hidden = false;
    document.body.classList.add('com-modal');
    render();
    // No celular o teclado abriria por cima da grade: o foco vai para o X.
    (matchMedia('(pointer: coarse)').matches ? $(`#${p}-fechar`) : $(`#${p}-busca`)).focus();
  }

  function fechar() {
    if (!aberto()) return;
    modal.hidden = true;
    if (!document.querySelector('.modal:not([hidden])')) document.body.classList.remove('com-modal');
    menuAberto = null;
    renomeando = null;
    focoAntes?.focus?.();
  }

  function render() {
    if (!aberto()) return;
    const itens = op.lista();
    const favs = itens.filter(x => x.favorito).length;
    const noFeed = itens.filter(x => x.publicado).length;

    $(`#${p}-sub`).textContent = itens.length
      ? `${itens.length} ${itens.length === 1 ? um : varios} ${itens.length === 1 ? (f ? 'salva' : 'salvo') : (f ? 'salvas' : 'salvos')} · ${favs} de 3 no perfil`
      : '';

    $(`#${p}-filtros`).replaceChildren(...[
      ['todos', f ? 'Todas' : 'Todos', itens.length],
      ['fav', [ico('estrela-cheia'), f ? ' Favoritas' : ' Favoritos'], favs],
      ['feed', 'No feed', noFeed],
    ].map(([id, nome, n]) => el('button', {
      type: 'button',
      class: 'ms-filtro' + (filtro === id ? ' ativo' : ''),
      'aria-pressed': String(filtro === id),
      onclick: () => { filtro = id; render(); },
    }, nome, el('small', {}, String(n)))));

    const termoCru = $(`#${p}-busca`).value.trim();
    const termo = termoCru.toLocaleLowerCase('pt-BR');
    const visiveis = ordenarItens(itens, $(`#${p}-ordem`).value).filter(x =>
      (filtro === 'todos' || (filtro === 'fav' ? x.favorito : x.publicado)) &&
      (!termo || x.nome.toLocaleLowerCase('pt-BR').includes(termo)));

    const grade = $(`#${p}-grade`);
    grade.replaceChildren();
    if (!itens.length) {
      grade.append(el('div', { class: 'ms-vazio' },
        el('strong', {}, op.vazio[0]), el('p', {}, op.vazio[1])));
      return;
    }
    if (!visiveis.length) {
      grade.append(el('div', { class: 'ms-vazio' },
        el('p', {}, termo ? `${f ? 'Nenhuma' : 'Nenhum'} ${um} com "${termoCru}".`
          : filtro === 'fav' ? `${f ? 'Nenhuma favorita' : 'Nenhum favorito'}. Toque na ☆ de ${f ? 'uma' : 'um'} ${um} para ${f ? 'ela' : 'ele'} ir para o seu perfil.`
          : `${f ? 'Nenhuma' : 'Nenhum'} ${um} ${f ? 'publicada' : 'publicado'} no feed ainda.`)));
      return;
    }
    for (const x of visiveis) grade.append(cartao(x));

    const campo = grade.querySelector('.ms-renomear');
    if (campo) { campo.focus(); campo.select(); }
  }

  function cartao(x) {
    const naMesa = x.id === op.abertoId();
    const nPecas = op.pecas(x);

    const nome = renomeando === x.id
      ? el('input', {
        class: 'ms-renomear', type: 'text', value: x.nome, maxlength: String(op.maxNome),
        'aria-label': `Novo nome ${f ? 'da' : 'do'} ${um}`,
        onkeydown: (e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          // Esc aqui só desiste do nome: não pode subir e fechar o painel.
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); renomeando = null; render(); }
        },
        onblur: (e) => { if (renomeando === x.id) renomear(x.id, e.currentTarget.value); },
      })
      : el('button', {
        type: 'button', class: 'ms-nome', title: 'Renomear',
        onclick: () => { renomeando = x.id; menuAberto = null; render(); },
      }, x.nome);

    const menu = menuAberto === x.id ? el('div', { class: 'ms-menu', role: 'menu' },
      el('button', { type: 'button', role: 'menuitem', onclick: () => abrirNaMesa(x.id) }, ico('editar'), ' Abrir e editar'),
      el('button', {
        type: 'button', role: 'menuitem',
        onclick: () => { renomeando = x.id; menuAberto = null; render(); },
      }, 'Aa Renomear'),
      el('button', { type: 'button', role: 'menuitem', onclick: () => duplicar(x.id) }, ico('duplicar'), ' Duplicar'),
      el('button', { type: 'button', role: 'menuitem', class: 'perigo', onclick: () => apagar(x.id) }, ico('lixo'), ' Excluir'),
    ) : null;

    return el('article', { class: 'ms-card' + (naMesa ? ' aberto' : '') + (menu ? ' com-menu' : '') },
      el('button', {
        type: 'button', class: 'ms-thumb',
        title: `Abrir "${x.nome}" para editar`,
        'aria-label': `Abrir "${x.nome}" para editar`,
        onclick: () => abrirNaMesa(x.id),
      },
        op.imagem(x),
        el('span', { class: 'ms-editar' }, ico('editar'), ' Editar'),
        naMesa ? el('span', { class: 'ms-selo' }, op.lugar) : null,
        x.publicado ? el('span', { class: 'ms-selo feed' }, 'no feed') : null,
      ),
      el('div', { class: 'ms-fav' }, estrelaFavorito(op.tipoFav, x.id, () => { op.aoMudar(); render(); })),
      el('div', { class: 'ms-info' },
        el('div', { class: 'ms-linha' },
          nome,
          el('button', {
            type: 'button', class: 'ms-apagar', title: `Apagar "${x.nome}"`,
            'aria-label': `Apagar "${x.nome}"`,
            onclick: () => apagar(x.id),
          }, ico('lixo')),
          el('button', {
            type: 'button', class: 'ms-mais', title: 'Mais opções', 'aria-label': 'Mais opções',
            'aria-haspopup': 'menu', 'aria-expanded': menu ? 'true' : 'false',
            onclick: () => { menuAberto = menuAberto === x.id ? null : x.id; render(); },
          }, ico('mais'))),
        el('small', {}, [dataCurta(quando(x)),
          nPecas === 1 ? '1 peça' : `${nPecas} peças`].filter(Boolean).join(' · '))),
      menu);
  }

  function abrirNaMesa(id) {
    op.abrir(id);
    fechar();
    const x = op.lista().find(i => i.id === id);
    if (x) toast(`"${x.nome}" ${op.lugar}. Mexa e salve.`);
  }

  function renomear(id, valor) {
    renomeando = null;
    const x = op.lista().find(i => i.id === id);
    const nome = String(valor || '').trim().slice(0, op.maxNome);
    if (x && nome && nome !== x.nome) {
      x.nome = nome;
      op.aoRenomear(id, nome);
      db.salvar();
      toast(`${f ? 'Renomeada' : 'Renomeado'} para "${nome}".`);
    }
    op.aoMudar();
    render();
  }

  function duplicar(id) {
    const orig = op.lista().find(i => i.id === id);
    if (!orig) return;
    const agora = new Date().toISOString();
    // A cópia é nova: não herda a estrela (o perfil tem três vagas) nem o
    // "no feed" — quem foi publicado foi o original.
    const copia = {
      ...structuredClone(orig),
      id: idNovo(op.prefixoId),
      nome: `${orig.nome} (cópia)`.slice(0, op.maxNome),
      criadoEm: agora,
      editadoEm: agora,
      publicado: false,
      favorito: false,
    };
    op.lista().push(copia);
    menuAberto = null;
    db.salvar();
    op.aoMudar();
    render();
    toast(`"${copia.nome}" ${f ? 'criada' : 'criado'}.`);
  }

  async function apagar(id) {
    const x = op.lista().find(i => i.id === id);
    if (!x) return;
    menuAberto = null;
    const noFeed = jaPublicado(op.campo, id) || x.publicado;
    const ok = await confirmar(
      'Não dá para desfazer.' + (noFeed ? ` O post ${f ? 'dela' : 'dele'} sai do feed também.` : ''),
      { titulo: `Excluir "${x.nome}"?`, sim: 'Excluir', perigo: true });
    if (!ok) { render(); return; }
    const lista = op.lista();
    const i = lista.indexOf(x);
    if (i >= 0) lista.splice(i, 1);
    op.aoApagar(id);
    db.salvar();
    op.aoMudar();
    render();
    toast(`"${x.nome}" ${f ? 'excluída' : 'excluído'}.`);
    apagarDoFeedPorOrigem(op.origem, id).then(ok => {
      db.salvar();
      if (!ok) toast('Não consegui tirar o post do feed agora. Apague por lá.', 'aviso');
    });
  }

  return { abrir, fechar, render, aberto, apagar };
}
