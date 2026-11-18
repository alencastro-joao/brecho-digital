// Enviar roupa: o jogador manda uma roupa dele para o João pôr no jogo.
//
// Abre pela engrenagem do perfil ("Enviar roupa"), numa tela cheia no
// acabamento das trocas: seta de voltar no topo, a ficha em painéis e o botão
// Enviar preso embaixo. A pessoa escolhe a foto e preenche tipo, cor, marca,
// raridade e, se quiser, o nome e a coleção, com os mesmos blocos do mini game
// Preencher (ajudas.js).
//
// A foto sobe assim que é escolhida (POST /api/envios devolve um POST
// assinado e ela vai direto para o S3, como na esteira): a nuvem tira o fundo
// enquanto a pessoa preenche, e a foto já recortada aparece no quadro, com o
// lápis do lado para cortar o que sobrou. Até o Enviar ela é rascunho e a
// esteira não mostra. O Enviar manda a ficha e o corte (PUT) e abre o ajuste
// no corpo, o mesmo do mini game Ajustar; a medida vai junto. Na esteira do
// João ela fica à parte, na vista "Enviadas" (nuvem/lambda/esteira.py,
// "Roupas dos jogadores"). Embaixo, a lista do que a pessoa já mandou.

import { CATEGORIAS, ORDEM_CATEGORIAS, CORES, RARIDADES, RARIDADE, ESTILOS, ancoraPadrao } from './config.js';
import * as db from './db.js';
import { el, toast, tempoRelativo, clamp } from './util.js';
import { ico, emo } from './icones.js';
import { tocar } from './sons.js';
import { telaTroca, secao } from './trocas.js';
import { montarAjuste } from './ajudas.js';

const MAX_FOTO = 15 * 1024 * 1024;      // o mesmo de esteira.py (MAX_FOTO_JOGADOR)
const TIPOS = ['image/jpeg', 'image/png', 'image/webp'];
const ESPERA_MS = 2500;                 // de quanto em quanto pergunta se o fundo já saiu
const ESPERA_MAX = 5 * 60 * 1000;       // depois disso, desiste de esperar
const MIN_CORTE = 0.05;
const INTEIRA = { x: 0, y: 0, w: 1, h: 1 };

const ESTADOS = {
  analise: { nome: 'Em análise', classe: 'analise' },
  publicada: { nome: 'Entrou no jogo', classe: 'publicada' },
  recusada: { nome: 'Não entrou', classe: 'recusada' },
};

async function chamar(rota, corpo, metodo = corpo ? 'POST' : 'GET') {
  const r = await fetch(rota, {
    method: metodo,
    credentials: 'include',
    headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.erro || 'Não consegui falar com o servidor.');
  return dados;
}

// O POST assinado do S3: os campos primeiro, o arquivo por último.
async function subirFoto(envio, arquivo) {
  const form = new FormData();
  for (const [k, v] of Object.entries(envio.campos)) form.append(k, v);
  form.append('file', arquivo);
  const r = await fetch(envio.url, { method: 'POST', body: form });
  if (!r.ok) throw new Error('A foto não subiu. Tente de novo.');
}

const bloco = (titulo, dica, ...conteudo) => el('div', { class: 'mg-bloco' },
  el('div', { class: 'mg-bloco-topo' }, el('strong', {}, titulo), dica), ...conteudo);

// A imagem dentro de uma janela de overflow escondido mostra só o corte
// (o mesmo `enquadrar` da esteira).
function enquadrar(img, c) {
  Object.assign(img.style, { width: `${100 / c.w}%`, height: `${100 / c.h}%`,
    left: `${-c.x / c.w * 100}%`, top: `${-c.y / c.h * 100}%` });
}

// ------------------------------- Recortar ----------------------------------
// A foto já sem fundo, com a caixa do que fica: arrastar move, os cantos
// mudam o tamanho. Tela cheia por cima do envio, no mesmo acabamento.
function abrirRecorte(src, atual, aoAplicar) {
  const c = { ...atual };
  const img = el('img', { src, alt: '', draggable: 'false' });
  const furo = el('div', { class: 'ev-corte-furo' });
  const caixa = el('div', { class: 'ev-corte-caixa' },
    ...['no', 'ne', 'so', 'se'].map(k => el('span', { class: 'ev-alca ' + k, 'data-canto': k })));
  const palco = el('div', { class: 'ev-corte-palco' }, img, el('div', { class: 'ev-corte-veu' }, furo), caixa);
  const desenhar = () => {
    for (const no of [caixa, furo]) Object.assign(no.style, {
      left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` });
  };
  caixa.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const r = palco.getBoundingClientRect();
    const canto = e.target.dataset?.canto || '';
    const base = { ...c };
    const x0 = e.clientX, y0 = e.clientY;
    caixa.setPointerCapture(e.pointerId);
    const mover = (ev) => {
      const dx = (ev.clientX - x0) / r.width;
      const dy = (ev.clientY - y0) / r.height;
      if (!canto) {
        c.x = clamp(base.x + dx, 0, 1 - base.w);
        c.y = clamp(base.y + dy, 0, 1 - base.h);
      } else {
        let { x, y } = base;
        let x2 = base.x + base.w, y2 = base.y + base.h;
        if (canto.includes('o')) x = clamp(base.x + dx, 0, x2 - MIN_CORTE);
        if (canto.includes('e')) x2 = clamp(x2 + dx, x + MIN_CORTE, 1);
        if (canto.startsWith('n')) y = clamp(base.y + dy, 0, y2 - MIN_CORTE);
        if (canto.startsWith('s')) y2 = clamp(y2 + dy, y + MIN_CORTE, 1);
        Object.assign(c, { x, y, w: x2 - x, h: y2 - y });
      }
      desenhar();
    };
    const soltar = () => {
      caixa.removeEventListener('pointermove', mover);
      caixa.removeEventListener('pointerup', soltar);
      caixa.removeEventListener('pointercancel', soltar);
    };
    caixa.addEventListener('pointermove', mover);
    caixa.addEventListener('pointerup', soltar);
    caixa.addEventListener('pointercancel', soltar);
  });
  const { fechar } = telaTroca('Recortar a foto', [
    el('p', { class: 'ev-intro' }, 'Arraste a caixa e os cantos: fica só o que estiver dentro.'),
    el('div', { class: 'ev-corte' }, palco),
  ], [
    el('button', { type: 'button', class: 'btn-ghost', onclick: () => { aoAplicar(null); fechar(); } }, 'Sem corte'),
    el('button', { type: 'button', class: 'btn-dark troca-aceitar ev-enviar', onclick: () => {
      const inteira = c.w > 0.995 && c.h > 0.995;
      aoAplicar(inteira ? null : { x: +c.x.toFixed(4), y: +c.y.toFixed(4), w: +c.w.toFixed(4), h: +c.h.toFixed(4) });
      tocar('ok');
      fechar();
    } }, ico('cortar'), 'Aplicar corte'),
  ], null, null, { info: false });
  desenhar();
}

// --------------------------------- A tela ----------------------------------
export function abrirEnviarRoupa() {
  const ficha = { nome: '', cat: '', cor: '', marca: '', raridade: '', tema: '' };
  let envio = null;          // { id, estado, previa, w, h } da foto que subiu
  let corte = null;
  let vez = 0;               // cada foto nova invalida a espera da anterior
  let enviando = false;
  let vivo = true;
  let aoMudarFoto = () => {};  // o botão Enviar acende quando a foto fica pronta

  // ------------------------------- A foto --------------------------------
  const previa = el('div', { class: 'ev-previa' });
  const pintarPrevia = () => {
    desenharPrevia();
    aoMudarFoto();
  };
  const desenharPrevia = () => {
    if (!envio) {
      previa.replaceChildren(el('span', { class: 'ev-previa-vazia' }, ico('camera'), el('small', {}, 'Nenhuma foto ainda')));
      return;
    }
    if (envio.estado === 'pronta' && envio.previa) {
      const img = el('img', { src: envio.previa, alt: 'A sua roupa, já sem fundo', draggable: 'false' });
      const c = corte || INTEIRA;
      // A janela tem a proporção do recorte; a foto inteira fica por dentro.
      const prop = ((envio.w || 1) * c.w) / ((envio.h || 1) * c.h);
      const janela = el('div', { class: 'ev-recorte', style: { aspectRatio: String(prop) } }, img);
      // Cabe no quadro pelo lado que encosta primeiro.
      const quadro = (previa.clientWidth || 300) / (previa.clientHeight || 240);
      janela.style[prop > quadro ? 'width' : 'height'] = '86%';
      enquadrar(img, c);
      previa.replaceChildren(janela,
        el('button', { type: 'button', class: 'ev-lapis', title: 'Recortar a foto', 'aria-label': 'Recortar a foto',
          onclick: () => abrirRecorte(envio.previa, corte || INTEIRA, (novo) => { corte = novo; pintarPrevia(); }) },
        ico('editar')));
      return;
    }
    if (envio.estado === 'erro') {
      previa.replaceChildren(el('span', { class: 'ev-previa-vazia' }, ico('x'),
        el('small', {}, 'Não deu para tirar o fundo dessa foto. Tente outra.')));
      return;
    }
    previa.replaceChildren(
      envio.local ? el('img', { class: 'ev-previa-crua', src: envio.local, alt: '' }) : null,
      el('span', { class: 'ev-previa-tirando' }, el('span', { class: 'ev-girando', 'aria-hidden': 'true' }),
        el('small', {}, 'Tirando o fundo…')));
  };
  pintarPrevia();

  async function escolher(input) {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    if (!TIPOS.includes(f.type)) return toast('A foto precisa ser JPG, PNG ou WebP.', 'aviso');
    if (f.size > MAX_FOTO) return toast('Essa foto passa de 15 MB. Escolha uma menor.', 'aviso');
    const minha = ++vez;
    if (envio?.local) URL.revokeObjectURL(envio.local);
    corte = null;
    envio = { estado: 'enviando', local: URL.createObjectURL(f) };
    tocar('escolha');
    pintarPrevia();
    try {
      const { envio: reserva } = await chamar('/api/envios', { arquivo: { nome: f.name, tipo: f.type, bytes: f.size } });
      await subirFoto(reserva, f);
      if (minha !== vez) return;
      envio.id = reserva.id;
      esperarFundo(minha);
    } catch (e) {
      if (minha !== vez) return;
      envio = null;
      pintarPrevia();
      tocar('naocurti');
      toast(e.message, 'erro');
    }
  }

  function esperarFundo(minha) {
    const inicio = Date.now();
    const perguntar = async () => {
      if (minha !== vez || !vivo) return;
      try {
        const { envio: e } = await chamar(`/api/envios/${envio.id}`);
        if (minha !== vez) return;
        if (e.estado === 'pronta' || e.estado === 'erro') {
          envio = { ...envio, ...e };
          if (e.estado === 'pronta') tocar('ok');
          return pintarPrevia();
        }
      } catch { /* tenta de novo */ }
      if (Date.now() - inicio > ESPERA_MAX) {
        envio = { ...envio, estado: 'erro' };
        return pintarPrevia();
      }
      setTimeout(perguntar, ESPERA_MS);
    };
    setTimeout(perguntar, ESPERA_MS);
  }

  const camera = el('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true,
    onchange: (e) => escolher(e.target) });
  const galeria = el('input', { type: 'file', accept: TIPOS.join(','), hidden: true,
    onchange: (e) => escolher(e.target) });
  const botoesFoto = el('div', { class: 'ev-foto-botoes' },
    el('label', { class: 'mg-voto' }, ico('camera'), 'Fotografar', camera),
    el('label', { class: 'mg-voto' }, ico('publicar'), 'Escolher foto', galeria));

  // ------------------------------- A ficha -------------------------------
  const campoNome = el('input', { class: 'mg-marca', type: 'text', maxlength: '60',
    placeholder: 'Ex.: Jaqueta jeans oversized', autocomplete: 'off',
    oninput: () => { ficha.nome = campoNome.value.trim(); } });

  const tipos = el('div', { class: 'mg-tipos' });
  const renderTipos = () => tipos.replaceChildren(...ORDEM_CATEGORIAS.map(c => el('button', {
    type: 'button', class: 'mg-tipo' + (c === ficha.cat ? ' ativa' : ''),
    onclick: () => { ficha.cat = ficha.cat === c ? '' : c; tocar('escolha'); renderTipos(); conferir(); },
  }, emo(CATEGORIAS[c].icone), el('span', {}, CATEGORIAS[c].nome))));
  renderTipos();

  const nomeCor = el('small', {}, 'escolha uma');
  const cores = el('div', { class: 'mg-cores' });
  const renderCores = () => {
    cores.replaceChildren(...CORES.map(c => el('button', {
      type: 'button', class: 'mg-cor' + (c.nome === ficha.cor ? ' ativa' : '') + (c.hex === 'estampa' ? ' estampa' : ''),
      title: c.nome, 'aria-label': c.nome,
      style: c.hex === 'estampa' ? {} : { '--cor': c.hex },
      onclick: () => { ficha.cor = ficha.cor === c.nome ? '' : c.nome; tocar('escolha'); renderCores(); conferir(); },
    })));
    nomeCor.textContent = ficha.cor || 'escolha uma';
  };
  renderCores();

  const campoMarca = el('input', { class: 'mg-marca', type: 'text', maxlength: '40',
    placeholder: 'Escreva a marca', autocomplete: 'off',
    oninput: () => { ficha.marca = campoMarca.value.trim(); } });
  const atalhos = el('div', { class: 'mg-marcas' }, ...db.marcasOrdenadas().slice(0, 8).map(m =>
    el('button', { type: 'button', class: 'mg-marca-chip', onclick: () => {
      campoMarca.value = m.nome; ficha.marca = m.nome;
    } }, m.nome)));

  // Raridade: um bloco pérola por raridade, com a cor dela, como nas fichas.
  const nomeRar = el('small', {}, 'escolha uma');
  const raridades = el('div', { class: 'ev-raridades' });
  const renderRaridades = () => {
    raridades.replaceChildren(...RARIDADES.map(r => el('button', {
      type: 'button', class: 'ev-rar' + (r.id === ficha.raridade ? ' ativa' : '') + (r.aura === 'arco-iris' ? ' arco-iris' : ''),
      style: { '--rar': r.aura && r.aura !== 'arco-iris' ? r.aura : r.cor, '--rar-fundo': r.bg },
      onclick: () => { ficha.raridade = ficha.raridade === r.id ? '' : r.id; tocar('escolha'); renderRaridades(); conferir(); },
    }, el('span', { class: 'ev-rar-ponto' }), el('span', {}, r.nome))));
    nomeRar.textContent = RARIDADE[ficha.raridade]?.nome || 'escolha uma';
  };
  renderRaridades();

  // Coleção: os Temas do jogo (config.ESTILOS), com o ícone de cada um. Opcional.
  const nomeColecao = el('small', {}, 'se fizer parte');
  const colecoes = el('div', { class: 'ev-colecoes' });
  const renderColecoes = () => {
    colecoes.replaceChildren(...Object.entries(ESTILOS).map(([id, t]) => el('button', {
      type: 'button', class: 'mg-tipo ev-colecao' + (id === ficha.tema ? ' ativa' : ''),
      onclick: () => { ficha.tema = ficha.tema === id ? '' : id; tocar('escolha'); renderColecoes(); },
    }, el('img', { src: t.icone, alt: '' }), el('span', {}, t.nome))));
    nomeColecao.textContent = ESTILOS[ficha.tema]?.nome || 'se fizer parte';
  };
  renderColecoes();

  // ------------------------- O que já foi enviado ------------------------
  const lista = el('div', { class: 'ev-lista' }, el('p', { class: 'ev-vazio' }, 'Carregando…'));
  const renderLista = (dados) => {
    const envios = dados.envios || [];
    if (!envios.length) {
      lista.replaceChildren(el('p', { class: 'ev-vazio' }, 'Você ainda não mandou nenhuma roupa.'));
      return;
    }
    lista.replaceChildren(...envios.map(e => {
      const est = ESTADOS[e.estado] || ESTADOS.analise;
      const r = RARIDADE[e.raridade];
      return el('div', { class: 'ev-envio' },
        el('span', { class: 'ev-envio-ico' }, emo(CATEGORIAS[e.cat]?.icone || '👕')),
        el('div', { class: 'ev-envio-texto' },
          el('strong', {}, e.nome || CATEGORIAS[e.cat]?.nome || 'Roupa'),
          el('small', {}, [r?.nome, e.marca, tempoRelativo(e.em)].filter(Boolean).join(' · '))),
        el('span', { class: 'ev-estado ' + est.classe }, est.nome));
    }));
  };
  const lerLista = () => chamar('/api/envios').then(renderLista).catch((e) => {
    lista.replaceChildren(el('p', { class: 'ev-vazio' }, e.message));
  });

  // ------------------------------- Enviar --------------------------------
  // Fica apagado até a ficha fechar, mas tocável: o toque diz o que falta.
  const botaoEnviar = el('button', { type: 'button', class: 'btn-dark troca-aceitar ev-enviar incompleto' },
    ico('ok'), 'Enviar roupa');
  const falta = () => !envio ? 'Escolha a foto da roupa.'
    : envio.estado === 'erro' ? 'Não deu para tirar o fundo dessa foto. Escolha outra.'
    : envio.estado !== 'pronta' ? 'Espere um pouco: o fundo da foto ainda está saindo.'
    : !ficha.cat ? 'Escolha o tipo da peça.'
    : !ficha.cor ? 'Escolha a cor principal.'
    : !ficha.raridade ? 'Escolha a raridade.' : '';
  function conferir() {
    botaoEnviar.disabled = enviando;
    botaoEnviar.classList.toggle('incompleto', !!falta());
  }

  const { caixa, fechar } = telaTroca('Enviar roupa', [
    el('p', { class: 'ev-intro' }, 'Mande uma roupa sua para entrar no brechó. ',
      el('b', {}, 'Ela vai para a análise'), ' e, se for aprovada, vira peça do jogo.'),
    secao('Foto', previa,
      el('p', { class: 'ev-dica' }, 'A roupa sozinha, de frente e com boa luz. O fundo sai na hora; o lápis recorta o que sobrar.'),
      botoesFoto),
    secao('Ficha da peça',
      el('div', { class: 'ev-blocos' },
        bloco('Nome', el('small', {}, 'opcional'), campoNome),
        bloco('Tipo de peça', el('small', {}, 'o que é?'), tipos),
        bloco('Cor principal', nomeCor, cores),
        bloco('Marca', el('small', {}, 'se souber'), campoMarca, atalhos),
        bloco('Raridade', nomeRar, raridades),
        bloco('Coleção', nomeColecao, colecoes))),
    secao('Suas roupas enviadas', lista),
  ], [
    el('button', { type: 'button', class: 'btn-ghost', onclick: () => sair() }, 'Cancelar'),
    botaoEnviar,
  ], null, () => { vivo = false; if (envio?.local) URL.revokeObjectURL(envio.local); }, { info: false });

  aoMudarFoto = conferir;

  botaoEnviar.addEventListener('click', async () => {
    const motivo = falta();
    if (motivo) return toast(motivo, 'aviso');
    enviando = true;
    conferir();
    botaoEnviar.replaceChildren(ico('relogio'), 'Enviando…');
    try {
      await chamar(`/api/envios/${envio.id}`, { ficha, corte: corte || false }, 'PUT');
      tocar('ok');
      ajustar();
    } catch (e) {
      enviando = false;
      botaoEnviar.replaceChildren(ico('ok'), 'Enviar roupa');
      conferir();
      tocar('naocurti');
      toast(e.message, 'erro');
    }
  });

  // --------------------------- Depois de enviar --------------------------
  // O corpo e o rodapé da tela viram o ajuste no corpo.
  const corpo = caixa.querySelector('.troca-corpo');
  const rodape = caixa.querySelector('.troca-rodape');
  const titulo = caixa.querySelector('.troca-topo h2');
  function sair() { vivo = false; fechar(); }
  const enviada = () => { sair(); toast('Roupa enviada! Ela está em análise.', 'ok'); };

  function ajustar() {
    titulo.textContent = 'Ajustar no corpo';
    tocar('janela');
    const p = ancoraPadrao(ficha.cat);
    const peca = { cat: ficha.cat, src: envio.previa, w: envio.w, h: envio.h, nome: ficha.nome };
    const { nos, posicionar } = montarAjuste(peca, {
      medida: { x: p.x, y: p.y, w: p.w, rot: 0 },
      corte,
      dica: 'Arraste a peça pela alça e use a barra para o tamanho, até ficar como ela fica no corpo.',
      botao: 'Pronto, ficou assim',
      aoPronto: async (medida) => {
        try {
          await chamar(`/api/envios/${envio.id}`, { medida }, 'PUT');
          tocar('ok');
          sair();
          toast('Roupa enviada e ajustada! Ela está em análise.', 'ok');
        } catch (e) {
          tocar('naocurti');
          toast(e.message, 'erro');
        }
      },
    });
    corpo.replaceChildren(el('div', { class: 'ev-ajuste' }, ...nos));
    rodape.replaceChildren(el('button', { type: 'button', class: 'btn-ghost', onclick: enviada }, 'Pular o ajuste'));
    posicionar();
  }

  lerLista();
}
