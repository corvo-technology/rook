import type { AdapterContext, ArtifactStore, SecretStore, VoiceProvider } from "@corvo/adapter-kit";
import type { Actor } from "@corvo/contracts";
import { AI_DISCLOSURE_VERSION, LOCAL_VOICE_PROVIDER_ID } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { findDefaultVoiceCredential } from "@corvo/db";
import { aiRecipient } from "./ai-consent.js";
import { AudioDecodeError, UnsupportedAudioFormatError } from "./audio-decode.js";
import type { LocalModelStore } from "./local-speech-models.js";
import { type LocalVoiceDeps, parseLocalVoiceSecret } from "./local-voice.js";
import { DEFAULT_LOCAL_MODEL } from "./local-voices.js";
import {
  OPENAI_COMPATIBLE_VOICE_PROVIDER_ID,
  openAiCompatibleVoiceServer,
} from "./openai-compatible-voice.js";
import { createVoiceProvider, MAX_TRANSCRIBE_BYTES, voiceCatalogEntry } from "./voice-factory.js";

const HOSTED_TRANSCRIBE_TIMEOUT_MS = 120_000;

export type TranscriptionFailure =
  | "unsupported-format"
  | "unreadable"
  | "too-large"
  | "no-speech"
  | "download-failed"
  | "model-removed"
  | "model-missing"
  | "busy"
  | "provider-failed"
  | "unavailable";

export type TranscriptionOutcome =
  | { status: "transcribed"; text: string; language?: string }
  | { status: "failed"; reason: TranscriptionFailure };

export interface AudioTranscriptionDeps {
  prisma: PrismaClient;
  artifacts: Pick<ArtifactStore, "get">;
  /** Present only on the desktop app's own engine. */
  localSpeech?: LocalVoiceDeps & { store: Pick<LocalModelStore, "automaticDownloadAllowed"> };
  /** The account's default voice connection: its provider and its secret. */
  loadVoiceCredential(actor: Actor): Promise<{ provider: string; secret: string } | null>;
  /** Whether the owner allowed this recipient to receive audio. */
  hasConsent(actor: Actor, recipientKey: string): Promise<boolean>;
  createProvider?: typeof createVoiceProvider;
  allowPrivateEndpoint?: boolean;
}

export function dbVoiceCredential(prisma: PrismaClient, secrets: Pick<SecretStore, "load">) {
  return async (actor: Actor) => {
    const credential = await findDefaultVoiceCredential(prisma, actor);
    if (!credential) return null;
    const secret = await prisma.secret.findFirst({
      where: { id: credential.secretId, userId: actor.userId, spaceId: null },
    });
    if (!secret) return null;
    return {
      provider: credential.provider,
      secret: await secrets.load(secret.ciphertext, secret.id),
    };
  };
}

export function prismaConsent(prisma: PrismaClient) {
  return async (actor: Actor, recipientKey: string) =>
    Boolean(
      await prisma.aiDataConsent.findFirst({
        where: {
          userId: actor.userId,
          spaceId: actor.spaceId,
          version: AI_DISCLOSURE_VERSION,
          recipientKey,
        },
        select: { recipientKey: true },
      }),
    );
}

type Chosen =
  | { failure: TranscriptionFailure }
  | { kind: "local"; provider: VoiceProvider; secret: string; modelId: string }
  | { kind: "hosted"; provider: VoiceProvider; secret: string };

/**
 * A selected provider that transcribes is used, and nothing else: a hosted one that fails is not
 * replaced by a download the owner did not ask for. Only when no provider that transcribes is
 * selected does the local engine take over, with its default model.
 */
async function chooseProvider(deps: AudioTranscriptionDeps, actor: Actor): Promise<Chosen> {
  const create = deps.createProvider ?? createVoiceProvider;
  try {
    const credential = await deps.loadVoiceCredential(actor);
    if (credential && voiceCatalogEntry(credential.provider)?.transcribe) {
      if (credential.provider === LOCAL_VOICE_PROVIDER_ID) {
        if (!deps.localSpeech) return { failure: "provider-failed" };
        return {
          kind: "local",
          provider: create(LOCAL_VOICE_PROVIDER_ID, { local: deps.localSpeech }),
          secret: credential.secret,
          modelId: parseLocalVoiceSecret(credential.secret).model,
        };
      }
      const endpoint =
        credential.provider === OPENAI_COMPATIBLE_VOICE_PROVIDER_ID
          ? openAiCompatibleVoiceServer(credential.secret)?.endpoint
          : undefined;
      const recipient = aiRecipient({
        provider: credential.provider,
        use: "voice",
        ...(endpoint ? { baseUrl: endpoint } : {}),
      });
      if (recipient && !(await deps.hasConsent(actor, recipient.key))) {
        return { failure: "provider-failed" };
      }
      return {
        kind: "hosted",
        provider: create(credential.provider, { allowPrivateEndpoint: deps.allowPrivateEndpoint }),
        secret: credential.secret,
      };
    }
    if (!deps.localSpeech) return { failure: "provider-failed" };
    // The owner removed a model or cancelled a download: do not fetch one on their behalf again.
    const { store } = deps.localSpeech;
    if (!(await store.automaticDownloadAllowed())) {
      const ready = (await store.list()).some(
        (model) => model.id === DEFAULT_LOCAL_MODEL && model.state === "ready",
      );
      if (!ready) return { failure: "model-removed" };
    }
    return {
      kind: "local",
      provider: create(LOCAL_VOICE_PROVIDER_ID, { local: deps.localSpeech }),
      secret: JSON.stringify({ model: DEFAULT_LOCAL_MODEL, language: "auto" }),
      modelId: DEFAULT_LOCAL_MODEL,
    };
  } catch {
    return { failure: "provider-failed" };
  }
}

function failureFor(error: unknown, kind: "local" | "hosted"): TranscriptionFailure {
  if (error instanceof UnsupportedAudioFormatError) return "unsupported-format";
  if (error instanceof AudioDecodeError) return "unreadable";
  const message = error instanceof Error ? error.message : "";
  // The local provider fails either while getting the model or while the engine runs.
  if (kind === "local" && !message.startsWith("Transcription")) return "download-failed";
  return "provider-failed";
}

const failed = (reason: TranscriptionFailure): TranscriptionOutcome => ({
  status: "failed",
  reason,
});

/** Transcribes one audio artifact of the actor's, once: a stored transcript is returned as is. */
export async function transcribeAudioArtifact(
  deps: AudioTranscriptionDeps,
  input: {
    artifactId: string;
    actor: Actor;
    signal?: AbortSignal;
    /** Audio from someone other than the owner must not cause a model to be downloaded. */
    noDownload?: boolean;
    /** Called once, before a model that is not on this computer yet starts downloading. */
    onPreparingModel?: (model: { id: string; sizeBytes: number }) => Promise<void>;
  },
): Promise<TranscriptionOutcome> {
  const { artifactId, actor } = input;
  const artifact = await deps.prisma.artifact.findFirst({
    where: { id: artifactId, spaceId: actor.spaceId, userId: actor.userId },
    select: { id: true, name: true, mimeType: true, size: true, storageKey: true },
  });
  if (!artifact) return failed("unavailable");
  const stored = await deps.prisma.artifactTranscript.findUnique({
    where: { artifactId },
    select: { text: true, language: true },
  });
  if (stored) {
    return {
      status: "transcribed",
      text: stored.text,
      ...(stored.language ? { language: stored.language } : {}),
    };
  }
  if (artifact.size > MAX_TRANSCRIBE_BYTES) return failed("too-large");
  const chosen = await chooseProvider(deps, actor);
  if ("failure" in chosen) return failed(chosen.failure);
  const hostedSignal =
    chosen.kind === "hosted" ? AbortSignal.timeout(HOSTED_TRANSCRIBE_TIMEOUT_MS) : undefined;
  const signal =
    input.signal && hostedSignal
      ? AbortSignal.any([input.signal, hostedSignal])
      : (input.signal ?? hostedSignal ?? new AbortController().signal);
  const context: AdapterContext = {
    operationId: "audio-transcription",
    traceId: "audio-transcription",
    spaceId: actor.spaceId,
    userId: actor.userId,
    signal,
  };
  let audio: Uint8Array;
  try {
    audio = await deps.artifacts.get(artifact.storageKey, context);
  } catch {
    return failed("unavailable");
  }
  if (chosen.kind === "local" && input.noDownload && deps.localSpeech) {
    // Someone other than the owner may not cause a model to be fetched.
    const ready = (await deps.localSpeech.store.list()).some(
      (entry) => entry.id === chosen.modelId && entry.state === "ready",
    );
    if (!ready) return failed("model-missing");
  }
  if (chosen.kind === "local" && input.onPreparingModel && deps.localSpeech) {
    try {
      const model = (await deps.localSpeech.store.list()).find(
        (entry) => entry.id === chosen.modelId,
      );
      if (model && model.state !== "ready") {
        await input.onPreparingModel({ id: model.id, sizeBytes: model.sizeBytes });
      }
    } catch {
      // An announcement that cannot be made must not stop the transcription.
    }
  }
  try {
    const result = await chosen.provider.transcribe?.(
      { audio, mimeType: artifact.mimeType, apiKey: chosen.secret, signal },
      context,
    );
    const text = result?.text.trim() ?? "";
    if (!result || !text) return failed("no-speech");
    const language = result.language ?? null;
    await deps.prisma.artifactTranscript.upsert({
      where: { artifactId },
      create: { artifactId, spaceId: actor.spaceId, text, language },
      update: { text, language },
    });
    return { status: "transcribed", text, ...(language ? { language } : {}) };
  } catch (error) {
    return failed(failureFor(error, chosen.kind));
  }
}

const REASON_TEXT: Record<TranscriptionFailure, string> = {
  "unsupported-format": "this audio format is not supported",
  unreadable: "the file could not be read",
  "too-large": "the file is too large",
  "no-speech": "no speech was heard",
  "download-failed": "the speech model could not be downloaded",
  "model-removed": "the speech model was removed",
  "model-missing": "the speech model is not on this computer",
  busy: "too many audio messages were sent at once",
  "provider-failed": "transcription is not available",
  unavailable: "the file is not available",
};

/**
 * The text an agent reads for one audio attachment. The file name is quoted so it cannot add
 * lines, and the transcript sits after a label that says it is machine output and may be wrong.
 */
export function transcriptNote(name: string, outcome: TranscriptionOutcome): string {
  const label = JSON.stringify(name);
  if (outcome.status === "failed") {
    return `Audio ${label} was not transcribed (${REASON_TEXT[outcome.reason]}).`;
  }
  const language = outcome.language ? ` (${outcome.language})` : "";
  return `Machine transcript of ${label}${language}, may contain errors:\n${outcome.text}`;
}
