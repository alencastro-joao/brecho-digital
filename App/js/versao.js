// Atualização sozinha: quem está com o app aberto (aba esquecida, app
// instalado no celular que só volta do fundo, sem nunca recarregar) pega a
// versão nova sem precisar limpar cache nem fechar nada.
//
// O nuvem/infra/publicar.sh grava a versão publicada em dois lugares: numa
// <meta name="versao"> dentro do index.html que sobe e no versao.txt. A página
// sabe em qual versão abriu (a meta) e, de tempos em tempos, confere o
// versao.txt.
//
// Recarregar custa a abertura inteira (a tela do cabide, de 4 a 14 s no
// celular), e há dias com dezenas de publicações. Por isso a versão nova NÃO
// recarrega a cada volta para o app (era o "sempre caindo no loading"):
//
// - Ao voltar para o app depois de um bom tempo no fundo (LONGE): recarrega na
//   hora. A pessoa já espera começar do zero, e o retomar.js guardou a tela e o
//   rascunho quando o app foi para o fundo.
// - Voltou logo, ou com o app aberto: só anota. A versão nova entra na próxima
//   abertura, na próxima volta depois de LONGE, ou no puxar para atualizar
//   (atualizarSeHouverVersao, chamado pelo js/puxar.js).
// - Uma tentativa por versão em cada aba: se o recarregar não trouxe a versão
//   nova (CloudFront atrasado), não entra em laço.
// - Sem a meta (servidor local) ou no meio de uma publicação, não faz nada.
const minha = document.querySelector('meta[name="versao"]')?.content?.trim();
const CHAVE = 'bd:versao-tentada';
const PERIODO = 3 * 60 * 1000;
const LONGE = 30 * 60 * 1000;   // tempo no fundo que já vale recarregar

let nova = null;      // versão publicada diferente da minha, à espera do momento certo
let escondidoEm = document.hidden ? Date.now() : null;

async function publicada() {
  try {
    const r = await fetch('versao.txt', { cache: 'no-store' });
    if (!r.ok) return null;
    const v = (await r.text()).trim();
    return v && !v.startsWith('publicando') && v.length < 100 ? v : null;
  } catch { return null; }
}

function jaTentei(v) {
  try { return sessionStorage.getItem(CHAVE) === v; } catch { return true; }
}

function recarregar() {
  if (!nova || jaTentei(nova)) return false;
  try { sessionStorage.setItem(CHAVE, nova); } catch { return false; }
  location.reload();
  return true;
}

async function conferir() {
  const v = await publicada();
  if (!v || v === minha) return false;
  nova = v;
  navigator.serviceWorker?.getRegistration?.().then(r => r?.update()).catch(() => {});
  return true;
}

const ativo = !!minha && location.protocol !== 'file:';

// Puxar para atualizar: se há versão nova, é a hora de recarregar (a pessoa
// pediu). Devolve true quando a página vai recarregar.
export async function atualizarSeHouverVersao() {
  if (!ativo) return false;
  await conferir();
  return recarregar();
}

if (ativo) {
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden') { escondidoEm = Date.now(); return; }
    const longe = escondidoEm !== null && Date.now() - escondidoEm >= LONGE;
    escondidoEm = null;
    if (await conferir() && longe) recarregar();
  });
  window.addEventListener('online', () => conferir());
  setInterval(() => { if (!document.hidden) conferir(); }, PERIODO);
  conferir();
}
