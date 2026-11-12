import { MAX_VOICE_AUDIO_BYTES, VOICE_RESPONSE_TIMEOUT_MS } from "@corvo/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Speaker } from "./tts.js";

const notices = vi.hoisted(() => ({
  announceLocalDownload: vi.fn(),
  announceLocalFallback: vi.fn(),
}));
const prepareRpc = vi.hoisted(() => vi.fn());

vi.mock("./voice-notices.js", () => notices);
vi.mock("./rpc.js", async (original) => ({
  ...(await original<typeof import("./rpc.js")>()),
  rpc: { voice: { prepare: prepareRpc } },
}));

afterEach(() => {
  notices.announceLocalDownload.mockClear();
  notices.announceLocalFallback.mockClear();
  prepareRpc.mockReset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubSelectedSpace(id: string) {
  const store = new Map<string, string>([["corvo:space-id", id]]);
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
  vi.stubGlobal("window", { localStorage });
  vi.stubGlobal("localStorage", localStorage);
  return (next: string) => store.set("corvo:space-id", next);
}

describe("Speaker", () => {
  it("interrupting before audio arrives leaves the speaker idle", async () => {
    const speaker = new Speaker();
    vi.spyOn(
      speaker as unknown as { prepare: () => Promise<string[]> },
      "prepare",
    ).mockImplementation(() => new Promise(() => undefined));
    const pending = speaker.speak("Hello there.", { messageId: "m1" });
    speaker.stop();
    await expect(pending).resolves.toBeUndefined();
    expect(speaker.state.status).toBe("idle");
  });

  it("does not report a failure for a request a newer one replaced", async () => {
    const speaker = new Speaker();
    let fail: (error: Error) => void = () => undefined;
    vi.spyOn(speaker as unknown as { prepare: () => Promise<string[]> }, "prepare")
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            fail = reject;
          }),
      )
      .mockResolvedValueOnce([]);
    const first = speaker.speak("First.", { messageId: "m1" });
    await speaker.speak("Second.", { messageId: "m2" });
    fail(new Error("Your voice provider is out of credit."));
    await expect(first).resolves.toBeUndefined();
    expect(speaker.state.error).toBeUndefined();
  });

  it("resolves with an error snapshot instead of rejecting", async () => {
    const speaker = new Speaker();
    vi.spyOn(
      speaker as unknown as { prepare: () => Promise<string[]> },
      "prepare",
    ).mockRejectedValue(new Error("ElevenLabs rejected that key."));
    await expect(speaker.speak("Hi there.")).resolves.toBe("ElevenLabs rejected that key.");
    expect(speaker.state.error).toBe("ElevenLabs rejected that key.");
  });

  it.each([
    { spaceId: undefined, expectedSpaceId: "space-support" },
    { spaceId: "space-edited", expectedSpaceId: "space-edited" },
  ])("keeps both speech requests in $expectedSpaceId", async ({ spaceId, expectedSpaceId }) => {
    const changeSelectedSpace = stubSelectedSpace("space-support");
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      blob: async () => new Blob(["audio"]),
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "Audio",
      class {
        src = "";
        onended: (() => void) | null = null;
        onerror: (() => void) | null = null;
        play() {
          queueMicrotask(() => this.onended?.());
          return Promise.resolve();
        }
        pause() {}
      },
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:voice");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    const speaker = new Speaker();
    const prepare = vi
      .spyOn(
        speaker as unknown as {
          prepare: (
            text: string,
            opts: unknown,
            signal: AbortSignal,
            spaceId: string | null,
          ) => Promise<string[]>;
        },
        "prepare",
      )
      .mockImplementation(async () => {
        changeSelectedSpace("space-other");
        return ["Hello."];
      });
    await speaker.speak("Hello.", { messageId: "m1", spaceId });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/voice/speak",
      expect.objectContaining({ credentials: "include" }),
    );
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("x-corvo-space-id")).toBe(expectedSpaceId);
    expect(headers.get("content-type")).toBe("application/json");
    expect(prepare.mock.calls[0]?.[3]).toBe(expectedSpaceId);
  });

  it("rejects oversized audio without waiting for response cancellation", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new ReadableStream({ cancel }), {
            headers: { "content-length": String(MAX_VOICE_AUDIO_BYTES + 1) },
          }),
      ),
    );
    const speaker = new Speaker();
    vi.spyOn(
      speaker as unknown as { prepare: () => Promise<string[]> },
      "prepare",
    ).mockResolvedValue(["Hello."]);

    await expect(speaker.speak("Hello.")).resolves.toBe("Voice response is too large.");

    expect(speaker.state.error).toBe("Voice response is too large.");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    ["VOICE_OUT_OF_CREDIT", 402, "Your voice provider is out of credit."],
    ["VOICE_KEY_REJECTED", 403, "Your voice provider key was rejected."],
  ])("shows its own copy for %s", async (code, status, copy) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "Insufficient API credit at fish.audio", code }), {
            status,
          }),
      ),
    );
    const speaker = new Speaker();
    vi.spyOn(
      speaker as unknown as { prepare: () => Promise<string[]> },
      "prepare",
    ).mockResolvedValue(["Hello."]);

    await expect(speaker.speak("Hello.")).resolves.toBe(copy);

    expect(speaker.state.error).toBe(copy);
  });

  it("times out while a voice response body is stalled", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              pull: () => new Promise<void>(() => undefined),
            }),
          ),
      ),
    );
    const speaker = new Speaker();
    vi.spyOn(
      speaker as unknown as { prepare: () => Promise<string[]> },
      "prepare",
    ).mockResolvedValue(["Hello."]);

    const pending = speaker.speak("Hello.");
    await vi.advanceTimersByTimeAsync(VOICE_RESPONSE_TIMEOUT_MS);
    await pending;

    expect(speaker.state.error).toBe("Voice request timed out.");
  });

  describe("with the voices of this computer", () => {
    function playableAudio() {
      vi.stubGlobal(
        "Audio",
        class {
          src = "";
          onended: (() => void) | null = null;
          onerror: (() => void) | null = null;
          play() {
            queueMicrotask(() => this.onended?.());
            return Promise.resolve();
          }
          pause() {}
        },
      );
      vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:voice");
      vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    }

    it("waits for the voice to download, says so once, and speaks the reply when it is there", async () => {
      vi.useFakeTimers();
      stubSelectedSpace("space-1");
      playableAudio();
      const fetchMock = vi.fn(async () => new Response(new Blob(["audio"])));
      vi.stubGlobal("fetch", fetchMock);
      prepareRpc
        .mockResolvedValueOnce({
          ready: true,
          utterances: [],
          preparing: { sizeBytes: 67_000_000 },
        })
        .mockResolvedValueOnce({
          ready: true,
          utterances: [],
          preparing: { sizeBytes: 67_000_000 },
        })
        .mockResolvedValue({ ready: true, utterances: ["Olá."] });
      const speaker = new Speaker();
      const done = speaker.speak("Olá.", { language: "pt" });
      expect(speaker.state.status).toBe("preparing");
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(2000);
      await done;
      expect(prepareRpc).toHaveBeenCalledTimes(3);
      expect(notices.announceLocalDownload).toHaveBeenCalledWith("speak", 67_000_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(speaker.state.status).toBe("idle");
    });

    it("stops asking when the reply is cancelled while the voice downloads", async () => {
      vi.useFakeTimers();
      stubSelectedSpace("space-1");
      prepareRpc.mockResolvedValue({ ready: true, utterances: [], preparing: { sizeBytes: 1 } });
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const speaker = new Speaker();
      const done = speaker.speak("Hello.");
      await vi.advanceTimersByTimeAsync(0);
      speaker.stop();
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(done).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(prepareRpc.mock.calls.length).toBeLessThanOrEqual(2);
    });

    it("sends the language of the reply, and says once that this computer's voice read it", async () => {
      stubSelectedSpace("space-1");
      playableAudio();
      const fetchMock = vi.fn(
        async (_url: string, _init?: RequestInit) =>
          new Response(new Blob(["audio"]), { headers: { "x-voice-fallback": "local" } }),
      );
      vi.stubGlobal("fetch", fetchMock);
      prepareRpc.mockResolvedValue({ ready: true, utterances: ["Hola."] });
      await new Speaker().speak("Hola.", {
        language: "es",
        provider: "local",
        voiceId: "voice-es",
      });
      expect(prepareRpc.mock.calls[0]?.[0]).toMatchObject({
        language: "es",
        provider: "local",
        voiceId: "voice-es",
      });
      expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
        language: "es",
        provider: "local",
        voiceId: "voice-es",
      });
      expect(notices.announceLocalFallback).toHaveBeenCalledTimes(1);
    });

    it("does not announce a fallback for a reply the selected voice read", async () => {
      stubSelectedSpace("space-1");
      playableAudio();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(new Blob(["audio"]))),
      );
      prepareRpc.mockResolvedValue({ ready: true, utterances: ["Hi."] });
      await new Speaker().speak("Hi.");
      expect(notices.announceLocalFallback).not.toHaveBeenCalled();
    });
  });
});
