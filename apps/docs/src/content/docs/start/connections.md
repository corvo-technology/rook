---
title: "Conexões"
description: "Conecte apps, servidores MCP, bancos e caixas de e-mail, com nível de acesso por agente."
sidebar:
  order: 4
---

**Configurações > Conexões** reúne tudo o que um agente pode alcançar: apps do catálogo, servidores MCP (por URL), bancos de dados e caixas de e-mail. Cada conexão é uma linha com o estado e quem a usa. **Conectar** abre a folha para adicionar uma nova.

## Níveis de acesso

Para cada agente e cada conexão você define:

| Nível | O agente pode |
| --- | --- |
| **Sem acesso** | Nada. A conexão nem aparece na lista de ferramentas dele. |
| **Leitura** | Consultar: listar, buscar, ler. |
| **Leitura e escrita** | Também criar e alterar. |

O servidor aplica o nível ao listar e ao chamar cada ferramenta; não depende do que o agente "decide". Listas por ferramenta de versões antigas aparecem como **Personalizado**.

:::note
Mesmo com escrita liberada, ações que mudam algo continuam passando pelas [aprovações](/start/approvals/).
:::

Detalhes de [servidores MCP, caixas de e-mail e bancos](/agents/connectors/).
