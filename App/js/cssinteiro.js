// O base.css termina com a marca --base-css-inteiro. Se ela não chegou, o CSS
// que o sw.js guardou no celular está velho ou cortado (foi o que deixou o
// cabide da abertura preto, no canto, empurrando a vitrine para baixo): joga
// fora o guardado e recarrega, uma vez só por aba, para não entrar em laço.
const CHAVE = 'bd:css-recarregado';

const marca = getComputedStyle(document.documentElement).getPropertyValue('--base-css-inteiro').trim();
if (marca) {
  try { sessionStorage.removeItem(CHAVE); } catch {}
} else if (navigator.serviceWorker?.controller && 'caches' in self) {
  let jaTentou = true;
  try { jaTentou = !!sessionStorage.getItem(CHAVE); sessionStorage.setItem(CHAVE, '1'); } catch {}
  if (!jaTentou) caches.delete('bd-casca').catch(() => {}).then(() => location.reload());
}
