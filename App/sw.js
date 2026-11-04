// Service worker do app instalado. Deixa o Chrome oferecer "Instalar" e faz o
// app abrir mais rápido, SEM nunca mostrar uma versão velha:
//
// - A página (index.html) vem sempre da rede, como num site.
// - CSS e JS ficam guardados no celular, mas só valem para a versão publicada
//   em que foram baixados. A cada abertura do app o sw lê o versao.txt (texto
//   minúsculo que o nuvem/infra/publicar.sh grava no fim de cada publicação,
//   com o resumo do conteúdo de CSS, JS e HTML). Mudou a versão: o guardado
//   inteiro vai para o lixo antes de a página pedir qualquer arquivo, e tudo
//   volta a vir da rede. Igual: os arquivos saem do celular na hora.
// - Sem versao.txt (servidor local) ou no meio de uma publicação ("publicando-"),
//   nada é guardado e tudo vem da rede, como antes.
// - Sem internet, mostra um aviso simples (o jogo precisa do servidor).
const CASCA = 'bd-casca';
const CHAVE_VERSAO = new URL('__versao__', self.registration.scope).href;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// A versão publicada agora, ou null quando não dá para confiar em nenhuma.
async function versaoPublicada() {
  try {
    const r = await fetch('versao.txt', { cache: 'no-store' });
    if (!r.ok) return null;
    const v = (await r.text()).trim();
    return v && !v.startsWith('publicando') && v.length < 100 ? v : null;
  } catch { return null; }
}

// Deixa o guardado batendo com a versão publicada: se mudou, apaga tudo.
async function conferirVersao(versao) {
  const cache = await caches.open(CASCA);
  const guardada = await (await cache.match(CHAVE_VERSAO))?.text();
  if (guardada === versao) return;
  await caches.delete(CASCA);
  if (versao) await (await caches.open(CASCA)).put(CHAVE_VERSAO, new Response(versao));
}

const guardavel = (url) => url.origin === self.location.origin
  && url.href.startsWith(self.registration.scope)
  && /\.(js|css)$/.test(url.pathname)
  && !url.pathname.endsWith('/sw.js');

async function arquivo(request) {
  const cache = await caches.open(CASCA);
  const versao = await cache.match(CHAVE_VERSAO);
  if (versao) {
    const guardado = await cache.match(request);
    if (guardado) return guardado;
  }
  const resposta = await fetch(request);
  if (versao && resposta.ok && resposta.type === 'basic') {
    cache.put(request, resposta.clone()).catch(() => {});
  }
  return resposta;
}

async function pagina(request) {
  const [resposta, versao] = await Promise.all([
    fetch(request).catch(() => null), versaoPublicada()]);
  // Antes de devolver a página: o CSS e o JS que ela vai pedir já encontram o
  // guardado limpo se a versão mudou.
  try { await conferirVersao(versao); } catch { await caches.delete(CASCA).catch(() => {}); }
  return resposta || new Response(SEM_REDE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

const SEM_REDE = `<!doctype html><html lang="pt-BR"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Brechó Digital</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;
  background:#fdfaf6;color:#1a1a1a;font-family:'Segoe UI',Roboto,Arial,sans-serif;text-align:center">
<div style="padding:24px"><h1 style="font-size:1.2rem">Sem internet</h1>
<p style="color:#6b6560">O Brechó precisa de conexão. Assim que voltar, toque abaixo.</p>
<button onclick="location.reload()" style="margin-top:8px;padding:11px 22px;border-radius:30px;
  border:0;background:#1a1a1a;color:#fff;font-weight:600">Tentar de novo</button></div></body></html>`;

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.mode === 'navigate') { e.respondWith(pagina(e.request)); return; }
  const url = new URL(e.request.url);
  if (guardavel(url)) e.respondWith(arquivo(e.request));
});
