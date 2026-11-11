import type { GuidePage } from "../types.js";

export const connectors: GuidePage = {
  slug: "connectors",
  text: {
    en: {
      title: "Apps and connectors",
      summary:
        "Connecting Store apps, choosing which agents may use them, MCP servers, chat apps and saved credentials.",
      body: `## Store apps

Open the **Store** and go to **Apps**. Use **Add** on an app and sign in; it then shows **Added**. Choose which agents may use it under **Agents that can use it**: an agent that was not given access cannot use the app, even when it is added. Ask the Chief and it can request access for an agent in the chat; you approve the card. **Uninstall** removes the app, and **Remove** drops one signed-in account.

## MCP servers

For tools that are not in the Store, use **Manage MCP servers** under **Apps** in the Store. Use **Add server** with a name and an HTTPS URL, or a command for a local server. **Test connection** checks that it answers. A server that asks for sign-in shows **Connect OAuth**; when the sign-in lapses it shows **OAuth expired** and you use **Reconnect OAuth**. On mobile they are under **Integrations**.

## Chat apps

Chat apps such as WhatsApp, Telegram and Slack connect an agent to a number or a bot, so people can write to that agent from the chat app. In the **Store**, open the chat app and use **Connect**, then send the code it shows from the chat app. WhatsApp uses **Add number**: scan the code with **Show QR code**, and choose whether the number is **My assistant** (answers your own chat with yourself) or **Customer service** (answers anyone who writes to it). In a number's menu, **Pause** and **Resume** stop and restart it, and **Disconnect** removes it.

## Saved credentials

When an agent needs an API key or a password, it asks for it in a protected card. The value is stored encrypted and is never shown again or sent to the model. To list, replace or remove them on web or desktop, open the bot's settings, **Advanced**, **Credentials**.

## When it goes wrong

An app marked **OAuth expired** needs signing in again. If an agent says it cannot reach an app, check that the app is **Added** and that the agent has access.`,
    },
    "pt-BR": {
      title: "Apps e conectores",
      summary:
        "Conectar apps da Loja, escolher quais agentes podem usá-los, servidores MCP, apps de chat e credenciais salvas.",
      body: `## Apps da Loja

Abra a **Loja** e vá em **Apps**. Use **Adicionar** em um app e entre na conta; ele passa a mostrar **Adicionado**. Escolha quais agentes podem usá-lo em **Agentes que podem usar**: um agente sem acesso não consegue usar o app, mesmo adicionado. Peça ao Chefe e ele pode solicitar acesso para um agente no chat; você aprova o cartão. **Desinstalar** remove o app, e **Remover** tira uma conta conectada.

## Servidores MCP

Para ferramentas que não estão na Loja, use **Gerenciar servidores MCP** em **Apps**, na Loja. Use **Adicionar servidor** com um nome e uma URL HTTPS, ou um comando para um servidor local. **Testar conexão** confere se ele responde. Um servidor que pede login mostra **Conectar OAuth**; quando o login expira aparece **OAuth expirado** e você usa **Reconectar OAuth**. No celular, ficam em **Integrações**.

## Apps de chat

Apps de chat como WhatsApp, Telegram e Slack ligam um agente a um número ou a um bot, para que as pessoas escrevam para esse agente pelo app de chat. Na **Loja**, abra o app de chat e use **Conectar**, depois envie pelo app de chat o código mostrado. O WhatsApp usa **Adicionar número**: escaneie o código com **Mostrar código QR** e escolha se o número é **Meu assistente** (responde ao seu próprio chat consigo mesmo) ou **Atendimento** (responde a qualquer pessoa que escrever). No menu de um número, **Pausar** e **Retomar** param e reiniciam, e **Desconectar** o remove.

## Credenciais salvas

Quando um agente precisa de uma chave de API ou de uma senha, ele pede em um cartão protegido. O valor é guardado criptografado e nunca é mostrado de novo nem enviado ao modelo. Para listar, trocar ou remover na web ou no desktop, abra as configurações do bot, **Avançado**, **Credenciais**.

## Quando algo dá errado

Um app marcado como **OAuth expirado** precisa de novo login. Se um agente diz que não alcança um app, confira se o app está **Adicionado** e se o agente tem acesso.`,
    },
  },
};
