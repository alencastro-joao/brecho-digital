// Boot: entra na conta, carrega o catálogo, monta as telas e liga o roteador.
//
// A ordem importa e é esta: primeiro saber quem é (auth), depois abrir o save
// dessa pessoa (db.iniciarEstado), e só então montar tela alguma. Montar antes
// seria desenhar o guarda-roupa de ninguém — e, pior, gravar por cima do save
// de quem entrar depois.

import { ADMIN, aplicarPapel } from './config.js';
import * as auth from './auth.js';
import { pedirConta } from './telaauth.js';
import { carregarCatalogo, catalogo } from './catalog.js';
import * as db from './db.js';
import { carregarEstoque } from './estoque.js';
import { darPresente, resumoDoPresente, incomunsDoPresente } from './presente.js';
import { montarNPC, falarDe } from './npc.js';
import { iniciarRouter, onEnter } from './router.js';
import { montarVitrine, aoEntrarNaVitrine, atualizarBadge } from './vitrine.js';
import { montarCloset, aoEntrarNoCloset } from './closet.js';
import { montarStylist, aoEntrarNoStylist } from './stylist.js';
import { montarBoard, aoEntrarNoBoard } from './board.js';
import { aoEntrarNoSocial } from './social.js';
import { montarUsuario, aoEntrarNoUsuario } from './usuario.js';
import { montarTarefas, aoEntrarNasTarefas } from './tarefas.js';
import { montarPerfil, aoEntrarNoPerfil } from './perfil.js';
import { montarPlayer } from './player.js';
import { montarPaineis } from './paineis.js';
import { montarEditar } from './editar.js';
import { montarConexoes } from './conexoes.js';
import { montarBusca, montarBuscaNoFeed } from './busca.js';
import { sincronizarSocial, agendarPerfil } from './pessoas.js';
import { montarPersonagem, aoEntrarNoPersonagem } from './personagem.js';
import { montarVestiario, aoEntrarNoVestiario } from './vestiario.js';
import { montarNivel } from './nivel.js';
import { toast } from './util.js';

const AVISO_DE_CONFLITO = 'bd:aviso-conflito';

// Quem está logado, segundo o servidor — ou a tela de entrada até estar.
// O cookie de sessão dura 30 dias: na maioria das aberturas isto não mostra
// tela nenhuma, só devolve a conta e o app abre direto na vitrine.
async function entrar() {
  let conta = null;
  let aviso = '';
  let nova = false;               // a conta nasceu agora, nesta abertura
  try {
    conta = await auth.carregarSessao();
  } catch (e) {
    aviso = e.message;      // servidor de pé mas reclamando: a tela mostra
  }
  if (!conta) ({ conta, nova } = await pedirConta({ aviso }));

  aplicarPapel(conta.papel);      // o modo administrador vem da conta, não da URL
  db.iniciarEstado(conta);        // daqui para baixo, db.state é o save dela
  document.getElementById('app').hidden = false;
  return { conta, nova };
}

// O presente em um toast só: seis toasts, um por peça, empilhariam a tela
// inteira em cima da vitrine que a pessoa está vendo pela primeira vez. O que
// veio de incomum é dito pelo nome — é o que faz o presente parecer garimpo e
// não formulário preenchido.
function anunciarPresente(ganhas) {
  if (!ganhas.length) return;

  falarDe('presente', { tempo: 9000 });

  const incomuns = incomunsDoPresente(ganhas);
  toast(`Presente de boas-vindas: ${resumoDoPresente(ganhas)} no seu guarda-roupa.`);
  if (incomuns.length) {
    toast(incomuns.length === 1
      ? `${incomuns[0]} veio incomum.`
      : `${incomuns.join(' e ')} vieram incomuns.`, 'uncommon');
  }
}

async function iniciar() {
  const { conta, nova } = await entrar();

  // Os dois em paralelo porque nenhum depende do outro, e os dois precisam
  // estar prontos antes de montar tela alguma: o catálogo para desenhar as
  // peças, o save da nuvem para saber *quais* peças. Sincronizar depois de
  // montar seria desenhar o guarda-roupa errado e corrigir na frente da pessoa.
  // O save mudou em outro aparelho enquanto esta aba estava aberta: o db já
  // trouxe o de lá, e recarregar é o jeito de nenhuma tela ficar desenhando o
  // guarda-roupa velho. O aviso atravessa a recarga pelo sessionStorage.
  db.onConflito(({ perdeu }) => {
    try { sessionStorage.setItem(AVISO_DE_CONFLITO, perdeu ? 'perdeu' : 'trouxe'); } catch {}
    location.reload();
  });
  const [, sync] = await Promise.all([
    carregarCatalogo(), db.sincronizarDaNuvem(), carregarEstoque()]);
  db.esquecerPecas(catalogo.removidas);
  let conflito = null;
  try {
    conflito = sessionStorage.getItem(AVISO_DE_CONFLITO);
    sessionStorage.removeItem(AVISO_DE_CONFLITO);
  } catch {}
  if (conflito === 'perdeu' || sync.perdeu) {
    toast('Seu guarda-roupa mudou em outro aparelho e veio de lá. O que foi feito aqui depois disso não foi guardado.', 'aviso');
  } else if (conflito === 'trouxe') {
    toast('Guarda-roupa atualizado com o que você fez em outro aparelho.');
  } else if (sync.estado === 'veio da nuvem') {
    toast('Guarda-roupa trazido da sua conta.');
  } else if (sync.estado === 'offline') {
    toast('Sem conexão com o servidor: jogando no save deste navegador.', 'aviso');
  }

  // Quem você segue, segundo o servidor: seguir de um aparelho tem que valer no
  // outro, e as contas reais precisam estar carregadas antes de o perfil
  // desenhar a lista de amigos. Falhar aqui não é motivo para não abrir o app.
  await sincronizarSocial();

  // O que os outros leem de você (bio, rosto, roupa) sobe sozinho quando muda.
  db.onChange(agendarPerfil);
  agendarPerfil();

  // O presente de boas-vindas. Aqui e não antes: ele escolhe peças, e o catálogo
  // é o que diz quais existem e de que raridade são hoje. Aqui e não depois: as
  // telas ainda não foram montadas, então a vitrine já nasce sem as peças que
  // acabaram de virar suas — o sorteio do dia exclui o que você tem.
  const presente = nova ? darPresente() : [];

  // Modo administrador: sem o servidor local não há onde gravar a peça, e o
  // "+ Adicionar peça" só falharia na hora de salvar. Avisa logo na entrada.
  if (ADMIN) {
    document.body.classList.add('admin');
    if (location.protocol === 'file:') {
      toast('Modo admin aberto em file:// — abra por http://localhost:5173 (iniciar.bat) para conseguir gravar peças.', 'aviso');
    }
  }

  db.virarODiaSeNecessario();

  montarNivel();   // antes das telas: o selo da sidebar já nasce com o nível certo
  montarNPC();
  montarVitrine();
  montarCloset();
  montarStylist();
  montarBoard();
  montarTarefas();
  montarPerfil();
  montarEditar();
  montarConexoes();
  montarPersonagem();
  montarVestiario();
  montarUsuario();
  montarBusca();
  montarBuscaNoFeed();
  montarPlayer();

  onEnter('vitrine', aoEntrarNaVitrine);
  onEnter('closet', aoEntrarNoCloset);
  onEnter('stylist', aoEntrarNoStylist);
  onEnter('board', aoEntrarNoBoard);
  onEnter('social', aoEntrarNoSocial);
  onEnter('tarefas', aoEntrarNasTarefas);
  onEnter('perfil', aoEntrarNoPerfil);
  onEnter('usuario', aoEntrarNoUsuario);
  onEnter('personagem', aoEntrarNoPersonagem);
  onEnter('vestiario', aoEntrarNoVestiario);

  iniciarRouter();
  montarPaineis();   // depois do router: as colunas já têm largura real

  // Depois do router: entrar na vitrine faz o dono da loja falar, e a fala do
  // presente é a que tem de ficar na tela na primeira abertura.
  anunciarPresente(presente);

  // O dia pode virar com a aba aberta.
  setInterval(() => {
    if (db.virarODiaSeNecessario()) {
      montarVitrine();
      toast('Vitrine nova! O dono repôs as peças.');
    } else {
      atualizarBadge();
    }
  }, 60000);

  console.info(
    `%cBrechó Digital%c ${conta.handle} · ${catalogo.itens.length} peças · ` +
    `contorno vetorial: ${catalogo.temContorno ? 'sim' : 'não (hit-test por alpha)'}`,
    'font-weight:700', 'font-weight:400'
  );
}

iniciar().catch(err => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend',
    `<pre style="position:fixed;inset:auto 16px 16px 16px;background:#fff;border:1px solid #f3c;
      padding:14px;border-radius:12px;font:12px/1.5 monospace;z-index:9999;white-space:pre-wrap">
Falha ao iniciar: ${err.message}</pre>`);
});
