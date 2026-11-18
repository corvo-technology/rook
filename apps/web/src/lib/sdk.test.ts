// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import source from "../../public/sdk.js?raw";

const ORIGIN = "https://app.corvo.test";

function mount(attributes: Record<string, string> = {}) {
  const element = document.createElement("corvo-assistant");
  element.setAttribute("session-url", "/corvo/session");
  element.setAttribute("origin", ORIGIN);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  document.body.append(element);
  return element;
}

const frameOf = (element: Element) => element.querySelector("iframe") as HTMLIFrameElement;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
let codes: string[];

beforeEach(() => {
  codes = ["code-1", "code-2", "code-3"];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      codes.length ? Response.json({ code: codes.shift() }) : new Response("no", { status: 500 }),
    ),
  );
  // biome-ignore lint/security/noGlobalEval: loads the built widget script the way a page would
  if (!customElements.get("corvo-assistant")) (0, eval)(source);
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("<corvo-assistant>", () => {
  it("opens a frame on the Rook origin with the code, theme and locale in the fragment", async () => {
    const element = mount({ theme: "dark", locale: "fr" });
    await settle();
    const src = new URL(frameOf(element).src);
    expect(src.origin + src.pathname).toBe(`${ORIGIN}/embed`);
    expect(Object.fromEntries(new URLSearchParams(src.hash.slice(1)))).toEqual({
      code: "code-1",
      theme: "dark",
      locale: "fr",
    });
    // The code never goes in the query string, which a server would see.
    expect(src.search).toBe("");
  });

  it("asks the partner's own backend for the code, with the partner's own cookies", async () => {
    mount();
    await settle();
    expect(fetch).toHaveBeenCalledWith("/corvo/session", {
      method: "POST",
      credentials: "same-origin",
    });
  });

  it("defaults the theme to auto and the locale to the visitor's language", async () => {
    const element = mount();
    await settle();
    const params = new URLSearchParams(new URL(frameOf(element).src).hash.slice(1));
    expect(params.get("theme")).toBe("auto");
    expect(params.get("locale")).toBe(navigator.language);
  });

  it("sends a new code when the frame asks for one, and only to the frame's origin", async () => {
    const element = mount();
    await settle();
    const frame = frameOf(element);
    const post = vi.fn();
    Object.defineProperty(frame, "contentWindow", { value: { postMessage: post } });
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "corvo:refresh" },
        origin: ORIGIN,
        source: frame.contentWindow as unknown as MessageEventSource,
      }),
    );
    await settle();
    expect(post).toHaveBeenCalledWith({ type: "corvo:code", code: "code-2" }, ORIGIN);
  });

  it("ignores messages from any other window or origin", async () => {
    const element = mount();
    await settle();
    const frame = frameOf(element);
    const post = vi.fn();
    Object.defineProperty(frame, "contentWindow", { value: { postMessage: post } });
    const spoof = (init: MessageEventInit) =>
      window.dispatchEvent(
        new MessageEvent("message", { data: { type: "corvo:refresh" }, ...init }),
      );
    spoof({
      origin: "https://evil.example",
      source: frame.contentWindow as unknown as MessageEventSource,
    });
    spoof({ origin: ORIGIN, source: window });
    await settle();
    expect(post).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("tells the page when the frame is ready or the session could not be opened", async () => {
    codes = [];
    const element = mount();
    const expired = vi.fn();
    element.addEventListener("corvo-expired", expired);
    await settle();
    expect(frameOf(element).getAttribute("src")).toBeNull();
    expect(expired).toHaveBeenCalled();
  });

  it("passes a changed theme to the frame without reloading it", async () => {
    const element = mount({ theme: "light" });
    await settle();
    const frame = frameOf(element);
    const post = vi.fn();
    Object.defineProperty(frame, "contentWindow", { value: { postMessage: post } });
    element.setAttribute("theme", "dark");
    expect(post).toHaveBeenCalledWith(
      { type: "corvo:config", theme: "dark", locale: undefined },
      ORIGIN,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("<corvo-assistant> events from the frame", () => {
  async function fromFrame(data: unknown, listen: (element: Element) => void) {
    const element = mount();
    listen(element);
    await settle();
    const frame = frameOf(element);
    Object.defineProperty(frame, "contentWindow", { value: { postMessage: vi.fn() } });
    window.dispatchEvent(
      new MessageEvent("message", {
        data,
        origin: ORIGIN,
        source: frame.contentWindow as unknown as MessageEventSource,
      }),
    );
  }

  it("announces unread and navigate requests with their details", async () => {
    const unread = vi.fn();
    const navigate = vi.fn();
    await fromFrame({ type: "corvo:unread", count: 4.9 }, (el) =>
      el.addEventListener("corvo-unread", unread),
    );
    expect(unread.mock.calls[0]?.[0].detail).toEqual({ count: 4 });
    await fromFrame({ type: "corvo:navigate", path: "/consultas/gravar" }, (el) =>
      el.addEventListener("corvo-navigate", navigate),
    );
    expect(navigate.mock.calls[0]?.[0].detail).toEqual({ path: "/consultas/gravar" });
  });

  it("ignores a navigate path that leaves the host's site", async () => {
    const navigate = vi.fn();
    await fromFrame({ type: "corvo:navigate", path: "//evil.example" }, (el) =>
      el.addEventListener("corvo-navigate", navigate),
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("opens the checkout in the top window unless the page handles it", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const seen = vi.fn();
    await fromFrame({ type: "corvo:checkout", url: "https://pay.example.test/buy" }, (el) =>
      el.addEventListener("corvo-checkout", seen),
    );
    expect(seen.mock.calls[0]?.[0].detail).toEqual({ url: "https://pay.example.test/buy" });
    expect(open).toHaveBeenCalledWith(
      "https://pay.example.test/buy",
      "_blank",
      "noopener,noreferrer",
    );

    open.mockClear();
    await fromFrame({ type: "corvo:checkout", url: "https://pay.example.test/buy" }, (el) =>
      el.addEventListener("corvo-checkout", (event) => event.preventDefault()),
    );
    expect(open).not.toHaveBeenCalled();
  });

  it("never opens an address that is not https", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await fromFrame({ type: "corvo:checkout", url: "javascript:alert(1)" }, () => undefined);
    expect(open).not.toHaveBeenCalled();
  });
});
