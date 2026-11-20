import type { AdapterContext, ArtifactStore } from "@corvo/adapter-kit";
import { IMAGE_MAX_COUNT } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { describe, expect, it, vi } from "vitest";
import { createMediaGenerationProvider } from "./media-generation-factory.js";
import {
  FakeMediaGenerationProvider,
  OpenAiCompatibleMediaGenerationProvider,
  OpenRouterMediaGenerationProvider,
} from "./media-generation-provider.js";
import { generateMediaFromTool } from "./media-generation-tools.js";
import { loadMediaReferences, withGeneratedImages } from "./media-references.js";

const run = { id: "run", threadId: "thread", botId: "bot", spaceId: "space", userId: "owner" };
const context: AdapterContext = {
  ...run,
  operationId: "op",
  traceId: "trace",
  signal: new AbortController().signal,
};
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0u8AAAAASUVORK5CYII=",
  "base64",
);
const answer = (n: number, extra: object = {}) =>
  new Response(
    JSON.stringify({
      data: Array.from({ length: n }, () => ({ b64_json: PNG.toString("base64") })),
      ...extra,
    }),
  );

describe("OpenRouter provider with several pictures", () => {
  it("asks for n pictures and splits the reported cost across them", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(answer(3, { usage: { cost: 0.12 } }));
    const provider = new OpenRouterMediaGenerationProvider({
      apiKey: "k",
      imageModel: "google/gemini-2.5-flash-image",
      fetch,
    });
    const images = await provider.generateImage({ prompt: "x", count: 3 }, context);
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toMatchObject({ n: 3 });
    expect(images).toHaveLength(3);
    expect(images.reduce((total, image) => total + (image.costUsd ?? 0), 0)).toBeCloseTo(0.12);
  });

  it("takes no reference pictures", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const provider = new OpenRouterMediaGenerationProvider({
      apiKey: "k",
      imageModel: "a/b",
      fetch,
    });
    expect(provider.capabilities.references).toBe(false);
    await expect(
      provider.generateImage(
        { prompt: "x", references: [{ bytes: PNG, mimeType: "image/png" }] },
        context,
      ),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("OpenAI-compatible image provider", () => {
  function server(response: () => Response = () => answer(1)) {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => response());
    const provider = new OpenAiCompatibleMediaGenerationProvider({
      baseUrl: "https://images.example.test/v1/",
      apiKey: "fake-key",
      imageModel: "gpt-image-1",
      fetch,
    });
    return { fetch, provider };
  }

  it("generates from a prompt through /images/generations", async () => {
    const { fetch, provider } = server(() => answer(2));
    const images = await provider.generateImage(
      { prompt: "a comb", aspectRatio: "3:2", count: 2 },
      context,
    );
    expect(images).toHaveLength(2);
    expect(images[0]).toMatchObject({ mimeType: "image/png" });
    expect(images[0]?.costUsd).toBeUndefined();
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://images.example.test/v1/images/generations");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer fake-key" });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "gpt-image-1",
      prompt: "a comb",
      n: 2,
      size: "1536x1024",
    });
    expect(init?.redirect).toBe("error");
  });

  it("edits from references through /images/edits as a multipart upload", async () => {
    const { fetch, provider } = server();
    expect(provider.capabilities.references).toBe(true);
    await provider.generateImage(
      {
        prompt: "make it blue",
        references: [
          { bytes: PNG, mimeType: "image/png" },
          { bytes: PNG, mimeType: "image/png" },
        ],
      },
      context,
    );
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://images.example.test/v1/images/edits");
    const form = init?.body as FormData;
    expect(form.get("prompt")).toBe("make it blue");
    expect(form.get("model")).toBe("gpt-image-1");
    expect(form.getAll("image[]")).toHaveLength(2);
  });

  it("asks older models for base64 and refuses what the model cannot do", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => answer(1));
    const classic = new OpenAiCompatibleMediaGenerationProvider({
      baseUrl: "https://images.example.test/v1",
      imageModel: "dall-e-3",
      fetch,
    });
    await classic.generateImage({ prompt: "x", aspectRatio: "16:9", count: 4 }, context);
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toMatchObject({
      response_format: "b64_json",
      n: 1,
      size: "1792x1024",
    });
    expect(classic.capabilities).toMatchObject({ references: false, maxCount: 1 });
    await expect(
      classic.generateImage(
        { prompt: "x", references: [{ bytes: PNG, mimeType: "image/png" }] },
        context,
      ),
    ).rejects.toMatchObject({ code: "unsupported" });
    await expect(
      classic.generateImage({ prompt: "x", aspectRatio: "21:9" }, context),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("separates refusals from answers that may have been charged for", async () => {
    const refused = await server(() => new Response("no", { status: 429 }))
      .provider.generateImage({ prompt: "x" }, context)
      .catch((error) => error);
    expect(refused).toMatchObject({ code: "rate_limit", uncertain: false });
    const unreadable = await server(() => new Response("not json"))
      .provider.generateImage({ prompt: "x" }, context)
      .catch((error) => error);
    expect(unreadable).toMatchObject({ code: "provider_failure", uncertain: true });
  });

  it("refuses unsafe endpoints", () => {
    for (const baseUrl of ["http://169.254.169.254/v1", "ftp://x.test/v1"])
      expect(
        () => new OpenAiCompatibleMediaGenerationProvider({ baseUrl, imageModel: "gpt-image-1" }),
      ).toThrow();
    expect(
      () =>
        new OpenAiCompatibleMediaGenerationProvider({
          baseUrl: "http://images.example.test/v1",
          apiKey: "fake-key",
          imageModel: "gpt-image-1",
        }),
    ).toThrow("HTTPS");
  });

  it("is chosen by name and uses the shared endpoint", () => {
    const provider = createMediaGenerationProvider({
      MEDIA_GENERATION_PROVIDER: "openai-compatible",
      MEDIA_GENERATION_IMAGE_MODEL: "gpt-image-1",
      CORVO_LOCAL_MODELS_URL: "http://127.0.0.1:11434/v1",
    });
    expect(provider?.id).toBe("openai-compatible");
    expect(
      createMediaGenerationProvider({
        MEDIA_GENERATION_PROVIDER: "openai-compatible",
        MEDIA_GENERATION_IMAGE_MODEL: "gpt-image-1",
      }),
    ).toBeUndefined();
  });
});

function toolSetup(provider = new FakeMediaGenerationProvider()) {
  const externalEffect = {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({
      id: "job",
      status: "media_submitting",
      result: { provider: provider.id },
    }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  let n = 0;
  const attach = vi.fn().mockImplementation(async () => {
    n += 1;
    return {
      artifactId: `art-${n}`,
      block: { kind: "image", artifactId: `art-${n}`, name: `g${n}.png` },
    };
  });
  const publish = vi.fn();
  const loadReferences = vi.fn();
  const credits = {
    hold: vi.fn().mockResolvedValue({
      settle: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
    }),
  };
  return {
    provider,
    attach,
    publish,
    loadReferences,
    credits,
    options: {
      name: "generate_image" as const,
      args: { prompt: "draw" } as Record<string, unknown>,
      executionId: "execution",
      provider,
      credits,
      loadReferences,
      prisma: {
        externalEffect,
        artifact: { findMany: vi.fn().mockResolvedValue([]) },
      } as unknown as PrismaClient,
      context,
      run,
      attach,
      publish,
    },
  };
}

describe("image tool: several pictures and references", () => {
  it("makes the pictures asked for and posts them together as one message", async () => {
    const { options, attach, publish } = toolSetup();
    const result = await generateMediaFromTool({ ...options, args: { prompt: "draw", count: 3 } });
    expect(result).toEqual({
      status: "completed",
      artifactId: "art-1",
      artifactIds: ["art-1", "art-2", "art-3"],
    });
    expect(attach).toHaveBeenCalledTimes(3);
    expect(attach.mock.calls[1]![1]).toBe("generated-job-2.png");
    // Each picture is checkpointed on top of the ones already attached.
    expect(attach.mock.calls[2]![2].result.artifactIds).toEqual(["art-1", "art-2"]);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]![0]).toHaveLength(3);
  });

  it("caps the count at the limit and at what the model makes", async () => {
    const { options, provider, credits } = toolSetup();
    await generateMediaFromTool({ ...options, args: { prompt: "draw", count: 40 } });
    expect(provider.lastInput?.count).toBe(IMAGE_MAX_COUNT);
    expect(credits.hold).toHaveBeenCalledWith(expect.objectContaining({ count: IMAGE_MAX_COUNT }));
    const narrow = toolSetup();
    Object.assign(narrow.provider.capabilities, { maxCount: 2 });
    await generateMediaFromTool({ ...narrow.options, args: { prompt: "draw", count: 4 } });
    expect(narrow.provider.lastInput?.count).toBe(2);
    expect(narrow.credits.hold).toHaveBeenCalledWith(expect.objectContaining({ count: 2 }));
  });

  it("hands the visible references to the provider", async () => {
    const { options, provider, loadReferences } = toolSetup();
    loadReferences.mockResolvedValue([{ bytes: PNG, mimeType: "image/png" }]);
    await generateMediaFromTool({
      ...options,
      args: { prompt: "vary", reference_artifact_ids: ["a1", "a1"] },
    });
    expect(loadReferences).toHaveBeenCalledWith(["a1"]);
    expect(provider.lastInput?.references).toHaveLength(1);
  });

  it("refuses a reference that is not visible before reserving or billing", async () => {
    const { options, provider, credits, loadReferences } = toolSetup();
    loadReferences.mockResolvedValue(undefined);
    const result = await generateMediaFromTool({
      ...options,
      args: { prompt: "vary", reference_artifact_ids: ["secret"] },
    });
    expect(result).toHaveProperty("error");
    expect(provider.lastInput).toBeUndefined();
    expect(credits.hold).not.toHaveBeenCalled();
    expect(options.prisma.externalEffect.create).not.toHaveBeenCalled();
  });

  it("refuses references for a model that cannot take them, without reading them", async () => {
    const { options, provider, credits, loadReferences } = toolSetup();
    Object.assign(provider.capabilities, { references: false });
    const result = await generateMediaFromTool({
      ...options,
      args: { prompt: "vary", reference_artifact_ids: ["a1"] },
    });
    expect(result).toEqual({ error: expect.stringContaining("cannot work from reference") });
    expect(loadReferences).not.toHaveBeenCalled();
    expect(credits.hold).not.toHaveBeenCalled();
  });

  it("holds the worst case for the pictures and settles at the reported cost", async () => {
    const { options, provider, credits } = toolSetup();
    vi.spyOn(provider, "generateImage").mockResolvedValue([
      { bytes: PNG, mimeType: "image/png", costUsd: 0.03 },
      { bytes: PNG, mimeType: "image/png", costUsd: 0.04 },
    ]);
    await generateMediaFromTool({ ...options, args: { prompt: "draw", count: 2 } });
    expect(credits.hold).toHaveBeenCalledWith({
      jobId: "job",
      provider: "fake",
      model: undefined,
      count: 2,
    });
    const hold = await credits.hold.mock.results[0]!.value;
    expect(hold.settle).toHaveBeenCalledWith(0.07, 2);
  });
});

describe("image tool on the account's own key", () => {
  it("holds no credit and records the call as usage at the reported cost", async () => {
    const { options, provider } = toolSetup();
    vi.spyOn(provider, "generateImage").mockResolvedValue([
      { bytes: PNG, mimeType: "image/png", costUsd: 0.03 },
    ]);
    const recordUsage = vi.fn().mockResolvedValue(undefined);
    const result = await generateMediaFromTool({
      ...options,
      credits: undefined,
      recordUsage,
      args: { prompt: "draw" },
    });
    expect(result).toMatchObject({ status: "completed" });
    expect(options.credits.hold).not.toHaveBeenCalled();
    expect(recordUsage).toHaveBeenCalledWith({
      jobId: "job",
      model: undefined,
      count: 1,
      costUsd: 0.03,
    });
  });

  it("still returns the pictures when the usage record fails", async () => {
    const { options } = toolSetup();
    const result = await generateMediaFromTool({
      ...options,
      credits: undefined,
      recordUsage: vi.fn().mockRejectedValue(new Error("db down")),
    });
    expect(result).toMatchObject({ status: "completed" });
  });
});

describe("loading references", () => {
  const store = (bytes = PNG) =>
    ({ get: vi.fn().mockResolvedValue(bytes) }) as unknown as ArtifactStore;
  const row = (id: string) => ({ id, storageKey: `key-${id}`, mimeType: "image/png" });
  function prisma(rows: ReturnType<typeof row>[]) {
    const findMany = vi.fn().mockResolvedValue(rows);
    return { findMany, client: { artifact: { findMany } } as unknown as PrismaClient };
  }

  it("scopes a channel's references to the channel", async () => {
    const { findMany, client } = prisma([row("a1")]);
    const found = await loadMediaReferences(
      { prisma: client, artifacts: store() },
      { spaceId: "space", userId: "owner", botId: "bot", groupId: "group" },
      ["a1"],
      context,
    );
    expect(found).toHaveLength(1);
    expect(findMany.mock.calls[0]![0].where).toMatchObject({ spaceId: "space", groupId: "group" });
    expect(findMany.mock.calls[0]![0].where).not.toHaveProperty("userId");
  });

  it("scopes a private chat's references to this agent and person", async () => {
    const { findMany, client } = prisma([row("a1")]);
    await loadMediaReferences(
      { prisma: client, artifacts: store() },
      { spaceId: "space", userId: "owner", botId: "bot", groupId: null },
      ["a1"],
      context,
    );
    expect(findMany.mock.calls[0]![0].where).toMatchObject({
      spaceId: "space",
      groupId: null,
      botId: "bot",
      userId: "owner",
    });
  });

  it("is unavailable as a whole when any one reference is not visible or not a picture", async () => {
    const { client } = prisma([row("a1")]);
    const artifacts = store();
    expect(
      await loadMediaReferences(
        { prisma: client, artifacts },
        { spaceId: "space", userId: "owner", botId: "bot", groupId: null },
        ["a1", "hidden"],
        context,
      ),
    ).toBeUndefined();
  });
});

describe("giving finished images back to the model", () => {
  const rows = [
    { id: "a1", storageKey: "k1", mimeType: "image/png", size: PNG.byteLength },
    { id: "a2", storageKey: "k2", mimeType: "video/mp4", size: 10 },
  ];
  const deps = () => ({
    prisma: { artifact: { findMany: vi.fn().mockResolvedValue(rows) } } as unknown as PrismaClient,
    artifacts: { get: vi.fn().mockResolvedValue(PNG) } as unknown as ArtifactStore,
  });

  it("returns the result with the pictures beside it and the plain result as details", async () => {
    const result = { status: "completed", artifactIds: ["a1", "a2"] };
    const out = await withGeneratedImages(deps(), run, result, context);
    expect(out).toMatchObject({ kind: "agent_tool_result", details: result });
    const content = (out as { content: Array<{ type: string }> }).content;
    expect(content.map((part) => part.type)).toEqual(["text", "image"]);
  });

  it("leaves a result without pictures, or an error, as it was", async () => {
    expect(await withGeneratedImages(deps(), run, { error: "no" }, context)).toEqual({
      error: "no",
    });
    expect(await withGeneratedImages(deps(), run, undefined, context)).toBeUndefined();
  });
});

describe("video is offered only by a provider that can make it", () => {
  it("never claims video for the real providers", () => {
    expect(
      new OpenAiCompatibleMediaGenerationProvider({
        baseUrl: "https://images.example.test/v1",
        imageModel: "gpt-image-1",
      }).capabilities.video,
    ).toBe(false);
    expect(
      new OpenRouterMediaGenerationProvider({ apiKey: "k", imageModel: "a/b" }).capabilities.video,
    ).toBe(false);
  });
});
