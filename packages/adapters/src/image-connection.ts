import type { MediaGenerationProvider, SecretStore } from "@corvo/adapter-kit";
import { DEFAULT_IMAGE_MODEL, imageModelEntry, normalizeImageModelId } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { findModelCredential, withModelScope } from "@corvo/db";
import {
  OpenAiCompatibleMediaGenerationProvider,
  OpenRouterMediaGenerationProvider,
} from "./media-generation-provider.js";
import { loadStoredModelSecret } from "./model-selection.js";
import type { StoredModelSecret } from "./pi-oauth.js";
import { parseModelSecret } from "./pi-oauth.js";
import { OPENAI_COMPATIBLE_PROVIDER_ID } from "./pi-openai-compatible-provider.js";

const OPENAI_IMAGES_URL = "https://api.openai.com/v1";
/** The OpenAI image model a plain OpenAI key uses; the first of the catalog's OpenAI models. */
const OPENAI_IMAGE_MODEL = "gpt-image-2";

/** A model connection of the account that can make pictures, and the provider that uses it. */
export interface ImageConnection {
  provider: MediaGenerationProvider;
  /** The connection's own provider id, as usage records name it. */
  connectionProvider: string;
  secretValues: string[];
}

/** OpenRouter asks for `openai/gpt-image-2` where OpenAI itself asks for `gpt-image-2`. */
export function openRouterImageModelId(id: string): string {
  const bare = normalizeImageModelId(id);
  if (id.includes("/")) return id;
  return /^(gpt-image|dall-e)/.test(bare) ? `openai/${bare}` : `google/${bare}`;
}

/** The image model an OpenAI-compatible connection serves: a listed one it has enabled. */
function enabledImageModel(secret: StoredModelSecret): string | undefined {
  if (secret.kind !== "openai_compatible") return undefined;
  return secret.enabledModelIds?.find((id) => imageModelEntry(id));
}

/**
 * The account's own connection that can make images, if any: a plain OpenAI key, an OpenRouter
 * key, or an OpenAI-compatible connection that has enabled a catalog image model. A sign-in
 * (OAuth) has no key to send to an images endpoint, so it never counts. In a space that uses
 * its owner's lent connections, those are the ones that apply.
 */
export async function findImageConnection(
  deps: {
    prisma: PrismaClient;
    secretStore: Pick<SecretStore, "load">;
    mcpAllowPrivateEndpoint?: boolean;
  },
  asker: { userId: string; spaceId: string },
  options: { fetch?: typeof fetch } = {},
): Promise<ImageConnection | undefined> {
  const { prisma, secretStore } = deps;
  return withModelScope(prisma, asker, async (scope) => {
    const read = async (secretId: string) => {
      const loaded = await loadStoredModelSecret(prisma, secretStore, scope.userId, secretId);
      if (loaded.status !== "loaded") return undefined;
      try {
        return parseModelSecret(loaded.plaintext);
      } catch {
        return undefined;
      }
    };
    for (const provider of ["openai", "openrouter"] as const) {
      const credential = await findModelCredential(prisma, scope, provider);
      const secret = credential && (await read(credential.secretId));
      if (secret?.kind !== "api_key") continue;
      return {
        connectionProvider: provider,
        secretValues: [secret.key],
        provider:
          provider === "openai"
            ? new OpenAiCompatibleMediaGenerationProvider({
                baseUrl: OPENAI_IMAGES_URL,
                apiKey: secret.key,
                imageModel: OPENAI_IMAGE_MODEL,
                ...options,
              })
            : new OpenRouterMediaGenerationProvider({
                apiKey: secret.key,
                imageModel: openRouterImageModelId(DEFAULT_IMAGE_MODEL),
                ...options,
              }),
      };
    }
    const compatible = await prisma.userModelCredential.findMany({
      where: { userId: scope.userId, provider: OPENAI_COMPATIBLE_PROVIDER_ID },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });
    for (const credential of compatible) {
      const secret = await read(credential.secretId);
      const imageModel = secret && enabledImageModel(secret);
      if (secret?.kind !== "openai_compatible" || !imageModel) continue;
      try {
        return {
          connectionProvider: OPENAI_COMPATIBLE_PROVIDER_ID,
          secretValues: secret.apiKey ? [secret.apiKey] : [],
          provider: new OpenAiCompatibleMediaGenerationProvider({
            baseUrl: secret.baseUrl,
            imageModel,
            allowPrivate: deps.mcpAllowPrivateEndpoint === true,
            ...(secret.apiKey ? { apiKey: secret.apiKey } : {}),
            ...(secret.headers ? { headers: secret.headers } : {}),
            ...options,
          }),
        };
      } catch {
        // An address the operator does not allow is not a usable image connection.
      }
    }
    return undefined;
  });
}

/**
 * Where a run's pictures come from. The account's own connection comes first, and then the
 * pictures are the account's own cost, with no credit held. Without one, the deployment's
 * provider serves them, but only where someone pays for it: the account's credits, or an
 * operator who named an image model for the deployment.
 */
export async function resolveRunImageProvider(input: {
  deps: Parameters<typeof findImageConnection>[0] & { mediaGeneration?: MediaGenerationProvider };
  asker: { userId: string; spaceId: string };
  deployment: MediaGenerationProvider | undefined;
  creditsEnabled: boolean;
  operatorPays: boolean;
  onError?: (error: unknown) => void;
}): Promise<{ provider: MediaGenerationProvider; own?: ImageConnection } | undefined> {
  const { deps, deployment } = input;
  if (deps.mediaGeneration) return { provider: deps.mediaGeneration };
  const own = await findImageConnection(deps, input.asker).catch((error) => {
    input.onError?.(error);
    return undefined;
  });
  if (own) return { provider: own.provider, own };
  if (!deployment) return undefined;
  return input.creditsEnabled || input.operatorPays || deployment.capabilities.offline
    ? { provider: deployment }
    : undefined;
}
