// Pré-pedidos da abertura: o script no topo do index.html já dispara o acervo,
// a sessão, o save, o estoque e quem você segue enquanto o navegador ainda
// baixa os módulos. Sem isso cada um saía só quando o módulo dele rodava, um
// depois do outro (uns 0,5 s cada até a AWS): era a fila da tela do cabide.
//
// Cada pré-pedido serve uma vez só (a resposta só pode ser lida uma vez).
// Quem entrou agora pela tela de login descarta os de /api/: foram feitos sem
// sessão e voltariam vazios.
const guardados = (typeof window !== 'undefined' && window.__prePedidos) || {};

// A resposta pré-pedida desta rota (Promise<Response|null>), ou null.
export function prePedido(rota) {
  const p = guardados[rota];
  if (!p) return null;
  delete guardados[rota];
  return p;
}

export function descartarPrePedidosDaApi() {
  for (const rota of Object.keys(guardados)) if (rota.startsWith('/api/')) delete guardados[rota];
}

// fetch(rota, opcoes), aproveitando o pré-pedido quando houver e der certo.
export async function buscar(rota, opcoes) {
  const pre = prePedido(rota);
  const r = pre && await pre;
  return r || fetch(rota, opcoes);
}
