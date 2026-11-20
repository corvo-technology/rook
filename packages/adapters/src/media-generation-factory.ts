import type { MediaGenerationProvider } from "@corvo/adapter-kit";
import {
  FakeMediaGenerationProvider,
  OpenAiCompatibleMediaGenerationProvider,
  OpenRouterMediaGenerationProvider,
} from "./media-generation-provider.js";

/**
 * Images come from the one provider the deployment names: `openrouter` (the default, with the
 * deployment's own key) or `openai-compatible`, which uses the deployment's shared
 * OpenAI-compatible endpoint (`CORVO_LOCAL_MODELS_URL`, and `MEDIA_GENERATION_API_KEY` when it
 * needs a key). `MEDIA_GENERATION_PROVIDER` can switch it off (`disabled`) or swap in the
 * offline `fake`.
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
  if (!imageModel || !apiKey) return undefined;
  return new OpenRouterMediaGenerationProvider({ apiKey, imageModel });
}
