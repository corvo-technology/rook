import type { AdapterContext, SecretStore } from "@corvo/adapter-kit";
import { VoiceAccountError } from "@corvo/adapter-kit";
import type { LocalSpeech } from "@corvo/adapters";
import {
  createVoiceProvider,
  creditOrganization,
  DEFAULT_LOCAL_MODEL,
  isFishSpeechModelId,
  isVoiceProviderId,
  LOCAL_VOICE_PROVIDER_ID,
  listVoiceCatalog,
  MAX_SPEAK_CHARS,
  MAX_TRANSCRIBE_BYTES,
  NoVoiceConfigured,
  OPENAI_COMPATIBLE_VOICE_PROVIDER_ID,
  OPENROUTER_VOICE_PROVIDER_ID,
  openAiCompatibleVoiceServer,
  openRouterVoiceId,
  parseLocalVoiceSecret,
  serializeOpenAiCompatibleVoiceSecret,
  synthesizeOnCredits,
  transcribeOnCredits,
  voiceCatalogEntry,
} from "@corvo/adapters";
import type {
  Actor,
  LocalSpeechModel,
  SettingsScope,
  VoiceAccountErrorCode,
  VoiceCredential,
  VoiceStatus,
} from "@corvo/contracts";
import { SettingsScopeSchema } from "@corvo/contracts";
import { speakable, toUtterances } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import {
  deleteUnreferencedCredentialSecret,
  findDefaultVoiceCredential,
  findVoiceCredential,
  findVoicePreference,
  IsolationError,
  lockSpaceSettings,
  newestVoiceCredentialOrder,
  Prisma,
  runAsSystemInTransaction,
  runAsTenant,
  saveVoicePreference,
  selectVoicePreference,
  voicePreferenceTarget,
} from "@corvo/db";
import { getLogger } from "@corvo/logging";
import { ORPCError } from "@orpc/server";
import type { Context, Hono } from "hono";
import { readBoundedBody } from "./http-body.js";
import {
  chooseVoiceForLanguage,
  DEFAULT_LOCAL_SECRET,
  ensureLocalModel,
  LocalModelPreparing,
  readyLocalVoices,
} from "./local-voice.js";
import { withSerializableRetry } from "./serializable-retry.js";
import type { SpeechSummarizer } from "./speech-summary.js";

export interface VoiceDeps {
  prisma: PrismaClient;
  secrets: SecretStore;
  /** The instance flag (`MCP_ALLOW_PRIVATE_ENDPOINT`). */
  env?: { mcpAllowPrivateEndpoint?: boolean };
  /** Set only when `VOICE_SUMMARY_MIN_CHARS` turns spoken summaries on. */
  speechSummary?: { summarize: SpeechSummarizer; minChars: number };
  /** Present only when the engine is the owner's own computer; see `createLocalSpeech`. */
  localSpeech?: LocalSpeech;
  /**
   * Present only where credits are on and the deployment runs on OpenRouter: customers on credits
   * with no voice of their own listen and speak with this key, paid from their balance.
   */
  voiceCredits?: { apiKey: string };
}

/** The deployment key and the paying organization, when this person's voice runs on credits. */
export async function creditVoiceFor(
  deps: Pick<VoiceDeps, "prisma" | "voiceCredits">,
  actor: Actor,
) {
  if (!deps.voiceCredits) return undefined;
  const organizationId = await creditOrganization(deps.prisma, actor);
  return organizationId ? { apiKey: deps.voiceCredits.apiKey, organizationId } : undefined;
}

/** A self-hosted speech server on a private address is limited like model endpoints. */
async function voiceMayUsePrivateEndpoint(deps: VoiceDeps, _actor: Actor, provider: string) {
  return (
    provider === OPENAI_COMPATIBLE_VOICE_PROVIDER_ID && deps.env?.mcpAllowPrivateEndpoint === true
  );
}

/** The voice adapter for a credential, with the actor's private-endpoint decision. */
export async function voiceProviderFor(deps: VoiceDeps, actor: Actor, provider: string) {
  return createVoiceProvider(provider, {
    allowPrivateEndpoint: await voiceMayUsePrivateEndpoint(deps, actor, provider),
    local: deps.localSpeech,
  });
}

export { LocalModelPreparing, listVoiceCatalog };

const SPEAK_TIMEOUT_MS = 60_000;
export const MAX_SPEAK_REQUEST_BYTES = 16 * 1024;
export const MAX_TRANSCRIBE_REQUEST_BYTES = 4 * Math.ceil(MAX_TRANSCRIBE_BYTES / 3) + 1024;

export function voiceContext(actor: Actor, signal?: AbortSignal): AdapterContext {
  return {
    operationId: "voice",
    traceId: "voice",
    spaceId: actor.spaceId,
    userId: actor.userId,
    signal: signal ?? new AbortController().signal,
  };
}

/** The providers offered here; "This computer" only where the engine is the owner's own. */
export function voiceCatalogFor(deps: Pick<VoiceDeps, "env" | "localSpeech">) {
  return listVoiceCatalog({
    allowPrivateEndpoint: deps.env?.mcpAllowPrivateEndpoint,
    localEngine: Boolean(deps.localSpeech),
  });
}

export function catalogEntry(provider: string) {
  return voiceCatalogEntry(provider);
}

/**
 * Where no voice is connected, the desktop app still listens and speaks with the models on the
 * owner's own computer (`localDefault`), so it reports itself ready.
 */
export function toVoiceStatus(
  cred: { provider: string; voiceId: string } | null,
  options: { localDefault?: boolean } = {},
): VoiceStatus {
  if (!cred && options.localDefault) {
    return { configured: false, ready: true, transcribe: true, provider: null, voiceId: "" };
  }
  const entry = cred ? catalogEntry(cred.provider) : undefined;
  return {
    configured: Boolean(cred),
    // The voices on this computer choose themselves, so connecting it is enough to speak.
    ready: Boolean(cred?.voiceId) || cred?.provider === LOCAL_VOICE_PROVIDER_ID,
    transcribe: Boolean(entry?.transcribe && cred),
    provider: cred?.provider ?? null,
    voiceId: cred?.voiceId ?? "",
  };
}

export function toVoiceCredential(row: {
  id: string;
  provider: string;
  isDefault: boolean;
  voiceId: string;
  speechModel?: string | null;
  server?: { endpoint: string; ttsModel: string; sttModel: string };
  /** The local provider's choice: its model and the language of the recordings. */
  local?: { model: string; language: string };
}): VoiceCredential {
  return {
    id: row.id,
    provider: row.provider,
    hasKey: true,
    isDefault: row.isDefault,
    voiceId: row.voiceId,
    speechModel: row.speechModel ?? "",
    transcribe: Boolean(catalogEntry(row.provider)?.transcribe),
    endpoint: row.server?.endpoint ?? "",
    ttsModel: row.server?.ttsModel ?? "",
    sttModel: row.server?.sttModel ?? row.local?.model ?? "",
    language: row.local?.language ?? "",
  };
}

/**
 * A self-hosted connection's address and model ids, read from its secret. Undefined for
 * hosted providers and for a secret that cannot be read, which still lists the connection.
 */
export async function voiceCredentialServer(
  deps: VoiceDeps,
  actor: Actor,
  row: { provider: string; secretId: string },
) {
  if (row.provider !== OPENAI_COMPATIBLE_VOICE_PROVIDER_ID) return undefined;
  try {
    const secret = await deps.prisma.secret.findFirst({
      where: { id: row.secretId, userId: actor.userId, spaceId: null },
    });
    if (!secret) return undefined;
    return openAiCompatibleVoiceServer(await deps.secrets.load(secret.ciphertext, secret.id));
  } catch {
    // Reconnecting replaces an unreadable secret.
    return undefined;
  }
}

/** A local connection's model and language, read from its secret; undefined for other providers. */
export async function voiceCredentialLocal(
  deps: VoiceDeps,
  actor: Actor,
  row: { provider: string; secretId: string },
) {
  if (row.provider !== LOCAL_VOICE_PROVIDER_ID) return undefined;
  try {
    const secret = await deps.prisma.secret.findFirst({
      where: { id: row.secretId, userId: actor.userId, spaceId: null },
    });
    if (!secret) return undefined;
    return parseLocalVoiceSecret(await deps.secrets.load(secret.ciphertext, secret.id));
  } catch {
    return undefined;
  }
}

/**
 * Another server or speech model has its own voices, so saved voice choices cannot carry
 * over. Only self-hosted connections can change either while keeping the credential.
 */
export function voiceChoicesChanged(previousPlaintext: string | undefined, plaintext: string) {
  const previous = previousPlaintext ? openAiCompatibleVoiceServer(previousPlaintext) : undefined;
  if (!previous) return false;
  const next = openAiCompatibleVoiceServer(plaintext);
  return previous.endpoint !== next?.endpoint || previous.ttsModel !== next?.ttsModel;
}

/**
 * The secret to store. Hosted providers keep the bare key; a self-hosted server stores
 * its base URL, optional key, and model ids, validated like model connections.
 */
export function voiceCredentialPlaintext(input: {
  provider: string;
  plaintext: string;
  baseUrl?: string;
  ttsModel?: string;
  sttModel?: string;
  /** The local provider's recording language: auto, en or pt. */
  language?: string;
  /** The stored secret for this provider; blank fields keep its key and models. */
  previousPlaintext?: string;
  allowPrivateEndpoint?: boolean;
}): string {
  if (input.provider === LOCAL_VOICE_PROVIDER_ID) {
    // There is no key: the secret is the owner's choice of model and language. Choosing only a
    // voice leaves listening to the default model.
    const model = input.sttModel?.trim() || DEFAULT_LOCAL_MODEL;
    const serialized = JSON.stringify({ model, language: input.language ?? "auto" });
    try {
      parseLocalVoiceSecret(serialized);
    } catch (error) {
      throw new ORPCError("BAD_REQUEST", {
        message: error instanceof Error ? error.message : "Pick a language.",
      });
    }
    return serialized;
  }
  if (input.provider !== OPENAI_COMPATIBLE_VOICE_PROVIDER_ID) {
    if (input.plaintext.trim().length < 8) {
      throw new ORPCError("BAD_REQUEST", { message: "Enter an API key." });
    }
    return input.plaintext;
  }
  try {
    return serializeOpenAiCompatibleVoiceSecret(
      {
        baseUrl: input.baseUrl ?? "",
        apiKey: input.plaintext,
        ttsModel: input.ttsModel,
        sttModel: input.sttModel,
      },
      input.previousPlaintext,
      { allowPrivate: input.allowPrivateEndpoint },
    );
  } catch (error) {
    throw new ORPCError("BAD_REQUEST", {
      message: error instanceof Error ? error.message : "That server URL is not valid.",
    });
  }
}

const FISH_AUDIO_PROVIDER = "fish-audio";

/** Empty clears the Fish override. Anything else must be a header-safe model id. */
export function fishSpeechModelValue(speechModel: string): string | null {
  const trimmed = speechModel.trim();
  if (!trimmed) return null;
  if (!isFishSpeechModelId(trimmed)) {
    throw new ORPCError("BAD_REQUEST", { message: "That speech model id is not valid." });
  }
  return trimmed;
}

export async function loadDefaultVoiceCredential(
  deps: VoiceDeps,
  actor: Actor,
  scope?: SettingsScope,
) {
  return loadVoiceCredential(deps, actor, undefined, scope);
}

export async function loadVoiceCredential(
  deps: VoiceDeps,
  actor: Actor,
  provider?: string,
  scope?: SettingsScope,
) {
  const cred = provider
    ? await findVoiceCredential(deps.prisma, actor, provider, scope)
    : await findDefaultVoiceCredential(deps.prisma, actor, scope);
  if (!cred) return null;
  const secret = await deps.prisma.secret.findFirst({
    where: { id: cred.secretId, userId: actor.userId, spaceId: null },
  });
  if (!secret) return null;
  return { cred, apiKey: await deps.secrets.load(secret.ciphertext, secret.id) };
}

export type VoiceTarget = {
  provider: string;
  apiKey: string;
  voiceId: string;
  speechModel?: string | undefined;
  /** Set when the voice runs on credits: whose balance pays for it. */
  organizationId?: string | undefined;
};

export async function resolveVoiceTarget(
  deps: VoiceDeps,
  actor: Actor,
  input: { botId?: string; voiceId?: string; scope?: SettingsScope; provider?: string },
): Promise<VoiceTarget> {
  let botVoiceId: string | null = null;
  if (input.botId) {
    const bot = await deps.prisma.bot.findFirst({
      where: { id: input.botId, spaceId: actor.spaceId, userId: actor.userId },
      select: { voiceId: true },
    });
    if (!bot) throw new IsolationError();
    botVoiceId = bot.voiceId;
  }
  // The sample of a voice on this computer names the provider; it needs no connection.
  if (input.provider === LOCAL_VOICE_PROVIDER_ID) {
    requireLocalSpeech(deps);
    return {
      provider: LOCAL_VOICE_PROVIDER_ID,
      apiKey: DEFAULT_LOCAL_SECRET,
      voiceId: input.voiceId ?? "",
    };
  }
  const loaded = await loadDefaultVoiceCredential(deps, actor, input.scope);
  if (!loaded) {
    // No voice connected: the desktop app speaks with this computer's own voices.
    if (deps.localSpeech) {
      return {
        provider: LOCAL_VOICE_PROVIDER_ID,
        apiKey: DEFAULT_LOCAL_SECRET,
        voiceId: input.voiceId ?? "",
      };
    }
    const credits = await creditVoiceFor(deps, actor);
    if (credits) {
      return {
        provider: OPENROUTER_VOICE_PROVIDER_ID,
        apiKey: credits.apiKey,
        voiceId: openRouterVoiceId(input.voiceId || botVoiceId || undefined),
        organizationId: credits.organizationId,
      };
    }
    throw new NoVoiceConfigured("key");
  }
  const voiceId = input.voiceId || botVoiceId || loaded.cred.voiceId;
  // This computer's voices choose themselves by language when none is named.
  if (!voiceId && loaded.cred.provider !== LOCAL_VOICE_PROVIDER_ID) {
    throw new NoVoiceConfigured("voice");
  }
  return {
    provider: loaded.cred.provider,
    apiKey: loaded.apiKey,
    voiceId,
    speechModel: loaded.cred.speechModel || undefined,
  };
}

export async function persistVoiceCredential(
  deps: VoiceDeps,
  actor: Actor,
  input: {
    provider: string;
    plaintext: string;
    voiceId?: string;
    speechModel?: string;
    baseUrl?: string;
    ttsModel?: string;
    sttModel?: string;
    /** The local provider only: auto, en or pt. */
    language?: string;
    /** Which copy the connection becomes the default voice in; omitted is what applies. */
    scope?: SettingsScope;
    signal?: AbortSignal;
  },
): Promise<VoiceCredential> {
  if (!isVoiceProviderId(input.provider)) {
    throw new ORPCError("BAD_REQUEST", { message: "Unknown voice provider." });
  }
  if (input.provider === LOCAL_VOICE_PROVIDER_ID) {
    // Choosing only a voice leaves listening to the default model, which comes by itself.
    if (input.sttModel?.trim()) await requireReadyLocalModel(deps, input.sttModel);
    else requireLocalSpeech(deps);
    if (input.voiceId?.trim()) await requireReadyLocalVoice(deps, input.voiceId);
  }
  const previous =
    input.provider === OPENAI_COMPATIBLE_VOICE_PROVIDER_ID
      ? // An unreadable old secret only means nothing is inherited; the form must be complete.
        await loadVoiceCredential(deps, actor, input.provider).catch(() => null)
      : null;
  const allowPrivateEndpoint = await voiceMayUsePrivateEndpoint(deps, actor, input.provider);
  const plaintext = voiceCredentialPlaintext({
    ...input,
    previousPlaintext: previous?.apiKey,
    allowPrivateEndpoint,
  });
  const server =
    input.provider === OPENAI_COMPATIBLE_VOICE_PROVIDER_ID
      ? openAiCompatibleVoiceServer(plaintext)
      : undefined;
  const choicesChanged = voiceChoicesChanged(previous?.apiKey, plaintext);
  const requestedSpeechModel =
    input.provider === FISH_AUDIO_PROVIDER && input.speechModel !== undefined
      ? fishSpeechModelValue(input.speechModel)
      : undefined;
  const provider = createVoiceProvider(input.provider, {
    allowPrivateEndpoint,
    local: deps.localSpeech,
  });
  const verified = await provider.verify(plaintext, voiceContext(actor, input.signal));
  if (!verified.ok) {
    throw new ORPCError("BAD_REQUEST", { message: verified.message ?? "That key was rejected." });
  }
  let voiceId = choicesChanged ? "" : (input.voiceId?.trim() ?? "");
  let validVoiceIds: string[] = [];
  // This computer's voices choose themselves by language, so none is picked for the owner.
  if (!voiceId && input.provider !== LOCAL_VOICE_PROVIDER_ID) {
    const voices = await provider.listVoices(plaintext, voiceContext(actor, input.signal));
    voiceId = voices[0]?.id ?? "";
    validVoiceIds = voices.map((voice) => voice.id);
  }
  const stored = await deps.secrets.put(plaintext, voiceContext(actor, input.signal));
  const cred = await withSerializableRetry(() =>
    deps.prisma.$transaction(
      async (tx) => {
        const existing = await tx.userVoiceCredential.findFirst({
          where: { userId: actor.userId, provider: input.provider },
          orderBy: newestVoiceCredentialOrder,
        });
        const secret = await tx.secret.create({
          data: {
            id: stored.id,
            userId: actor.userId,
            spaceId: null,
            kind: "voice",
            ciphertext: stored.ciphertext,
          },
        });
        const credential = !existing
          ? await tx.userVoiceCredential.create({
              data: {
                userId: actor.userId,
                provider: input.provider,
                secretId: secret.id,
              },
            })
          : await tx.userVoiceCredential.update({
              where: { id: existing.id },
              data: { secretId: secret.id },
            });
        await lockSpaceSettings(tx, actor);
        const target = await voicePreferenceTarget(tx, actor, input.scope);
        const previousPreference = existing
          ? await findVoicePreference(tx, target, existing.id)
          : null;
        const selectedVoiceId =
          voiceId || (choicesChanged ? "" : previousPreference?.voiceId) || "";
        const speechModel =
          requestedSpeechModel !== undefined
            ? requestedSpeechModel
            : previousPreference?.speechModel;
        await selectVoicePreference(tx, target, credential.id, selectedVoiceId, speechModel);
        if (existing && choicesChanged) {
          // The credential is account-wide but the account and each Space that overrides
          // voice keep their own voice. Move every other copy whose voice the new server
          // or model lacks onto the new default.
          const stale = {
            userId: actor.userId,
            credentialId: existing.id,
            voiceId: { notIn: validVoiceIds },
          };
          if (target.scope === "space") {
            await tx.userVoicePreference.updateMany({
              where: stale,
              data: { voiceId: selectedVoiceId },
            });
          }
          await runAsSystemInTransaction(
            tx,
            "move a voice connection's other Spaces onto its new server",
            () =>
              tx.spaceVoicePreference.updateMany({
                where: {
                  ...stale,
                  spaceMember: { settingOverrides: { some: { setting: "voice" } } },
                  ...(target.scope === "space" ? { spaceId: { not: actor.spaceId } } : {}),
                },
                data: { voiceId: selectedVoiceId },
              }),
          );
        }
        if (existing) {
          await deleteUnreferencedCredentialSecret(tx, {
            credentialKind: "voice",
            credentialId: existing.id,
            secretId: existing.secretId,
          });
        }
        return {
          ...credential,
          isDefault: true,
          voiceId: selectedVoiceId,
          speechModel: speechModel ?? "",
          server,
          local:
            input.provider === LOCAL_VOICE_PROVIDER_ID
              ? parseLocalVoiceSecret(plaintext)
              : undefined,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
  return toVoiceCredential(cred);
}

function requireLocalSpeech(deps: Pick<VoiceDeps, "localSpeech">): LocalSpeech {
  if (!deps.localSpeech) {
    throw new ORPCError("BAD_REQUEST", { message: "Local speech is not available here." });
  }
  return deps.localSpeech;
}

/** A model can be used only once it is on this computer. */
async function requireReadyLocalModel(
  deps: Pick<VoiceDeps, "localSpeech">,
  id: string | undefined,
) {
  const local = requireLocalSpeech(deps);
  const found = (await local.store.list()).find(
    (model) => model.id === (id ?? "").trim() && model.kind === "listen",
  );
  if (!found) throw new ORPCError("BAD_REQUEST", { message: "Pick a model from the list." });
  if (found.state !== "ready") {
    throw new ORPCError("BAD_REQUEST", { message: "Download the model first." });
  }
}

/** A voice can be chosen only once it is on this computer. */
async function requireReadyLocalVoice(deps: Pick<VoiceDeps, "localSpeech">, id: string) {
  const local = requireLocalSpeech(deps);
  const found = (await local.store.list()).find(
    (model) => model.id === id.trim() && model.kind === "speak",
  );
  if (!found) throw new ORPCError("BAD_REQUEST", { message: "Pick a voice from the list." });
  if (found.state !== "ready") {
    throw new ORPCError("BAD_REQUEST", { message: "Download the voice first." });
  }
}

/** Every model "This computer" can use, with its download state. Empty where there is no engine. */
export async function localSpeechModels(
  deps: Pick<VoiceDeps, "localSpeech">,
): Promise<LocalSpeechModel[]> {
  return deps.localSpeech ? deps.localSpeech.store.list() : [];
}

/** Starts a download and returns at once; progress is read from `localSpeechModels`. */
export async function downloadLocalModel(deps: Pick<VoiceDeps, "localSpeech">, id: string) {
  const local = requireLocalSpeech(deps);
  const model = (await local.store.list()).find((entry) => entry.id === id);
  if (!model) {
    throw new ORPCError("BAD_REQUEST", { message: "Pick a model from the list." });
  }
  // The owner asked for this download, so automatic ones are welcome again.
  await local.store.allowAutomaticDownload(model.kind);
  void local.store.ensure(id).catch((error: unknown) => {
    getLogger().warn("local speech model download failed", {
      model: id,
      reason: error instanceof Error ? error.message : String(error),
    });
  });
  return { ok: true as const };
}

export async function cancelLocalModelDownload(deps: Pick<VoiceDeps, "localSpeech">, id: string) {
  const { store } = requireLocalSpeech(deps);
  if (!(await store.list()).some((model) => model.id === id)) {
    throw new ORPCError("BAD_REQUEST", { message: "Pick a model from the list." });
  }
  store.cancel(id);
  return { ok: true as const };
}

/** Removes the model, and the "This computer" choice too when it was the model in use. */
export async function removeLocalModel(deps: VoiceDeps, actor: Actor, id: string) {
  const local = requireLocalSpeech(deps);
  if (!(await local.store.list()).some((model) => model.id === id)) {
    throw new ORPCError("BAD_REQUEST", { message: "Pick a model from the list." });
  }
  await local.store.remove(id);
  const selected = await loadVoiceCredential(deps, actor, LOCAL_VOICE_PROVIDER_ID).catch(
    () => null,
  );
  const inUse = selected ? safeLocalModel(selected.apiKey) : undefined;
  if (inUse === id)
    await disconnectVoiceCredential(deps, actor, { provider: LOCAL_VOICE_PROVIDER_ID });
  return { ok: true as const };
}

function safeLocalModel(plaintext: string): string | undefined {
  try {
    return parseLocalVoiceSecret(plaintext).model;
  } catch {
    return undefined;
  }
}

export async function disconnectVoiceCredential(
  deps: VoiceDeps,
  actor: Actor,
  input: { provider: string },
): Promise<{ ok: true }> {
  const provider = input.provider.trim();
  if (!provider) {
    throw new ORPCError("BAD_REQUEST", { message: "Unknown voice provider." });
  }
  await withSerializableRetry(() =>
    deps.prisma.$transaction(
      async (tx) => {
        const existing = await tx.userVoiceCredential.findMany({
          where: { userId: actor.userId, provider },
        });
        if (existing.length === 0) return;
        const ids = existing.map((row) => row.id);
        const removed = { userId: actor.userId, credentialId: { in: ids } };
        await tx.userVoicePreference.deleteMany({ where: removed });
        await tx.spaceVoicePreference.deleteMany({ where: removed });
        await tx.userVoiceCredential.deleteMany({
          where: { userId: actor.userId, id: { in: ids } },
        });
        for (const row of existing) {
          await deleteUnreferencedCredentialSecret(tx, {
            credentialKind: "voice",
            credentialId: row.id,
            secretId: row.secretId,
          });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
  return { ok: true as const };
}

export async function updateVoiceSpeechModel(
  deps: VoiceDeps,
  actor: Actor,
  input: { provider: string; speechModel: string; scope?: SettingsScope },
): Promise<VoiceCredential> {
  if (input.provider !== FISH_AUDIO_PROVIDER) {
    throw new ORPCError("BAD_REQUEST", { message: "Speech model applies to Fish Audio." });
  }
  const speechModel = fishSpeechModelValue(input.speechModel);
  return withSerializableRetry(() =>
    deps.prisma.$transaction(
      async (tx) => {
        const found = await tx.userVoiceCredential.findFirst({
          where: { userId: actor.userId, provider: input.provider },
          orderBy: newestVoiceCredentialOrder,
        });
        if (!found) {
          throw new ORPCError("BAD_REQUEST", { message: "Connect a voice provider first." });
        }
        await lockSpaceSettings(tx, actor);
        const target = await voicePreferenceTarget(tx, actor, input.scope);
        const preference = await findVoicePreference(tx, target, found.id);
        // Remember the model without taking the default. Another provider may already be
        // selected, and a new row still has no voice.
        if (!preference && speechModel === null) {
          return toVoiceCredential({ ...found, isDefault: false, voiceId: "", speechModel: "" });
        }
        const saved = await saveVoicePreference(tx, target, found.id, { speechModel });
        return toVoiceCredential({
          ...found,
          isDefault: saved.isDefault,
          voiceId: saved.voiceId,
          speechModel: saved.speechModel,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

/**
 * Gets the voice on this computer ready for a reply. Null when it is on this computer; the size
 * of the download that was started when it is not; and a refusal when the owner removed their
 * voices, so none is fetched on their behalf again.
 */
async function prepareLocalVoice(
  local: LocalSpeech,
  input: { language?: string | undefined; voiceId?: string | undefined },
): Promise<{ sizeBytes: number } | "removed" | null> {
  const chosen = await chooseVoiceForLanguage(local, {
    language: input.language,
    selected: input.voiceId,
  });
  if (chosen.ready) return null;
  const model = (await local.store.list()).find((entry) => entry.id === chosen.id);
  if (model?.state === "failed") {
    throw new ORPCError("BAD_REQUEST", {
      message: "Could not download the voice. Try again in Voice settings.",
    });
  }
  if (model?.state === "downloading") return { sizeBytes: chosen.sizeBytes };
  if (!(await local.store.automaticDownloadAllowed("speak"))) return "removed";
  void local.store.ensure(chosen.id).catch((error: unknown) => {
    getLogger().warn("local voice download failed", {
      voice: chosen.id,
      reason: error instanceof Error ? error.message : String(error),
    });
  });
  return { sizeBytes: chosen.sizeBytes };
}

export async function prepareVoice(
  deps: VoiceDeps,
  actor: Actor,
  input: {
    text: string;
    voiceId?: string;
    botId?: string;
    scope?: SettingsScope;
    provider?: string;
    language?: string;
    signal?: AbortSignal;
  },
) {
  let target: VoiceTarget;
  try {
    target = await resolveVoiceTarget(deps, actor, input);
  } catch (error) {
    if (error instanceof NoVoiceConfigured) {
      return { ready: false, utterances: [] as string[] };
    }
    throw error;
  }
  if (target.provider === LOCAL_VOICE_PROVIDER_ID && deps.localSpeech) {
    const preparing = await prepareLocalVoice(deps.localSpeech, {
      language: input.language,
      voiceId: target.voiceId,
    });
    if (preparing === "removed") return { ready: false, utterances: [] as string[] };
    if (preparing) return { ready: true, utterances: [] as string[], preparing };
  }
  return { ready: true, utterances: await spokenUtterances(deps, actor, input) };
}

/**
 * A voice conversation is starting: loads this computer's models in the background so the first
 * turn does not pay for it. Nothing is downloaded and nothing fails the caller; a model that is
 * not on this computer yet is left to the request that needs it.
 */
export async function warmVoice(
  deps: VoiceDeps,
  actor: Actor,
  input: { botId?: string; scope?: SettingsScope; language?: string },
): Promise<void> {
  const local = deps.localSpeech;
  if (!local) return;
  const loaded = await loadDefaultVoiceCredential(deps, actor, input.scope);
  // Only a connection that is this computer, or none at all, listens and speaks here.
  const here = !loaded || loaded.cred.provider === LOCAL_VOICE_PROVIDER_ID;
  if (!here) return;
  const failed = (what: string) => (error: unknown) =>
    getLogger().warn("could not load the local speech model ahead of use", {
      what,
      reason: error instanceof Error ? error.message : String(error),
    });
  if (local.transcriber.warm) {
    const secret = loaded ? loaded.apiKey : DEFAULT_LOCAL_SECRET;
    const model = safeLocalModel(secret);
    const ready = model
      ? (await local.store.list()).some((entry) => entry.id === model && entry.state === "ready")
      : false;
    if (model && ready) {
      void local.store
        .ensure(model)
        .then((modelDir) => local.transcriber.warm?.({ modelDir }))
        .catch(failed("listening"));
    }
  }
  if (local.synthesizer.warm) {
    const chosen = await chooseVoiceForLanguage(local, {
      language: input.language,
      selected: loaded?.cred.voiceId || undefined,
    });
    const voice = local.store.spec(chosen.id)?.voice;
    if (chosen.ready && voice) {
      void local.store
        .ensure(chosen.id)
        .then((modelDir) => local.synthesizer.warm?.({ modelDir, voice }))
        .catch(failed("speaking"));
    }
  }
}

async function spokenUtterances(
  deps: VoiceDeps,
  actor: Actor,
  input: { text: string; botId?: string; signal?: AbortSignal },
): Promise<string[]> {
  const full = toUtterances(input.text);
  const summary = deps.speechSummary;
  if (!input.botId || !summary) return full;
  if (speakable(input.text).length <= summary.minChars) return full;
  const spoken = await summary.summarize(actor, input.botId, input.text, input.signal);
  const utterances = spoken ? toUtterances(spoken) : [];
  return utterances.length > 0 ? utterances : full;
}

/** A refused request is the caller's mistake; anything else is the provider failing. */
function providerFailed(error: unknown) {
  return !(error instanceof ORPCError) && !(error instanceof IsolationError);
}

export async function synthesizeVoice(
  deps: VoiceDeps,
  actor: Actor,
  input: {
    text: string;
    voiceId?: string;
    botId?: string;
    scope?: SettingsScope;
    provider?: string;
    language?: string;
    signal?: AbortSignal;
  },
) {
  const target = await resolveVoiceTarget(deps, actor, input);
  const text = input.text.trim();
  if (!text) throw new ORPCError("BAD_REQUEST", { message: "Nothing to speak." });
  if (text.length > MAX_SPEAK_CHARS) {
    throw new ORPCError("BAD_REQUEST", { message: "That utterance is too long to speak." });
  }
  const context = voiceContext(actor, input.signal);
  const provider = await voiceProviderFor(deps, actor, target.provider);
  const request = {
    text,
    voiceId: target.voiceId,
    apiKey: target.apiKey,
    model: target.speechModel,
    language: input.language,
    signal: input.signal,
  };
  try {
    if (target.organizationId) {
      return await synthesizeOnCredits(
        {
          prisma: deps.prisma,
          organizationId: target.organizationId,
          userId: actor.userId,
          spaceId: actor.spaceId,
        },
        provider,
        request,
        context,
      );
    }
    return await provider.synthesize(request, context);
  } catch (error) {
    const local = deps.localSpeech;
    if (
      target.provider === LOCAL_VOICE_PROVIDER_ID ||
      !local ||
      input.signal?.aborted ||
      !providerFailed(error)
    ) {
      throw error;
    }
    // A selected provider that fails (an error, no credit left) is never replaced by a download,
    // but a voice already on this computer can still read this reply.
    if ((await readyLocalVoices(local)).length === 0) throw error;
    getLogger().warn("voice provider failed, speaking with the voice on this computer", {
      provider: target.provider,
      reason: error instanceof Error ? error.message : String(error),
    });
    const clip = await (await voiceProviderFor(deps, actor, LOCAL_VOICE_PROVIDER_ID)).synthesize(
      {
        text,
        voiceId: "",
        apiKey: DEFAULT_LOCAL_SECRET,
        language: input.language,
        signal: input.signal,
      },
      context,
    );
    return { ...clip, fallback: true as const };
  }
}

/**
 * Makes the listening model of this computer ready for a recording. The model comes by itself
 * unless the owner removed it, and a request waits a while for the download before it asks the
 * client to come back.
 */
async function prepareLocalListening(local: LocalSpeech, secret: string, implicit: boolean) {
  const id = parseLocalVoiceSecret(secret).model;
  const model = (await local.store.list()).find((entry) => entry.id === id);
  if (!model || model.state === "ready") return;
  if (model.state === "failed") {
    throw new ORPCError("BAD_REQUEST", {
      message: "Could not download the speech model. Try again in Voice settings.",
    });
  }
  if (
    implicit &&
    model.state !== "downloading" &&
    !(await local.store.automaticDownloadAllowed("listen"))
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: "The speech model was removed. Download it in Voice settings.",
    });
  }
  await ensureLocalModel(local, id);
}

export async function transcribeVoice(
  deps: VoiceDeps,
  actor: Actor,
  input: { audio: Uint8Array; mimeType: string; language?: string; signal?: AbortSignal },
) {
  const loaded = await loadDefaultVoiceCredential(deps, actor);
  // No voice connected: the desktop app listens with the speech model on this computer, and
  // anyone else on credits listens with the deployment's.
  const credits = !loaded && !deps.localSpeech ? await creditVoiceFor(deps, actor) : undefined;
  if (!loaded && !deps.localSpeech && !credits) throw new NoVoiceConfigured("key");
  const target: { provider: string; apiKey: string; organizationId?: string } = loaded
    ? { provider: loaded.cred.provider, apiKey: loaded.apiKey }
    : credits
      ? {
          provider: OPENROUTER_VOICE_PROVIDER_ID,
          apiKey: credits.apiKey,
          organizationId: credits.organizationId,
        }
      : { provider: LOCAL_VOICE_PROVIDER_ID, apiKey: DEFAULT_LOCAL_SECRET };
  const provider = await voiceProviderFor(deps, actor, target.provider);
  if (!provider.transcribe) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This voice provider does not transcribe audio. Use on-device dictation instead.",
    });
  }
  if (input.audio.byteLength === 0 || input.audio.byteLength > MAX_TRANSCRIBE_BYTES) {
    throw new ORPCError("BAD_REQUEST", { message: "That recording is empty or too large." });
  }
  if (target.provider === LOCAL_VOICE_PROVIDER_ID && deps.localSpeech) {
    await prepareLocalListening(deps.localSpeech, target.apiKey, !loaded);
  }
  const request = {
    audio: input.audio,
    mimeType: input.mimeType || "audio/webm",
    language: input.language,
    apiKey: target.apiKey,
    signal: input.signal,
  };
  const context = voiceContext(actor, input.signal);
  if (target.organizationId) {
    return transcribeOnCredits(
      {
        prisma: deps.prisma,
        organizationId: target.organizationId,
        userId: actor.userId,
        spaceId: actor.spaceId,
      },
      provider,
      request,
      context,
    );
  }
  return provider.transcribe(request, context);
}

export function mountVoiceHttpRoutes(
  app: Hono,
  deps: VoiceDeps,
  authenticate: (c: Context) => Promise<Actor | null>,
) {
  app.post("/api/voice/speak", async (c) => {
    const actor = await authenticate(c);
    if (!actor) return c.json({ error: "Unauthorized" }, 401);
    const raw = await readBoundedBody(c.req.raw, MAX_SPEAK_REQUEST_BYTES);
    if (raw === null) return c.json({ error: "Request body is too large." }, 413);
    const body = parseVoiceRequestBody(raw);
    try {
      const clip = await runAsTenant(actor, () =>
        synthesizeVoice(deps, actor, {
          text: String((body as { text?: unknown }).text ?? ""),
          voiceId: optionalString((body as { voiceId?: unknown }).voiceId),
          botId: optionalString((body as { botId?: unknown }).botId),
          provider: optionalString((body as { provider?: unknown }).provider),
          language: optionalString((body as { language?: unknown }).language),
          scope: SettingsScopeSchema.safeParse((body as { scope?: unknown }).scope).data,
          signal: AbortSignal.any(
            [c.req.raw.signal, AbortSignal.timeout(SPEAK_TIMEOUT_MS)].filter(
              Boolean,
            ) as AbortSignal[],
          ),
        }),
      );
      // Copy into a fresh ArrayBuffer-backed view: DOM-lib BodyInit rejects
      // Uint8Array<ArrayBufferLike> since TS 5.7.
      return new Response(new Uint8Array(clip.bytes), {
        headers: {
          "content-type": clip.mimeType,
          "cache-control": "no-store",
          // The selected voice failed and this computer's read the reply; the client says so once.
          ...("fallback" in clip ? { "x-voice-fallback": "local" } : {}),
        },
      });
    } catch (error) {
      return voiceHttpError(c, error);
    }
  });

  app.post("/api/voice/transcribe", async (c) => {
    const actor = await authenticate(c);
    if (!actor) return c.json({ error: "Unauthorized" }, 401);
    const raw = await readBoundedBody(c.req.raw, MAX_TRANSCRIBE_REQUEST_BYTES);
    if (raw === null) return c.json({ error: "Request body is too large." }, 413);
    const body = parseVoiceRequestBody(raw);
    const audioBase64 = String((body as { audioBase64?: unknown }).audioBase64 ?? "");
    const language = optionalString((body as { language?: unknown }).language);
    try {
      const audio = decodeAudioBase64(audioBase64);
      const result = await runAsTenant(actor, () =>
        transcribeVoice(deps, actor, {
          audio,
          mimeType: String((body as { mimeType?: unknown }).mimeType ?? "audio/webm"),
          language,
          signal: c.req.raw.signal,
        }),
      );
      return c.json({
        text: result.text,
        ...(result.language ? { language: result.language } : {}),
      });
    } catch (error) {
      return voiceHttpError(c, error);
    }
  });
}

function parseVoiceRequestBody(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function decodeAudioBase64(value: string): Uint8Array {
  if (!value.trim()) throw new ORPCError("BAD_REQUEST", { message: "Recording is empty." });
  try {
    return new Uint8Array(Buffer.from(value, "base64"));
  } catch {
    throw new ORPCError("BAD_REQUEST", { message: "Recording is not valid audio." });
  }
}

/** Spent credit is 402; a rejected key is 403, never 401, which clients read as a lost session. */
export function voiceAccountErrorStatus(code: VoiceAccountErrorCode) {
  return code === "VOICE_KEY_REJECTED" ? 403 : 402;
}

function voiceHttpError(c: Context, error: unknown) {
  if (error instanceof IsolationError) {
    return c.json({ error: "Resource not found" }, 404);
  }
  if (error instanceof NoVoiceConfigured) {
    return c.json({ error: error.message }, 409);
  }
  if (error instanceof LocalModelPreparing) {
    return c.json({ error: error.message, code: error.code, sizeBytes: error.sizeBytes }, 503);
  }
  if (error instanceof ORPCError) {
    const code = String(error.code ?? "BAD_REQUEST");
    const status =
      code === "UNAUTHORIZED" ? 401 : code === "NOT_FOUND" ? 404 : code === "CONFLICT" ? 409 : 400;
    return c.json({ error: error.message }, status);
  }
  if (error instanceof VoiceAccountError) {
    getLogger().warn("voice provider account rejected the request", {
      route: c.req.path,
      reason: error.code,
    });
    return c.json({ error: error.message, code: error.code }, voiceAccountErrorStatus(error.code));
  }
  const message = error instanceof Error ? error.message : "Voice request failed.";
  // Message only: request bodies, keys and audio never reach the log.
  getLogger().warn("voice request failed", { route: c.req.path, reason: message });
  return c.json({ error: message }, 502);
}
