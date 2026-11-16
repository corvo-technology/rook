import type { AdapterContext, SpeechClip, VoiceProvider } from "@corvo/adapter-kit";
import { VoiceAccountError, VoiceProviderError } from "@corvo/adapter-kit";
import * as logging from "@corvo/logging";
import { describe, expect, it, vi } from "vitest";
import { synthesizeResilient } from "./voice-resilience.js";

const context = { signal: new AbortController().signal } as AdapterContext;
const request = { text: "Olá", voiceId: "Kore", apiKey: "deploy-key" };
const clip: SpeechClip = { bytes: new Uint8Array([1]), mimeType: "audio/wav" };
const fast = { backoffMs: 1 };

function provider(...results: Array<SpeechClip | Error>) {
  const synthesize = vi.fn(async () => {
    const next = results.shift() ?? new Error("exhausted");
    if (next instanceof Error) throw next;
    return next;
  });
  return { synthesize, voice: { synthesize } as unknown as VoiceProvider };
}

const timeout = () => new VoiceProviderError("timeout", 502, "Request timed out");

describe("synthesizeResilient", () => {
  it("asks once more after a passing fault and returns that audio", async () => {
    const { synthesize, voice } = provider(timeout(), clip);
    await expect(synthesizeResilient(voice, request, context, fast)).resolves.toBe(clip);
    expect(synthesize).toHaveBeenCalledTimes(2);
  });

  it("retries a network failure that carries no status", async () => {
    const { synthesize, voice } = provider(new TypeError("fetch failed"), clip);
    await synthesizeResilient(voice, request, context, fast);
    expect(synthesize).toHaveBeenCalledTimes(2);
  });

  it("tries the fallback model after two failures, and only then", async () => {
    const { synthesize, voice } = provider(timeout(), new VoiceProviderError("busy", 429), clip);
    await synthesizeResilient(voice, request, context, { ...fast, fallbackModel: "vendor/backup" });
    expect(synthesize).toHaveBeenCalledTimes(3);
    const models = synthesize.mock.calls.map((call) => (call as unknown[])[0]);
    expect(models.map((sent) => (sent as { model?: string }).model)).toEqual([
      undefined,
      undefined,
      "vendor/backup",
    ]);
  });

  it("gives up after three tries and throws the last error", async () => {
    const last = new VoiceProviderError("still down", 503);
    const { synthesize, voice } = provider(timeout(), timeout(), last, clip);
    await expect(
      synthesizeResilient(voice, request, context, { ...fast, fallbackModel: "vendor/backup" }),
    ).rejects.toBe(last);
    expect(synthesize).toHaveBeenCalledTimes(3);
  });

  it("makes only two tries without a fallback", async () => {
    const { synthesize, voice } = provider(timeout(), timeout(), clip);
    await expect(synthesizeResilient(voice, request, context, fast)).rejects.toThrow("timeout");
    expect(synthesize).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["a plain timeout message", new Error("Request timed out")],
    ["a TimeoutError", new DOMException("The operation timed out.", "TimeoutError")],
    ["an attempt aborted by its own clock", new DOMException("aborted", "AbortError")],
    [
      "a timeout the provider reports inside a refusal",
      new VoiceProviderError("no", 400, "Request timed out"),
    ],
  ])("asks again after %s", async (_name, failure) => {
    const { synthesize, voice } = provider(failure, clip);
    await expect(synthesizeResilient(voice, request, context, fast)).resolves.toBe(clip);
    expect(synthesize).toHaveBeenCalledTimes(2);
  });

  it("logs the name and cause of a failure so the next one can be told apart", async () => {
    const warn = vi.fn();
    vi.spyOn(logging, "getLogger").mockReturnValue({ warn } as unknown as ReturnType<
      typeof logging.getLogger
    >);
    const failure = new Error("Request timed out", { cause: new Error("socket hang up") });
    failure.name = "TimeoutError";
    const { voice } = provider(failure, clip);
    await synthesizeResilient(voice, request, context, fast);
    expect(warn).toHaveBeenCalledWith(
      "voice provider failed to speak",
      expect.objectContaining({
        name: "TimeoutError",
        cause: "Error: socket hang up",
        callerAborted: false,
      }),
    );
  });

  it("does not repeat a refusal", async () => {
    for (const refusal of [
      new VoiceProviderError("bad key", 401),
      new VoiceProviderError("bad request", 400),
      new VoiceAccountError("VOICE_CREDITS_USED_UP", "Add credits"),
    ]) {
      const { synthesize, voice } = provider(refusal, clip);
      await expect(synthesizeResilient(voice, request, context, fast)).rejects.toBe(refusal);
      expect(synthesize).toHaveBeenCalledTimes(1);
    }
  });

  it("stops when the caller hung up", async () => {
    const hangup = new AbortController();
    const { synthesize, voice } = provider(timeout(), clip);
    synthesize.mockImplementationOnce(async () => {
      hangup.abort();
      throw timeout();
    });
    await expect(
      synthesizeResilient(voice, { ...request, signal: hangup.signal }, context, fast),
    ).rejects.toThrow("timeout");
    expect(synthesize).toHaveBeenCalledTimes(1);
  });

  it("never runs past its budget", async () => {
    const synthesize = vi.fn(
      (req: { signal?: AbortSignal }) =>
        new Promise<SpeechClip>((_resolve, reject) => {
          req.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const voice = { synthesize } as unknown as VoiceProvider;
    const started = Date.now();
    await expect(
      synthesizeResilient(voice, request, context, { budgetMs: 60, backoffMs: 1 }),
    ).rejects.toThrow("aborted");
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(synthesize.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
