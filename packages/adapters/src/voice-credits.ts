import { randomUUID } from "node:crypto";
import type {
  AdapterContext,
  SpeechClip,
  VoiceProvider,
  VoiceSynthesizeRequest,
  VoiceTranscribeRequest,
  VoiceTranscribeResult,
} from "@corvo/adapter-kit";
import { VoiceAccountError } from "@corvo/adapter-kit";
import type { PrismaClient } from "@corvo/db";
import {
  creditAccount,
  organizationForMember,
  recordModelCreditReceipt,
  reserveModelCredits,
  settleModelCredits,
} from "@corvo/db";
import { getLogger } from "@corvo/logging";
import {
  OPENROUTER_STT_MODEL,
  OPENROUTER_STT_USD_PER_SECOND,
  OPENROUTER_TTS_MODEL,
  OPENROUTER_TTS_USD_PER_CHAR,
  OPENROUTER_VOICE_PROVIDER_ID,
} from "./openrouter-voice.js";

/**
 * Voice on credits needs the deployment's OpenRouter key and billing credits switched on. The key
 * is what the API hands to the provider; nothing else may carry it.
 */
export function creditVoiceKey(input: {
  creditsEnabled: boolean;
  provider: string;
  key: string | undefined;
}): { apiKey: string } | undefined {
  return input.creditsEnabled && input.provider === OPENROUTER_VOICE_PROVIDER_ID && input.key
    ? { apiKey: input.key }
    : undefined;
}

/** The organization whose credit pays for this person's voice, only while it is on credits. */
export async function creditOrganization(
  prisma: PrismaClient,
  scope: { userId: string; spaceId: string },
): Promise<string | undefined> {
  const membership = await organizationForMember(prisma, scope);
  if (!membership) return undefined;
  const account = await creditAccount(prisma, membership.organizationId);
  return account.mode === "credits" ? membership.organizationId : undefined;
}

export interface VoiceCharge {
  prisma: PrismaClient;
  organizationId: string;
  userId: string;
  spaceId: string;
}

/** Hold twice the catalog price of the text: the price may move, and the difference goes back. */
const SPEAK_HOLD_MARGIN = 2;
/**
 * A recording's length is not known from its bytes. Compressed speech runs from about 8 kbit/s, so
 * one second per kilobyte never undercounts a normal note, and a short one holds at least 30 s.
 */
const LISTEN_BYTES_PER_SECOND = 1000;
const LISTEN_MIN_SECONDS = 30;

export const speakHoldUsd = (chars: number) =>
  chars * OPENROUTER_TTS_USD_PER_CHAR * SPEAK_HOLD_MARGIN;

export const listenHoldUsd = (bytes: number) =>
  Math.max(LISTEN_MIN_SECONDS, bytes / LISTEN_BYTES_PER_SECOND) * OPENROUTER_STT_USD_PER_SECOND;

async function hold(charge: VoiceCharge, usd: number, model: string) {
  try {
    return await reserveModelCredits(charge.prisma, charge.organizationId, usd, {
      callId: `voice:${randomUUID()}`,
      userId: charge.userId,
      spaceId: charge.spaceId,
      provider: OPENROUTER_VOICE_PROVIDER_ID,
      model,
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Not enough model credits"))
      throw new VoiceAccountError(
        "VOICE_OUT_OF_CREDIT",
        "Not enough credit for voice. Add credits in Billing.",
      );
    throw error;
  }
}

/** A failed release leaves the hold for the reconciler to flag; it must not hide the real error. */
async function settleQuietly(charge: VoiceCharge, entryId: string, costUsd: number) {
  try {
    await settleModelCredits(charge.prisma, entryId, costUsd);
  } catch (error) {
    getLogger().warn("voice credit settlement failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Speaks on credit. TTS replies carry no cost, only a generation id, so the hold stays pending
 * with that id and the credit reconciler settles it at OpenRouter's real cost. Without an id the
 * catalog price settles it at once.
 */
export async function synthesizeOnCredits(
  charge: VoiceCharge,
  provider: VoiceProvider,
  request: VoiceSynthesizeRequest,
  context: AdapterContext,
): Promise<SpeechClip> {
  const entryId = await hold(charge, speakHoldUsd(request.text.length), OPENROUTER_TTS_MODEL);
  let clip: SpeechClip;
  try {
    clip = await provider.synthesize(request, context);
  } catch (error) {
    await settleQuietly(charge, entryId, 0);
    throw error;
  }
  const estimate = request.text.length * OPENROUTER_TTS_USD_PER_CHAR;
  if (!clip.providerRequestId) {
    await settleQuietly(charge, entryId, estimate);
    return clip;
  }
  try {
    await recordModelCreditReceipt(charge.prisma, entryId, {
      providerRequestId: clip.providerRequestId,
      inputTokens: null,
      outputTokens: null,
    });
  } catch (error) {
    getLogger().warn("voice credit receipt failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    await settleQuietly(charge, entryId, estimate);
  }
  return clip;
}

/** Listens on credit and settles at the cost the transcription reply reports. */
export async function transcribeOnCredits(
  charge: VoiceCharge,
  provider: VoiceProvider,
  request: VoiceTranscribeRequest,
  context: AdapterContext,
): Promise<VoiceTranscribeResult> {
  const held = listenHoldUsd(request.audio.byteLength);
  const entryId = await hold(charge, held, OPENROUTER_STT_MODEL);
  let result: VoiceTranscribeResult;
  try {
    if (!provider.transcribe) throw new Error("Voice cannot transcribe.");
    result = await provider.transcribe(request, context);
  } catch (error) {
    await settleQuietly(charge, entryId, 0);
    throw error;
  }
  if (result.costUsd === undefined) {
    // No reported cost: the hold stands in for it rather than letting the call go free.
    await settleQuietly(charge, entryId, held);
    return result;
  }
  try {
    await recordModelCreditReceipt(charge.prisma, entryId, {
      inputTokens: null,
      outputTokens: null,
      costUsd: result.costUsd,
      costSource: "provider-reported",
      usageSource: "provider-reported",
    });
  } catch (error) {
    getLogger().warn("voice credit receipt failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  await settleQuietly(charge, entryId, result.costUsd);
  return result;
}
