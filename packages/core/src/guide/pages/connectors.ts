import type { GuidePage } from "../types.js";

export const connectors: GuidePage = {
  slug: "connectors",
  text: {
    en: {
      title: "Apps and connectors",
      summary:
        "Connecting Store apps, choosing which agents may use them, MCP servers, chat apps and saved credentials.",
      body: `## Store apps

Open the **Store** and go to **Apps**. **Connect** an app, sign in, and then choose which agents may use it under **Agents that can use it**. An agent that was not given access cannot use the app, even when it is connected. Ask the Chief and it can request access for an agent in the chat; you approve the card. **Disconnect** removes the connection.

## MCP servers

For tools that are not in the Store, open **Settings** › **Connections** or use **Manage MCP servers** in the Store. Use **Add server** with a name and an HTTPS URL, or a command for a local server. **Test connection** checks that it answers. A server that asks for sign-in shows **Connect OAuth**; when the sign-in lapses it shows **OAuth expired** and you use **Reconnect OAuth**.

## Chat apps

WhatsApp and Telegram connect an agent to a number or a bot, so people can write to that agent from the chat app. In the **Store**, use **Add number** for WhatsApp, scan the code with **Show QR code**, and choose whether the number is **My assistant** (answers your own chat) or **Customer service** (answers anyone who writes). **Pause** and **Resume** stop and restart a number. For Telegram, paste the token from the bot you created.

## Saved credentials

When an agent needs an API key or a password, it asks for it in a protected card. The value is stored encrypted and is never shown again or sent to the model. To list, replace or remove them, open the bot's settings, **Advanced**, **Credentials**.

## When it goes wrong

A connection that shows an error needs signing in again or reconnecting. If an agent says it cannot reach an app, check that the app is **Connected** and that the agent has access.`,
    },
    "pt-BR": {
      title: "Apps e conectores",
      summary:
        "Conectar apps da Loja, escolher quais agentes podem usá-los, servidores MCP, apps de chat e credenciais salvas.",
      body: `## Apps da Loja

Abra a **Loja** e vá em **Apps**. **Conectar** um app, entre na conta e depois escolha quais agentes podem usá-lo em **Agentes que podem usar**. Um agente sem acesso não consegue usar o app, mesmo conectado. Peça ao Chefe e ele pode solicitar acesso para um agente no chat; você aprova o cartão. **Desconectar** remove a conexão.

## Servidores MCP

Para ferramentas que não estão na Loja, abra **Configurações** › **Conexões** ou use **Gerenciar servidores MCP** na Loja. Use **Adicionar servidor** com um nome e uma URL HTTPS, ou um comando para um servidor local. **Testar conexão** confere se ele responde. Um servidor que pede login mostra **Conectar OAuth**; quando o login expira aparece **OAuth expirado** e você usa **Reconectar OAuth**.

## Apps de chat

WhatsApp e Telegram ligam um agente a um número ou a um bot, para que as pessoas escrevam para esse agente pelo app de chat. Na **Loja**, use **Adicionar número** no WhatsApp, escaneie o código com **Mostrar código QR** e escolha se o número é **Meu assistente** (responde ao seu próprio chat) ou **Atendimento** (responde a qualquer pessoa que escrever). **Pausar** e **Retomar** param e reiniciam um número. No Telegram, cole o token do bot que você criou.

## Credenciais salvas

Quando um agente precisa de uma chave de API ou de uma senha, ele pede em um cartão protegido. O valor é guardado criptografado e nunca é mostrado de novo nem enviado ao modelo. Para listar, trocar ou remover, abra as configurações do bot, **Avançado**, **Credenciais**.

## Quando algo dá errado

Uma conexão com erro precisa de novo login ou de reconexão. Se um agente diz que não alcança um app, confira se o app está **Conectado** e se o agente tem acesso.`,
    },
  },
};
