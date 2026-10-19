// Desfazer/refazer do Stylist e da Colagem: fotos (JSON) do que está na mesa
// antes de cada mudança. Um gesto contínuo (setas seguidas, rodinha do mouse,
// arrastar um slider, pinça) vira um passo só: `marcarJunto` marca na primeira
// vez e deixa o resto passar até o gesto parar.
export function criarDesfazer({ foto, restaurar, aoMudar, limite = 60 }) {
  let passado = [], futuro = [];
  let aberta = null, timer = 0;

  function marcar() {
    aberta = null;
    passado.push(foto());
    if (passado.length > limite) passado.shift();
    futuro.length = 0;
    aoMudar?.();
  }

  function marcarJunto(tipo, ms = 700) {
    clearTimeout(timer);
    if (aberta !== tipo) { marcar(); aberta = tipo; }
    timer = setTimeout(() => { aberta = null; }, ms);
  }

  function desfazer() {
    if (!passado.length) return false;
    aberta = null;
    futuro.push(foto());
    restaurar(passado.pop());
    aoMudar?.();
    return true;
  }

  function refazer() {
    if (!futuro.length) return false;
    aberta = null;
    passado.push(foto());
    restaurar(futuro.pop());
    aoMudar?.();
    return true;
  }

  function zerar() {
    passado = []; futuro = []; aberta = null;
    aoMudar?.();
  }

  return {
    marcar, marcarJunto, desfazer, refazer, zerar,
    // Fecha o gesto aberto: a próxima mudança vira outro passo.
    fechar: () => { aberta = null; },
    podeDesfazer: () => passado.length > 0,
    podeRefazer: () => futuro.length > 0,
  };
}
