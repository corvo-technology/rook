import type { MediaGenerationProvider } from "@corvo/adapter-kit";
import { DEFAULT_IMAGE_MODEL } from "@corvo/contracts";
import { openRouterImageModelId } from "./image-connection.js";
import {
  FakeMediaGenerationProvider,
  OpenAiCompatibleMediaGenerationProvider,
  OpenRouterMediaGenerationProvider,
} from "./media-generation-provider.js";

/**
 * The deployment's own image provider, used only when an account has no connection of its own
 * that can make images: OpenRouter on the deployment's key, with the catalog's default model.
 *
 * Deprecated, kept for one release so a deployment that set them still boots and behaves the
 * same: `MEDIA_GENERATION_IMAGE_MODEL` names the model, `MEDIA_GENERATION_PROVIDER` can pick
 * `openai-compatible` (the shared `CORVO_LOCAL_MODELS_URL`, with `MEDIA_GENERATION_API_KEY`),
 * switch images off (`disabled`) or swap in the offline `fake`.
 */
export function createMediaGenerationProvider(
  env: NodeJS.ProcessEnv = process.env,
): MediaGenerationProvider | undefined {
  const kind = env.MEDIA_GENERATION_PROVIDER?.trim().toLowerCase();
  if (kind === "disabled") return undefined;
  if (kind === "fake") return new FakeMediaGenerationProvider();
  const imageModel = env.MEDIA_GENERATION_IMAGE_MODEL?.trim();
  if (kind === "openai-compatible") {
    const baseUrl = env.CORVO_LOCAL_MODELS_URL?.trim();
    if (!imageModel || !baseUrl) return undefined;
    const apiKey = env.MEDIA_GENERATION_API_KEY?.trim();
    return new OpenAiCompatibleMediaGenerationProvider({
      baseUrl,
      imageModel,
      ...(apiKey ? { apiKey } : {}),
    });
  }
  if (kind && kind !== "openrouter") throw new Error("Unknown media generation provider");
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return undefined;
  return new OpenRouterMediaGenerationProvider({
    apiKey,
    imageModel: imageModel || openRouterImageModelId(DEFAULT_IMAGE_MODEL),
  });
}

/** Whether the operator named an image model themselves, the old way. */
export function deploymentNamesImageModel(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.MEDIA_GENERATION_IMAGE_MODEL?.trim());
}
