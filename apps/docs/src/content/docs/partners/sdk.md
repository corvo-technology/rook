---
title: "SDK e eventos"
description: "O elemento <corvo-assistant>: inline ou como botão flutuante, seus atributos, métodos e eventos."
sidebar:
  order: 6
---

O SDK é um único script que registra o elemento `<corvo-assistant>`. Ele tem dois modos.

- **Inline** (o padrão): o elemento é o chat, com o tamanho que você definir.
- **Launcher** (`mode="launcher"`): um botão flutuante disponível em todas as telas do seu produto. Abre uma caixa de pergunta rápida, ou um painel lateral com o chat completo, na sua cor, nos seus cantos e na sua fonte.

```html
<script src="https://app.rook.team/sdk.js"></script>
<corvo-assistant
  session-url="/rook/session"
  theme="auto"
  locale="pt-BR"
  accent="#e11d48"
  style="height: 600px"
></corvo-assistant>
```

## Atributos

| Atributo | Valor |
| --- | --- |
| `session-url` | Rota do **seu** backend que devolve `{ "code": "..." }` (veja o [quickstart](/partners/quickstart/)). Chamada com `POST` e cookies da mesma origem. |
| `mode` | `inline` (padrão) ou `launcher`. |
| `theme` | `light`, `dark` ou `auto`. |
| `locale` | `en`, `de`, `pt-BR`, `zh-CN`, `es`, `fr` ou `ja`. Padrão: o idioma do visitante. |
| `accent` | A sua cor principal, `#rrggbb`. Botões e o estado atual a usam; o texto sobre ela fica claro ou escuro para manter a leitura. Sem ela vale o `accent` do modelo, ou o verde do Rook. |
| `origin` | De onde o quadro é carregado. Padrão: de onde veio o `sdk.js`. |

Só no launcher:

| Atributo | Valor |
| --- | --- |
| `dock` | `overlay` (padrão) cobre a página; `push` abre espaço para o painel. No celular o painel é sempre uma folha na parte de baixo. |
| `radius` | Um comprimento CSS para os cantos, como `10px`. |
| `font-family` | Uma pilha de fontes. Sem ela, o launcher usa a fonte da sua página. |
| `name` | O nome do assistente, usado como título do painel e nome acessível do botão. |
| `context` | O contexto da página em JSON (veja abaixo). |
| `shortcut` | `off` desliga o atalho <kbd>⌘J</kbd> / <kbd>Ctrl+J</kbd>. |

Mude `theme`, `locale`, `accent`, `radius`, `font-family`, `dock` ou `name` e tudo acompanha, sem recarregar.

## Launcher

Monte o elemento **uma vez** no shell do seu app, para que ele continue no lugar enquanto a pessoa muda de tela. Ele prepara a sessão enquanto o seu produto está em uso (aquece a conexão ao carregar a página e abre a sessão quando o navegador está ocioso ou o botão recebe o mouse), então abrir mostra o chat na hora.

- O botão fica no canto inferior direito, com um contador de não lidas. <kbd>⌘J</kbd> ou <kbd>Ctrl+J</kbd> abre e fecha, <kbd>Esc</kbd> fecha, e o foco volta para onde estava.
- A caixa de pergunta rápida mostra o que a pessoa está vendo, um campo, sugestões para a tela atual e um link para a conversa completa.
- O painel tem 440 px de largura, pode ocupar a tela inteira e vira uma folha inferior abaixo de 640 px.
- Se a sessão não puder ser aberta (por exemplo, a sua rota responde `403`), o launcher se esconde e dispara `corvo-unavailable`.

## Contexto da página

Diga ao assistente onde a pessoa está, para que "esse cliente" faça sentido. Chame de novo sempre que a página mudar.

```js
el.setContext({
  page: "/clientes/42",
  title: "Cliente",
  entities: [{ type: "customer", id: "42", label: "Carlos Souza" }],
  suggestions: ["Esse cliente está sumido?"], // opcional, para a caixa rápida
});
```

Ou defina o atributo `context` com o mesmo JSON. Tudo tem tamanho limitado (no máximo 5 entidades, rótulos curtos), aparece para a pessoa como uma etiqueta e chega ao assistente como dado, nunca como instrução. Envie só o que a pessoa já vê no seu produto.

## Ações

Registre o que a sua página sabe fazer pela pessoa. O assistente pode *propor* uma delas; a pessoa sempre confirma em um cartão antes de qualquer coisa chegar à sua página.

```js
el.registerActions([
  {
    name: "open_agenda",
    description: "Abrir na agenda",
    params: {
      type: "object",
      properties: { day: { type: "string" } },
      required: ["day"],
    },
  },
]);

el.addEventListener("corvo-action", async (event) => {
  const { name, params, id } = event.detail;
  const ok = await meuApp.run(name, params);
  el.resolveAction(id, { ok, message: ok ? "Aberto" : "Sem horário" });
});
```

- `params` é um pedaço pequeno de JSON Schema: um objeto plano cujos valores são `string`, `number`, `integer` ou `boolean`, com `enum`, `maxLength`, `minimum`, `maximum` e `required`.
- O SDK e o servidor conferem os parâmetros com o seu esquema; um nome desconhecido ou um valor que não cabe nunca chega ao `corvo-action`.
- As ações existem só para esta sessão e esta página. Cada confirmação fica registrada no registro de segurança da conta.
- O resultado que você passa a `resolveAction` volta para a conversa.

## Sugestões

`el.setSuggestions(["Quem vem hoje?", "Clientes sumidos"])` define as linhas da caixa rápida. Sem isso valem as `suggestions` do contexto e, depois, as descrições das ações registradas.

## Métodos

| Método | O que faz |
| --- | --- |
| `setContext(context)` | Define onde a pessoa está (veja acima). |
| `registerActions(actions)` | Substitui a lista de ações que a sua página oferece. |
| `resolveAction(id, result)` | Responde a um `corvo-action`: `{ ok?, message? }` ou um texto. |
| `setSuggestions(list)` | Define as sugestões da caixa rápida. |
| `open()`, `close()`, `toggle()` | Controlam o launcher. |

## Eventos

| Evento | Quando |
| --- | --- |
| `corvo-ready` | O quadro carregou e a sessão está pronta. |
| `corvo-expired` | A sessão não pôde ser renovada (a rota devolveu erro ou nenhum código). Mostre o seu próprio estado ou peça login novamente. |
| `corvo-checkout` `{ url }` | O cliente tocou para comprar mais. Chame `preventDefault()` para tratar você mesmo; senão o endereço abre em uma nova aba. |
| `corvo-navigate` `{ path }` | Abra esse lugar no seu produto, como uma tela de gravação. |
| `corvo-unread` `{ count }` | Mostre o contador no seu próprio menu. |
| `corvo-open`, `corvo-close` | Só no launcher: ele abriu ou fechou. |
| `corvo-unavailable` `{ reason }` | Só no launcher: o assistente não pode ser oferecido e o launcher se escondeu. `reason` é `forbidden`, `unavailable`, `network`, `no_code` ou `expired`. |
| `corvo-action` `{ name, params, id }` | Só no launcher: o cliente confirmou uma ação que você registrou. Execute e depois chame `resolveAction(id, result)`. |

O elemento pede um novo código à sua rota sempre que o quadro precisa de um, sozinho.

## Shell de um app React

```jsx
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export function Assistente({ cliente }) {
  const el = useRef(null);
  const { pathname } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const node = el.current;
    node.registerActions([
      { name: "open_agenda", description: "Abrir na agenda",
        params: { type: "object", properties: { day: { type: "string" } } } },
    ]);
    const onAction = (e) => {
      navigate(`/agenda?day=${e.detail.params.day ?? ""}`);
      node.resolveAction(e.detail.id, { ok: true });
    };
    node.addEventListener("corvo-action", onAction);
    node.addEventListener("corvo-navigate", (e) => navigate(e.detail.path));
    return () => node.removeEventListener("corvo-action", onAction);
  }, [navigate]);

  useEffect(() => {
    el.current.setContext({
      page: pathname,
      entities: cliente ? [{ type: "customer", id: cliente.id, label: cliente.nome }] : [],
    });
  }, [pathname, cliente]);

  return (
    <corvo-assistant ref={el} mode="launcher" session-url="/rook/session" accent="#e11d48" />
  );
}
```

Renderize `<Assistente />` uma só vez, ao lado do seu roteador, não dentro de uma tela.

## Segurança do quadro

O quadro guarda o token de sessão **só em memória** (um iframe de outro site não pode manter cookie), então a sua página nunca o vê. Qualquer site pode emoldurar a página, mas um quadro sem um código válido de uso único não mostra nada. As mensagens entre a sua página e o quadro são conferidas dos dois lados por origem e por formato; a página só pode enviar o seu visual, o seu contexto, as suas ações e o resultado de uma ação, e nunca toca na sessão.
