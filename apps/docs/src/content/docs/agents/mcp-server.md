---
title: "Use o Rook no Claude Code, Codex e Cursor"
description: "Conecte qualquer cliente MCP à sua conta para conversar com seus agentes."
sidebar:
  order: 5
---

Qualquer cliente MCP pode conversar com seus agentes. Ele se conecta ao seu Rook com uma chave, e tudo o que faz passa pelas mesmas verificações do app, como você.

## Crie uma chave

Abra **Configurações > MCP**, dê um nome à chave, escolha o que ela pode fazer e, se você tem vários espaços, se ela fica limitada a um. A chave aparece uma só vez. Copie nesse momento; o Rook guarda apenas uma impressão digital dela. **Revogar** encerra a chave na hora. Cada chave mostra quando foi usada pela última vez.

| Acesso | O cliente pode |
| --- | --- |
| **Ler** | Listar espaços, agentes, canais e tickets, e ler conversas. |
| **Conversar** | Também mandar mensagem a um agente ou canal, criar tickets e comentar. |
| **Configurar** | Também criar e editar agentes e rotinas, sugerir memórias e adicionar páginas da wiki. |

Apagar, decidir aprovações, pessoas, segredos e regras de aprovação nunca estão disponíveis, seja qual for a chave.

## Conecte

O endereço é o do seu Rook seguido de `/mcp`. As Configurações o mostram com um comando pronto para copiar.

Claude Code:

```bash
claude mcp add --transport http rook https://SEU-ROOK/mcp --header "Authorization: Bearer SUA_CHAVE"
```

Codex, em `~/.codex/config.toml`:

```toml
[mcp_servers.rook]
url = "https://SEU-ROOK/mcp"
bearer_token_env_var = "ROOK_MCP_KEY"
```

Cursor, em `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "rook": {
      "url": "https://SEU-ROOK/mcp",
      "headers": { "Authorization": "Bearer SUA_CHAVE" }
    }
  }
}
```

## O que esperar

- **Mensagens.** A mensagem a um agente sai como você, e a ferramenta espera a resposta por até 30 segundos por padrão. Se o agente ainda está trabalhando, o cliente recebe um identificador e lê a conversa depois. Um agente que precisa de aprovação espera por você no app.
- **Mudanças são marcadas.** Tickets, comentários e páginas da wiki escritos por uma chave terminam com "via MCP key" e o nome dela. As edições de agente aparecem assim no histórico de instruções.
- **Rotinas começam desligadas.** Uma rotina criada por uma chave fica desligada até você ligá-la.
- **Memórias esperam.** Um fato sugerido por uma chave espera no app até você salvá-lo.
- **Limites.** Uma chave pode fazer 60 chamadas por minuto.
