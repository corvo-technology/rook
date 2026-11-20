import type { PrismaClient } from "@corvo/db";
import { describe, expect, it, vi } from "vitest";

const credentials = vi.hoisted(() => ({
  byProvider: new Map<string, { id: string; secretId: string }>(),
  compatible: [] as { id: string; secretId: string }[],
}));
vi.mock("@corvo/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@corvo/db")>()),
  withModelScope: (_prisma: unknown, scope: object, fn: (s: object) => unknown) =>
    fn({ ...scope, delegated: false }),
  findModelCredential: async (_prisma: unknown, _scope: unknown, provider: string) =>
    credentials.byProvider.get(provider) ?? null,
}));

import { openRouterImageModelId, resolveRunImageProvider } from "./image-connection.js";
import { FakeMediaGenerationProvider } from "./media-generation-provider.js";

const asker = { userId: "user", spaceId: "space" };
const secrets: Record<string, object> = {};
const deps = {
  prisma: {
    secret: {
      findFirst: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        ciphertext: where.id,
      }),
    },
    userModelCredential: { findMany: async () => credentials.compatible },
  } as unknown as PrismaClient,
  secretStore: { load: async (ciphertext: string) => JSON.stringify(secrets[ciphertext]) },
};
const deployment = new FakeMediaGenerationProvider();
const resolve = (extra: Partial<Parameters<typeof resolveRunImageProvider>[0]> = {}) =>
  resolveRunImageProvider({
    deps,
    asker,
    deployment,
    creditsEnabled: true,
    operatorPays: false,
    ...extra,
  });

function reset() {
  credentials.byProvider.clear();
  credentials.compatible = [];
}

describe("which provider makes a run's pictures", () => {
  it("uses the account's OpenAI key with an OpenAI image model, on its own cost", async () => {
    reset();
    credentials.byProvider.set("openai", { id: "c1", secretId: "s1" });
    secrets.s1 = { kind: "api_key", key: "sk-test-openai" };
    const resolved = await resolve();
    expect(resolved?.own?.connectionProvider).toBe("openai");
    expect(resolved?.provider.id).toBe("openai-compatible");
    expect(resolved?.provider.imageModel).toBe("gpt-image-2");
    expect(resolved?.provider.capabilities.references).toBe(true);
  });

  it("sends the picture request to OpenAI with the account's key", async () => {
    reset();
    credentials.byProvider.set("openai", { id: "c1", secretId: "s1" });
    secrets.s1 = { kind: "api_key", key: "sk-test-openai" };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              b64_json:
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0u8AAAAASUVORK5CYII=",
            },
          ],
        }),
      ),
    );
    const { findImageConnection } = await import("./image-connection.js");
    const own = await findImageConnection(deps, asker, { fetch });
    await own?.provider.generateImage({ prompt: "x" }, {
      signal: new AbortController().signal,
    } as never);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://api.openai.com/v1/images/generations");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer sk-test-openai" });
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: "gpt-image-2" });
  });

  it("uses an OpenRouter connection with an OpenRouter image model id", async () => {
    reset();
    credentials.byProvider.set("openrouter", { id: "c2", secretId: "s2" });
    secrets.s2 = { kind: "api_key", key: "or-test" };
    const resolved = await resolve();
    expect(resolved?.own?.connectionProvider).toBe("openrouter");
    expect(resolved?.provider.id).toBe("openrouter");
    expect(resolved?.provider.imageModel).toBe("google/gemini-3.1-flash-lite-image");
  });

  it("uses an OpenAI-compatible connection that enabled a catalog image model", async () => {
    reset();
    credentials.compatible = [
      { id: "c3", secretId: "s3" },
      { id: "c4", secretId: "s4" },
    ];
    secrets.s3 = {
      kind: "openai_compatible",
      baseUrl: "https://chat-only.example.test/v1",
      enabledModelIds: ["llama-3"],
    };
    secrets.s4 = {
      kind: "openai_compatible",
      baseUrl: "https://images.example.test/v1",
      apiKey: "k",
      enabledModelIds: ["llama-3", "openai/gpt-image-1-mini"],
    };
    const resolved = await resolve();
    expect(resolved?.own?.connectionProvider).toBe("openai-compatible");
    expect(resolved?.provider.imageModel).toBe("openai/gpt-image-1-mini");
  });

  it("ignores a sign-in, which has no key to send", async () => {
    reset();
    credentials.byProvider.set("openai", { id: "c5", secretId: "s5" });
    secrets.s5 = { kind: "oauth", credential: { access: "a", refresh: "r", expires: 1 } };
    const resolved = await resolve();
    expect(resolved?.own).toBeUndefined();
    expect(resolved?.provider).toBe(deployment);
  });

  it("falls back to the deployment's provider when the account has no image connection", async () => {
    reset();
    expect((await resolve())?.provider).toBe(deployment);
    expect((await resolve())?.own).toBeUndefined();
  });

  it("offers the deployment's real provider only where someone pays for it", async () => {
    reset();
    const real = {
      ...deployment,
      capabilities: { ...deployment.capabilities, offline: false },
    } as unknown as typeof deployment;
    expect(await resolve({ deployment: real, creditsEnabled: false })).toBeUndefined();
    expect((await resolve({ deployment: real, creditsEnabled: true }))?.provider).toBe(real);
    expect((await resolve({ deployment: real, operatorPays: true }))?.provider).toBe(real);
  });

  it("falls back when the connection cannot be read", async () => {
    reset();
    credentials.byProvider.set("openai", { id: "c6", secretId: "s6" });
    const broken = {
      ...deps,
      secretStore: {
        load: async () => {
          throw new Error("unavailable");
        },
      },
    };
    const resolved = await resolve({ deps: broken });
    expect(resolved?.provider).toBe(deployment);
  });

  it("names OpenRouter models with their vendor prefix", () => {
    expect(openRouterImageModelId("gpt-image-2")).toBe("openai/gpt-image-2");
    expect(openRouterImageModelId("gemini-3.1-flash-image")).toBe("google/gemini-3.1-flash-image");
    expect(openRouterImageModelId("black-forest-labs/flux.2-pro")).toBe(
      "black-forest-labs/flux.2-pro",
    );
  });
});
