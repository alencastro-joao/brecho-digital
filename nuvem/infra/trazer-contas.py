# -*- coding: utf-8 -*-
"""
Traz as contas da nuvem (DynamoDB) para o servidor local (SQLite).

    python nuvem/infra/trazer-contas.py

O hash da senha é o mesmo formato nos dois lados (scrypt$n$r$p$sal$hash), então
quem entra no site entra no localhost com a mesma senha. Vem junto quem segue
quem. O save do jogo não: ele mora no S3.

A nuvem ganha: se uma conta local tiver o mesmo e-mail ou @ de uma da nuvem, a
local é substituída. Antes de mexer, o banco é copiado para
`usuarios.sqlite.bak`. Pode rodar quantas vezes quiser.
"""

import os
import shutil
import sqlite3
import sys

import boto3
from boto3.dynamodb.types import TypeDeserializer

AQUI = os.path.dirname(os.path.abspath(__file__))
BANCO = os.path.join(AQUI, '..', '..', 'App', 'dados', 'usuarios.sqlite')
TABELA = os.environ.get('BD_TABELA') or 'brecho'

sys.path.insert(0, os.path.join(AQUI, '..', '..', 'App', 'tools'))
import contas   # noqa: E402  (cria as tabelas se o banco for novo)
import pessoas  # noqa: E402

contas.BANCO = BANCO


def ler_nuvem():
    des = TypeDeserializer()
    pagina = boto3.client('dynamodb', region_name='us-east-1').get_paginator('scan')
    for p in pagina.paginate(TableName=TABELA, FilterExpression='begins_with(pk, :u)',
                             ExpressionAttributeValues={':u': {'S': 'USER#'}}):
        for item in p['Items']:
            yield {k: des.deserialize(v) for k, v in item.items()}


def main():
    usuarios = list(ler_nuvem())
    if os.path.exists(BANCO):
        shutil.copy2(BANCO, BANCO + '.bak')

    # Abrir pelas funções dos módulos garante o esquema (usuarios, sessoes, segue).
    contas._conectar().close() if hasattr(contas, '_conectar') else None
    con = sqlite3.connect(BANCO)
    con.execute('PRAGMA foreign_keys = ON')
    with con:
        for u in usuarios:
            # Conta local que ocupa o e-mail ou o @ desta, com outro id, sai.
            con.execute('DELETE FROM usuarios WHERE id != ? AND (email_normal = ? OR handle_normal = ?)',
                        (u['id'], u['email_normal'], u['handle_normal']))
            con.execute("""
                INSERT INTO usuarios (id, email, email_normal, email_confirmado, handle,
                                      handle_normal, nome, senha, papel, criado_em, ultimo_acesso)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET email=excluded.email,
                  email_normal=excluded.email_normal, handle=excluded.handle,
                  handle_normal=excluded.handle_normal, nome=excluded.nome,
                  senha=excluded.senha, papel=excluded.papel""",
                (u['id'], u['email'], u['email_normal'], int(bool(u.get('email_confirmado'))),
                 u['handle'], u['handle_normal'], u['nome'], u['senha'],
                 u.get('papel') or 'usuario', u['criado_em'], u.get('ultimo_acesso')))
        ids = {u['id'] for u in usuarios}
        for u in usuarios:
            for para in u.get('seguindo') or ():
                if para in ids:
                    con.execute('INSERT OR IGNORE INTO segue (de, para, criado_em) VALUES (?,?,?)',
                                (u['id'], para, u['criado_em']))
    con.close()

    for u in sorted(usuarios, key=lambda u: u['criado_em']):
        print('  @%-20s %s' % (u['handle'], u.get('papel') or 'usuario'))
    print('== %d conta(s) trazidas para %s' % (len(usuarios), os.path.normpath(BANCO)))


if __name__ == '__main__':
    main()
