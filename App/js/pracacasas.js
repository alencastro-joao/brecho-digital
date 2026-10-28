// Praça: os prédios desenhados, um para cada botão da barra e na cor dele.
// Cada um é um SVG de 250 de largura com o chão em y = h; o nome vai escrito
// à mão (Caveat) numa placa ou na fachada, com o nome do botão.

const T = '#3b2b22';                                   // o traço das roupas
const L = `stroke="${T}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;
const l = `stroke="${T}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"`;
const SOMBRA = 'rgba(0,0,0,.07)';

const escrito = (x, y, texto, tam = 30, rot = 0) =>
  `<text x="${x}" y="${y}" text-anchor="middle" font-family="'BD Caveat', cursive" font-size="${tam}"
    fill="${T}" transform="rotate(${rot} ${x} ${y})">${texto}</text>`;

// Toldo listrado com a barra de baixo em ondinhas.
function toldo(x, y, w, cor, n = 6) {
  const p = w / n;
  let listras = '', ondas = `M${x} ${y + 24}`;
  for (let i = 0; i < n; i++) {
    if (i % 2) listras += `<rect x="${x + i * p}" y="${y}" width="${p}" height="24" fill="${cor}"/>`;
    ondas += ` q${p / 2} 14 ${p} 0`;
  }
  return `<rect x="${x}" y="${y}" width="${w}" height="24" fill="#fff"/>${listras}
    <rect x="${x}" y="${y}" width="${w}" height="24" fill="none" ${L}/>
    <path d="${ondas} z" fill="${cor}" ${L}/>`;
}

const porta = (x, y, w, h, cor = '#fff') =>
  `<path d="M${x} ${y + h} v-${h - w / 2} a${w / 2} ${w / 2} 0 0 1 ${w} 0 v${h - w / 2}" fill="${cor}" ${L}/>
   <circle cx="${x + w - 10}" cy="${y + h - h / 2.4}" r="3" fill="${T}"/>`;

const janela = (x, y, w, h) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#fffdf6" ${L}/>
   <path d="M${x + w / 2} ${y} v${h} M${x} ${y + h / 2} h${w}" ${l}/>`;

// Uma pecinha de roupa no cabide (para vitrines e araras).
const roupinha = (x, y, cor) =>
  `<path d="M${x} ${y - 8} q0 -6 5 -6" fill="none" ${l}/>
   <path d="M${x - 12} ${y + 4} l12 -10 l12 10 l-3 5 l-4 -2 v18 h-10 v-18 l-4 2 z" fill="${cor}" ${l}/>`;

const DESENHOS = {
  // Loja: o brechó com toldo verde, arara na vitrine e a placa pendurada.
  vitrine(h, c) {
    return `
      <rect x="12" y="40" width="226" height="${h - 40}" rx="4" fill="${c.cor}" ${L}/>
      <path d="M4 44 h242 v-14 h-242 z" fill="#a5d6a7" ${L}/>
      <path d="M125 30 v14" ${l}/>
      ${janela(34, 66, 52, 44)}${janela(164, 66, 52, 44)}
      ${toldo(4, h - 118, 242, c.toldo, 8)}
      <rect x="22" y="${h - 88}" width="130" height="88" fill="#fffdf6" ${L}/>
      <path d="M32 ${h - 70} h110" ${l}/>
      ${roupinha(52, h - 62, '#f48fb1')}${roupinha(86, h - 62, '#fff176')}${roupinha(120, h - 62, '#90caf9')}
      ${porta(168, h - 92, 56, 92)}
      <path d="M96 0 v18 M154 0 v18" ${l}/>
      <rect x="82" y="14" width="86" height="26" rx="4" fill="#fffdf6" ${L} transform="rotate(-2 125 27)"/>
      ${escrito(125, 35, 'Loja', 26, -2)}`;
  },

  // Closet: o prédio é o próprio guarda-roupa, com duas portas e um cabide no topo.
  closet(h, c) {
    return `
      <path d="M125 6 q-10 0 -10 8 q0 6 10 8 l40 18 h-80 l40 -18" fill="none" ${L}/>
      <rect x="22" y="40" width="206" height="${h - 52}" rx="10" fill="${c.cor}" ${L}/>
      <rect x="14" y="36" width="222" height="16" rx="6" fill="#80deea" ${L}/>
      <rect x="40" y="70" width="80" height="${h - 100}" rx="8" fill="#e0f7fa" ${L}/>
      <rect x="130" y="70" width="80" height="${h - 100}" rx="8" fill="#e0f7fa" ${L}/>
      <circle cx="112" cy="${h / 2 + 30}" r="4" fill="${T}"/><circle cx="138" cy="${h / 2 + 30}" r="4" fill="${T}"/>
      <rect x="22" y="${h - 14}" width="16" height="14" ${L} fill="#80deea"/><rect x="212" y="${h - 14}" width="16" height="14" ${L} fill="#80deea"/>
      <ellipse cx="125" cy="${h / 2 - 22}" rx="56" ry="20" fill="#fffdf6" ${L} transform="rotate(2 125 ${h / 2 - 22})"/>
      ${escrito(125, h / 2 - 13, 'Closet', 28, 2)}`;
  },

  // Stylist: o ateliê, alto e com telhado de mansarda, manequim na vitrine.
  stylist(h, c) {
    return `
      <path d="M20 70 l20 -50 h170 l20 50 z" fill="#ffe082" ${L}/>
      <circle cx="125" cy="44" r="14" fill="#fffdf6" ${L}/><path d="M125 34 v10 h7" ${l}/>
      <rect x="20" y="70" width="210" height="${h - 70}" fill="${c.cor}" ${L}/>
      ${janela(40, 92, 56, 50)}${janela(154, 92, 56, 50)}
      <rect x="62" y="152" width="126" height="28" rx="4" fill="#fffdf6" ${L} transform="rotate(1 125 166)"/>
      ${escrito(125, 174, 'Stylist', 26, 1)}
      ${toldo(14, h - 112, 222, c.toldo, 6)}
      <rect x="30" y="${h - 84}" width="104" height="84" fill="#fffdf6" ${L}/>
      <path d="M70 ${h - 66} q12 -6 24 0 q4 14 -2 26 q8 6 6 14 h-32 q-2 -8 6 -14 q-6 -12 -2 -26 z" fill="#f8bbd0" ${l}/>
      <path d="M82 ${h - 20} v14 M74 ${h - 4} h16" ${l}/>
      <path d="M108 ${h - 60} l14 14 M122 ${h - 60} l-14 14" ${l}/>
      <circle cx="106" cy="${h - 62}" r="4" fill="none" ${l}/><circle cx="124" cy="${h - 62}" r="4" fill="none" ${l}/>
      ${porta(156, h - 92, 56, 92)}`;
  },

  // Colagem: a galeria, com fotos e recortes colados tortos na fachada.
  board(h, c) {
    const foto = (x, y, w, hh, rot, cor) =>
      `<g transform="rotate(${rot} ${x + w / 2} ${y + hh / 2})"><rect x="${x}" y="${y}" width="${w}" height="${hh}" fill="#fffdf6" ${l}/>
        <rect x="${x + 5}" y="${y + 5}" width="${w - 10}" height="${hh - 18}" fill="${cor}" ${l}/>
        <rect x="${x + w / 2 - 8}" y="${y - 5}" width="16" height="9" fill="#fff59d" opacity=".9"/></g>`;
    return `
      <path d="M12 ${h} v-${h - 28} q113 -34 226 0 v${h - 28}" fill="${c.cor}" ${L}/>
      <path d="M28 64 q97 -24 194 0 v34 q-97 -18 -194 0 z" fill="#fffdf6" ${L}/>
      ${escrito(125, 84, 'Colagem', 28, 0)}
      ${foto(30, 112, 50, 58, -8, '#ce93d8')}${foto(98, 108, 56, 50, 4, '#80cbc4')}${foto(170, 114, 48, 56, -3, '#ffcc80')}
      <rect x="22" y="${h - 76}" width="110" height="76" fill="#fffdf6" ${L}/>
      ${foto(36, h - 62, 36, 40, 6, '#f48fb1')}${foto(80, h - 58, 40, 34, -6, '#9fa8da')}
      ${porta(160, h - 92, 58, 92)}`;
  },

  // Feed: o café, com janela redonda de lente de câmera e mesinha na calçada.
  social(h, c) {
    return `
      <rect x="14" y="36" width="222" height="${h - 36}" rx="6" fill="${c.cor}" ${L}/>
      <path d="M8 40 h234 v-14 h-234 z" fill="#b39ddb" ${L}/>
      <circle cx="125" cy="90" r="34" fill="#fffdf6" ${L}/><circle cx="125" cy="90" r="20" fill="#d1c4e9" ${l}/>
      <circle cx="125" cy="90" r="9" fill="#7e57c2" ${l}/><circle cx="119" cy="84" r="3" fill="#fff"/>
      <rect x="192" y="58" width="22" height="12" rx="3" fill="#fffdf6" ${l}/>
      <path d="M40 158 q85 -10 170 0" fill="none" ${l}/>
      ${escrito(125, 150, 'Feed', 30, -1)}
      ${toldo(8, h - 112, 234, c.toldo, 7)}
      <rect x="24" y="${h - 84}" width="116" height="84" fill="#fffdf6" ${L}/>
      <path d="M54 ${h - 52} h22 v12 q0 10 -11 10 q-11 0 -11 -10 z M76 ${h - 48} q8 0 6 6 q-2 4 -6 4" fill="#fffdf6" ${l}/>
      <path d="M60 ${h - 60} q4 -5 0 -10 M68 ${h - 60} q4 -5 0 -10" fill="none" ${l}/>
      <path d="M96 ${h - 30} h30 M111 ${h - 30} v30" ${l}/>
      ${porta(162, h - 92, 56, 92)}`;
  },

  // Tarefas: a prefeitura, com colunas, frontão e o troféu no alto.
  tarefas(h, c) {
    const col = (x) => `<rect x="${x}" y="96" width="18" height="${h - 110}" fill="#fffdf6" ${l}/>`;
    return `
      <path d="M113 34 h24 v6 q0 14 -12 14 q-12 0 -12 -14 z M118 54 h14 v6 h-14 z M113 38 q-8 0 -6 8 q2 4 7 4 M137 38 q8 0 6 8 q-2 4 -7 4"
        fill="#ffb74d" ${l}/>
      <path d="M8 96 l117 -36 l117 36 z" fill="#ffcc80" ${L}/>
      ${escrito(125, 91, 'Tarefas', 24, 0)}
      <rect x="18" y="96" width="214" height="${h - 96}" fill="${c.cor}" ${L}/>
      ${col(32)}${col(70)}${col(162)}${col(200)}
      <path d="M8 ${h} v-14 h234 v14" fill="#ffcc80" ${L}/>
      ${porta(100, h - 100, 50, 86)}
      <rect x="96" y="112" width="58" height="32" rx="3" fill="#fffdf6" ${l} transform="rotate(-3 125 128)"/>
      <path d="M104 122 l3 3 l6 -6 M104 134 l3 3 l6 -6 M118 123 h28 M118 135 h22" fill="none" ${l} transform="rotate(-3 125 128)"/>`;
  },

  // Perfil: a casinha de morar, telhado de duas águas e um retrato na janela.
  perfil(h, c) {
    return `
      <rect x="176" y="22" width="24" height="44" fill="#ffab91" ${L}/>
      <path d="M2 102 l123 -88 l123 88 z" fill="#ffab91" ${L}/>
      <circle cx="125" cy="70" r="18" fill="#fffdf6" ${L}/>
      <path d="M125 59 l3 7 h7 l-6 5 l2 7 l-6 -4 l-6 4 l2 -7 l-6 -5 h7 z" fill="#ffd54f" ${l}/>
      <rect x="22" y="102" width="206" height="${h - 102}" fill="${c.cor}" ${L}/>
      <rect x="38" y="122" width="74" height="84" rx="6" fill="#fffdf6" ${L}/>
      <circle cx="75" cy="152" r="13" fill="#ffccbc" ${l}/><path d="M53 198 q22 -32 44 0" fill="#ff8a65" ${l}/>
      ${janela(144, 128, 66, 50)}
      <path d="M140 178 h74 v14 h-74 z" fill="#ff8a65" ${l}/>
      <rect x="140" y="${h - 112}" width="76" height="28" rx="4" fill="#fffdf6" ${L} transform="rotate(-2 178 ${h - 98})"/>
      ${escrito(178, h - 90, 'Perfil', 26, -2)}
      ${porta(150, h - 78, 56, 78)}
      <rect x="40" y="${h - 60}" width="70" height="44" rx="4" fill="#fffdf6" ${L}/>
      <path d="M40 ${h - 16} h70 l6 16 h-82 z" fill="#a5d6a7" ${l}/>`;
  },
};

// Árvore no mesmo traço: copa de bolas sobrepostas, tronco com galho.
export const ARVORE = `<svg class="pc-arvore-svg" viewBox="0 0 130 200" width="130" height="200" aria-hidden="true">
  <path d="M58 200 q4 -40 0 -80 h14 q-4 40 0 80 z" fill="#b08968" ${L}/>
  <path d="M71 150 q10 -6 18 -20" fill="none" ${L}/>
  <path d="M30 122 q-24 -4 -22 -30 q-14 -26 12 -40 q2 -30 34 -30 q16 -22 42 -6 q30 -2 30 28 q22 16 6 40 q6 28 -24 32 q-12 18 -36 8 q-20 14 -42 -2 z"
    fill="#a5d6a7" ${L}/>
  <path d="M40 60 q6 -14 22 -14 M84 40 q12 0 16 12" fill="none" stroke="#e8f5e9" stroke-width="5" stroke-linecap="round"/>
  <path d="M52 100 q12 8 26 0 M96 82 q6 6 4 14 M24 84 q4 8 12 10" fill="none" ${l}/>
</svg>`;

export const HIDRANTE = `<svg viewBox="0 0 80 120" width="48" height="72" aria-hidden="true">
  <rect x="20" y="40" width="40" height="74" rx="6" fill="#ef5350" ${L}/><path d="M16 44 q24 -40 48 0 z" fill="#ef5350" ${L}/>
  <rect x="8" y="60" width="12" height="16" fill="#ef5350" ${l}/><rect x="60" y="60" width="12" height="16" fill="#ef5350" ${l}/>
  <rect x="14" y="110" width="52" height="8" fill="#c62828" ${l}/><rect x="34" y="14" width="12" height="10" fill="#ef5350" ${l}/></svg>`;

export const LIXEIRA = `<svg viewBox="0 0 90 130" width="52" height="76" aria-hidden="true">
  <path d="M14 30 h62 l-6 96 h-50 z" fill="#81c784" ${L}/><rect x="8" y="20" width="74" height="12" rx="4" fill="#66bb6a" ${L}/>
  <path d="M32 46 v66 M45 46 v66 M58 46 v66" ${l}/><path d="M36 20 q9 -12 18 0" fill="none" ${l}/></svg>`;

export function desenhoDaCasa(c) {
  return `<svg viewBox="-6 0 262 ${c.h}" width="100%" height="100%" aria-hidden="true" overflow="visible">
    ${DESENHOS[c.view](c.h, c)}
    <rect x="12" y="${c.h - 4}" width="226" height="4" fill="${SOMBRA}"/></svg>`;
}
