// Service worker do app instalado. Existe só para o Chrome aceitar "Instalar":
// NÃO guarda nada em cache. Toda página, CSS e JS vem sempre da rede, então a
// versão publicada aparece na hora, como no navegador. A única coisa que ele
// faz é mostrar um aviso simples quando o celular está sem internet.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

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
  if (e.request.mode !== 'navigate') return;   // resto segue direto para a rede
  e.respondWith(fetch(e.request).catch(() =>
    new Response(SEM_REDE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
