---
title: "Conectores"
description: "Servidores MCP, caixas de e-mail e bancos de dados somente leitura."
sidebar:
  order: 4
---

Todos aparecem em **Configurações > Conexões** e usam os mesmos [níveis de acesso](/start/connections/).

## Servidores MCP

O [Model Context Protocol](https://modelcontextprotocol.io) é o jeito padrão de dar ferramentas a um agente. Conecte um servidor pela URL e escolha quais agentes o usam. Com muitas ferramentas (mais de 20), o Rook oferece um catálogo sob demanda: o agente busca e carrega só a ferramenta que precisa, sem lotar o contexto.

Se você mantém um sistema e quer que os agentes o usem, veja os [requisitos do conector](/partners/connector/).

## Caixas de e-mail

Conecte uma caixa e dê a um agente o nível de acesso que ele precisa. Enviar ou responder em nome de alguém é uma ação que muda algo, então segue as [aprovações](/start/approvals/).

## Bancos de dados somente leitura

Conecte um PostgreSQL (string de conexão ou as partes; é testado ao salvar e a senha é guardada cifrada) e escolha quais agentes podem consultá-lo. O agente recebe duas ferramentas:

- `describe_database`: mostra tabelas e colunas;
- `query_database`: executa **uma** consulta por vez, `SELECT`, `WITH ... SELECT` ou `EXPLAIN`.

Qualquer consulta que possa escrever, ou que alcance o que não deve, é recusada antes de chegar ao banco. Cada consulta fica registrada (conexão, agente, duração, linhas, resultado), nunca o texto da consulta nem as linhas.

:::tip
Crie um usuário de banco só de leitura, com acesso apenas às tabelas necessárias. Defesa em camadas.
:::
