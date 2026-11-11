import type { GuidePage } from "../types.js";

export const approvals: GuidePage = {
  slug: "approvals",
  text: {
    en: {
      title: "Approvals",
      summary: "Which actions wait for you, what the card buttons do, and how to set the rules.",
      body: `## What waits for you

Anything that sends, pays, publishes or changes something outside the app, and any change to your agents, groups or routines, can wait for your approval in the chat as a card. What asks depends on the mode below.

## The card

A card shows exactly what will happen. Its buttons are **Allow once**, **Always allow this tool** and **Deny**; some cards offer **Edit first**. Proposed changes to existing agents, routines and groups use **Apply** and **Dismiss**. When the Chief proposes several changes in one reply, the cards come one at a time; the reply continues once every card is decided. Changes to agents, groups and routines ask even when a tool is always allowed, and **Auto** cannot approve them. Only **Never ask** lets them through, and only in a run you started that no outside message reached.

## The rules

Open **Settings** › **Approvals** and choose a mode:

- **Ask**: asks before it changes anything.
- **Auto**: a second model, the **Approval model**, approves what fits your request and you decide the rest. It appears once an approval model is set under **Settings** › **Models**.
- **Never ask**: does everything without asking. Best for bots you trust.

Per tool, a rule can be **Allow** or **Block**. A space can keep its own rules.

## When it goes wrong

If a card seems stuck, answer it in the chat where it appeared; the reply waits until every card is decided. Runs started by a routine, a webhook, a chat app or another bot never get the tools that change your agents, groups or routines.`,
    },
    "pt-BR": {
      title: "Aprovações",
      summary:
        "Quais ações esperam por você, o que os botões do cartão fazem e como definir as regras.",
      body: `## O que espera por você

Tudo que envia, paga, publica ou muda algo fora do app, e qualquer mudança em seus agentes, grupos ou rotinas, pode esperar sua aprovação no chat como um cartão. O que pergunta depende do modo abaixo.

## O cartão

Um cartão mostra exatamente o que vai acontecer. Os botões são **Permitir uma vez**, **Permitir sempre esta ferramenta** e **Negar**; alguns cartões oferecem **Editar primeiro**. Mudanças propostas em agentes, rotinas e grupos existentes usam **Aplicar** e **Dispensar**. Quando o Chefe propõe várias mudanças em uma resposta, os cartões vêm um de cada vez; a resposta continua quando todos forem decididos. Mudanças em agentes, grupos e rotinas perguntam mesmo que uma ferramenta esteja sempre permitida, e o **Auto** não pode aprová-las. Só o **Nunca perguntar** as deixa passar, e apenas em uma execução que você iniciou e que nenhuma mensagem externa alcançou.

## As regras

Abra **Configurações** › **Aprovações** e escolha um modo:

- **Perguntar**: pergunta antes de mudar qualquer coisa.
- **Auto**: um segundo modelo, o **Modelo de aprovação**, aprova o que combina com seu pedido e você decide o resto. Aparece depois que um modelo de aprovação é definido em **Configurações** › **Modelos**.
- **Nunca perguntar**: faz tudo sem perguntar. Melhor para bots em que você confia.

Por ferramenta, uma regra pode ser **Permitir** ou **Bloquear**. Um espaço pode ter as próprias regras.

## Quando algo dá errado

Se um cartão parece travado, responda no chat onde ele apareceu; a resposta espera até todos os cartões serem decididos. Execuções iniciadas por uma rotina, um webhook, um app de chat ou outro bot nunca recebem as ferramentas que mudam seus agentes, grupos ou rotinas.`,
    },
  },
};
