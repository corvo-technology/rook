import type { GuidePage } from "../types.js";

export const approvals: GuidePage = {
  slug: "approvals",
  text: {
    en: {
      title: "Approvals",
      summary: "Which actions wait for you, what the card buttons do, and how to set the rules.",
      body: `## What waits for you

Anything that sends, pays, publishes or changes something outside the app, and any change to your agents, groups or routines, waits for your approval in the chat as a card.

## The card

A card shows exactly what will happen. Its buttons are **Allow once**, **Always allow this tool** and **Deny**; some cards offer **Edit first**. Proposed changes to existing agents, routines and groups use **Apply** and **Dismiss**. When the Chief proposes several changes in one reply, the cards come one at a time; the reply continues once every card is decided. Changes to agents, groups and routines always ask, even if a tool is always allowed.

## The rules

Open **Settings** › **Approvals** and choose a mode:

- **Ask**: asks before it changes anything.
- **Auto**: a second model, the **Approval model**, approves what fits your request and you decide the rest. It appears once an approval model is set.
- **Never ask**: does everything without asking. Best for bots you trust.

Per tool, a rule can be **Allow** or **Block**. You can also set rules for one space only.

## When it goes wrong

If a card seems stuck, answer it in the chat where it appeared; the reply waits until every card is decided. A run started by a routine, a message from a chat app or another bot cannot ask you, so it stops at actions that need approval.`,
    },
    "pt-BR": {
      title: "Aprovações",
      summary:
        "Quais ações esperam por você, o que os botões do cartão fazem e como definir as regras.",
      body: `## O que espera por você

Tudo que envia, paga, publica ou muda algo fora do app, e qualquer mudança em seus agentes, grupos ou rotinas, espera sua aprovação no chat como um cartão.

## O cartão

Um cartão mostra exatamente o que vai acontecer. Os botões são **Permitir uma vez**, **Permitir sempre esta ferramenta** e **Negar**; alguns cartões oferecem **Editar primeiro**. Mudanças propostas em agentes, rotinas e grupos existentes usam **Aplicar** e **Dispensar**. Quando o Chefe propõe várias mudanças em uma resposta, os cartões vêm um de cada vez; a resposta continua quando todos forem decididos. Mudanças em agentes, grupos e rotinas sempre perguntam, mesmo que uma ferramenta esteja sempre permitida.

## As regras

Abra **Configurações** › **Aprovações** e escolha um modo:

- **Perguntar**: pergunta antes de mudar qualquer coisa.
- **Auto**: um segundo modelo, o **Modelo de aprovação**, aprova o que combina com seu pedido e você decide o resto. Aparece depois que um modelo de aprovação é definido.
- **Nunca perguntar**: faz tudo sem perguntar. Melhor para bots em que você confia.

Por ferramenta, uma regra pode ser **Permitir** ou **Bloquear**. Também dá para definir regras só para um espaço.

## Quando algo dá errado

Se um cartão parece travado, responda no chat onde ele apareceu; a resposta espera até todos os cartões serem decididos. Uma execução iniciada por uma rotina, por mensagem de um app de chat ou por outro bot não consegue perguntar a você, então ela para nas ações que precisam de aprovação.`,
    },
  },
};
