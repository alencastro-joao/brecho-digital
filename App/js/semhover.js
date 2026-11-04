// Celular e tablet (tela de toque sem mouse): tira do CSS as regras de :hover.
// No toque o navegador deixa o :hover "grudado" no último botão tocado, que
// fica aceso (levantado, com borda) até tocar em outro lugar: cara de site.
// Em vez de embrulhar as ~150 regras em @media (hover: hover), apaga aqui, uma
// vez no boot, o seletor com :hover de cada regra (as regras sem ele ficam).
// PC e notebook com tela de toque e mouse dizem (hover: hover) e não mudam.

function limpar(regras) {
  for (let i = regras.length - 1; i >= 0; i--) {
    const r = regras[i];
    if (r.cssRules && !r.selectorText) { limpar(r.cssRules); continue; }   // @media, @supports
    if (!r.selectorText?.includes(':hover')) continue;
    const ficam = r.selectorText.split(/,(?![^(]*\))/).filter(s => !s.includes(':hover'));
    if (ficam.length) r.selectorText = ficam.join(',');
    else r.parentRule ? r.parentRule.deleteRule(i) : r.parentStyleSheet.deleteRule(i);
  }
}

if (matchMedia('(hover: none)').matches) {
  for (const folha of document.styleSheets) {
    try { limpar(folha.cssRules); } catch { /* folha de outro site: não dá para ler */ }
  }
}
