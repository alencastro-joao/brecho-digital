// Contas: o cliente da API de autenticação.
//
// É o único arquivo do front que fala com o servidor sobre quem está logado.
// Tudo o mais — telas, db.js, perfil — pergunta daqui. Quando o projeto subir
// para a nuvem, o que muda é a constante API (e nada mais):
//
//     const API = 'https://api.brechodigital.com';
//
// A sessão não mora em JavaScript. Ela vem num cookie HttpOnly que o navegador
// manda sozinho — por isso `credentials: 'include'` em toda chamada, e por isso
// não existe aqui nenhuma função "pegar token": se o JS conseguisse ler o
// token, um XSS conseguiria levá-lo embora. Consequência prática de já fazer
// certo agora: em outro domínio a API precisa devolver CORS com
// `Access-Control-Allow-Credentials` e o cookie precisa sair `SameSite=None;
// Secure`. É a conta a pagar por cookie de sessão, e é menor que a de guardar
// token em localStorage.

// Mesma origem: o servidor.py serve a página e a API. Na nuvem vira a URL da API.
const API = '';

export class ErroDeAuth extends Error {
  constructor(mensagem, codigo = 0) {
    super(mensagem);
    this.codigo = codigo;
  }
}

// Quem está logado agora. Nulo = ninguém. Objeto só de leitura para quem lê:
// mudar conta é chamar entrar/registrar/sair, não mexer aqui.
let atual = null;
export const contaAtual = () => atual;
export const ehAdmin = () => atual?.papel === 'admin';

const ouvintes = new Set();
export function onConta(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }
const avisar = () => ouvintes.forEach(fn => fn(atual));

async function pedir(rota, { metodo = 'GET', corpo = null } = {}) {
  let resposta;
  try {
    resposta = await fetch(API + rota, {
      method: metodo,
      credentials: 'include',              // o cookie da sessão
      headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
  } catch {
    // Servidor desligado, sem rede, ou a página aberta em file://.
    throw new ErroDeAuth('Não consegui falar com o servidor. Ele está rodando?', 0);
  }

  let dados = {};
  try { dados = await resposta.json(); } catch { /* 204, HTML de erro, etc. */ }

  if (!resposta.ok) throw new ErroDeAuth(dados.erro || 'Falha inesperada.', resposta.status);
  return dados;
}

// Quem está logado, segundo o servidor. É a primeira coisa que o app pergunta
// ao abrir: o cookie sobrevive a fechar o navegador, então voltar amanhã não
// deve pedir senha de novo.
export async function carregarSessao() {
  try {
    const { usuario } = await pedir('/api/auth/eu');
    atual = usuario || null;
  } catch (e) {
    // Sem servidor não dá para saber: fica deslogado, e a tela de entrada diz
    // o que houve. Silenciar aqui seria entrar sem conta e gravar por cima.
    atual = null;
    if (e.codigo !== 0) throw e;
  }
  avisar();
  return atual;
}

export async function registrar({ email, senha, nome, handle }) {
  const { usuario } = await pedir('/api/auth/registrar',
    { metodo: 'POST', corpo: { email, senha, nome, handle } });
  atual = usuario;
  avisar();
  return usuario;
}

export async function entrar({ email, senha }) {
  const { usuario } = await pedir('/api/auth/entrar',
    { metodo: 'POST', corpo: { email, senha } });
  atual = usuario;
  avisar();
  return usuario;
}

export async function sair() {
  try {
    await pedir('/api/auth/sair', { metodo: 'POST' });
  } finally {
    atual = null;
    avisar();
  }
}

// Nome e @ são da conta (moram no banco, valem em qualquer navegador). Bio,
// avatar e o resto do perfil continuam no estado do jogo — ver db.js.
export async function atualizarConta({ nome, handle }) {
  const { usuario } = await pedir('/api/auth/eu',
    { metodo: 'PUT', corpo: { nome, handle } });
  atual = usuario;
  avisar();
  return usuario;
}

export async function trocarSenha({ atual: senhaAtual, nova }) {
  const { usuario } = await pedir('/api/auth/senha',
    { metodo: 'POST', corpo: { atual: senhaAtual, nova } });
  atual = usuario;
  avisar();
  return usuario;
}
