// Voltar de outro aplicativo e achar o app onde estava.
//
// O save do jogo já vai para o localStorage a cada mudança (db.salvar), mas o
// que está *em andamento* mora só na memória: o look montado no palco do
// Stylist, a colagem aberta na mesa, a tela em que a pessoa estava. No celular,
// trocar de aplicativo pode congelar a aba e o sistema matá-la para liberar
// memória; ao voltar, o navegador recarrega a página (e o app instalado abre
// no endereço inicial, sem a tela). Tudo isso sumia.
//
// Aqui fica uma foto pequena desse andamento, ao lado do save da conta
// (`bd:v1:estado:<id>:retomar`). Ela é gravada quando a aba some
// (visibilitychange/pagehide, os únicos que o celular garante) e, por
// garantia, a cada poucos segundos com o app aberto. Ao abrir, o boot devolve
// cada rascunho à sua tela.
//
// Não duplica nada: o rascunho não é um look nem uma colagem salvos. Ele só
// lembra *qual* look/colagem estava aberto (pelo id), e salvar depois atualiza
// esse mesmo, em vez de criar outro.

import * as db from './db.js';

// A tela só volta sozinha se a pessoa saiu há pouco: abrir o app no dia
// seguinte começa na vitrine, como sempre. O trabalho no palco e na mesa vale
// por mais tempo, porque é trabalho.
const TELA_VALE = 6 * 60 * 60 * 1000;
const RASCUNHO_VALE = 7 * 24 * 60 * 60 * 1000;
const PERIODO = 15000;

const fontes = new Map();   // nome → { foto: () => dados|null, retomar: (dados) => void }

/** Uma tela que tem trabalho em andamento se registra aqui. */
export function registrar(nome, foto, retomar) {
  fontes.set(nome, { foto, retomar });
}

function ler() {
  const chave = db.chaveDaRetomada();
  if (!chave) return null;
  try { return JSON.parse(localStorage.getItem(chave)); } catch { return null; }
}

let ultima = '';

export function guardar() {
  const chave = db.chaveDaRetomada();
  if (!chave) return;
  const rascunhos = {};
  for (const [nome, f] of fontes) {
    try {
      const d = f.foto();
      if (d) rascunhos[nome] = d;
    } catch (e) { console.warn(`retomar: não consegui fotografar ${nome}`, e); }
  }
  const corpo = JSON.stringify({ hash: location.hash || '', rascunhos });
  if (corpo === ultima) return;   // nada mudou: não regrava o mesmo
  try {
    localStorage.setItem(chave, JSON.stringify({ em: Date.now(), hash: location.hash || '', rascunhos }));
    ultima = corpo;
  } catch (e) {
    // Sem espaço: o save do jogo vem antes do rascunho. Larga o rascunho.
    try { localStorage.removeItem(chave); } catch {}
    console.warn('retomar: sem espaço para o rascunho', e);
  }
}

/**
 * Chamado no boot, depois de as telas serem montadas e antes do roteador:
 * devolve os rascunhos às telas e, se a página abriu sem tela no endereço
 * (app instalado reaberto), põe de volta a tela em que a pessoa estava.
 */
export function retomar({ tela = true } = {}) {
  const r = ler();
  if (r && typeof r.em === 'number') {
    const idade = Date.now() - r.em;
    if (idade < RASCUNHO_VALE) {
      for (const [nome, d] of Object.entries(r.rascunhos || {})) {
        try { fontes.get(nome)?.retomar(d); }
        catch (e) { console.warn(`retomar: rascunho de ${nome} não voltou`, e); }
      }
    }
    if (tela && idade < TELA_VALE && !location.hash && r.hash && r.hash.startsWith('#/')) {
      // replaceState, e não location.hash: o roteador ainda não está ouvindo,
      // e voltar pelo navegador não deve levar a uma vitrine que ninguém viu.
      history.replaceState(history.state, '', r.hash);
    }
  }
  ligar();
}

let ligado = false;
function ligar() {
  if (ligado || typeof window === 'undefined') return;
  ligado = true;
  window.addEventListener('pagehide', guardar);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') guardar();
  });
  window.addEventListener('hashchange', guardar);
  setInterval(guardar, PERIODO);
}
