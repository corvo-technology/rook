import type { CliEngineSetupService } from "@corvo/adapters";
import type { Actor } from "@corvo/contracts";
import { RPCHandler } from "@orpc/server/fetch";
import { describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

const owner: Actor = {
  userId: "user-one",
  spaceId: "space-one",
  email: "one@corvo.test",
  isDeploymentOwner: true,
};

function setup(service?: Partial<Record<keyof CliEngineSetupService, unknown>>) {
  const refresh = vi.fn(async () => ({}));
  const deps = {
    prisma: {},
    cliEngineSetup: service as unknown as CliEngineSetupService | undefined,
    localSetup: { refresh },
    env: { agentRuntime: "pi", webOrigin: "http://127.0.0.1:5173", sandboxProvider: "fake" },
  } as unknown as RouterDeps;
  const handler = new RPCHandler(createRouter(deps));
  const call = async (procedure: string, input: unknown = null) => {
    const { response } = await handler.handle(
      new Request(`http://127.0.0.1/rpc/${procedure}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: input }),
      }),
      { prefix: "/rpc", context: { actor: owner } },
    );
    const body = (await response?.json()) as { json?: any };
    return { status: response?.status ?? 0, json: body?.json };
  };
  return { call, refresh };
}

describe("engines routes", () => {
  it("every procedure is FORBIDDEN where CLI engines are not offered", async () => {
    const { call } = setup(undefined);
    const sessionId = "session-one";
    for (const [procedure, input] of [
      ["engines/setupState", null],
      ["engines/install", { id: "claude" }],
      ["engines/signIn", { id: "claude" }],
      ["engines/loginScreen", { sessionId }],
      ["engines/loginInput", { sessionId, text: "x" }],
      ["engines/cancelLogin", { sessionId }],
    ] as const) {
      expect((await call(procedure, input)).status, procedure).toBe(403);
    }
  });

  it("install with an unknown id is BAD_REQUEST and runs nothing", async () => {
    const install = vi.fn();
    const { call } = setup({ install });
    expect((await call("engines/install", { id: "unknown" })).status).toBe(400);
    expect(install).not.toHaveBeenCalled();
  });

  it("a finished install refreshes what the model step finds", async () => {
    const { call, refresh } = setup({ install: vi.fn(async () => "installed") });
    expect(await call("engines/install", { id: "claude" })).toEqual({
      status: 200,
      json: { state: "installed" },
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("a checksum mismatch is reported and refreshes nothing", async () => {
    const { call, refresh } = setup({ install: vi.fn(async () => "mismatch") });
    expect((await call("engines/install", { id: "claude" })).json).toEqual({ state: "mismatch" });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("signIn answers with the mode the service picked", async () => {
    const { call } = setup({
      signIn: vi.fn(async () => ({ sessionId: "s1", mode: "terminal" })),
    });
    expect(await call("engines/signIn", { id: "claude" })).toEqual({
      status: 200,
      json: { sessionId: "s1", mode: "terminal" },
    });
  });

  it("signIn is BAD_REQUEST where the computer cannot run it", async () => {
    const { call } = setup({ signIn: vi.fn(async () => undefined) });
    expect((await call("engines/signIn", { id: "claude" })).status).toBe(400);
  });

  it("loginInput for another session id is NOT_FOUND", async () => {
    const { call } = setup({ input: vi.fn(() => false) });
    expect((await call("engines/loginInput", { sessionId: "other", text: "x" })).status).toBe(404);
  });

  it("a session that finished signed in refreshes the model step", async () => {
    const { call, refresh } = setup({
      session: vi.fn(() => ({ state: "done", lines: [] })),
    });
    expect((await call("engines/loginScreen", { sessionId: "s1" })).json.state).toBe("done");
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
