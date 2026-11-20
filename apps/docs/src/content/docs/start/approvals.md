---
title: "Aprovações"
description: "Como o Rook pede o seu aval antes de ações reais."
sidebar:
  order: 6
---

Quando um agente vai fazer algo que muda o mundo (enviar um e-mail, gravar em um sistema, gastar dinheiro), ele para e pede aprovação. O cartão mostra o que será feito; segure o botão para **permitir** (no celular, toque longo) ou escolha **Agora não**.

## Modos

Em **Configurações > Aprovações**:

| Modo | Comportamento |
| --- | --- |
| **Sempre perguntar** | Pede antes de qualquer mudança. |
| **Só o arriscado** (padrão) | Lê e faz pequenas edições sozinho; pede antes de enviar, publicar, pagar, apagar, fazer deploy ou rodar algo. |
| **Automático** | Um modelo de aprovação libera o que combina com o pedido e pergunta o resto. |
| **Nunca perguntar** | Executa tudo. Use com cuidado. |

Em qualquer modo você pode permitir ou bloquear ferramentas e sites específicos. Um espaço pode ter regras próprias, diferentes das da conta.

## Limites de proteção

- **Limite de pagamento**: nas configurações de um agente você pode definir o máximo por pagamento e por mês. Acima do limite, ou sem um valor legível, o agente pergunta mesmo que a ferramenta esteja liberada.
- **Ferramentas desconhecidas**: com um modelo de aprovação configurado, você pode deixar que um modelo sugira se uma ferramenta de nome incomum só lê, faz uma edição simples ou é arriscada. Fica desligado por padrão, e na dúvida o agente pergunta.
- **Links**: o agente não abre um link com uma chave, uma consulta longa demais ou trechos copiados de dados privados, a menos que esse mesmo link já tenha aparecido na conversa.

## Onde aparecem

- no cartão dentro da conversa;
- na entrada **Aprovações** do menu, que lista tudo o que você pode decidir em todas as conversas;
- na caixa de entrada (o sino) e como notificação.

Um agente com aprovação pendente não segue até você responder.
