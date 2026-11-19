// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import source from "../../public/sdk.js?raw";
import alias from "../../public/sdk-assist.js?raw";

const ORIGIN = "https://app.corvo.test";

interface RookGlobal {
  configure(options: Record<string, unknown>): void;
  ask: ((options: Record<string, unknown>) => Promise<unknown>) & { stub?: boolean };
  recorder: ((options: Record<string, unknown>) => unknown) & { stub?: boolean };
}
const rook = () => (window as unknown as { Rook?: RookGlobal }).Rook as RookGlobal;

/** Runs a built script the way a page would. */
const run = (code: string) => {
  // biome-ignore lint/security/noGlobalEval: loads the built script the way a page would
  window.eval(code);
};

let paths: string[];
let sessions: number;
let bearers: string[];

beforeEach(() => {
  paths = [];
  bearers = [];
  sessions = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = url.startsWith(ORIGIN) ? url.slice(ORIGIN.length) : url;
      paths.push(path);
      if (path === "/corvo/session") return Response.json({ code: `code-${++sessions}` });
      if (path === "/api/partner/embed/exchange") {
        return Response.json({
          token: `token-${sessions}`,
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        });
      }
      bearers.push(String((init.headers as Record<string, string>).authorization));
      return Response.json({ result: { ok: true } });
    }),
  );
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  Reflect.deleteProperty(window, "Rook");
  run(source);
});
afterEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mountElement() {
  const element = document.createElement("corvo-assistant");
  element.setAttribute("mode", "launcher");
  element.setAttribute("session-url", "/corvo/session");
  element.setAttribute("origin", ORIGIN);
  document.body.append(element);
  return element as HTMLElement & { getToken(force?: boolean): Promise<string> };
}

describe("one SDK entry", () => {
  it("has the element and the headless calls in sdk.js", () => {
    expect(customElements.get("corvo-assistant")).toBeTruthy();
    expect(typeof rook().ask).toBe("function");
    expect(typeof rook().recorder).toBe("function");
    expect(typeof rook().configure).toBe("function");
  });

  it("signs the headless calls in through the element on the page, once", async () => {
    mountElement();
    await rook().ask({ preset: "evolution" });
    await rook().ask({ preset: "evolution" });
    expect(paths.filter((p) => p === "/corvo/session")).toHaveLength(1);
    expect(paths.filter((p) => p === "/api/partner/embed/exchange")).toHaveLength(1);
    expect(bearers).toEqual(["Bearer token-1", "Bearer token-1"]);
  });

  it("makes one sign-in for calls that start together, and a new one when forced", async () => {
    const element = mountElement();
    const [a, b] = await Promise.all([element.getToken(), element.getToken()]);
    expect(a).toBe("token-1");
    expect(b).toBe("token-1");
    expect(sessions).toBe(1);
    expect(await element.getToken(true)).toBe("token-2");
  });

  it("uses the element's origin and session route, with no configuration", async () => {
    mountElement();
    await rook().ask({ task: "t" });
    expect(paths).toContain("/api/partner/embed/ask");
  });

  it("lets a getToken the page configured win over the element", async () => {
    mountElement();
    rook().configure({ origin: ORIGIN, getToken: async () => "mine" });
    await rook().ask({ task: "t" });
    expect(sessions).toBe(0);
    expect(bearers).toEqual(["Bearer mine"]);
  });

  it("falls back to a session of its own when there is no element", async () => {
    rook().configure({ sessionUrl: "/corvo/session", origin: ORIGIN });
    await rook().ask({ task: "t" });
    expect(sessions).toBe(1);
    expect(bearers).toEqual(["Bearer token-1"]);
  });

  it("fails clearly with neither an element nor a session route", async () => {
    await expect(rook().ask({ task: "t" })).rejects.toMatchObject({ code: "no_session" });
  });
});

describe("sdk-assist.js alias", () => {
  function runAlias(readyState: string, async = false) {
    Reflect.deleteProperty(window, "Rook");
    Object.defineProperty(document, "currentScript", {
      value: { src: `${ORIGIN}/sdk-assist.js`, async, defer: false },
      configurable: true,
    });
    Object.defineProperty(document, "readyState", { value: readyState, configurable: true });
    run(alias);
  }
  afterEach(() => {
    Reflect.deleteProperty(document, "currentScript");
    Reflect.deleteProperty(document, "readyState");
  });

  it("writes sdk.js in place when it is a plain script tag, so the next script finds Rook", () => {
    const write = vi.spyOn(document, "write").mockImplementation(() => undefined);
    runAlias("loading");
    expect(write).toHaveBeenCalledWith(expect.stringContaining(`src="${ORIGIN}/sdk.js"`));
  });

  it("loads sdk.js and holds ask until it is there when added later", async () => {
    runAlias("complete", true);
    const script = document.head.querySelector("script") as HTMLScriptElement;
    expect(script.src).toBe(`${ORIGIN}/sdk.js`);
    expect(rook().ask.stub).toBe(true);
    expect(() => rook().recorder({})).toThrow(/loading/);
    const pending = rook().ask({ task: "t" });
    // The real file arrives and takes over.
    run(source);
    script.onload?.(new Event("load"));
    await pending.catch(() => undefined);
    expect(rook().ask.stub).toBeUndefined();
  });

  it("does nothing when sdk.js already ran", () => {
    const write = vi.spyOn(document, "write").mockImplementation(() => undefined);
    run(source);
    Object.defineProperty(document, "currentScript", {
      value: { src: `${ORIGIN}/sdk-assist.js` },
      configurable: true,
    });
    run(alias);
    expect(write).not.toHaveBeenCalled();
    expect(document.head.querySelector("script")).toBeNull();
  });
});
