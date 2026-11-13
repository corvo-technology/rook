import type { ProcessEvent } from "@corvo/adapter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeRemoteSupervisor } from "./docker-remote-supervisor.test-support.js";
import {
  DockerSandboxProvider,
  MAX_SANDBOX_ERROR_RESPONSE_BYTES,
  MAX_SANDBOX_SUCCESS_RESPONSE_BYTES,
  SCREEN_RELEASE_TIMEOUT_MS,
} from "./docker-sandbox.js";
import { isSandboxGoneError } from "./sandbox-errors.js";

const context = {
  operationId: "docker-test",
  traceId: "docker-test",
  spaceId: "workspace",
  userId: "user",
  botId: "bot",
  screenLeaseId: "run-1:1",
  signal: new AbortController().signal,
};

/** A supervisor stub that answers its health check as a shared-disk one, then runs `respond`. */
function sharedDiskSupervisor(respond: (url: string, init?: RequestInit) => Promise<Response>) {
  return vi.fn(async (url: string, init?: RequestInit) =>
    url.endsWith("/health") ? Response.json({ ok: true }) : respond(url, init),
  );
}

describe("Docker sandbox", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("names the computer service and the network's reason when its request fails", async () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:50635"), {
      code: "ECONNREFUSED",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed", { cause: refused });
      }),
    );
    const provider = new DockerSandboxProvider("http://127.0.0.1:50635", "test-token");
    await expect(
      provider.provision({ botId: "bot", homePath: "/tmp/bot" }, context),
    ).rejects.toThrow("fetch failed (127.0.0.1:50635): connect ECONNREFUSED 127.0.0.1:50635");
  });

  it("rejects a failed interactive screen instead of returning a viewer fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/screen-mode")
          ? Response.json({ error: "control screen failed to start" }, { status: 400 })
          : Response.json({ running: true }),
      ),
    );
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");
    await expect(
      provider.connectScreen(
        { id: "computer", botId: "bot", kind: "docker", providerRef: "computer" },
        { view: "stream", interactive: true, controlToken: "human-control" },
        context,
      ),
    ).rejects.toThrow("control screen failed to start");
  });

  it("requires a control token and an explicit route for an interactive screen", async () => {
    const fetchMock = vi.fn(async () => Response.json({}));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");
    const computer = {
      id: "computer",
      botId: "bot",
      kind: "docker" as const,
      providerRef: "computer",
    };
    await expect(
      provider.connectScreen(computer, { view: "stream", interactive: true }, context),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(
      provider.connectScreen(
        computer,
        { view: "stream", interactive: true, controlToken: "human-control" },
        context,
      ),
    ).rejects.toThrow();
  });

  it("sends the bounded timeout to the supervisor and preserves its honest result", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({
        stdout: "partial output\n",
        stderr: "command timed out after 75 ms\n",
        code: 124,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");
    const events: ProcessEvent[] = [];

    for await (const event of provider.execute(
      { id: "computer", botId: "bot", kind: "docker", providerRef: "computer" },
      { argv: ["sleep", "10"], unsetEnv: ["FAILED"], timeoutMs: 75 },
      context,
    )) {
      events.push(event);
    }

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      argv: ["env", "-u", "FAILED", "--", "sleep", "10"],
      cwd: "/home/corvo",
      timeoutMs: 75,
    });
    expect(events).toEqual([
      { type: "stdout", data: "partial output\n" },
      { type: "stderr", data: "command timed out after 75 ms\n" },
      { type: "exit", code: 124 },
    ]);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "x-corvo-bot-id": "bot",
      "x-corvo-screen-id": "bot",
    });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "x-request-id": expect.any(String),
      traceparent: expect.stringMatching(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/),
    });
  });

  it("yields stdout from a streaming exec before the command exits", async () => {
    let releaseExit: () => void = () => undefined;
    const exitGate = new Promise<void>((resolve) => {
      releaseExit = resolve;
    });
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            async start(controller) {
              controller.enqueue(
                encoder.encode(
                  `${JSON.stringify({ type: "stdout", data: "code: ABCD-1234\nhttps://github.com/login/device\n" })}\n`,
                ),
              );
              await exitGate;
              controller.enqueue(encoder.encode(`${JSON.stringify({ type: "exit", code: 0 })}\n`));
              controller.close();
            },
          }),
          { headers: { "content-type": "application/x-ndjson" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");
    const iterator = provider
      .execute(
        { id: "computer", botId: "bot", kind: "docker", providerRef: "computer" },
        { argv: ["gh", "auth", "login", "--web"], timeoutMs: 5_000 },
        context,
      )
      [Symbol.asyncIterator]();

    const first = await iterator.next();
    expect(first.value).toEqual({
      type: "stdout",
      data: "code: ABCD-1234\nhttps://github.com/login/device\n",
    });
    let exitSeen = false;
    const rest = (async () => {
      const next = await iterator.next();
      exitSeen = true;
      return next;
    })();
    await Promise.resolve();
    expect(exitSeen).toBe(false);
    releaseExit();
    await expect(rest).resolves.toEqual({ value: { type: "exit", code: 0 }, done: false });
  });

  it("rejects a declared oversized success response without buffering it", async () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      sharedDiskSupervisor(
        async () =>
          new Response(new ReadableStream({ cancel }), {
            headers: { "content-length": String(MAX_SANDBOX_SUCCESS_RESPONSE_BYTES + 1) },
          }),
      ),
    );
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");

    await expect(
      provider.provision({ botId: "bot", homePath: "/tmp/bot" }, context),
    ).rejects.toThrow(`sandbox response exceeds ${MAX_SANDBOX_SUCCESS_RESPONSE_BYTES} bytes`);
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  });

  it.each([
    [
      { id: "computer", resumed: true, started: true },
      { fresh: false, started: true },
    ],
    [{ id: "computer", resumed: true, started: false }, { fresh: false }],
    [{ id: "computer", resumed: true }, { fresh: false }],
    [{ id: "computer", resumed: false }, { fresh: true }],
  ])("reports whether provisioning started the computer: %j", async (body, expected) => {
    vi.stubGlobal(
      "fetch",
      sharedDiskSupervisor(async () => Response.json(body)),
    );
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");

    await expect(
      provider.provision({ botId: "bot", homePath: "/tmp/bot" }, context),
    ).resolves.toStrictEqual({
      id: "computer",
      botId: "bot",
      kind: "docker",
      providerRef: "computer",
      ...expected,
    });
  });

  it("translates a 429 computer limit reached error from the supervisor", async () => {
    vi.stubGlobal(
      "fetch",
      sharedDiskSupervisor(async () =>
        Response.json({ error: "Computer limit reached for space (max: 5)" }, { status: 429 }),
      ),
    );
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");

    await expect(
      provider.provision({ botId: "bot", homePath: "/tmp/bot" }, context),
    ).rejects.toThrow("Computer limit reached for space (max: 5)");
  });

  it("stops a streamed file response at the caller-derived encoded limit", async () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array(1029));
              },
              cancel,
            }),
          ),
      ),
    );
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");

    await expect(
      provider.readFile(
        { id: "computer", botId: "bot", kind: "docker", providerRef: "computer" },
        "small.txt",
        context,
        { maxBytes: 1 },
      ),
    ).rejects.toThrow("sandbox response exceeds 1028 bytes");
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  });

  it("accepts a valid encoded envelope above the generic response cap", async () => {
    const maxBytes = 13 * 1024 * 1024;
    const encodedLimit = Math.ceil(maxBytes / 3) * 4 + 1024;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response('{"content":""}', {
            headers: { "content-length": String(encodedLimit) },
          }),
      ),
    );
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");

    await expect(
      provider.readFile(
        { id: "computer", botId: "bot", kind: "docker", providerRef: "computer" },
        "large.bin",
        context,
        { maxBytes },
      ),
    ).resolves.toEqual(new Uint8Array());
  });

  it("releases this bot's screen assignment through the supervisor", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");

    await provider.releaseScreen(
      { id: "computer", botId: "home-bot", kind: "docker", providerRef: "computer" },
      context,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://supervisor.test/computers/computer/screen",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({
          authorization: "Bearer test-token",
          "x-corvo-bot-id": "home-bot",
          "x-corvo-screen-id": "bot",
          "x-corvo-screen-lease-id": "run-1:1",
          "x-corvo-space-id": "workspace",
        }),
      }),
    );
  });

  it("still releases the screen after the run abort signal has fired", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({ error: "computer not found" }, { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");
    const abort = new AbortController();
    abort.abort();

    await expect(
      provider.releaseScreen(
        { id: "computer", botId: "home-bot", kind: "docker", providerRef: "computer" },
        { ...context, signal: abort.signal },
      ),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]?.signal).not.toBe(abort.signal);
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
  });

  it("reports a supervisor teardown failure instead of a finished release", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ error: "computer screen failed to stop" }, { status: 500 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");
    const computer = {
      id: "computer",
      botId: "home-bot",
      kind: "docker",
      providerRef: "computer",
    } as const;

    await expect(provider.releaseScreen(computer, context)).rejects.toThrow(
      "sandbox screen release failed: 500",
    );

    fetchMock.mockImplementation(async () =>
      Response.json({ error: "computer screen failed to stop" }, { status: 404 }),
    );
    await expect(provider.releaseScreen(computer, context)).rejects.toThrow(
      "sandbox screen release failed: 404",
    );
  });

  it("bounds screen release even when fetch ignores cancellation", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Promise<Response>(() => undefined),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");

    const pending = provider.releaseScreen(
      { id: "computer", botId: "home-bot", kind: "docker", providerRef: "computer" },
      context,
    );
    const rejected = expect(pending).rejects.toThrow("sandbox screen release timed out");
    await vi.advanceTimersByTimeAsync(SCREEN_RELEASE_TIMEOUT_MS);

    await rejected;
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("surfaces a supervisor failure from stop and destroy instead of swallowing it", async () => {
    const fetchMock = vi.fn(async () => Response.json({ error: "unauthorized" }, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new DockerSandboxProvider("http://supervisor.test", "stale-token");
    const computer = {
      id: "computer",
      botId: "bot",
      kind: "docker",
      providerRef: "computer",
    } as const;

    await expect(provider.stop(computer, context)).rejects.toThrow(
      'sandbox stop failed: 401 {"error":"unauthorized"}',
    );
    await expect(provider.destroy(computer, context)).rejects.toThrow(
      'sandbox destroy failed: 401 {"error":"unauthorized"}',
    );

    fetchMock.mockImplementation(async () => new Response("boom", { status: 500 }));
    await expect(provider.stop(computer, context)).rejects.toThrow("sandbox stop failed: 500 boom");
    await expect(provider.destroy(computer, context)).rejects.toThrow(
      "sandbox destroy failed: 500 boom",
    );
  });

  it("does not buffer an oversized supervisor error body", async () => {
    const cancel = vi.fn();
    const fetchMock = vi.fn(
      async () =>
        new Response(new ReadableStream({ cancel }), {
          status: 500,
          headers: { "content-length": String(MAX_SANDBOX_ERROR_RESPONSE_BYTES + 1) },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");
    const computer = {
      id: "computer",
      botId: "bot",
      kind: "docker",
      providerRef: "computer",
    } as const;

    await expect(provider.stop(computer, context)).rejects.toThrow("sandbox stop failed: 500");
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  });

  it("stops reading a streamed supervisor error at the byte limit", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(MAX_SANDBOX_ERROR_RESPONSE_BYTES + 1));
            },
          }),
          { status: 500 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");

    await expect(
      provider.stop(
        { id: "computer", botId: "bot", kind: "docker", providerRef: "computer" },
        context,
      ),
    ).rejects.toThrow("sandbox stop failed: 500");
  });

  it("treats a computer the supervisor no longer knows as already stopped and destroyed", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ error: "computer not found" }, { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");
    const computer = {
      id: "computer",
      botId: "bot",
      kind: "docker",
      providerRef: "computer",
    } as const;

    await expect(provider.stop(computer, context)).resolves.toBeUndefined();
    await expect(provider.destroy(computer, context)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("asks the supervisor to cancel orphaned run work when releasing a screen", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");
    await provider.releaseScreen(
      { id: "computer-1", botId: "bot", kind: "docker", providerRef: "computer-1" },
      { ...context, cancelRunWork: true },
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://supervisor.test/computers/computer-1/screen",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({ "x-corvo-cancel-run-work": "1" }),
      }),
    );
  });

  it("preserves only a completed, non-cancelled screen and releases the view on cancellation", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");
    const computer = {
      id: "computer-1",
      botId: "bot",
      kind: "docker",
      providerRef: "computer-1",
    } as const;

    await provider.releaseScreen(computer, { ...context, keepScreenWarm: true });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "x-corvo-preserve-screen": "1",
    });

    await provider.releaseScreen(computer, {
      ...context,
      keepScreenWarm: true,
      cancelRunWork: true,
    });
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      "x-corvo-cancel-run-work": "1",
    });
    expect(fetchMock.mock.calls[1]?.[1]?.headers).not.toHaveProperty("x-corvo-preserve-screen");

    const abort = new AbortController();
    abort.abort();
    await provider.releaseScreen(computer, {
      ...context,
      keepScreenWarm: true,
      signal: abort.signal,
    });
    expect(fetchMock.mock.calls[2]?.[1]?.headers).not.toHaveProperty("x-corvo-preserve-screen");
  });
});

describe("Docker page browser", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the owned computer screen and lease instead of the generic exec endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ ok: true, title: "Fixture", url: "https://example.test" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");
    await provider.pageBrowser(
      { id: "computer", botId: "team-home", kind: "docker", providerRef: "computer" },
      { command: "snapshot" },
      context,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://supervisor.test/computers/computer/browser",
      expect.objectContaining({
        redirect: "error",
        signal: context.signal,
        body: JSON.stringify({ command: "snapshot" }),
        headers: expect.objectContaining({
          "x-corvo-bot-id": "team-home",
          "x-corvo-screen-lease-id": "run-1:1",
        }),
      }),
    );
  });
});

describe("Docker sandbox stopped containers", () => {
  const computer = {
    id: "computer",
    botId: "bot",
    kind: "docker" as const,
    providerRef: "computer",
  };

  function supervisorWith(status: Response | (() => Response)) {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/screen-mode")) {
        return Response.json(
          { error: "(HTTP code 409) container stopped/paused - container computer is not running" },
          { status: 400 },
        );
      }
      if (url.endsWith("/computers/computer") && (init?.method ?? "GET") === "GET") {
        return typeof status === "function" ? status() : status;
      }
      throw new Error(`unexpected request ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats a control revoke on a stopped container as already released", async () => {
    const fetchMock = supervisorWith(() => Response.json({ id: "computer", running: false }));
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");

    await expect(provider.setScreenControl(computer, false, context, "lease-1")).resolves.toBe(
      undefined,
    );

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "http://supervisor.test/computers/computer/screen-mode",
      "http://supervisor.test/computers/computer",
    ]);
  });

  it("reports a deleted container gone so lease cleanup can clear its stale reference", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { error: "(HTTP code 404) no such container - No such container: computer" },
        { status: 400 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");

    const error = await provider.setScreenControl(computer, false, context, "lease-1").then(
      () => null,
      (error: unknown) => error,
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(isSandboxGoneError(error)).toBe(true);
  });

  it("reports a deleted container gone when running a command", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          stdout: "",
          stderr: "(HTTP code 404) no such container - No such container: computer",
          code: 1,
        }),
      ),
    );
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");

    const error = await (async () => {
      for await (const _event of provider.execute(computer, { argv: ["true"] }, context));
    })().then(
      () => null,
      (error: unknown) => error,
    );

    expect(isSandboxGoneError(error)).toBe(true);
  });

  it("reports a stopped container gone when running a command", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith("/exec")
        ? Response.json({ error: "computer is not running" }, { status: 409 })
        : Response.json({ id: "computer", running: false }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");

    const error = await (async () => {
      for await (const _event of provider.execute(computer, { argv: ["true"] }, context));
    })().then(
      () => null,
      (error: unknown) => error,
    );

    expect(isSandboxGoneError(error)).toBe(true);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "http://supervisor.test/computers/computer/exec",
      "http://supervisor.test/computers/computer",
    ]);
  });

  it("keeps an exec failure on a live container a failed command", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).endsWith("/exec")
          ? new Response("bad gateway", { status: 502 })
          : Response.json({ id: "computer", running: true }),
      ),
    );
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");

    const events = [];
    for await (const event of provider.execute(computer, { argv: ["true"] }, context)) {
      events.push(event);
    }
    expect(events).toEqual([
      { type: "stderr", data: "exec failed: 502" },
      { type: "exit", code: 1 },
    ]);
  });

  it("reports a stopped container gone when granting interactive control", async () => {
    supervisorWith(() => Response.json({ id: "computer", running: false }));
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");

    const error = await provider.setScreenControl(computer, true, context, "lease-1").then(
      () => null,
      (error: unknown) => error,
    );

    expect(error).toBeInstanceOf(Error);
    expect(isSandboxGoneError(error)).toBe(true);
  });

  it("reports a stopped container gone instead of a blank screen", async () => {
    supervisorWith(() => Response.json({ id: "computer", running: false }));
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");

    const error = await provider
      .connectScreen(computer, { view: "stream", interactive: false }, context)
      .then(
        () => null,
        (error: unknown) => error,
      );

    expect(isSandboxGoneError(error)).toBe(true);
  });

  it("does not treat a supervisor lookup failure as a stopped container", async () => {
    // The supervisor answers 404 for any inspection error, not only a missing container.
    supervisorWith(() => Response.json({ error: "computer not found" }, { status: 404 }));
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");

    await expect(provider.setScreenControl(computer, false, context, "lease-1")).rejects.toThrow(
      /sandbox screen mode failed: 400/,
    );
    await expect(
      provider.connectScreen(computer, { view: "stream", interactive: false }, context),
    ).resolves.toMatchObject({ url: null });
  });

  it("propagates cancellation raised while checking the container", async () => {
    const controller = new AbortController();
    supervisorWith(() => {
      controller.abort();
      throw controller.signal.reason;
    });
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");
    const cancelable = { ...context, signal: controller.signal };

    await expect(
      provider.setScreenControl(computer, false, cancelable, "lease-1"),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("keeps a screen-mode failure on a live container an error", async () => {
    supervisorWith(() => Response.json({ id: "computer", running: true }));
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");

    await expect(provider.setScreenControl(computer, false, context, "lease-1")).rejects.toThrow(
      /sandbox screen mode failed: 400 .*is not running/,
    );
    await expect(
      provider.connectScreen(computer, { view: "stream", interactive: false }, context),
    ).resolves.toMatchObject({ url: null });
  });

  it("does not guess when the supervisor cannot describe the container", async () => {
    supervisorWith(() => new Response("upstream unavailable", { status: 502 }));
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");

    await expect(provider.setScreenControl(computer, false, context, "lease-1")).rejects.toThrow(
      /sandbox screen mode failed: 400/,
    );
    await expect(
      provider.connectScreen(computer, { view: "stream", interactive: false }, context),
    ).resolves.toMatchObject({ url: null });
  });
});

describe("Docker sandbox with homes kept by a remote supervisor", () => {
  const computer = { id: "c-bot", botId: "bot", kind: "docker" as const, providerRef: "c-bot" };

  afterEach(() => vi.unstubAllGlobals());

  it("asks the supervisor who owns the homes and keeps asking until it answers", async () => {
    const responses = [new Response("down", { status: 503 }), Response.json({ homes: "remote" })];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => responses.shift() ?? Response.json({ homes: "remote" })),
    );
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");
    await expect(provider.keepsHome(context)).rejects.toThrow("health failed: 503");
    await expect(provider.keepsHome(context)).resolves.toBe(true);
    await expect(provider.keepsHome(context)).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("treats a supervisor that does not say as one sharing its disk", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true })),
    );
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");
    await expect(provider.keepsHome(context)).resolves.toBe(false);
  });

  it("sends no home path, because the supervisor makes the home on its own host", async () => {
    const supervisor = fakeRemoteSupervisor();
    vi.stubGlobal("fetch", supervisor.fetch);
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");
    await provider.provision({ botId: "bot", homePath: "/server/data/homes/bot" }, context);
    expect(supervisor.provisions).toHaveLength(1);
    expect(supervisor.provisions[0]).not.toHaveProperty("homePath");
  });

  it("still sends the shared home path to a supervisor that shares the disk", async () => {
    const seen: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      sharedDiskSupervisor(async (_url, init) => {
        seen.push(JSON.parse(String(init?.body)));
        return Response.json({ id: "computer" });
      }),
    );
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");
    await provider.provision({ botId: "bot", homePath: "/server/data/homes/bot" }, context);
    expect(seen[0]).toMatchObject({ homePath: "/server/data/homes/bot" });
  });

  it("exports the home as one archive, with the executable bit and large paths intact", async () => {
    const supervisor = fakeRemoteSupervisor();
    supervisor.write("bot", { "notes/todo.txt": "write the report", "ünï/ça.txt": "accents" });
    vi.stubGlobal("fetch", supervisor.fetch);
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");
    const files: Record<string, string> = {};
    for await (const file of provider.exportWorkspace(computer, context)) {
      if ("body" in file) throw new Error("expected small files");
      files[file.path] = Buffer.from(file.content).toString();
    }
    expect(files).toEqual({ "notes/todo.txt": "write the report", "ünï/ça.txt": "accents" });
    expect(supervisor.requests).toEqual(["GET /health", "GET /computers/c-bot/archive"]);
  });

  it("imports a workspace as one streamed archive and round-trips it", async () => {
    const supervisor = fakeRemoteSupervisor();
    supervisor.disk.set("bot", new Map());
    vi.stubGlobal("fetch", supervisor.fetch);
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");
    async function* files() {
      yield { path: "a.txt", content: Buffer.from("one") };
      yield { path: "deep/dir/run.sh", content: Buffer.from("#!/bin/sh"), executable: true };
    }
    await provider.importWorkspace(computer, files(), context);
    expect(supervisor.read("bot")).toEqual({ "a.txt": "one", "deep/dir/run.sh": "#!/bin/sh" });
    expect(supervisor.disk.get("bot")?.get("deep/dir/run.sh")?.executable).toBe(true);
    expect(supervisor.requests.filter((request) => request.startsWith("PUT"))).toEqual([
      "PUT /computers/c-bot/archive",
    ]);
  });

  it("reports a computer the supervisor no longer has as gone, so its row is cleared", async () => {
    const supervisor = fakeRemoteSupervisor();
    vi.stubGlobal("fetch", supervisor.fetch);
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");
    const error = await provider
      .exportWorkspace(computer, context)
      [Symbol.asyncIterator]()
      .next()
      .catch((caught: unknown) => caught);
    expect(isSandboxGoneError(error)).toBe(true);
  });

  it("fails an import the supervisor refused, instead of calling the restore done", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/health")
          ? Response.json({ homes: "remote" })
          : Response.json({ error: "tar: short read" }, { status: 500 }),
      ),
    );
    const provider = new DockerSandboxProvider("http://supervisor.test", "test-token");
    async function* none() {
      yield { path: "a.txt", content: Buffer.from("one") };
    }
    await expect(provider.importWorkspace(computer, none(), context)).rejects.toThrow(
      "sandbox workspace import failed: 500",
    );
  });
});
