import type { AdapterContext } from "@corvo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import {
  OPENROUTER_DEFAULT_VOICE,
  OPENROUTER_STT_MODEL,
  OPENROUTER_TTS_MODEL,
  OpenRouterVoiceProvider,
  openRouterVoiceId,
} from "./openrouter-voice.js";

const context = { signal: new AbortController().signal } as AdapterContext;

describe("OpenRouterVoiceProvider", () => {
  it("speaks through OpenRouter and reports the generation id", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3, 4]), {
        headers: { "content-type": "audio/pcm", "x-generation-id": "gen-1" },
      }),
    );
    const clip = await new OpenRouterVoiceProvider(fetcher).synthesize(
      { text: "Olá", voiceId: "a-voice-from-another-provider", apiKey: "deploy-key" },
      context,
    );
    expect(clip.mimeType).toBe("audio/wav");
    expect(clip.providerRequestId).toBe("gen-1");
    // A WAV header for 24 kHz mono 16-bit, then the samples untouched.
    expect(new TextDecoder().decode(clip.bytes.slice(0, 4))).toBe("RIFF");
    expect(new DataView(clip.bytes.buffer).getUint32(24, true)).toBe(24_000);
    expect([...clip.bytes.slice(44)]).toEqual([1, 2, 3, 4]);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/audio/speech");
    expect(init.headers).toMatchObject({ authorization: "Bearer deploy-key" });
    expect(JSON.parse(String(init.body))).toEqual({
      model: OPENROUTER_TTS_MODEL,
      input: "Olá",
      voice: OPENROUTER_DEFAULT_VOICE,
      response_format: "pcm",
    });
  });

  it("reports the status and a clean reason when OpenRouter refuses, never the key", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          {
            error: {
              message: "Provider timed out for deploy-key sk-or-v1-abcdef123456",
              code: 502,
            },
          },
          { status: 502 },
        ),
      );
    const error = await new OpenRouterVoiceProvider(fetcher)
      .synthesize({ text: "Olá", voiceId: "Kore", apiKey: "deploy-key" }, context)
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      name: "VoiceProviderError",
      status: 502,
      detail: "Provider timed out for [key] [key]",
    });
  });

  it("speaks with the model it is asked for", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(new Uint8Array([1, 2]), { headers: { "content-type": "audio/pcm" } }),
      );
    await new OpenRouterVoiceProvider(fetcher).synthesize(
      { text: "Olá", voiceId: "Kore", apiKey: "k", model: "vendor/backup" },
      context,
    );
    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).model).toBe("vendor/backup");
  });

  it("keeps a voice it knows", () => {
    expect(openRouterVoiceId("Puck")).toBe("Puck");
    expect(openRouterVoiceId(undefined)).toBe(OPENROUTER_DEFAULT_VOICE);
  });

  it("lets Whisper hear the language when none is given, and reports it", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        text: " oi, tudo bem? ",
        language: "portuguese",
        usage: { seconds: 3, cost: 0.0002 },
      }),
    );
    const result = await new OpenRouterVoiceProvider(fetcher).transcribe(
      {
        audio: new Uint8Array([1, 2]),
        mimeType: "audio/webm;codecs=opus",
        apiKey: "deploy-key",
      },
      context,
    );
    expect(result).toEqual({ text: "oi, tudo bem?", language: "pt", costUsd: 0.0002 });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/audio/transcriptions");
    expect(JSON.parse(String(init.body))).toEqual({
      model: OPENROUTER_STT_MODEL,
      input_audio: { data: "AQI=", format: "webm" },
      response_format: "verbose_json",
    });
  });

  it("forces the language it is told the person speaks", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ text: "oi", language: "pt" }));
    await new OpenRouterVoiceProvider(fetcher).transcribe(
      { audio: new Uint8Array([1]), mimeType: "audio/wav", language: "pt-BR", apiKey: "k" },
      context,
    );
    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).language).toBe("pt");
  });

  it("keeps a language code a provider already gives", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ text: "hola", language: "es" }));
    const result = await new OpenRouterVoiceProvider(fetcher).transcribe(
      { audio: new Uint8Array([1]), mimeType: "audio/wav", apiKey: "k" },
      context,
    );
    expect(result).toEqual({ text: "hola", language: "es" });
  });

  it("leaves the cost out when the reply has none", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ text: "oi" }));
    const result = await new OpenRouterVoiceProvider(fetcher).transcribe(
      { audio: new Uint8Array([1]), mimeType: "audio/wav", apiKey: "k" },
      context,
    );
    expect(result).toEqual({ text: "oi" });
  });

  it("fails without echoing the provider's reply or the key", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({ error: { message: "key deploy-key is out" } }, { status: 402 }),
      );
    const provider = new OpenRouterVoiceProvider(fetcher);
    const error = await provider
      .synthesize({ text: "x", voiceId: "", apiKey: "deploy-key" }, context)
      .catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("deploy-key");
  });
});
