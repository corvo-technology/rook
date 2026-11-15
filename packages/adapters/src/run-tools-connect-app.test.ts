import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestSpaceAppAccess } from "./mcp-access.js";
import type { RunContext } from "./run-context.js";
import type { ToolCall } from "./run-tool-gate.js";
import { integrationTools } from "./run-tools-integrations.js";

vi.mock("./mcp-access.js", () => ({ requestSpaceAppAccess: vi.fn() }));
vi.mock("./connect-app.js", () => ({ connectApp: vi.fn(async () => ({ status: "pending" })) }));
vi.mock("./run-progress.js", () => ({
  flushProgress: vi.fn(async () => undefined),
  publishMidTurnNarration: vi.fn(async () => undefined),
}));

const ctx = {
  deps: {},
  run: { id: "run-1", spaceId: "space-1", userId: "user-1", threadId: "t-1", botId: "bot-1" },
  runId: "run-1",
  context: {},
} as unknown as RunContext;

function call(args: Record<string, unknown>) {
  const finish = vi.fn((result: unknown) => result);
  return { call: { args, executionId: "exec-1", finish } as unknown as ToolCall, finish };
}

beforeEach(() => vi.mocked(requestSpaceAppAccess).mockReset());

describe("connect_app for a teammate", () => {
  it("hands the app and the teammate's name to the access request", async () => {
    vi.mocked(requestSpaceAppAccess).mockResolvedValue({ status: "pending", message: "ok" });
    const { call: toolCall, finish } = call({ app: "Sentry", agent: "Infraestrutura e SRE" });
    await integrationTools.connect_app?.(ctx, toolCall);
    expect(requestSpaceAppAccess).toHaveBeenCalledWith(
      ctx.deps,
      ctx.run,
      "Sentry",
      "Infraestrutura e SRE",
      "write",
    );
    expect(finish).toHaveBeenCalledWith({ status: "pending", message: "ok" });
  });

  it("does not fall back to connecting the app for itself when the app is unknown", async () => {
    vi.mocked(requestSpaceAppAccess).mockResolvedValue(undefined);
    const { call: toolCall, finish } = call({ app: "Nothing", agent: "Marketing" });
    await integrationTools.connect_app?.(ctx, toolCall);
    expect(finish).toHaveBeenCalledWith({
      error: expect.stringContaining("Nothing"),
    });
  });

  it("asks for read access when the agent says reading is enough", async () => {
    vi.mocked(requestSpaceAppAccess).mockResolvedValue({ status: "pending", message: "ok" });
    const { call: toolCall } = call({ app: "Sentry", agent: "Marketing", level: "read" });
    await integrationTools.connect_app?.(ctx, toolCall);
    expect(requestSpaceAppAccess).toHaveBeenCalledWith(
      ctx.deps,
      ctx.run,
      "Sentry",
      "Marketing",
      "read",
    );
  });

  it("passes no teammate when none is named", async () => {
    vi.mocked(requestSpaceAppAccess).mockResolvedValue({ status: "pending", message: "ok" });
    const { call: toolCall } = call({ app: "Sentry" });
    await integrationTools.connect_app?.(ctx, toolCall);
    expect(requestSpaceAppAccess).toHaveBeenCalledWith(
      ctx.deps,
      ctx.run,
      "Sentry",
      undefined,
      "write",
    );
  });
});
