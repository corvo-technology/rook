---
title: "SDK and events"
description: "The <corvo-assistant> element, its attributes and events."
sidebar:
  order: 6
---

The SDK is a single script that registers the `<corvo-assistant>` element.

```html
<script src="https://app.rook.team/sdk.js"></script>
<corvo-assistant
  session-url="/rook/session"
  theme="auto"
  locale="en"
  accent="#e11d48"
  style="height: 600px"
></corvo-assistant>
```

## Attributes

| Attribute | Value |
| --- | --- |
| `session-url` | A route on **your** backend that returns `{ "code": "..." }` (see the [quickstart](/en/partners/quickstart/)). Called with `POST` and same-origin cookies. |
| `theme` | `light`, `dark` or `auto`. |
| `locale` | `en`, `de`, `pt-BR`, `zh-CN`, `es`, `fr` or `ja`. Default: the visitor's language. |
| `accent` | Your main color, `#rrggbb`. Buttons and the current state use it; the text on it turns light or dark to stay readable. Without it the template's `accent` applies, or Rook's own green. |

Change `theme`, `locale` or `accent` and the frame follows, without reloading.

## Events

| Event | When |
| --- | --- |
| `corvo-ready` | The frame loaded and the session is ready. |
| `corvo-expired` | The session could not be opened or renewed (your route failed or returned no code). Show your own state or ask for a new sign-in. |

The element asks your route for a new code whenever the frame needs one, on its own. You only listen for the events.

```js
const el = document.querySelector("corvo-assistant");
el.addEventListener("corvo-ready", () => console.log("assistant ready"));
el.addEventListener("corvo-expired", () => (location.href = "/login"));
```

## Frame security

The frame keeps its session token **in memory only** (a frame on another site cannot keep a cookie), so your page never sees it. Any site may frame the page, but a frame without a valid one-use code shows nothing.
