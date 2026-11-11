import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type FoundServer, LocalSetupCheck } from "@corvo/adapters";
import type { Actor, ModelCatalogEntry } from "@corvo/contracts";
import { DISABLED_LOCAL_SETUP } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { RPCHandler } from "@orpc/server/fetch";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";
import { buildLocalSetupReport } from "./routes/local-setup.js";

// The model catalog is built once per process, so the operator's local model is set before it.
vi.hoisted(() => {
  process.env.CORVO_LOCAL_MODELS = "fake-local";
});
const connectMock = vi.hoisted(() => vi.fn());
vi.mock("./model-credentials.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./model-credentials.js")>()),
  createModelConnector: () => ({
    verifyModelConnection: vi.fn(),
    connectModelCredential: connectMock,
  }),
}));

const owner: Actor = {
  userId: "user-one",
  spaceId: "space-one",
  email: "one@corvo.test",
  isDeploymentOwner: true,
};

const server = (port = 11434, models = ["fake-model", "other-model"]): FoundServer => ({
  port,
  label: port === 11434 ? "Ollama" : "LM Studio",
  baseUrl: `http://127.0.0.1:${port}/v1`,
  models,
});

type Connection = {
  id: string;
  provider: string;
  label: string;
  defaultModel?: string;
  secret?: string;
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "local-setup-api-"));
  connectMock.mockReset();
  connectMock.mockResolvedValue({ id: "saved-connection" });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function check(options: {
  cached?: FoundServer[];
  probe?: (signal: AbortSignal) => Promise<FoundServer[]>;
}) {
  const file = path.join(dir, "local-setup.json");
  if (options.cached) {
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        checkedAt: 11,
        servers: options.cached.map(({ port, models }) => ({ port, models })),
      }),
    );
  }
  const probe = vi.fn(options.probe ?? (async () => []));
  return { check: new LocalSetupCheck({ file, probe }), probe };
}

function setup(
  options: {
    localSetup?: LocalSetupCheck;
    connections?: Connection[];
    roles?: Array<Record<string, unknown>>;
    testLocalModel?: RouterDeps["testLocalModel"];
  } = {},
) {
  const connections = options.connections ?? [];
  const roleRows: Array<Record<string, unknown>> = [...(options.roles ?? [])];
  const roleTable = (copy: "account" | "space") => {
    const owns = (row: Record<string, unknown>, where: Record<string, string>) =>
      (copy === "space") === (row.spaceId !== undefined) &&
      Object.entries(where).every(([key, value]) => row[key] === value);
    return {
      findMany: vi.fn(async ({ where }: { where: Record<string, string> }) =>
        roleRows
          .filter((row) => owns(row, where))
          .sort((left, right) => Number(left.position) - Number(right.position)),
      ),
      deleteMany: vi.fn(async ({ where }: { where: Record<string, string> }) => {
        for (let index = roleRows.length - 1; index >= 0; index--) {
          if (owns(roleRows[index] as Record<string, unknown>, where)) roleRows.splice(index, 1);
        }
        return { count: 0 };
      }),
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        roleRows.push(...data);
        return { count: data.length };
      }),
    };
  };
  const userModelRoleChoice = roleTable("account");
  const spaceModelRoleChoice = roleTable("space");
  const spaceSettingOverride = {
    findUnique: vi.fn(async () => null),
    findMany: vi.fn(async () => []),
  };
  const tx = {
    userModelRoleChoice,
    spaceModelRoleChoice,
    spaceSettingOverride,
    $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
  };
  const rows = connections.map((connection) => ({
    id: connection.id,
    userId: owner.userId,
    provider: connection.provider,
    label: connection.label,
    secretId: `secret-${connection.id}`,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    userPreferences: connection.defaultModel
      ? [
          {
            modelId: connection.defaultModel,
            thinkingLevel: null,
            credentialId: connection.id,
            updatedAt: new Date(0),
          },
        ]
      : [],
  }));
  const prisma = {
    deploymentSettings: { findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => null) },
    user: {
      findUniqueOrThrow: vi.fn(async () => ({
        email: owner.email,
        name: "One",
        timezone: null,
        signupSurvey: null,
      })),
    },
    partnerTenant: { findFirst: vi.fn(async () => null) },
    missionState: { findUnique: vi.fn(async () => null) },
    bot: { findMany: vi.fn(async () => []) },
    routine: { findMany: vi.fn(async () => []) },
    space: { findFirst: vi.fn(async () => ({ organization: { modelCredits: { mode: "off" } } })) },
    userModelRoleChoice,
    spaceModelRoleChoice,
    spaceSettingOverride,
    userModelCredential: {
      findMany: vi.fn(async ({ where }: { where: { userId: string; provider?: string } }) =>
        rows.filter(
          (row) =>
            row.userId === where.userId && (!where.provider || where.provider === row.provider),
        ),
      ),
      findFirst: vi.fn(
        async ({ where }: { where: { id?: string; userId: string } }) =>
          rows.find((row) => row.userId === where.userId && (!where.id || row.id === where.id)) ??
          null,
      ),
    },
    userModelPreference: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    secret: {
      findMany: vi.fn(async () =>
        connections.map((connection) => ({
          id: `secret-${connection.id}`,
          ciphertext: connection.secret ?? "fake-api-key-for-offline-tests",
        })),
      ),
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
        const connection = connections.find((candidate) => `secret-${candidate.id}` === where.id);
        return connection
          ? { id: where.id, ciphertext: connection.secret ?? "fake-api-key-for-offline-tests" }
          : null;
      }),
    },
    $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
  } as unknown as PrismaClient;
  Object.assign(tx, { userModelCredential: prisma.userModelCredential });
  const deps = {
    prisma,
    localSetup: options.localSetup,
    testLocalModel: options.testLocalModel,
    secrets: { load: vi.fn((ciphertext: string) => ciphertext) },
    env: {
      agentRuntime: "pi",
      defaultProvider: "openrouter",
      defaultModel: "unused-test-model",
      webOrigin: "http://127.0.0.1:5173",
      screenProxySecret: "fixture-secret",
      sandboxProvider: "fake",
      mcpAllowPrivateEndpoint: Boolean(options.localSetup),
    },
    dataDir: dir,
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
  return { call, roleRows, prisma };
}

const catalogEntry = (provider: string, id: string): ModelCatalogEntry =>
  ({ provider, providerName: provider, id, label: id, billing: "", auth: "api-key" }) as never;

describe("models.localSetup", () => {
  it("hosted: reports disabled and never probes", async () => {
    const { check: unused, probe } = await check({});
    const { call } = setup({});
    expect(await call("models/localSetup", { wait: true })).toEqual({
      status: 200,
      json: DISABLED_LOCAL_SETUP,
    });
    expect(unused).toBeDefined();
    expect(probe).not.toHaveBeenCalled();
  });

  it("answers from the cache at once and checks behind", async () => {
    const { check: setupCheck, probe } = await check({
      cached: [server()],
      probe: () => new Promise(() => undefined),
    });
    const { call } = setup({ localSetup: setupCheck });
    const { json } = await call("models/localSetup", { wait: false });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(json.checking).toBe(true);
    expect(json.options.map((option: { id: string }) => option.id)).toEqual([
      "server:11434",
      "local",
    ]);
  });

  it("wait returns the fresh result and drops a server that stopped", async () => {
    const { check: setupCheck } = await check({ cached: [server()], probe: async () => [] });
    const { call } = setup({ localSetup: setupCheck });
    const { json } = await call("models/localSetup", { wait: true });
    expect(json.checking).toBe(false);
    expect(json.options.some((option: { id: string }) => option.id === "server:11434")).toBe(false);
  });

  it("orders options: connection, server, local", async () => {
    const { check: setupCheck } = await check({
      probe: async () => [server(1234), server(11434)],
    });
    const { call } = setup({
      localSetup: setupCheck,
      connections: [
        { id: "cred-one", provider: "openrouter", label: "My key", defaultModel: "x/unknown" },
      ],
    });
    const { json } = await call("models/localSetup", { wait: true });
    expect(
      json.options.map((option: { id: string; backgroundModelId: unknown }) => option.id),
    ).toEqual(["connection:cred-one", "server:11434", "server:1234", "local"]);
    const byId = Object.fromEntries(
      json.options.map((option: { id: string }) => [option.id, option]),
    );
    expect(byId["server:11434"].backgroundModelId).toBeNull();
    expect(byId.local.label).toBe("Local models");
    expect(byId.local.modelId).toBe("fake-local");
  });
});

describe("buildLocalSetupReport", () => {
  const base = { findings: null, checking: false, operatorModels: [] as string[] };

  it("sets backgroundModelId from catalog prices for a connection, null for a server", () => {
    const report = buildLocalSetupReport({
      ...base,
      findings: { version: 1, checkedAt: 1, servers: [server()] },
      connections: [
        { id: "c1", provider: "acme", label: "Acme", defaultModel: "big", kind: "api_key" },
      ],
      catalog: [catalogEntry("acme", "big"), catalogEntry("acme", "small")],
      costs: (_provider, id) =>
        id === "big"
          ? { input: 3, output: 15 }
          : id === "small"
            ? { input: 1, output: 2 }
            : undefined,
    });
    expect(report.options[0]).toMatchObject({
      id: "connection:c1",
      modelId: "big",
      backgroundModelId: "small",
    });
    expect(report.options[1]).toMatchObject({ id: "server:11434", backgroundModelId: null });
  });

  it("marks oauth connections not testable", () => {
    const report = buildLocalSetupReport({
      ...base,
      connections: [
        { id: "c1", provider: "acme", label: "Acme", defaultModel: null, kind: "oauth" },
        { id: "c2", provider: "acme", label: "Acme two", defaultModel: null, kind: "api_key" },
      ],
      catalog: [catalogEntry("acme", "big")],
    });
    expect(report.options.map((option) => [option.id, option.testable])).toEqual([
      ["connection:c1", false],
      ["connection:c2", true],
    ]);
  });
});

describe("models.testLocal", () => {
  it("rejects an unknown option id with NOT_FOUND and a model outside the list with BAD_REQUEST", async () => {
    const { check: setupCheck } = await check({ cached: [server()] });
    const testLocalModel = vi.fn();
    const fetchImpl = vi.fn();
    const { call } = setup({ localSetup: setupCheck, testLocalModel });
    expect(
      (await call("models/testLocal", { optionId: "server:9", modelId: "fake-model" })).status,
    ).toBe(404);
    expect(
      (await call("models/testLocal", { optionId: "server:11434", modelId: "not-listed" })).status,
    ).toBe(400);
    expect(testLocalModel).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("on a server uses only its detected base URL and waits up to 60 s", async () => {
    const { check: setupCheck } = await check({ cached: [server()] });
    const testLocalModel = vi.fn(async () => ({ ok: true as const, ms: 12 }));
    const { call } = setup({ localSetup: setupCheck, testLocalModel });
    const { json } = await call("models/testLocal", {
      optionId: "server:11434",
      modelId: "fake-model",
    });
    expect(json).toEqual({ ok: true, ms: 12 });
    const [config, options] = testLocalModel.mock.calls[0] as unknown as [
      { baseUrl: string; id: string },
      { timeoutMs: number },
    ];
    expect(config.baseUrl.startsWith("http://127.0.0.1:11434/v1")).toBe(true);
    expect(config.id).toBe("fake-model");
    expect(options.timeoutMs).toBe(60_000);
  });

  it("refuses to test a sign-in connection", async () => {
    const { check: setupCheck } = await check({});
    const testLocalModel = vi.fn();
    const { call } = setup({
      localSetup: setupCheck,
      testLocalModel,
      connections: [
        {
          id: "cred-oauth",
          provider: "openrouter",
          label: "Signed in",
          secret: JSON.stringify({ kind: "oauth", provider: "openrouter", credential: {} }),
        },
      ],
    });
    const { status } = await call("models/testLocal", {
      optionId: "connection:cred-oauth",
      modelId: "x",
    });
    expect([400, 404]).toContain(status);
    expect(testLocalModel).not.toHaveBeenCalled();
  });
});

describe("models.useLocal", () => {
  it("needsModel is false after choosing an operator-local model", async () => {
    const { check: setupCheck } = await check({});
    const { call } = setup({ localSetup: setupCheck });
    expect((await call("me")).json.needsModel).toBe(true);
    const used = await call("models/useLocal", { optionId: "local", modelId: "fake-local" });
    expect(used).toEqual({ status: 200, json: { ok: true } });
    expect((await call("me")).json.needsModel).toBe(false);
  });

  it("saves a server as an openai-compatible connection with the detected URL", async () => {
    const { check: setupCheck } = await check({
      cached: [server()],
      probe: async () => [server()],
    });
    const { call } = setup({ localSetup: setupCheck });
    const { status } = await call("models/useLocal", {
      optionId: "server:11434",
      modelId: "fake-model",
    });
    expect(status).toBe(200);
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(connectMock.mock.calls[0]?.[1]).toMatchObject({
      provider: "openai-compatible",
      baseUrl: "http://127.0.0.1:11434/v1",
      modelId: "fake-model",
      label: "Ollama",
      credentialId: null,
      makeDefault: true,
      enabledModelIds: ["fake-model", "other-model"],
    });
  });

  it("fills fast and approval only when empty, and leaves routing untouched", async () => {
    const opus = "claude-opus-4-5";
    const haiku = "claude-haiku-4-5";
    const { check: setupCheck } = await check({});
    const { call, roleRows } = setup({
      localSetup: setupCheck,
      connections: [
        { id: "cred-a", provider: "anthropic", label: "Anthropic", defaultModel: opus },
      ],
      roles: [
        {
          userId: owner.userId,
          role: "fast",
          position: 0,
          provider: "anthropic",
          modelId: "claude-sonnet-4-5",
          thinkingLevel: null,
        },
      ],
    });
    const report = await call("models/localSetup", { wait: true });
    const option = report.json.options.find((o: { id: string }) => o.id === "connection:cred-a");
    expect(option.modelId).toBe(opus);
    expect(option.backgroundModelId).toBeTruthy();
    expect(option.backgroundModelId).not.toBe(opus);
    const used = await call("models/useLocal", { optionId: "connection:cred-a", modelId: opus });
    expect(used.status).toBe(200);
    const primary = (role: string) =>
      roleRows.find((row) => row.role === role && row.position === 0)?.modelId;
    expect(primary("main")).toBe(opus);
    expect(primary("fast")).toBe("claude-sonnet-4-5");
    expect(primary("approval")).toBe(option.backgroundModelId);
    expect(roleRows.some((row) => row.role === "routing")).toBe(false);
    expect(haiku).toBeTruthy();
  });

  it("on a stale server id is NOT_FOUND after the fresh check", async () => {
    const { check: setupCheck } = await check({ cached: [server()], probe: async () => [] });
    const { call } = setup({ localSetup: setupCheck });
    const { status } = await call("models/useLocal", {
      optionId: "server:11434",
      modelId: "fake-model",
    });
    expect(status).toBe(404);
    expect(connectMock).not.toHaveBeenCalled();
  });

  it("is NOT_FOUND where detection is off", async () => {
    const { call } = setup({});
    expect((await call("models/useLocal", { optionId: "local", modelId: "x" })).status).toBe(404);
  });
});
