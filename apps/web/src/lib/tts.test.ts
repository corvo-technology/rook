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

describe("Speaker.speakStream", () => {
  /** Each speak request waits for the test to answer it; each clip plays until the test ends it. */
  function harness() {
    stubSelectedSpace("space-1");
    prepareRpc.mockResolvedValue({ ready: true, utterances: [] });
    const requests: Array<{
      text: string;
      signal: AbortSignal;
      answer: (response: Response) => void;
    }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            const signal = init?.signal as AbortSignal;
            signal.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
            requests.push({
              text: (JSON.parse(String(init?.body)) as { text: string }).text,
              signal,
              answer: resolve,
            });
          }),
      ),
    );
    const playing: Array<{ blob: string; end: () => void }> = [];
    const blobs = new Map<string, string>();
    let count = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      const url = `blob:${count++}`;
      blobs.set(url, (blob as Blob & { label?: string }).label ?? "");
      return url;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.stubGlobal(
      "Audio",
      class {
        onended: (() => void) | null = null;
        onerror: (() => void) | null = null;
        paused = false;
        constructor(public src: string) {}
        play() {
          playing.push({ blob: this.src, end: () => this.onended?.() });
          return Promise.resolve();
        }
        pause() {
          this.paused = true;
        }
      },
    );
    const answer = (index: number) =>
      requests[index]?.answer(new Response(new Blob([requests[index]?.text ?? ""])));
    // Reading a response body takes several turns of the event loop.
    const settle = async () => {
      for (let turn = 0; turn < 30; turn += 1) await vi.advanceTimersByTimeAsync(0);
    };
    return { requests, playing, answer, settle };
  }

  it("plays what is queued in order and renders one clip ahead of the one playing", async () => {
    vi.useFakeTimers();
    const { requests, playing, answer, settle } = harness();
    const speaker = new Speaker();
    const stream = speaker.speakStream({ botId: "bot" });
    for (const text of ["One.", "Two.", "Three.", "Four."]) stream.push(text);
    await settle();
    expect(requests.map((request) => request.text)).toEqual(["One.", "Two."]);

    answer(1);
    await settle();
    // The second clip is ready, but the first has not been heard yet.
    expect(playing).toHaveLength(0);
    answer(0);
    await settle();
    expect(playing).toHaveLength(1);
    expect(speaker.state).toMatchObject({ status: "speaking", caption: "One." });

    playing[0]?.end();
    await settle();
    expect(requests.map((request) => request.text)).toEqual(["One.", "Two.", "Three."]);
    expect(speaker.state).toMatchObject({ status: "speaking", caption: "Two." });
    expect(playing).toHaveLength(2);

    answer(2);
    playing[1]?.end();
    await settle();
    expect(speaker.state.caption).toBe("Three.");
    answer(3);
    playing[2]?.end();
    await settle();
    expect(speaker.state.caption).toBe("Four.");
    expect(requests.map((request) => request.text)).toEqual(["One.", "Two.", "Three.", "Four."]);
  });

  it("speaks the first sentence while the reply is still being written, and stays quiet between sentences", async () => {
    vi.useFakeTimers();
    const { playing, answer, settle } = harness();
    const speaker = new Speaker();
    const stream = speaker.speakStream();
    stream.push("First sentence.");
    await settle();
    answer(0);
    await settle();
    expect(speaker.state.status).toBe("speaking");
    playing[0]?.end();
    await settle();
    // Nothing is queued and the reply is not over: the speaker must not report idle.
    expect(speaker.state.status).toBe("speaking");
    expect(stream.closed).toBe(false);

    stream.push("Second sentence.");
    await settle();
    answer(1);
    await settle();
    expect(speaker.state.caption).toBe("Second sentence.");
    playing[1]?.end();
    stream.end();
    await expect(stream.done).resolves.toBeUndefined();
    expect(speaker.state.status).toBe("idle");
  });

  it("goes idle after the last sentence once the reply is over", async () => {
    vi.useFakeTimers();
    const { playing, answer, settle } = harness();
    const speaker = new Speaker();
    const stream = speaker.speakStream();
    stream.push("Only one.");
    stream.end();
    await settle();
    answer(0);
    await settle();
    playing[0]?.end();
    await expect(stream.done).resolves.toBeUndefined();
    expect(speaker.state.status).toBe("idle");
    expect(stream.closed).toBe(true);
  });

  it("aborts queued and in-flight requests, and stops the audio, when cancelled", async () => {
    vi.useFakeTimers();
    const { requests, playing, answer, settle } = harness();
    const speaker = new Speaker();
    const stream = speaker.speakStream();
    stream.push("One.");
    stream.push("Two.");
    stream.push("Three.");
    await settle();
    answer(0);
    await settle();
    expect(playing).toHaveLength(1);

    stream.cancel();
    await settle();
    expect(requests[1]?.signal.aborted).toBe(true);
    expect(requests).toHaveLength(2);
    expect(stream.closed).toBe(true);
    expect(speaker.state.status).toBe("idle");
    stream.push("Four.");
    await settle();
    expect(requests).toHaveLength(2);
    await expect(stream.done).resolves.toBeUndefined();
  });

  it("is cancelled by stop, which is what hanging up and cutting in call", async () => {
    vi.useFakeTimers();
    const { requests, settle } = harness();
    const speaker = new Speaker();
    const stream = speaker.speakStream();
    stream.push("One.");
    stream.push("Two.");
    await settle();
    speaker.stop();
    await settle();
    expect(requests.every((request) => request.signal.aborted)).toBe(true);
    expect(stream.closed).toBe(true);
  });

  it("is replaced by the next thing to speak without failing", async () => {
    vi.useFakeTimers();
    const { requests, settle } = harness();
    const speaker = new Speaker();
    const stream = speaker.speakStream();
    stream.push("One.");
    await settle();
    const next = speaker.speakStream();
    await settle();
    expect(requests[0]?.signal.aborted).toBe(true);
    expect(stream.closed).toBe(true);
    expect(next.closed).toBe(false);
    await expect(stream.done).resolves.toBeUndefined();
    expect(speaker.state.error).toBeUndefined();
  });

  it("skips a sentence that fails and speaks the rest of the reply", async () => {
    vi.useFakeTimers();
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const { requests, playing, answer, settle } = harness();
    const speaker = new Speaker();
    const stream = speaker.speakStream();
    for (const text of ["One.", "Two.", "Three."]) stream.push(text);
    await settle();
    answer(0);
    await settle();
    playing[0]?.end();
    requests[1]?.answer(new Response(JSON.stringify({ error: "Busy" }), { status: 502 }));
    await settle();
    answer(2);
    await settle();
    expect(speaker.state).toMatchObject({ status: "speaking", caption: "Three." });
    playing[1]?.end();
    stream.end();
    await expect(stream.done).resolves.toBeUndefined();
    expect(speaker.state).toEqual({ status: "idle" });
    const stages = debug.mock.calls
      .filter(([label]) => label === "[voice] sentence")
      .map(([, info]) => `${(info as { text: string }).text}:${(info as { stage: string }).stage}`);
    expect(stages).toEqual(
      expect.arrayContaining(["One.:sent", "One.:received", "One.:played", "Two.:failed"]),
    );
  });

  it("reports a failure only when nothing of the reply could be spoken", async () => {
    vi.useFakeTimers();
    const { requests, playing, answer, settle } = harness();
    const speaker = new Speaker();
    const stream = speaker.speakStream();
    stream.push("One.");
    stream.push("Two.");
    await settle();
    requests[0]?.answer(
      new Response(JSON.stringify({ error: "No credit", code: "VOICE_OUT_OF_CREDIT" }), {
        status: 402,
      }),
    );
    await settle();
    answer(1);
    await settle();
    playing[0]?.end();
    stream.end();
    await expect(stream.done).resolves.toBeUndefined();
    expect(speaker.state.error).toBeUndefined();

    const silent = new Speaker();
    const second = silent.speakStream();
    second.push("Only.");
    await settle();
    requests[2]?.answer(new Response("{}", { status: 502 }));
    await settle();
    second.end();
    await expect(second.done).resolves.toEqual(expect.any(String));
    expect(silent.state.status).toBe("idle");
    expect(silent.state.error).toEqual(expect.any(String));
  });

  it("skips a clip the browser refuses to play and still speaks the next", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const { requests, playing, answer, settle } = harness();
    let first = true;
    vi.stubGlobal(
      "Audio",
      class {
        onended: (() => void) | null = null;
        onerror: (() => void) | null = null;
        src = "";
        play() {
          if (first) {
            first = false;
            return Promise.reject(new DOMException("blocked", "NotAllowedError"));
          }
          playing.push({ blob: this.src, end: () => this.onended?.() });
          return Promise.resolve();
        }
        pause() {}
      },
    );
    const speaker = new Speaker();
    const stream = speaker.speakStream();
    stream.push("One.");
    stream.push("Two.");
    await settle();
    answer(0);
    answer(1);
    await settle();
    expect(requests).toHaveLength(2);
    expect(playing).toHaveLength(1);
    expect(speaker.state).toMatchObject({ status: "speaking", caption: "Two." });
    playing[0]?.end();
    stream.end();
    await expect(stream.done).resolves.toBeUndefined();
  });

  it("plays every clip on the one element that the start of the call unlocked", async () => {
    vi.useFakeTimers();
    const { answer, settle } = harness();
    const created: unknown[] = [];
    const played: string[] = [];
    vi.stubGlobal(
      "Audio",
      class {
        onended: (() => void) | null = null;
        onerror: (() => void) | null = null;
        src = "";
        constructor() {
          created.push(this);
        }
        play() {
          played.push(this.src);
          if (!this.src.startsWith("data:")) queueMicrotask(() => this.onended?.());
          return Promise.resolve();
        }
        pause() {}
      },
    );
    const speaker = new Speaker();
    speaker.unlock();
    const stream = speaker.speakStream();
    stream.push("One.");
    stream.push("Two.");
    await settle();
    answer(0);
    answer(1);
    await settle();
    stream.end();
    await settle();
    expect(created).toHaveLength(1);
    expect(played[0]).toMatch(/^data:audio\/wav/);
    expect(played).toHaveLength(3);
  });

  it("fails before any audio when there is no voice to speak with", async () => {
    vi.useFakeTimers();
    const { playing, answer, settle } = harness();
    prepareRpc.mockResolvedValue({ ready: false, utterances: [] });
    const speaker = new Speaker();
    const stream = speaker.speakStream();
    stream.push("One.");
    await settle();
    answer(0);
    await expect(stream.done).resolves.toMatch(/voice provider key/);
    expect(playing).toHaveLength(0);
    expect(speaker.state.status).toBe("idle");
  });

  it("logs how long the first audio took", async () => {
    vi.useFakeTimers();
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const { answer, settle } = harness();
    const speaker = new Speaker();
    const stream = speaker.speakStream({ turnStartedAt: performance.now() });
    stream.push("One.");
    await vi.advanceTimersByTimeAsync(250);
    answer(0);
    await settle();
    expect(debug).toHaveBeenCalledWith(
      "[voice] time to first audio",
      expect.objectContaining({ sinceTurnMs: 250, sinceFirstTextMs: 250 }),
    );
    stream.cancel();
  });
});
