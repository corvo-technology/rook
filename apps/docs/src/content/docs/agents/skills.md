---
title: "Skills"
description: "Ensine um procedimento uma vez e o agente repete."
sidebar:
  order: 3
---

Uma **skill** é um procedimento que o agente aprende: "como fechamos o caixa", "como respondemos um pedido de reembolso". Em vez de repetir a explicação em cada conversa, você a escreve uma vez (ou mostra ao agente e ele registra) e ela passa a valer.

- Escreva a skill como um passo a passo curto, com o resultado esperado.
- A skill diz **como**; o que o agente **pode** fazer continua dependendo das [conexões](/start/connections/) e das [aprovações](/start/approvals/).
- O que o time inteiro precisa saber, e não um procedimento, vai para a **wiki**; o que só diz respeito a uma pessoa vai para a **memória** dela.

## Memória e wiki

| | Memória | Wiki |
| --- | --- | --- |
| **De quem** | Sua, em cada espaço | Do time |
| **O quê** | Fatos curtos e preferências ("responde em português") | Páginas ligadas por `[[Título]]` |
| **Como entra** | Você escreve, o agente propõe (e você salva) ou um modelo sugere | Um modelo barato lê conversas encerradas e propõe; você aprova, recusa ou desfaz |

Tudo é versionado e cifrado em repouso.
