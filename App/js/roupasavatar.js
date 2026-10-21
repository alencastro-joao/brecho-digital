// As roupas do avatar cadastradas pelo admin (Admin › Roupas do avatar). Moram
// numa chave a mais do acervo.json (`roupasAvatar`, gravada pela Lambda em
// nuvem/lambda/roupasavatar.py), e o catálogo de roupinhas (roupinhas.js) é
// montado na hora do import — por isso a lista é lida aqui com await no topo,
// antes dele. O mesmo pedido serve ao catálogo de peças (catalog.js), para o
// acervo não descer duas vezes na abertura.

import { CONFIG } from './config.js';

let primeiro = fetch(CONFIG.ACERVO, { cache: 'no-cache' })
  .then(r => (r.ok ? r.json() : null))
  .catch(() => null);

// A primeira leitura reaproveita o pedido da abertura; as seguintes (o admin
// recarregando o acervo) vão à rede de novo.
export function lerAcervo() {
  const p = primeiro || fetch(CONFIG.ACERVO, { cache: 'no-cache' })
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null);
  primeiro = null;
  return p;
}

// Rede lenta não segura a abertura: sem resposta em 5 s, o jogo abre sem elas.
const dados = await Promise.race([primeiro, new Promise(ok => setTimeout(ok, 5000))]);
const lista = dados?.roupasAvatar;

export const ROUPAS_AVATAR = (Array.isArray(lista) ? lista : [])
  .filter(r => r?.id && r.src && Array.isArray(r.caixa) && r.caixa.length === 4
    && Array.isArray(r.colecoes));

// Tamanho e posição (e, nos óculos, as cores) das roupas que estão no código,
// ajustados no admin: { 'oculos-espinhos': { caixa: [x, y, w, h], cores: [...] } }.
const ajustes = dados?.ajustesRoupas;
export const AJUSTES_ROUPAS = ajustes && typeof ajustes === 'object' ? ajustes : {};
export const caixaAjustada = (id, caixa) => {
  const c = AJUSTES_ROUPAS[id]?.caixa;
  return Array.isArray(c) && c.length === 4 ? c : caixa;
};
