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

  it("keeps a voice it knows", () => {
    expect(openRouterVoiceId("Puck")).toBe("Puck");
    expect(openRouterVoiceId(undefined)).toBe(OPENROUTER_DEFAULT_VOICE);
  });

  it("transcribes with the recording's format and language and reads the reported cost", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ text: " oi ", usage: { seconds: 3, cost: 0.0002 } }));
    const result = await new OpenRouterVoiceProvider(fetcher).transcribe(
      {
        audio: new Uint8Array([1, 2]),
        mimeType: "audio/webm;codecs=opus",
        language: "pt-BR",
        apiKey: "deploy-key",
      },
      context,
    );
    expect(result).toEqual({ text: "oi", costUsd: 0.0002 });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/audio/transcriptions");
    expect(JSON.parse(String(init.body))).toEqual({
      model: OPENROUTER_STT_MODEL,
      input_audio: { data: "AQI=", format: "webm" },
      language: "pt",
    });
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
