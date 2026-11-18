---
title: "SDK e eventos"
description: "O elemento <corvo-assistant>, seus atributos e eventos."
sidebar:
  order: 6
---

O SDK é um único script que registra o elemento `<corvo-assistant>`.

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
| `theme` | `light`, `dark` ou `auto`. |
| `locale` | `en`, `de`, `pt-BR`, `zh-CN`, `es`, `fr` ou `ja`. Padrão: o idioma do visitante. |
| `accent` | A sua cor principal, `#rrggbb`. Botões e o estado atual a usam; o texto sobre ela fica claro ou escuro para manter a leitura. Sem ela vale o `accent` do modelo, ou o verde do Rook. |

Mude `theme`, `locale` ou `accent` e o quadro acompanha, sem recarregar.

## Eventos

| Evento | Quando |
| --- | --- |
| `corvo-ready` | O quadro carregou e a sessão está pronta. |
| `corvo-expired` | A sessão não pôde ser aberta ou renovada (a rota devolveu erro ou nenhum código). Mostre o seu próprio estado ou peça login novamente. |

O elemento pede um novo código à sua rota sempre que o quadro precisa de um, sozinho. Você só ouve os eventos.

```js
const el = document.querySelector("corvo-assistant");
el.addEventListener("corvo-ready", () => console.log("assistente pronto"));
el.addEventListener("corvo-expired", () => (location.href = "/login"));
```

## Segurança do quadro

O quadro guarda o token de sessão **só em memória** (um iframe de outro site não pode manter cookie), então a sua página nunca o vê. Qualquer site pode emoldurar a página, mas um quadro sem um código válido de uso único não mostra nada.
