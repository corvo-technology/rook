import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearSpaceSelection,
  createSpaceRpc,
  leaveUnavailableSpace,
  onRpcTargetGone,
  rpc,
  rpcForSpace,
  selectedSpaceId,
  selectSpace,
} from "./rpc.js";

const notify = vi.hoisted(() => vi.fn());
vi.mock("./auth", () => ({ authClient: { $store: { notify } } }));

afterEach(() => {
  vi.unstubAllGlobals();
  notify.mockClear();
});

describe("signed-out responses", () => {
  it("rechecks the session when the server answers 401, and only then", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ json: { code: "UNAUTHORIZED", status: 401 } }, { status: 401 }),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(rpc.me()).rejects.toMatchObject({ status: 401 });
    expect(notify).toHaveBeenCalledWith("$sessionSignal");

    notify.mockClear();
    fetch.mockImplementation(async () =>
      Response.json({ json: { code: "INTERNAL_SERVER_ERROR", status: 500 } }, { status: 500 }),
    );
    await expect(rpc.me()).rejects.toMatchObject({ status: 500 });
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("unavailable space", () => {
  function browser(selected: string, spaces: string[] | null) {
    const items = new Map([["corvo:space-id", selected]]);
    const reload = vi.fn();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => items.set(key, value),
        removeItem: (key: string) => items.delete(key),
      },
      location: { origin: "http://app.example", reload },
    });
    const fetch = vi.fn(async (_request: Request, init?: RequestInit) => {
      if (!spaces)
        return Response.json({ json: { code: "UNAUTHORIZED", status: 401 } }, { status: 401 });
      expect(new Headers(init?.headers).has("x-corvo-space-id")).toBe(false);
      return Response.json({
        json: {
          current: {
            id: "home",
            name: "Home",
            bots: [],
            groups: [],
            externalConversations: [],
            botSections: [],
          },
          spaces: spaces.map((id) => ({ id })),
        },
      });
    });
    vi.stubGlobal("fetch", fetch);
    return { items, reload };
  }

  it("drops a space the user is no longer in and reloads", async () => {
    const { items, reload } = browser("space-gone", ["home"]);
    await leaveUnavailableSpace("space-gone");
    expect(items.has("corvo:space-id")).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("recovers from a 401 on the shell's space-bound client", async () => {
    const { items, reload } = browser("space-gone", ["home"]);
    const fetch = vi.mocked(globalThis.fetch);
    const list = fetch.getMockImplementation()!;
    fetch.mockImplementation(async (request, init) =>
      new Headers(init?.headers).get("x-corvo-space-id") === "space-gone"
        ? Response.json({ json: { code: "UNAUTHORIZED", status: 401 } }, { status: 401 })
        : list(request, init),
    );
    await expect(createSpaceRpc("space-gone").me()).rejects.toMatchObject({ status: 401 });
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(items.has("corvo:space-id")).toBe(false);
  });

  it("keeps a space the user still has, and keeps it when signed out", async () => {
    for (const spaces of [["home", "space-a"], null]) {
      const { items, reload } = browser("space-a", spaces);
      await leaveUnavailableSpace("space-a");
      expect(items.get("corvo:space-id")).toBe("space-a");
      expect(reload).not.toHaveBeenCalled();
    }
  });
});

describe("space selection storage", () => {
  it("reports localStorage write failures without throwing", () => {
    const localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
      removeItem: () => {
        throw new Error("quota exceeded");
      },
    };
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("localStorage", localStorage);

    expect(selectSpace("space-support")).toBe(false);
    expect(() => clearSpaceSelection()).not.toThrow();
    expect(selectedSpaceId()).toBeNull();
  });

  it("treats an already-persisted selection as success when writes fail", () => {
    const localStorage = {
      getItem: (key: string) => (key === "corvo:space-id" ? "space-support" : null),
      setItem: () => {
        throw new Error("quota exceeded");
      },
      removeItem: vi.fn(),
    };
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("localStorage", localStorage);

    expect(selectSpace("space-support")).toBe(true);
    expect(selectSpace("space-other")).toBe(false);
  });

  it("reports when a space selection was persisted", () => {
    const setItem = vi.fn();
    const localStorage = { getItem: () => null, setItem, removeItem: vi.fn() };
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("localStorage", localStorage);

    expect(selectSpace("space-support")).toBe(true);
    expect(setItem).toHaveBeenCalledWith("corvo:space-id", "space-support");
  });
});

describe("shell RPC space isolation", () => {
  it.each([rpc, createSpaceRpc("space-a")])(
    "passes the caller's cancellation signal directly to fetch",
    async (client) => {
      const controller = new AbortController();
      const fetch = vi.fn(async (_request: Request, _init: RequestInit) =>
        Response.json({ json: {} }),
      );
      vi.stubGlobal("fetch", fetch);

      await client.me(undefined, { signal: controller.signal });

      const signal = fetch.mock.calls[0]?.[1].signal;
      expect(signal).toBe(controller.signal);
      controller.abort("thread retired");
      expect(signal?.aborted).toBe(true);
      expect(signal?.reason).toBe("thread retired");
    },
  );

  it.each(["space-a", null])(
    "keeps async follow-up requests in the original space %s after selection changes",
    async (originalSpace) => {
      let selected = originalSpace;
      vi.stubGlobal("window", {
        location: { origin: "https://example.test", pathname: "/app" },
        localStorage: { getItem: () => selected },
      });
      const fetch = vi.fn(async (_input: Request, _init: RequestInit) =>
        Response.json({ json: {} }),
      );
      vi.stubGlobal("fetch", fetch);
      const shellRpc = createSpaceRpc(selectedSpaceId());
      await shellRpc.me();
      selected = "space-b";
      // For example, an upload continues after reading a file or awaiting another RPC.
      await shellRpc.artifacts.create({
        botId: "bot-a",
        name: "example.txt",
        mimeType: "text/plain",
        contentBase64: "ZXhhbXBsZQ==",
      });
      await rpc.me();
      const headers = fetch.mock.calls.map((call) => {
        const init = call[1];
        return new Headers(init.headers).get("x-corvo-space-id");
      });
      expect(headers).toEqual([originalSpace, originalSpace, "space-b"]);
    },
  );

  it.each([createSpaceRpc, rpcForSpace])(
    "honours a space a call names explicitly with %s",
    async (clientForSpace) => {
      vi.stubGlobal("window", {
        location: { origin: "https://example.test", pathname: "/app" },
        localStorage: { getItem: () => "space-a" },
      });
      const fetch = vi.fn(async (_input: Request, _init: RequestInit) =>
        Response.json({ json: {} }),
      );
      vi.stubGlobal("fetch", fetch);
      const shellRpc = clientForSpace("space-a");
      await shellRpc.me(undefined, { context: { spaceId: "space-b" } });
      await shellRpc.me(undefined, { context: { spaceId: null } });
      await shellRpc.me();
      const headers = fetch.mock.calls.map((call) =>
        new Headers(call[1].headers).get("x-corvo-space-id"),
      );
      expect(headers).toEqual(["space-b", null, "space-a"]);
    },
  );
});

describe("space-bound clients", () => {
  function stubSelection(selected: string) {
    const localStorage = {
      getItem: (key: string) => (key === "corvo:space-id" ? selected : null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    const sent: Array<string | null> = [];
    vi.stubGlobal("window", {
      localStorage,
      location: { origin: "http://test", pathname: "/app" },
    });
    vi.stubGlobal("localStorage", localStorage);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request, init?: RequestInit) => {
        sent.push(new Headers(init?.headers ?? request.headers).get("x-corvo-space-id"));
        return Response.json({ json: null });
      }),
    );
    return sent;
  }

  it("sends its own space whichever space is selected", async () => {
    const sent = stubSelection("space-selected");
    await rpcForSpace("space-other").usage.summary();
    await rpc.usage.summary();
    expect(sent).toEqual(["space-other", "space-selected"]);
  });

  it("reuses one client per space", () => {
    expect(rpcForSpace("space-a")).toBe(rpcForSpace("space-a"));
    expect(rpcForSpace("space-a")).not.toBe(rpcForSpace("space-b"));
  });
});

describe("a send during an API swap", () => {
  const sent = { botId: "bot-1", text: "hi", clientNonce: "nonce-1" };
  const ok = () => Response.json({ json: { seq: 1 } });

  it("retries a 503 with the same client id and then succeeds", async () => {
    const bodies: string[] = [];
    const fetch = vi
      .fn<(request: Request) => Promise<Response>>()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", async (request: Request) => {
      bodies.push(await request.clone().text());
      return fetch(request);
    });
    await expect(rpc.threads.send(sent)).resolves.toMatchObject({ seq: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(bodies[0]).toContain("nonce-1");
    expect(bodies[1]).toBe(bodies[0]);
  });

  it("retries a dropped connection", async () => {
    const fetch = vi
      .fn<() => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetch);
    await expect(rpc.threads.send(sent)).resolves.toMatchObject({ seq: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry a send from an old client that has no client id", async () => {
    const fetch = vi.fn(async () => new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    await expect(rpc.threads.send({ botId: "bot-1", text: "hi" })).rejects.toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry a deleted conversation, and tells the shell to leave it", async () => {
    const fetch = vi.fn(async () =>
      Response.json(
        { json: { code: "NOT_FOUND", status: 404, message: "This conversation no longer exists" } },
        { status: 404 },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const gone = vi.fn();
    const off = onRpcTargetGone(gone);
    await expect(rpc.threads.send(sent)).rejects.toMatchObject({ code: "NOT_FOUND" });
    off();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(gone).toHaveBeenCalledWith({ botId: "bot-1" });
  });
});
