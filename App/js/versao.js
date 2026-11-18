// Atualização sozinha: quem está com o app aberto (aba esquecida, app
// instalado no celular que só volta do fundo, sem nunca recarregar) pega a
// versão nova sem precisar limpar cache nem fechar nada.
//
// O nuvem/infra/publicar.sh grava a versão publicada em dois lugares: numa
// <meta name="versao"> dentro do index.html que sobe e no versao.txt. A página
// sabe em qual versão abriu (a meta) e, de tempos em tempos, confere o
// versao.txt. Mudou: recarrega num momento que não atrapalha.
//
// - Ao voltar para o app (visibilitychange): recarrega na hora. O retomar.js
//   já guardou a tela e o rascunho quando o app foi para o fundo.
// - Com o app aberto, a cada poucos minutos: só anota que há versão nova e
//   recarrega na próxima troca de tela (hashchange), não no meio de um gesto.
// - Uma tentativa por versão em cada aba: se o recarregar não trouxe a versão
//   nova (CloudFront atrasado), não entra em laço.
// - Sem a meta (servidor local) ou no meio de uma publicação, não faz nada.
const minha = document.querySelector('meta[name="versao"]')?.content?.trim();
const CHAVE = 'bd:versao-tentada';
const PERIODO = 3 * 60 * 1000;

let nova = null;   // versão publicada diferente da minha, à espera do momento certo

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
  if (!nova || jaTentei(nova)) return;
  try { sessionStorage.setItem(CHAVE, nova); } catch { return; }
  location.reload();
}

async function conferir(agora) {
  const v = await publicada();
  if (!v || v === minha) return;
  nova = v;
  navigator.serviceWorker?.getRegistration?.().then(r => r?.update()).catch(() => {});
  if (agora) recarregar();
}

if (minha && location.protocol !== 'file:') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') conferir(true);
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted) conferir(true); });
  window.addEventListener('online', () => conferir(false));
  window.addEventListener('hashchange', () => { if (nova) setTimeout(recarregar, 50); });
  setInterval(() => { if (!document.hidden) conferir(false); }, PERIODO);
  conferir(false);
}
