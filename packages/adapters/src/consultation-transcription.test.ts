import type { VoiceProvider } from "@corvo/adapter-kit";
import type { Actor } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import * as db from "@corvo/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AudioTranscriptionDeps, transcribeAudioBytes } from "./audio-transcription.js";

const actor = { userId: "owner-1", spaceId: "space-1" } as Actor;
const audio = new Uint8Array(30_000).fill(3);

function fixture(provider: Partial<VoiceProvider>) {
  const deps: AudioTranscriptionDeps = {
    prisma: {} as PrismaClient,
    artifacts: { get: vi.fn() },
    loadVoiceCredential: vi.fn(async () => null),
    hasConsent: vi.fn(async () => true),
    voiceCredits: { apiKey: "deployment-key", metered: true },
    createProvider: (() => provider) as never,
  };
  return deps;
}

afterEach(() => vi.restoreAllMocks());

function onCredits() {
  vi.spyOn(db, "organizationForMember").mockResolvedValue({ organizationId: "org-1" } as never);
  vi.spyOn(db, "creditAccount").mockResolvedValue({ mode: "credits" } as never);
  return {
    reserve: vi.spyOn(db, "reserveModelCredits").mockResolvedValue("entry-1" as never),
    settle: vi.spyOn(db, "settleModelCredits").mockResolvedValue(undefined as never),
    receipt: vi.spyOn(db, "recordModelCreditReceipt").mockResolvedValue(undefined as never),
  };
}

describe("transcribeAudioBytes", () => {
  it("transcribes in memory on the deployment's speech key and charges the customer's credit", async () => {
    const charges = onCredits();
    const transcribe = vi.fn(async () => ({ text: " Bom dia. ", language: "pt", costUsd: 0.02 }));
    const outcome = await transcribeAudioBytes(fixture({ transcribe }), {
      actor,
      audio,
      mimeType: "audio/webm",
      language: "pt",
    });
    expect(outcome).toEqual({ status: "transcribed", text: "Bom dia.", language: "pt" });
    expect(transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ audio, mimeType: "audio/webm", apiKey: "deployment-key" }),
      expect.anything(),
    );
    expect(charges.reserve).toHaveBeenCalledWith(
      expect.anything(),
      "org-1",
      expect.any(Number),
      expect.objectContaining({ spaceId: "space-1", userId: "owner-1" }),
    );
    expect(charges.settle).toHaveBeenCalledWith(expect.anything(), "entry-1", 0.02);
  });

  it("refuses with the used-up reason when the credit cannot cover the hold", async () => {
    const charges = onCredits();
    charges.reserve.mockRejectedValue(new Error("Not enough model credits. Add credits."));
    const transcribe = vi.fn();
    const outcome = await transcribeAudioBytes(fixture({ transcribe }), {
      actor,
      audio,
      mimeType: "audio/webm",
    });
    expect(outcome).toEqual({ status: "failed", reason: "credits-used-up" });
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("releases the hold and reports a provider failure", async () => {
    const charges = onCredits();
    const transcribe = vi.fn(async () => {
      throw new Error("provider down");
    });
    const outcome = await transcribeAudioBytes(fixture({ transcribe }), {
      actor,
      audio,
      mimeType: "audio/webm",
    });
    expect(outcome).toEqual({ status: "failed", reason: "provider-failed" });
    expect(charges.settle).toHaveBeenCalledWith(expect.anything(), "entry-1", 0);
  });

  it("reports silence and empty audio", async () => {
    onCredits();
    const transcribe = vi.fn(async () => ({ text: "  ", costUsd: 0 }));
    await expect(
      transcribeAudioBytes(fixture({ transcribe }), { actor, audio, mimeType: "audio/webm" }),
    ).resolves.toEqual({ status: "failed", reason: "no-speech" });
    await expect(
      transcribeAudioBytes(fixture({ transcribe }), {
        actor,
        audio: new Uint8Array(),
        mimeType: "audio/webm",
      }),
    ).resolves.toEqual({ status: "failed", reason: "unreadable" });
  });
});
