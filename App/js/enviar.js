// Enviar roupa: o jogador manda uma roupa dele para o João pôr no jogo.
//
// Abre pela engrenagem do perfil ("Enviar roupa"), numa tela cheia no
// acabamento das trocas: seta de voltar no topo, a ficha em painéis e o botão
// Enviar preso embaixo. A pessoa escolhe a foto e preenche tudo — nome, tipo,
// cor, marca e raridade —, com os mesmos blocos do mini game Preencher
// (ajudas.js).
//
// A foto não passa pela API: POST /api/envios devolve um POST assinado e ela
// sobe direto para o S3, como na esteira. Lá ela entra na esteira do João, à
// parte, na vista "Enviadas" (nuvem/lambda/esteira.py, "Roupas dos
// jogadores"). Embaixo, a lista do que a pessoa já mandou e como está.
//
// Enviada a foto, a tela espera a nuvem tirar o fundo (o trabalhador só tira
// se a foto ainda tiver fundo) e abre o ajuste no corpo, o mesmo do mini game
// Ajustar: a medida que a pessoa deixar vai junto para a esteira.

import { CATEGORIAS, ORDEM_CATEGORIAS, CORES, RARIDADES, RARIDADE, ancoraPadrao } from './config.js';
import * as db from './db.js';
import { el, toast, tempoRelativo } from './util.js';
import { ico, emo } from './icones.js';
import { tocar } from './sons.js';
import { telaTroca, secao } from './trocas.js';
import { montarAjuste } from './ajudas.js';

const MAX_FOTO = 15 * 1024 * 1024;      // o mesmo de esteira.py (MAX_FOTO_JOGADOR)
const TIPOS = ['image/jpeg', 'image/png', 'image/webp'];
const ESPERA_MS = 3000;                 // de quanto em quanto pergunta se o fundo já saiu
const ESPERA_MAX = 5 * 60 * 1000;       // depois disso, o João ajusta na esteira

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

export function abrirEnviarRoupa() {
  const ficha = { nome: '', cat: '', cor: '', marca: '', raridade: '' };
  let arquivo = null;
  let urlPrevia = '';
  let enviando = false;

  // ------------------------------- A foto --------------------------------
  const previa = el('div', { class: 'ev-previa' },
    el('span', { class: 'ev-previa-vazia' }, ico('camera'), el('small', {}, 'Nenhuma foto ainda')));
  const escolher = (input) => {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    if (!TIPOS.includes(f.type)) return toast('A foto precisa ser JPG, PNG ou WebP.', 'aviso');
    if (f.size > MAX_FOTO) return toast('Essa foto passa de 15 MB. Escolha uma menor.', 'aviso');
    arquivo = f;
    if (urlPrevia) URL.revokeObjectURL(urlPrevia);
    urlPrevia = URL.createObjectURL(f);
    previa.replaceChildren(el('img', { src: urlPrevia, alt: 'A foto da sua roupa' }));
    tocar('escolha');
    conferir();
  };
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
    oninput: () => { ficha.nome = campoNome.value.trim(); conferir(); } });

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
          el('strong', {}, e.nome || 'Roupa'),
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
  function conferir() {
    botaoEnviar.disabled = enviando;
    botaoEnviar.classList.toggle('incompleto', !!falta());
  }
  const falta = () => !arquivo ? 'Escolha a foto da roupa.'
    : ficha.nome.length < 2 ? 'Dê um nome para a peça.'
    : !ficha.cat ? 'Escolha o tipo da peça.'
    : !ficha.cor ? 'Escolha a cor principal.'
    : !ficha.raridade ? 'Escolha a raridade.' : '';

  const { caixa, fechar } = telaTroca('Enviar roupa', [
    el('p', { class: 'ev-intro' }, 'Mande uma roupa sua para entrar no brechó. ',
      el('b', {}, 'Ela vai para a análise'), ' e, se for aprovada, vira peça do jogo.'),
    secao('Foto', previa,
      el('p', { class: 'ev-dica' }, 'A roupa sozinha, de frente e com boa luz. O fundo a gente tira.'),
      botoesFoto),
    secao('Ficha da peça',
      el('div', { class: 'ev-blocos' },
        bloco('Nome', el('small', {}, 'como ela vai aparecer'), campoNome),
        bloco('Tipo de peça', el('small', {}, 'o que é?'), tipos),
        bloco('Cor principal', nomeCor, cores),
        bloco('Marca', el('small', {}, 'se souber'), campoMarca, atalhos),
        bloco('Raridade', nomeRar, raridades))),
    secao('Suas roupas enviadas', lista),
  ], [
    el('button', { type: 'button', class: 'btn-ghost', onclick: () => fechar() }, 'Cancelar'),
    botaoEnviar,
  ], null, () => { if (urlPrevia) URL.revokeObjectURL(urlPrevia); }, { info: false });

  botaoEnviar.addEventListener('click', async () => {
    const motivo = falta();
    if (motivo) return toast(motivo, 'aviso');
    enviando = true;
    conferir();
    botaoEnviar.replaceChildren(ico('relogio'), 'Enviando…');
    try {
      const { envio } = await chamar('/api/envios', {
        arquivo: { nome: arquivo.name, tipo: arquivo.type, bytes: arquivo.size },
        ficha,
      });
      await subirFoto(envio, arquivo);
      tocar('ok');
      esperarFundo(envio.id);
    } catch (e) {
      enviando = false;
      botaoEnviar.replaceChildren(ico('ok'), 'Enviar roupa');
      conferir();
      tocar('naocurti');
      toast(e.message, 'erro');
    }
  });

  // --------------------------- Depois de enviar --------------------------
  // O corpo e o rodapé da tela viram a espera e, depois, o ajuste no corpo.
  const corpo = caixa.querySelector('.troca-corpo');
  const rodape = caixa.querySelector('.troca-rodape');
  const titulo = caixa.querySelector('.troca-topo h2');
  let vivo = true;
  const sair = () => { vivo = false; fechar(); };
  const botaoSair = (texto) => el('button', { type: 'button', class: 'btn-ghost', onclick: sair }, texto);

  function esperarFundo(id) {
    titulo.textContent = 'Preparando a peça';
    corpo.replaceChildren(secao('', el('div', { class: 'ev-espera' },
      el('span', { class: 'ev-girando', 'aria-hidden': 'true' }),
      el('strong', {}, 'Roupa enviada!'),
      el('p', {}, 'Agora a gente tira o fundo da foto. Leva uns segundos e, depois, ',
        el('b', {}, 'você ajusta a peça no corpo'), '.'))));
    rodape.replaceChildren(botaoSair('Deixar para depois'));
    const inicio = Date.now();
    const perguntar = async () => {
      if (!vivo) return;
      try {
        const { envio } = await chamar(`/api/envios/${id}`);
        if (envio.estado === 'pronta' && envio.previa) return ajustar(envio);
        if (envio.estado === 'erro') return terminar('Não deu para tirar o fundo dessa foto. A roupa ficou em análise e o ajuste é feito lá.');
      } catch { /* tenta de novo */ }
      if (Date.now() - inicio > ESPERA_MAX) return terminar('A foto está demorando. A roupa ficou em análise e o ajuste é feito lá.');
      setTimeout(perguntar, ESPERA_MS);
    };
    setTimeout(perguntar, ESPERA_MS);
  }

  function ajustar(envio) {
    if (!vivo) return;
    titulo.textContent = 'Ajustar no corpo';
    tocar('janela');
    const p = ancoraPadrao(envio.cat || ficha.cat);
    const peca = { cat: envio.cat || ficha.cat, src: envio.previa, w: envio.w, h: envio.h, nome: ficha.nome };
    const { nos, posicionar } = montarAjuste(peca, {
      medida: { x: p.x, y: p.y, w: p.w, rot: 0 },
      dica: 'Arraste a peça pela alça e use a barra para o tamanho, até ficar como ela fica no corpo.',
      botao: 'Pronto, enviar assim',
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
    rodape.replaceChildren(botaoSair('Pular o ajuste'));
    posicionar();
  }

  function terminar(texto) {
    if (!vivo) return;
    corpo.replaceChildren(secao('', el('div', { class: 'ev-espera' },
      el('strong', {}, 'Roupa enviada!'), el('p', {}, texto))));
    rodape.replaceChildren(botaoSair('Fechar'));
  }

  lerLista();
}
