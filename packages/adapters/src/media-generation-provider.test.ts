import type { AdapterContext } from "@corvo/adapter-kit";
import { MediaGenerationError } from "@corvo/adapter-kit";
import { ATTACHMENT_MAX_BYTES } from "@corvo/contracts";
import { describe, expect, it, vi } from "vitest";
import { createMediaGenerationProvider } from "./media-generation-factory.js";
import {
  FakeMediaGenerationProvider,
  mediaPromptSchema,
  OpenRouterMediaGenerationProvider,
} from "./media-generation-provider.js";

const context: AdapterContext = {
  spaceId: "space",
  userId: "owner",
  operationId: "op",
  traceId: "trace",
  signal: new AbortController().signal,
};
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0u8AAAAASUVORK5CYII=",
  "base64",
);
const png = (extra: object = {}) =>
  new Response(
    JSON.stringify({
      data: [{ b64_json: PNG.toString("base64"), media_type: "image/png" }],
      usage: { cost: 0.0412 },
      ...extra,
    }),
  );
function setup(...responses: Response[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  return {
    fetch,
    provider: new OpenRouterMediaGenerationProvider({
      apiKey: "fake-key",
      imageModel: "google/gemini-2.5-flash-image",
      fetch,
    }),
  };
}

describe("media generation connection", () => {
  it("is off without an OpenRouter key, and takes the catalog default model with one", () => {
    expect(createMediaGenerationProvider({})).toBeUndefined();
    expect(
      createMediaGenerationProvider({
        MEDIA_GENERATION_IMAGE_MODEL: "google/gemini-2.5-flash-image",
      }),
    ).toBeUndefined();
    expect(createMediaGenerationProvider({ OPENROUTER_API_KEY: "key" })?.imageModel).toBe(
      "google/gemini-3.1-flash-lite-image",
    );
    expect(
      createMediaGenerationProvider({
        MEDIA_GENERATION_PROVIDER: "disabled",
        OPENROUTER_API_KEY: "key",
        MEDIA_GENERATION_IMAGE_MODEL: "a/b",
      }),
    ).toBeUndefined();
    const provider = createMediaGenerationProvider({
      OPENROUTER_API_KEY: "key",
      MEDIA_GENERATION_IMAGE_MODEL: "google/gemini-2.5-flash-image",
    });
    expect(provider?.id).toBe("openrouter");
    expect(provider?.capabilities).toEqual({
      images: true,
      video: false,
      offline: false,
      references: false,
      maxCount: 4,
    });
    expect(provider?.imageModel).toBe("google/gemini-2.5-flash-image");
  });

  it("keeps an offline provider for tests, and refuses an unknown one", async () => {
    const fake = createMediaGenerationProvider({ MEDIA_GENERATION_PROVIDER: "fake" })!;
    expect(fake.capabilities.offline).toBe(true);
    expect(
      (await new FakeMediaGenerationProvider().generateImage({ prompt: "x" }, context))[0]
        ?.mimeType,
    ).toBe("image/png");
    expect(() => createMediaGenerationProvider({ MEDIA_GENERATION_PROVIDER: "fal" })).toThrow(
      "Unknown media generation provider",
    );
  });

  it("rejects a model id that is not an OpenRouter slug", () => {
    for (const imageModel of ["flux", "a b/c", "https://x.test/a/b", "../a/b"])
      expect(() => new OpenRouterMediaGenerationProvider({ apiKey: "k", imageModel })).toThrow(
        "Invalid image model",
      );
  });
});

describe("OpenRouter image generation", () => {
  it("asks for one image with the chosen proportion and returns it with its cost", async () => {
    const { provider, fetch } = setup(png());
    const [output] = await provider.generateImage(
      { prompt: "a comb", aspectRatio: "4:5" },
      context,
    );
    expect(output).toMatchObject({ mimeType: "image/png", costUsd: 0.0412 });
    expect(Buffer.from(output!.bytes).equals(PNG)).toBe(true);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://openrouter.ai/api/v1/images");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer fake-key" });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "google/gemini-2.5-flash-image",
      prompt: "a comb",
      n: 1,
      aspect_ratio: "4:5",
    });
    expect(init?.redirect).toBe("error");
  });

  it("leaves the proportion out when none is asked for, and the cost out when none is reported", async () => {
    const { provider, fetch } = setup(
      new Response(JSON.stringify({ data: [{ b64_json: PNG.toString("base64") }] })),
    );
    const [output] = await provider.generateImage({ prompt: "x" }, context);
    expect(output?.costUsd).toBeUndefined();
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).not.toHaveProperty("aspect_ratio");
  });

  it("says a refusal came before anything was generated", async () => {
    for (const [status, code] of [
      [401, "authentication"],
      [403, "authentication"],
      [429, "rate_limit"],
      [402, "provider_failure"],
      [500, "provider_failure"],
    ] as const) {
      const { provider } = setup(new Response("nope", { status }));
      const error = await provider.generateImage({ prompt: "x" }, context).catch((e) => e);
      expect(error).toBeInstanceOf(MediaGenerationError);
      expect(error.code).toBe(code);
      expect(error.uncertain).toBe(false);
    }
  });

  it("says an answer that never arrived or cannot be read may still have been charged", async () => {
    const network = new OpenRouterMediaGenerationProvider({
      apiKey: "k",
      imageModel: "a/b",
      fetch: vi.fn().mockRejectedValue(new Error("socket hang up")),
    });
    const cases = [
      network.generateImage({ prompt: "x" }, context),
      setup(new Response("not json")).provider.generateImage({ prompt: "x" }, context),
      setup(new Response(JSON.stringify({ data: [] }))).provider.generateImage(
        { prompt: "x" },
        context,
      ),
      setup(
        new Response(
          JSON.stringify({ data: [{ b64_json: Buffer.from("GIF89a").toString("base64") }] }),
        ),
      ).provider.generateImage({ prompt: "x" }, context),
    ];
    for (const attempt of cases) {
      const error = await attempt.catch((e) => e);
      expect(error).toBeInstanceOf(MediaGenerationError);
      expect(error.code).toBe("provider_failure");
      expect(error.uncertain).toBe(true);
      expect(error.message).not.toContain("socket");
    }
  });

  it("takes the format the model gives, PNG, JPEG or WebP, and says which", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]);
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]);
    for (const [bytes, mimeType] of [
      [PNG, "image/png"],
      [jpeg, "image/jpeg"],
      [webp, "image/webp"],
    ] as const) {
      const { provider } = setup(
        new Response(JSON.stringify({ data: [{ b64_json: bytes.toString("base64") }] })),
      );
      const [output] = await provider.generateImage({ prompt: "x" }, context);
      expect(output?.mimeType).toBe(mimeType);
      expect(Buffer.from(output!.bytes).equals(bytes)).toBe(true);
    }
  });

  it("refuses an output over the attachment limit without decoding it", async () => {
    const big = Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(ATTACHMENT_MAX_BYTES, 1)]).toString(
      "base64",
    );
    const { provider } = setup(new Response(JSON.stringify({ data: [{ b64_json: big }] })));
    const error = await provider.generateImage({ prompt: "x" }, context).catch((e) => e);
    expect(error.code).toBe("output_limit");
  });

  it("does no video", async () => {
    const { provider, fetch } = setup();
    await expect(provider.generateVideo({ prompt: "x" }, context)).rejects.toMatchObject({
      code: "unsupported",
    });
    await expect(provider.pollVideo("id", context)).rejects.toMatchObject({ code: "unsupported" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an invalid prompt or proportion before any request", async () => {
    const { provider, fetch } = setup();
    await expect(provider.generateImage({ prompt: "  " }, context)).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(
      provider.generateImage({ prompt: "x", aspectRatio: "7:3" as never }, context),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves cancellation without making a request", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    const { provider, fetch } = setup();
    await expect(
      provider.generateImage({ prompt: "x" }, { ...context, signal: controller.signal }),
    ).rejects.toThrow("stop");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("mediaPromptSchema", () => {
  it("reads the tool's snake_case proportion", () => {
    expect(mediaPromptSchema.parse({ prompt: " hi ", aspect_ratio: "9:16" })).toEqual({
      prompt: "hi",
      aspectRatio: "9:16",
      count: 1,
      referenceArtifactIds: [],
    });
    expect(mediaPromptSchema.parse({ prompt: "hi" })).toEqual({
      prompt: "hi",
      count: 1,
      referenceArtifactIds: [],
    });
    expect(mediaPromptSchema.parse({ prompt: "hi", count: 99 }).count).toBe(4);
    expect(mediaPromptSchema.safeParse({ prompt: "hi", count: 0 }).success).toBe(false);
    expect(
      mediaPromptSchema.parse({ prompt: "hi", reference_artifact_ids: ["a", "a", "b"] })
        .referenceArtifactIds,
    ).toEqual(["a", "b"]);
    expect(
      mediaPromptSchema.parse({
        prompt: "hi",
        reference_artifact_ids: ["attachments/cm1x.png", "cm1x", "cm2y.jpg"],
      }).referenceArtifactIds,
    ).toEqual(["cm1x", "cm2y"]);
    expect(mediaPromptSchema.safeParse({ prompt: "hi", aspect_ratio: "2:9" }).success).toBe(false);
  });
});
