---
title: "SDK and events"
description: "The <corvo-assistant> element: inline or as a launcher, its attributes, methods and events."
sidebar:
  order: 6
---

The SDK is a single script that registers the `<corvo-assistant>` element. It has two modes.

- **Inline** (the default): the element is the chat, sized by you.
- **Launcher** (`mode="launcher"`): a floating button available on every screen of your product. It opens a quick-ask box, or a side panel with the full chat, in your own accent, corner radius and font.

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
| `mode` | `inline` (default) or `launcher`. |
| `theme` | `light`, `dark` or `auto`. |
| `locale` | `en`, `de`, `pt-BR`, `zh-CN`, `es`, `fr` or `ja`. Default: the visitor's language. |
| `accent` | Your main color, `#rrggbb`. Buttons and the current state use it; the text on it turns light or dark to stay readable. Without it the template's `accent` applies, or Rook's own green. |
| `origin` | Where the frame is loaded from. Default: where `sdk.js` came from. |
| `name` | What your product calls the assistant. It is the label at the top of the frame and, in the launcher, the panel title and the button's accessible name. Without it the frame shows "Assistant"; Rook's own name and mark never appear. |
| `icon` | An `https` address for the assistant's image. Without it, no mark is shown. |
| `user-name` | What the signed-in person is called, such as `Maria Silva`. It is who the assistant greets ("Good afternoon, Maria") and who signs their messages in the conversation. Without it the frame greets without a name and says "You"; it never uses the customer account's name. |

Launcher only:

| Attribute | Value |
| --- | --- |
| `dock` | `overlay` (default) covers the page; `push` makes room for the panel. On a phone the panel is always a bottom sheet. |
| `radius` | A CSS length for the corners, such as `10px`. |
| `font-family` | A font stack. Without it the launcher uses your page's font. |
| `context` | The page context as JSON (see below). |
| `consultations` | Turns on the **Record consultation** bar inside the panel (see [Recording a consultation in the panel](#recording-a-consultation-in-the-panel)). |
| `shortcut` | `off` turns off the <kbd>⌘J</kbd> / <kbd>Ctrl+J</kbd> key. |

Change `theme`, `locale`, `accent`, `radius`, `font-family`, `dock`, `name`, `icon` or `user-name` and everything follows, without reloading. Because the account belongs to the customer rather than a person, pass `user-name` with whoever is signed in to your product; Rook does not store it.

## Launcher

Mount the element **once** in your app shell, so it stays in place as people move between screens. It prepares the session while your product is in use (it warms the connection when the page loads, and signs the session in when the browser is idle or the button is hovered), so opening it shows the chat at once.

- The button sits at the bottom right, with an unread badge. <kbd>⌘J</kbd> or <kbd>Ctrl+J</kbd> opens and closes it, <kbd>Esc</kbd> closes it, and focus goes back to where it was.
- The quick-ask box shows what the person is looking at, one input, suggestions for the current page and a link to the full conversation.
- The panel is 440 px wide, can expand to the full screen, and is a bottom sheet below 640 px.
- If the session cannot be opened (for example your route answers `403`), the launcher hides itself and fires `corvo-unavailable`.

## Page context

Tell the assistant where the person is, so "this customer" means something. Call it again whenever the page changes.

```js
el.setContext({
  page: "/customers/42",
  title: "Customer",
  entities: [{ type: "customer", id: "42", label: "Carlos Souza" }],
  suggestions: ["Is this customer overdue?"], // optional, for the quick-ask box
});
```

Or set the `context` attribute to the same JSON. Everything is length-limited (at most 5 entities, short labels), shown to the person as a chip, and given to the assistant as data, never as instructions. Send only what the person already sees in your product.

## Recording a consultation in the panel

With the `consultations` attribute, the launcher's panel shows a bar with **Record consultation** whenever the page says who is being seen. Without a patient in the context the bar is absent, and the empty chat suggests two questions about the day (such as summarizing today's schedule), or your template's shortcuts.

Pass the patient and the visit through the page context, with `patient` (or `client`) and `appointment` entities:

```js
el.setContext({
  page: "/patients/42/notes",
  entities: [
    { type: "patient", id: "42", label: "Maria Souza" },
    { type: "appointment", id: "9001", label: "Today, 10:00" },
  ],
});
// optional: who is seeing the patient and what the note should hold
el.setConsultation({ professionalName: "Dr. Ana", preset: "evolution" });
```

`setConsultation` accepts `clientId`, `appointmentId`, `clientName`, `professionalName` and the output (`preset`, or `task` and `schema`, or `instructions`); whatever is missing comes from the context's entities.

The flow for the professional:

1. **Record consultation** asks whether the patient agreed to be recorded. The professional confirms **Yes, verbally** or **Yes, in writing**, or cancels. Nothing is recorded and the microphone is not requested before that confirmation; the method and the time go to Rook as the consultation's consent.
2. While recording, the bar shows the time, **Pause** and **Stop**.
3. After stopping, it shows **Generating draft…** while Rook transcribes and fills in the note.
4. When the draft is ready, the element fires `corvo-consultation` with `{ consultationId, clientId, appointmentId, note, transcript, actions? }` (`actions` are the [agreed actions](/en/partners/consultations/#agreed-actions); when there are any, the consultation is kept so `Rook.applyConsultationActions` can apply them). Save the note as a **draft** in the record and call `el.resolveConsultation({ path: "/patients/42/notes/777" })`: the bar now shows **Open draft**, which fires `corvo-navigate` with that path.

```js
el.addEventListener("corvo-consultation", async (event) => {
  const { appointmentId, note } = event.detail;
  const draft = await myApp.saveDraft(appointmentId, note); // always a draft: the professional reviews it
  el.resolveConsultation({ path: `/patients/42/notes/${draft.id}` });
});
```

The audio and transcript are deleted from Rook once the event is delivered (the note is yours from then on), unless the event carries `actions`. If the microphone is blocked or the recording fails, the bar says so and offers **Try again**. Recording continues if the panel is closed, and the floating button gets a red ring while it does. To record inside a form of your own, without the panel, use `Rook.recorder` in [AI in your own screens](/en/partners/inline-ai/).

## Actions

Register what your page can do for the person. The assistant may *propose* one of them; the person always confirms in a card before anything reaches your page.

```js
el.registerActions([
  {
    name: "open_agenda",
    description: "Open in the schedule",
    params: {
      type: "object",
      properties: { day: { type: "string" } },
      required: ["day"],
    },
  },
]);

el.addEventListener("corvo-action", async (event) => {
  const { name, params, id } = event.detail;
  const ok = await myApp.run(name, params);
  el.resolveAction(id, { ok, message: ok ? "Opened" : "No slot" });
});
```

- `params` is a small subset of JSON Schema: a flat object whose values are `string`, `number`, `integer` or `boolean`, with `enum`, `maxLength`, `minimum`, `maximum` and `required`.
- The SDK and the server both check the params against your schema; an unknown name or a value that does not fit never reaches `corvo-action`.
- Actions exist only for this session and this page. Every confirmation is recorded in the account's security log.
- The result you pass to `resolveAction` goes back into the conversation.

## Suggestions

`el.setSuggestions(["Who is coming today?", "Overdue customers"])` sets the lines in the quick-ask box. Without it, the `suggestions` of the context apply, then a shortcut for each entity that has a `path`, then the descriptions of your registered actions.

A plain string is a question sent to the assistant. A place in your product is `{ label, path }`: tapping it fires `corvo-navigate` with the path and nothing is sent to the assistant. Suggestions whose `path` is the page the person is on (your context's `page`, or the current address) are hidden. An entity with a `path` (`{ type: "patient", id: "42", label: "Maria", path: "/patients/42" }`) becomes an "Open Maria" shortcut without you listing it; the `path` stays in your page and is never sent to Rook.

The panel's title is your `name` attribute, or "Assistant" when you pass none; Rook's own name is never shown.

## Methods

| Method | What it does |
| --- | --- |
| `setContext(context)` | Sets where the person is (see above). |
| `registerActions(actions)` | Replaces the list of actions your page offers. |
| `resolveAction(id, result)` | Answers a `corvo-action`: `{ ok?, message? }` or a message string. |
| `setSuggestions(list)` | Sets the quick-ask suggestions. |
| `setConsultation(options)` | Who is being seen and the note's output (see Recording a consultation in the panel). |
| `resolveConsultation({ path })` | Says where the draft landed in your product; the bar shows **Open draft**. |
| `open()`, `close()`, `toggle()` | Control the launcher. |

## AI in your own screens

The same script also defines `Rook.ask`, `Rook.recorder` and `Rook.configure` (see [AI in your own screens](/en/partners/inline-ai/)). With a `<corvo-assistant>` on the page they sign in through it and share one session; `element.getToken(force)` returns that session's bearer token if you need it yourself. `sdk-assist.js` still works and only loads `sdk.js`.

## Events

| Event | When |
| --- | --- |
| `corvo-ready` | The frame loaded and the session is ready. |
| `corvo-expired` | The session could not be renewed (your route failed or returned no code). Show your own state or ask for a new sign-in. |
| `corvo-checkout` `{ url }` | The customer tapped to buy more. Call `preventDefault()` to handle it yourself; otherwise the address opens in a new tab. |
| `corvo-navigate` `{ path }` | Open that place in your product, such as a recording screen. |
| `corvo-unread` `{ count }` | Badge your own menu. |
| `corvo-open`, `corvo-close` | Launcher only: the launcher opened or closed. |
| `corvo-unavailable` `{ reason }` | Launcher only: the assistant cannot be offered, so the launcher hid itself. `reason` is `forbidden`, `unavailable`, `network`, `no_code` or `expired`. |
| `corvo-action` `{ name, params, id }` | Launcher only: the customer confirmed an action you registered. Do it, then call `resolveAction(id, result)`. |
| `corvo-consultation` `{ consultationId, clientId, appointmentId, note, transcript }` | Launcher only, with `consultations`: the draft of a consultation recorded in the panel is ready. Save it and call `resolveConsultation`. |
| `corvo-consultation-error` `{ code, message, status, consultationId }` | Launcher only, with `consultations`: the recording failed. `code` is one of the [recording error codes](/en/partners/inline-ai/); the panel already shows `message`. Log it or show your own words. |

The element asks your route for a new code whenever the frame needs one, on its own.

## React app shell

```jsx
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export function Assistant({ customer }) {
  const el = useRef(null);
  const { pathname } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const node = el.current;
    node.registerActions([
      { name: "open_agenda", description: "Open in the schedule",
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
      entities: customer ? [{ type: "customer", id: customer.id, label: customer.name }] : [],
    });
  }, [pathname, customer]);

  return (
    <corvo-assistant ref={el} mode="launcher" session-url="/rook/session" accent="#e11d48" />
  );
}
```

Render `<Assistant />` once, next to your router, not inside a screen.

## Frame security

The frame keeps its session token **in memory only** (a frame on another site cannot keep a cookie), so your page never sees it. Any site may frame the page, but a frame without a valid one-use code shows nothing. Messages between your page and the frame are checked on both sides by origin and by shape; the page can only send its look, its context, its actions and the result of an action, and never touches the session.
