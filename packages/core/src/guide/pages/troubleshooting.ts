import type { GuidePage } from "../types.js";

export const troubleshooting: GuidePage = {
  slug: "troubleshooting",
  text: {
    en: {
      title: "Troubleshooting",
      summary:
        "A reply that failed, an app that stopped working, the computer, and approvals that seem stuck.",
      body: `## A reply failed

The chat shows the reason and a button to fix it: **Change model** or **Replace key** for a model or key problem, or **Add Model** when none is connected. Common reasons are a provider limit being reached, too many requests, a refused key, or a model the provider cannot serve. See the models and limits pages.

## An app stopped working

Open **Settings** › **Connections**. An app or server in error needs signing in again: **Reconnect OAuth** for a server whose sign-in expired, or connect the app again. Confirm the agent is listed under **Agents that can use it**.

## The computer

If bots cannot run commands, the computer may be asleep, stopped or unavailable. On the desktop app, the prompt under **Where should bots run?** lets you allow it again, and **Check again** retries. A computer that is asleep wakes when you open it.

## Approvals that seem stuck

An approval waits in the chat where it appeared. With several cards, they come one at a time and the reply continues after the last one. Runs started by a routine or a chat app cannot ask you. See the approvals page.

## Attached documents

Agents read PDFs and plain text, Markdown, CSV, JSON and HTML files. Other file types are not read yet, and a scanned PDF with no text comes back empty.

## When the Chief cannot tell

The Chief can check the space's status: failed runs, apps in error and limits nearly full. If the guide does not cover the question, it says so instead of guessing.`,
    },
    "pt-BR": {
      title: "Solução de problemas",
      summary:
        "Uma resposta que falhou, um app que parou de funcionar, o computador e aprovações que parecem travadas.",
      body: `## Uma resposta falhou

O chat mostra o motivo e um botão para corrigir: **Trocar modelo** ou **Substituir chave** para um problema de modelo ou chave, ou **Adicionar modelo** quando nenhum está conectado. Os motivos comuns são limite do provedor atingido, requisições demais, chave recusada ou um modelo que o provedor não consegue servir. Veja as páginas de modelos e limites.

## Um app parou de funcionar

Abra **Configurações** › **Conexões**. Um app ou servidor com erro precisa de novo login: **Reconectar OAuth** para um servidor cujo login expirou, ou conecte o app de novo. Confirme que o agente está listado em **Agentes que podem usar**.

## O computador

Se os bots não executam comandos, o computador pode estar dormindo, parado ou indisponível. No app desktop, o aviso em **Onde os bots devem ser executados?** permite liberar de novo, e **Verificar de novo** tenta outra vez. Um computador dormindo acorda quando você o abre.

## Aprovações que parecem travadas

Uma aprovação espera no chat onde apareceu. Com vários cartões, eles vêm um de cada vez e a resposta continua depois do último. Execuções iniciadas por uma rotina ou por um app de chat não podem perguntar a você. Veja a página de aprovações.

## Documentos anexados

Os agentes leem PDFs e arquivos de texto, Markdown, CSV, JSON e HTML. Outros tipos de arquivo ainda não são lidos, e um PDF escaneado sem texto volta vazio.

## Quando o Chefe não sabe dizer

O Chefe pode conferir o estado do espaço: execuções que falharam, apps com erro e limites quase cheios. Se o guia não cobre a pergunta, ele diz isso em vez de adivinhar.`,
    },
  },
};
