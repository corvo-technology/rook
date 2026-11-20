import type {
  AdapterContext,
  GeneratedMedia,
  MediaGenerationInput,
  MediaGenerationProvider,
  MediaVideoJob,
} from "@corvo/adapter-kit";
import { MEDIA_ASPECT_RATIOS, MediaGenerationError } from "@corvo/adapter-kit";
import {
  ATTACHMENT_MAX_BYTES,
  IMAGE_MAX_COUNT,
  IMAGE_MAX_REFERENCES,
  imageModelEntry,
} from "@corvo/contracts";
import { z } from "zod";
import { FAKE_VIDEO_BASE64 } from "./fake-media-assets.js";
import {
  assertAllowedOpenAiCompatibleUrl,
  assertHttpsForKeyedOpenAiCompatibleUrl,
  normalizeOpenAiCompatibleBaseUrl,
} from "./openai-compatible-url.js";

/**
 * What the image tool accepts: a prompt, optionally the proportion, how many pictures, and the
 * artifacts to start from. Counts above the cap are brought down to it, not refused.
 */
export const mediaPromptSchema = z
  .object({
    prompt: z.string().trim().min(1).max(4000),
    aspect_ratio: z.enum(MEDIA_ASPECT_RATIOS).optional(),
    count: z.number().int().min(1).optional(),
    reference_artifact_ids: z
      .array(z.string().trim().min(1).max(200))
      .max(IMAGE_MAX_REFERENCES)
      .optional(),
  })
  .transform(({ prompt, aspect_ratio, count, reference_artifact_ids }) => ({
    prompt,
    ...(aspect_ratio ? { aspectRatio: aspect_ratio } : {}),
    count: Math.min(count ?? 1, IMAGE_MAX_COUNT),
    referenceArtifactIds: [...new Set((reference_artifact_ids ?? []).map(artifactIdOf))],
  }));

/** An attachment is listed to the agent as `attachments/<id>.png`; either form names it. */
function artifactIdOf(reference: string): string {
  return (reference.split("/").pop() ?? reference).replace(/\.[a-z0-9]{1,5}$/i, "");
}
export function validateGeneratedMedia(
  output: GeneratedMedia,
  mimeType: GeneratedMedia["mimeType"] | readonly GeneratedMedia["mimeType"][],
) {
  const allowed: readonly string[] = Array.isArray(mimeType) ? mimeType : [mimeType];
  if (!allowed.includes(output.mimeType) || !output.bytes.byteLength) {
    throw new MediaGenerationError("provider_failure");
  }
  if (output.bytes.byteLength > ATTACHMENT_MAX_BYTES) {
    throw new MediaGenerationError("output_limit");
  }
}

async function boundedBytes(response: Response, limit: number): Promise<Uint8Array> {
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new MediaGenerationError("output_limit");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new MediaGenerationError("provider_failure");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) throw new MediaGenerationError("output_limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}

const OPENROUTER_IMAGES_URL = "https://openrouter.ai/api/v1/images";
const imageResponse = z.object({
  data: z.array(z.object({ b64_json: z.string().min(1) })).min(1),
  usage: z.object({ cost: z.number().finite().nonnegative().optional() }).optional(),
});

/** The picture formats an attachment can hold, told apart by their first bytes. */
function imageFormat(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | undefined {
  const head = Buffer.from(bytes.subarray(0, 12));
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "image/png";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.toString("latin1", 0, 4) === "RIFF" && head.toString("latin1", 8, 12) === "WEBP")
    return "image/webp";
  return undefined;
}

function checkedInput(input: MediaGenerationInput, maxCount: number, references: boolean) {
  const parsed = mediaPromptSchema.safeParse({
    prompt: input.prompt,
    aspect_ratio: input.aspectRatio,
    count: input.count,
  });
  if (!parsed.success) throw new MediaGenerationError("invalid_input");
  if (input.references?.length) {
    if (!references) throw new MediaGenerationError("unsupported");
    if (input.references.length > IMAGE_MAX_REFERENCES)
      throw new MediaGenerationError("invalid_input");
  }
  return { ...parsed.data, count: Math.min(parsed.data.count, maxCount) };
}

/**
 * Sends one billed image request and reads the pictures back. A failure before an answer may
 * still have been charged for, so it is marked uncertain; a refusal status is not.
 */
async function requestImages(
  send: () => Promise<Response>,
  count: number,
  context: AdapterContext,
): Promise<{ images: GeneratedMedia[]; costUsd?: number }> {
  let response: Response;
  try {
    response = await send();
  } catch {
    context.signal.throwIfAborted();
    // The request may have reached the provider before the connection failed.
    throw new MediaGenerationError("provider_failure", { uncertain: true });
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new MediaGenerationError(
      response.status === 429
        ? "rate_limit"
        : [401, 403].includes(response.status)
          ? "authentication"
          : "provider_failure",
    );
  }
  // Base64 is a third larger than the bytes it carries.
  const limit = (Math.ceil((ATTACHMENT_MAX_BYTES * 4) / 3) + 64_000) * count;
  let body: z.infer<typeof imageResponse>;
  try {
    const text = new TextDecoder().decode(await boundedBytes(response, limit));
    const result = imageResponse.safeParse(JSON.parse(text));
    if (!result.success) throw new Error("unreadable");
    body = result.data;
  } catch (error) {
    context.signal.throwIfAborted();
    if (error instanceof MediaGenerationError) throw error;
    throw new MediaGenerationError("provider_failure", { uncertain: true });
  }
  const images: GeneratedMedia[] = [];
  for (const item of body.data.slice(0, count)) {
    const bytes = Buffer.from(item.b64_json, "base64");
    const mimeType = imageFormat(bytes);
    // An answer that is not a picture was still charged for.
    if (!mimeType) throw new MediaGenerationError("provider_failure", { uncertain: true });
    const output: GeneratedMedia = { bytes, mimeType };
    validateGeneratedMedia(output, mimeType);
    images.push(output);
  }
  const cost = body.usage?.cost;
  // One total for the call; each picture carries its share so the shares add up to it.
  if (cost !== undefined) for (const image of images) image.costUsd = cost / images.length;
  return { images, ...(cost !== undefined ? { costUsd: cost } : {}) };
}

/**
 * OpenRouter's image API: one request, the pictures back as base64, billed to the caller's key
 * and reported in the answer. No output format is asked for: most models do not list the
 * option, so the model's own choice is taken and read from the bytes. It takes no reference
 * pictures.
 */
export class OpenRouterMediaGenerationProvider implements MediaGenerationProvider {
  readonly id = "openrouter";
  readonly imageModel: string;
  readonly capabilities: MediaGenerationProvider["capabilities"];
  constructor(
    private readonly options: { apiKey: string; imageModel: string; fetch?: typeof fetch },
  ) {
    if (
      !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*(?:\/[a-zA-Z0-9_-][a-zA-Z0-9_.:-]*)+$/.test(options.imageModel)
    )
      throw new Error("Invalid image model");
    this.imageModel = options.imageModel;
    this.capabilities = {
      images: true,
      video: false,
      offline: false,
      references: false,
      maxCount: imageModelEntry(options.imageModel)?.maxCount ?? IMAGE_MAX_COUNT,
    };
  }
  async generateImage(
    input: MediaGenerationInput,
    context: AdapterContext,
  ): Promise<GeneratedMedia[]> {
    const checked = checkedInput(input, this.capabilities.maxCount, false);
    context.signal.throwIfAborted();
    const { images } = await requestImages(
      () =>
        (this.options.fetch ?? fetch)(OPENROUTER_IMAGES_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: this.imageModel,
            prompt: checked.prompt,
            n: checked.count,
            ...(checked.aspectRatio ? { aspect_ratio: checked.aspectRatio } : {}),
          }),
          signal: AbortSignal.any([context.signal, AbortSignal.timeout(180_000)]),
          redirect: "error",
        }),
      checked.count,
      context,
    );
    return images;
  }
  async generateVideo(
    _input: MediaGenerationInput,
    _context: AdapterContext,
  ): Promise<MediaVideoJob> {
    throw new MediaGenerationError("unsupported");
  }
  async pollVideo(_id: string, _context: AdapterContext): Promise<MediaVideoJob> {
    throw new MediaGenerationError("unsupported");
  }
}

/** Pixel size to ask an OpenAI-style images endpoint for, from the proportion wanted. */
function openAiImageSize(model: string, ratio: MediaGenerationInput["aspectRatio"]): string {
  const [width, height] = (ratio ?? "1:1").split(":").map(Number) as [number, number];
  if (width === height) return "1024x1024";
  const wide = width > height;
  if (model === "dall-e-3") return wide ? "1792x1024" : "1024x1792";
  return wide ? "1536x1024" : "1024x1536";
}

/**
 * Any server that speaks the OpenAI images protocol: `/images/generations` for a prompt, and
 * `/images/edits` when reference pictures come with it. Cost is not reported by the protocol, so
 * the catalog price is what the call is settled at.
 */
export class OpenAiCompatibleMediaGenerationProvider implements MediaGenerationProvider {
  readonly id = "openai-compatible";
  readonly imageModel: string;
  readonly capabilities: MediaGenerationProvider["capabilities"];
  private readonly baseUrl: string;
  constructor(
    private readonly options: {
      baseUrl: string;
      apiKey?: string;
      imageModel: string;
      fetch?: typeof fetch;
    },
  ) {
    if (!/^[\w.:/@+-]{1,200}$/.test(options.imageModel)) throw new Error("Invalid image model");
    // The operator named this server, so a private address is allowed; metadata hosts are not.
    const url = assertAllowedOpenAiCompatibleUrl(options.baseUrl, { allowPrivate: true });
    assertHttpsForKeyedOpenAiCompatibleUrl(url, options.apiKey);
    this.baseUrl = normalizeOpenAiCompatibleBaseUrl(options.baseUrl);
    this.imageModel = options.imageModel;
    const entry = imageModelEntry(options.imageModel);
    this.capabilities = {
      images: true,
      video: false,
      offline: false,
      references: entry?.references ?? true,
      maxCount: entry?.maxCount ?? IMAGE_MAX_COUNT,
    };
  }
  async generateImage(
    input: MediaGenerationInput,
    context: AdapterContext,
  ): Promise<GeneratedMedia[]> {
    const { references, maxCount } = this.capabilities;
    const checked = checkedInput(input, maxCount, references);
    const entry = imageModelEntry(this.imageModel);
    if (checked.aspectRatio && entry && !entry.aspectRatios.includes(checked.aspectRatio))
      throw new MediaGenerationError("invalid_input");
    context.signal.throwIfAborted();
    const size = openAiImageSize(this.imageModel, checked.aspectRatio);
    // gpt-image models always answer in base64 and reject the parameter; older ones need it.
    const answersBase64 = this.imageModel.startsWith("gpt-image");
    const common = {
      model: this.imageModel,
      prompt: checked.prompt,
      n: checked.count,
      size,
    };
    const headers: Record<string, string> = this.options.apiKey
      ? { Authorization: `Bearer ${this.options.apiKey}` }
      : {};
    const references_ = input.references ?? [];
    const send = () => {
      const signal = AbortSignal.any([context.signal, AbortSignal.timeout(180_000)]);
      const doFetch = this.options.fetch ?? fetch;
      if (references_.length) {
        const form = new FormData();
        for (const [key, value] of Object.entries(common)) form.append(key, String(value));
        if (!answersBase64) form.append("response_format", "b64_json");
        for (const [index, reference] of references_.entries())
          form.append(
            "image[]",
            new Blob([Buffer.from(reference.bytes)], { type: reference.mimeType }),
            `reference-${index}.${reference.mimeType.split("/")[1]}`,
          );
        return doFetch(`${this.baseUrl}/images/edits`, {
          method: "POST",
          headers,
          body: form,
          signal,
          redirect: "error",
        });
      }
      return doFetch(`${this.baseUrl}/images/generations`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          ...common,
          ...(answersBase64 ? {} : { response_format: "b64_json" }),
        }),
        signal,
        redirect: "error",
      });
    };
    return (await requestImages(send, checked.count, context)).images;
  }
  async generateVideo(
    _input: MediaGenerationInput,
    _context: AdapterContext,
  ): Promise<MediaVideoJob> {
    throw new MediaGenerationError("unsupported");
  }
  async pollVideo(_id: string, _context: AdapterContext): Promise<MediaVideoJob> {
    throw new MediaGenerationError("unsupported");
  }
}

/** Deterministic provider; no network or billing. */
export class FakeMediaGenerationProvider implements MediaGenerationProvider {
  readonly id = "fake";
  readonly capabilities = {
    images: true,
    video: true,
    offline: true,
    references: true,
    maxCount: IMAGE_MAX_COUNT,
  };
  /** What the last image call was asked for, for tests. */
  lastInput: MediaGenerationInput | undefined;
  async generateImage(
    input: MediaGenerationInput,
    context: AdapterContext,
  ): Promise<GeneratedMedia[]> {
    context.signal.throwIfAborted();
    this.lastInput = input;
    return Array.from({ length: Math.min(input.count ?? 1, IMAGE_MAX_COUNT) }, () => ({
      mimeType: "image/png" as const,
      bytes: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0u8AAAAASUVORK5CYII=",
        "base64",
      ),
    }));
  }
  async generateVideo(
    _input: MediaGenerationInput,
    context: AdapterContext,
  ): Promise<MediaVideoJob> {
    context.signal.throwIfAborted();
    return { id: "fake-video", status: "queued", progress: 0 };
  }
  async pollVideo(id: string, context: AdapterContext): Promise<MediaVideoJob> {
    context.signal.throwIfAborted();
    return {
      id,
      status: "completed",
      output: {
        mimeType: "video/mp4",
        bytes: Buffer.from(FAKE_VIDEO_BASE64, "base64"),
      },
    };
  }
}
