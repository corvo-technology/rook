// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import source from "../../public/sdk.js?raw";

const ORIGIN = "https://app.corvo.test";

type Launcher = HTMLElement & {
  setContext(context: unknown): void;
  registerActions(actions: unknown): void;
  resolveAction(id: string, result?: unknown): void;
  setSuggestions(list: string[]): void;
  open(): void;
  close(): void;
  toggle(): void;
};

function mount(attributes: Record<string, string> = {}): Launcher {
  const element = document.createElement("corvo-assistant") as Launcher;
  element.setAttribute("mode", "launcher");
  element.setAttribute("session-url", "/corvo/session");
  element.setAttribute("origin", ORIGIN);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  document.body.append(element);
  return element;
}

const shadow = (element: Element) => element.shadowRoot as ShadowRoot;
const frameOf = (element: Element) => shadow(element).querySelector("iframe") as HTMLIFrameElement;
const fab = (element: Element) => shadow(element).querySelector(".fab") as HTMLButtonElement;
const pop = (element: Element) => shadow(element).querySelector(".pop") as HTMLElement;
const panel = (element: Element) => shadow(element).querySelector(".panel") as HTMLElement;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Gives the frame a fake window and returns what the element posts to it. */
function spyFrame(element: Element) {
  const frame = frameOf(element);
  const post = vi.fn();
  Object.defineProperty(frame, "contentWindow", {
    value: { postMessage: post },
    configurable: true,
  });
  return { frame, post };
}

function fromFrame(
  element: Element,
  data: unknown,
  init: { origin?: string; source?: unknown } = {},
) {
  const frame = frameOf(element);
  window.dispatchEvent(
    new MessageEvent("message", {
      data,
      origin: init.origin ?? ORIGIN,
      source: (init.source ?? frame.contentWindow) as MessageEventSource,
    }),
  );
}

let codes: Array<string | number>;
beforeEach(() => {
  codes = ["code-1", "code-2", "code-3"];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const next = codes.shift();
      if (typeof next === "number") return new Response("no", { status: next });
      return next ? Response.json({ code: next }) : new Response("no", { status: 500 });
    }),
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  // biome-ignore lint/security/noGlobalEval: loads the built widget script the way a page would
  if (!customElements.get("corvo-assistant")) (0, eval)(source);
});
afterEach(() => {
  document.body.innerHTML = "";
  document.body.removeAttribute("style");
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("launcher: surfaces", () => {
  it("draws a button in a shadow root and nothing else until it is used", () => {
    const element = mount();
    expect(fab(element)).toBeTruthy();
    expect(pop(element).hidden).toBe(true);
    expect(panel(element).dataset.open).toBe("false");
    expect(element.querySelector("iframe")).toBeNull();
    expect(shadow(element).textContent).not.toMatch(/rook/i);
  });

  it("toggles the quick-ask popover from the button and announces it", () => {
    const element = mount();
    const opened = vi.fn();
    const closed = vi.fn();
    element.addEventListener("corvo-open", opened);
    element.addEventListener("corvo-close", closed);
    fab(element).click();
    expect(pop(element).hidden).toBe(false);
    expect(fab(element).getAttribute("aria-expanded")).toBe("true");
    expect(opened).toHaveBeenCalledTimes(1);
    fab(element).click();
    expect(pop(element).hidden).toBe(true);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("opens and closes with Cmd/Ctrl+J, and not with the key off", () => {
    const element = mount();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "j", metaKey: true, bubbles: true }),
    );
    expect(pop(element).hidden).toBe(false);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "j", ctrlKey: true, bubbles: true }),
    );
    expect(pop(element).hidden).toBe(true);
    document.body.innerHTML = "";
    const off = mount({ shortcut: "off" });
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "j", metaKey: true, bubbles: true }),
    );
    expect(pop(off).hidden).toBe(true);
  });

  it("closes on Escape and gives focus back to where it was", () => {
    const element = mount();
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    element.open();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(pop(element).hidden).toBe(true);
    expect(document.activeElement).toBe(outside);
  });

  it("focuses the input when the popover opens", () => {
    const element = mount();
    element.open();
    expect(shadow(element).activeElement).toBe(shadow(element).querySelector("input"));
  });

  it("opens the full conversation as a panel, hides the button, and can expand", () => {
    const element = mount();
    element.open();
    (shadow(element).querySelector(".full") as HTMLElement).click();
    expect(panel(element).dataset.open).toBe("true");
    expect(pop(element).hidden).toBe(true);
    expect(fab(element).hidden).toBe(true);
    (shadow(element).querySelector(".expand") as HTMLElement).click();
    expect(panel(element).dataset.expanded).toBe("true");
    (shadow(element).querySelector(".close") as HTMLElement).click();
    expect(panel(element).dataset.open).toBe("false");
    expect(panel(element).dataset.expanded).toBe("false");
  });

  it("pushes the page for dock=push and puts it back on close", () => {
    document.body.style.marginInlineEnd = "8px";
    const element = mount({ dock: "push" });
    element.open();
    (shadow(element).querySelector(".full") as HTMLElement).click();
    expect(document.body.style.marginInlineEnd).toBe("440px");
    element.close();
    expect(document.body.style.marginInlineEnd).toBe("8px");
  });

  it("overlays the page by default", () => {
    const element = mount();
    element.open();
    (shadow(element).querySelector(".full") as HTMLElement).click();
    expect(document.body.style.marginInlineEnd).toBe("");
  });

  it("takes the partner's accent, radius and font, and keeps the page's font by default", () => {
    const element = mount({ accent: "#e11d48", radius: "4px", "font-family": "Inter, sans-serif" });
    const root = shadow(element).querySelector(".root") as HTMLElement;
    expect(root.style.getPropertyValue("--accent")).toBe("#e11d48");
    expect(root.style.getPropertyValue("--radius")).toBe("4px");
    expect(root.style.fontFamily).toContain("Inter");
    element.setAttribute("font-family", "x; background:url(//evil)");
    expect(root.style.fontFamily).toBe("");
    element.setAttribute("radius", "calc(1px)");
    expect(root.style.getPropertyValue("--radius")).toBe("");
  });

  it("badges the button with unread and still announces it", async () => {
    const element = mount();
    await settle();
    spyFrame(element);
    const unread = vi.fn();
    element.addEventListener("corvo-unread", unread);
    fromFrame(element, { type: "corvo:unread", count: 3 });
    const badge = shadow(element).querySelector(".badge") as HTMLElement;
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe("3");
    expect(unread.mock.calls[0]?.[0].detail).toEqual({ count: 3 });
  });
});

describe("launcher: instant open", () => {
  it("preconnects to the Rook origin on load", () => {
    mount();
    const link = document.head.querySelector('link[rel="preconnect"]') as HTMLLinkElement;
    expect(link.href).toBe(`${ORIGIN}/`);
  });

  it("prepares the session when the browser is idle, in compact mode, without opening", async () => {
    vi.useFakeTimers();
    const element = mount();
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetch).toHaveBeenCalledTimes(1);
    const src = new URL(frameOf(element).src);
    expect(src.origin + src.pathname).toBe(`${ORIGIN}/embed`);
    expect(new URLSearchParams(src.hash.slice(1)).get("mode")).toBe("compact");
    expect(new URLSearchParams(src.hash.slice(1)).get("code")).toBe("code-1");
    expect(pop(element).hidden).toBe(true);
  });

  it("prepares on first hover and only once", async () => {
    const element = mount();
    fab(element).dispatchEvent(new Event("pointerenter"));
    fab(element).dispatchEvent(new Event("focus"));
    fab(element).click();
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shows a skeleton until the frame is ready, then the chat", async () => {
    const element = mount();
    fab(element).dispatchEvent(new Event("pointerenter"));
    await settle();
    const body = shadow(element).querySelector(".body") as HTMLElement;
    expect(body.dataset.ready).toBeUndefined();
    expect(shadow(element).querySelector(".skeleton")).toBeTruthy();
    spyFrame(element);
    const ready = vi.fn();
    element.addEventListener("corvo-ready", ready);
    fromFrame(element, { type: "corvo:ready" });
    expect(body.dataset.ready).toBe("true");
    expect(ready).toHaveBeenCalled();
  });

  it("hides itself and says why when the session is refused", async () => {
    codes = [403];
    const element = mount();
    const unavailable = vi.fn();
    element.addEventListener("corvo-unavailable", unavailable);
    fab(element).dispatchEvent(new Event("pointerenter"));
    await settle();
    expect((shadow(element).querySelector(".root") as HTMLElement).hidden).toBe(true);
    expect(unavailable.mock.calls[0]?.[0].detail).toEqual({ reason: "forbidden" });
    element.open();
    expect(pop(element).hidden).toBe(true);
  });

  it("hides itself when the frame cannot sign in", async () => {
    const element = mount();
    fab(element).dispatchEvent(new Event("pointerenter"));
    await settle();
    spyFrame(element);
    const unavailable = vi.fn();
    element.addEventListener("corvo-unavailable", unavailable);
    fromFrame(element, { type: "corvo:expired" });
    expect(unavailable.mock.calls[0]?.[0].detail).toEqual({ reason: "expired" });
  });
});

describe("launcher: page context and suggestions", () => {
  async function ready(element: Launcher) {
    fab(element).dispatchEvent(new Event("pointerenter"));
    await settle();
    const spy = spyFrame(element);
    fromFrame(element, { type: "corvo:ready" });
    spy.post.mockClear();
    return spy;
  }

  it("forwards a limited context to the frame's origin and shows it as a chip", async () => {
    const element = mount();
    const { post } = await ready(element);
    element.setContext({
      page: "/clientes/42",
      title: "x".repeat(500),
      entities: [
        { type: "customer", id: 42, label: "Carlos Souza" },
        { type: "bad type", id: "1", label: "dropped" },
      ],
    });
    const [message, target] = post.mock.calls[0] as [Record<string, unknown>, string];
    expect(target).toBe(ORIGIN);
    expect(message.type).toBe("corvo:context");
    const context = message.context as { title: string; entities: unknown[] };
    expect(context.title).toHaveLength(120);
    expect(context.entities).toEqual([{ type: "customer", id: "42", label: "Carlos Souza" }]);
    expect((pop(element).querySelector(".chip") as HTMLElement).textContent).toBe("Carlos Souza");
  });

  it("reads the context attribute and ignores one that is not JSON", async () => {
    const element = mount({ context: JSON.stringify({ page: "/agenda", title: "Agenda" }) });
    expect((pop(element).querySelector(".chip") as HTMLElement).textContent).toBe("Agenda");
    const { post } = await ready(element);
    element.setAttribute("context", "{nope");
    expect(post.mock.calls[0]?.[0]).toEqual({ type: "corvo:context", context: null });
  });

  it("sends the context again once the frame is ready", async () => {
    const element = mount();
    element.setContext({ page: "/agenda" });
    fab(element).dispatchEvent(new Event("pointerenter"));
    await settle();
    const { post } = spyFrame(element);
    fromFrame(element, { type: "corvo:ready" });
    expect(post.mock.calls.map((call) => call[0].type)).toEqual(["corvo:context", "corvo:actions"]);
  });

  it("lists the page's suggestions, then its own, then the registered actions", () => {
    const element = mount();
    const lines = () =>
      [...pop(element).querySelectorAll(".suggest button")].map((b) => b.textContent);
    element.registerActions([{ name: "open_agenda", description: "Abrir na agenda" }]);
    expect(lines()).toEqual(["Abrir na agenda"]);
    element.setContext({ page: "/x", suggestions: ["Quem vem hoje?"] });
    expect(lines()).toEqual(["Quem vem hoje?"]);
    element.setSuggestions(["Resumo do dia"]);
    expect(lines()).toEqual(["Resumo do dia"]);
  });

  it("sends a typed question or a tapped suggestion to the chat and opens it", async () => {
    const element = mount();
    const { post } = await ready(element);
    element.setSuggestions(["Resumo do dia"]);
    element.open();
    (pop(element).querySelector(".suggest button") as HTMLElement).click();
    expect(panel(element).dataset.open).toBe("true");
    expect(post).toHaveBeenCalledWith({ type: "corvo:ask", text: "Resumo do dia" }, ORIGIN);
  });

  it("holds a question until the frame is ready", async () => {
    const element = mount();
    element.open();
    const input = shadow(element).querySelector("input") as HTMLInputElement;
    input.value = "  Quem vem hoje?  ";
    (shadow(element).querySelector("form") as HTMLFormElement).dispatchEvent(
      new Event("submit", { cancelable: true }),
    );
    await settle();
    const { post } = spyFrame(element);
    fromFrame(element, { type: "corvo:ready" });
    expect(post).toHaveBeenCalledWith({ type: "corvo:ask", text: "Quem vem hoje?" }, ORIGIN);
  });
});

describe("launcher: host actions", () => {
  const BOOK = {
    name: "book",
    description: "Reservar horário",
    params: {
      type: "object",
      properties: {
        barber: { type: "string", enum: ["rafael", "ana"] },
        minutes: { type: "integer", minimum: 10 },
      },
      required: ["barber"],
    },
    confirm: false,
  };

  async function ready(element: Launcher) {
    fab(element).dispatchEvent(new Event("pointerenter"));
    await settle();
    const spy = spyFrame(element);
    fromFrame(element, { type: "corvo:ready" });
    spy.post.mockClear();
    return spy;
  }

  it("sends the registered actions to the frame, always asking the customer first", async () => {
    const element = mount();
    const { post } = await ready(element);
    element.registerActions([BOOK, { name: "Not Valid" }]);
    const message = post.mock.calls[0]?.[0] as {
      type: string;
      actions: Array<{ name: string; confirm: boolean }>;
    };
    expect(message.type).toBe("corvo:actions");
    expect(message.actions.map((a) => [a.name, a.confirm])).toEqual([["book", true]]);
  });

  it("dispatches corvo-action only after the frame reports a confirmed, valid action", async () => {
    const element = mount();
    const { post } = await ready(element);
    element.registerActions([BOOK]);
    post.mockClear();
    const seen = vi.fn();
    element.addEventListener("corvo-action", seen);
    fromFrame(element, {
      type: "corvo:action",
      id: "a1",
      name: "book",
      params: { barber: "ana", minutes: 30 },
    });
    expect(seen.mock.calls[0]?.[0].detail).toEqual({
      name: "book",
      params: { barber: "ana", minutes: 30 },
      id: "a1",
    });
    expect(post).not.toHaveBeenCalled();
  });

  it("refuses unknown actions and params that do not fit, without telling the page", async () => {
    const element = mount();
    const { post } = await ready(element);
    element.registerActions([BOOK]);
    post.mockClear();
    const seen = vi.fn();
    element.addEventListener("corvo-action", seen);
    fromFrame(element, { type: "corvo:action", id: "a1", name: "delete_all", params: {} });
    fromFrame(element, {
      type: "corvo:action",
      id: "a2",
      name: "book",
      params: { barber: "mallory" },
    });
    fromFrame(element, { type: "corvo:action", id: "a3", name: "book", params: {} });
    fromFrame(element, {
      type: "corvo:action",
      id: "a4",
      name: "book",
      params: { barber: "ana", extra: 1 },
    });
    fromFrame(element, {
      type: "corvo:action",
      id: "a5",
      name: "book",
      params: { barber: "ana", minutes: 2.5 },
    });
    expect(seen).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(5);
    expect(
      post.mock.calls.every(
        ([message]) => message.type === "corvo:action-result" && message.ok === false,
      ),
    ).toBe(true);
  });

  it("sends the page's answer back once, only for an action it was asked to do", async () => {
    const element = mount();
    const { post } = await ready(element);
    element.registerActions([BOOK]);
    post.mockClear();
    fromFrame(element, { type: "corvo:action", id: "a1", name: "book", params: { barber: "ana" } });
    element.resolveAction("nope", { ok: true });
    expect(post).not.toHaveBeenCalled();
    element.resolveAction("a1", { ok: true, message: "Reservado" });
    element.resolveAction("a1", { ok: true });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      { type: "corvo:action-result", id: "a1", ok: true, result: "Reservado" },
      ORIGIN,
    );
    fromFrame(element, { type: "corvo:action", id: "a2", name: "book", params: { barber: "ana" } });
    element.resolveAction("a2", { ok: false, message: "Sem horário" });
    expect(post.mock.calls[1]?.[0]).toMatchObject({ id: "a2", ok: false, result: "Sem horário" });
  });

  it("ignores every message from another window or origin", async () => {
    const element = mount();
    const { post } = await ready(element);
    element.registerActions([BOOK]);
    post.mockClear();
    const seen = vi.fn();
    const unread = vi.fn();
    element.addEventListener("corvo-action", seen);
    element.addEventListener("corvo-unread", unread);
    const action = { type: "corvo:action", id: "a1", name: "book", params: { barber: "ana" } };
    fromFrame(element, action, { origin: "https://evil.example" });
    fromFrame(element, action, { source: window });
    fromFrame(element, { type: "corvo:unread", count: 9 }, { origin: "https://evil.example" });
    fromFrame(element, { type: "corvo:escape" }, { source: window });
    expect(seen).not.toHaveBeenCalled();
    expect(unread).not.toHaveBeenCalled();
    element.resolveAction("a1", { ok: true });
    expect(post).not.toHaveBeenCalled();
  });

  it("closes when the frame reports Escape", async () => {
    const element = mount();
    await ready(element);
    element.open();
    (shadow(element).querySelector(".full") as HTMLElement).click();
    fromFrame(element, { type: "corvo:escape" });
    expect(panel(element).dataset.open).toBe("false");
  });
});

describe("inline mode", () => {
  it("is unchanged: no shadow root, no launcher, the frame loads at once", async () => {
    const element = document.createElement("corvo-assistant");
    element.setAttribute("session-url", "/corvo/session");
    element.setAttribute("origin", ORIGIN);
    document.body.append(element);
    await settle();
    expect(element.shadowRoot).toBeNull();
    const frame = element.querySelector("iframe") as HTMLIFrameElement;
    expect(new URLSearchParams(new URL(frame.src).hash.slice(1)).get("mode")).toBeNull();
  });
});
