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
| `name` | Como o seu produto chama o assistente. É o rótulo no topo do quadro e, no launcher, o título do painel e o nome acessível do botão. Sem ele o quadro mostra "Assistente"; o nome e a marca do Rook nunca aparecem. |
| `icon` | Um endereço `https` com a imagem do assistente. Sem ele, nenhuma marca é mostrada. |
| `user-name` | Como a pessoa que está usando se chama, por exemplo `Maria Silva`. É a pessoa que o assistente cumprimenta ("Boa tarde, Maria") e quem assina as mensagens dela na conversa. Sem ele, o quadro cumprimenta sem nome e usa "Você"; nunca usa o nome da conta do cliente. |

Só no launcher:

| Atributo | Valor |
| --- | --- |
| `dock` | `overlay` (padrão) cobre a página; `push` abre espaço para o painel. No celular o painel é sempre uma folha na parte de baixo. |
| `radius` | Um comprimento CSS para os cantos, como `10px`. |
| `font-family` | Uma pilha de fontes. Sem ela, o launcher usa a fonte da sua página. |
| `context` | O contexto da página em JSON (veja abaixo). |
| `consultations` | Liga o botão **Gravar consulta** dentro do painel (veja [Gravar consulta no painel](#gravar-consulta-no-painel)). |
| `shortcut` | `off` desliga o atalho <kbd>⌘J</kbd> / <kbd>Ctrl+J</kbd>. |

Mude `theme`, `locale`, `accent`, `radius`, `font-family`, `dock`, `name`, `icon` ou `user-name` e tudo acompanha, sem recarregar. Como a conta é do cliente e não de uma pessoa, passe `user-name` com o nome de quem está logado no seu produto; o Rook não o guarda.

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

## Gravar consulta no painel

Com o atributo `consultations`, o painel do launcher mostra uma faixa com **Gravar consulta** sempre que a página disser quem está sendo atendido. Sem contexto de paciente, a faixa não aparece e o chat vazio sugere duas perguntas do dia (como o resumo da agenda de hoje), ou os atalhos do seu modelo.

Passe o paciente e a consulta pelo contexto da página, com entidades `patient` (ou `client`) e `appointment`:

```js
el.setContext({
  page: "/pacientes/42/evolucao",
  entities: [
    { type: "patient", id: "42", label: "Maria Souza" },
    { type: "appointment", id: "9001", label: "Hoje, 10:00" },
  ],
});
// opcional: quem atende e o que a nota deve conter
el.setConsultation({ professionalName: "Dra. Ana", preset: "evolution" });
```

`setConsultation` aceita `clientId`, `appointmentId`, `clientName`, `professionalName` e a saída (`preset`, ou `task` e `schema`, ou `instructions`); o que faltar vem das entidades do contexto.

O fluxo para o profissional:

1. **Gravar consulta** abre uma pergunta: o paciente autorizou a gravação? O profissional confirma **Sim, verbalmente** ou **Sim, por escrito**, ou cancela. Nada é gravado e o microfone não é pedido antes dessa confirmação; o método e o horário seguem para o Rook como o consentimento da consulta.
2. Durante a gravação a faixa mostra o tempo, **Pausar** e **Parar**.
3. Ao parar, mostra **Gerando rascunho…** enquanto o Rook transcreve e preenche a nota.
4. Quando o rascunho fica pronto, o elemento dispara `corvo-consultation` com `{ consultationId, clientId, appointmentId, note, transcript }`. Salve a nota como **rascunho** no prontuário e chame `el.resolveConsultation({ path: "/pacientes/42/evolucao/777" })`: a faixa passa a mostrar **Abrir rascunho**, que dispara `corvo-navigate` com esse caminho.

```js
el.addEventListener("corvo-consultation", async (event) => {
  const { appointmentId, note } = event.detail;
  const draft = await meuApp.saveDraft(appointmentId, note); // sempre rascunho: o profissional revisa
  el.resolveConsultation({ path: `/pacientes/42/evolucao/${draft.id}` });
});
```

O áudio e a transcrição são apagados do Rook assim que o evento é entregue (a nota é sua a partir daí). Se o microfone estiver bloqueado ou a gravação falhar, a faixa diz e oferece **Tentar de novo**. A gravação continua se o painel for fechado, e o botão flutuante ganha um anel vermelho enquanto grava. Para gravar dentro de um formulário seu, sem o painel, use `Rook.recorder` em [IA nas suas telas](/partners/inline-ai/).

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

`el.setSuggestions(["Quem vem hoje?", "Clientes sumidos"])` define as linhas da caixa rápida. Sem isso valem as `suggestions` do contexto, depois um atalho para cada entidade que tenha `path` e, por fim, as descrições das ações registradas.

Uma string simples é uma pergunta enviada ao assistente. Um lugar do seu produto é `{ label, path }`: ao tocar, dispara `corvo-navigate` com o caminho e nada é enviado ao assistente. Sugestões cujo `path` é a página em que a pessoa já está (o `page` do contexto ou o endereço atual) ficam ocultas. Uma entidade com `path` (`{ type: "patient", id: "42", label: "Maria", path: "/pacientes/42" }`) vira o atalho "Abrir Maria" sem você listá-lo; o `path` fica na sua página e nunca é enviado ao Rook.

O título do painel é o atributo `name`, ou "Assistente" quando você não passa nenhum; o nome do próprio Rook nunca aparece.

## Métodos

| Método | O que faz |
| --- | --- |
| `setContext(context)` | Define onde a pessoa está (veja acima). |
| `registerActions(actions)` | Substitui a lista de ações que a sua página oferece. |
| `resolveAction(id, result)` | Responde a um `corvo-action`: `{ ok?, message? }` ou um texto. |
| `setSuggestions(list)` | Define as sugestões da caixa rápida. |
| `setConsultation(options)` | Quem está sendo atendido e a saída da nota (veja Gravar consulta no painel). |
| `resolveConsultation({ path })` | Diz onde o rascunho ficou no seu produto; a faixa mostra **Abrir rascunho**. |
| `open()`, `close()`, `toggle()` | Controlam o launcher. |

## IA nas suas telas

O mesmo script define também `Rook.ask`, `Rook.recorder` e `Rook.configure` (veja [IA nas suas telas](/partners/inline-ai/)). Com um `<corvo-assistant>` na página, eles entram por ele e compartilham uma só sessão; `element.getToken(force)` devolve o token dessa sessão, se você precisar dele. O `sdk-assist.js` continua funcionando e só carrega o `sdk.js`.

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
| `corvo-consultation` `{ consultationId, clientId, appointmentId, note, transcript }` | Só no launcher, com `consultations`: o rascunho de uma consulta gravada no painel está pronto. Salve-o e chame `resolveConsultation`. |
| `corvo-consultation-error` `{ code, message, status, consultationId }` | Só no launcher, com `consultations`: a gravação falhou. `code` é um dos [códigos de erro de gravação](/partners/inline-ai/); o painel já mostra `message`. Registre-o ou mostre as suas palavras. |

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
