// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import source from "../../public/sdk-assist.js?raw";

const ORIGIN = "https://app.corvo.test";
const CONSULTATIONS = "/api/partner/embed/consultations";

interface RookGlobal {
  configure(options: Record<string, unknown>): void;
  ask(options: Record<string, unknown>): Promise<{ result: Record<string, unknown> }>;
  recorder(options: Record<string, unknown>): {
    state: string;
    start(): Promise<void>;
    pause(): void;
    resume(): void;
    stop(): Promise<void>;
    cancel(): Promise<void>;
  };
  RookError: new (code: string, status: number) => Error & { code: string; status: number };
}
const rook = () => (window as unknown as { Rook: RookGlobal }).Rook;

interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fake Rook: the partner's session route, the code exchange, ask and the recording API. */
function server(
  over: {
    ask?: (call: Call) => Response;
    chunk?: (call: Call, n: number) => Response;
    status?: () => Record<string, unknown>;
    expiresIn?: number;
  } = {},
) {
  const calls: Call[] = [];
  let tokens = 0;
  let chunkTries = 0;
  const handler = async (url: string, init: RequestInit = {}) => {
    const path = url.startsWith(ORIGIN) ? url.slice(ORIGIN.length) : url;
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    const raw = init.body;
    const body =
      typeof raw === "string" ? JSON.parse(raw) : raw instanceof Blob ? { blob: raw.size } : raw;
    const call: Call = { method: init.method ?? "GET", path, headers, body };
    calls.push(call);
    if (path === "/corvo/session") return Response.json({ code: `code-${++tokens}` });
    if (path === "/api/partner/embed/exchange") {
      return Response.json({
        token: `token-${tokens}`,
        expiresAt: new Date(Date.now() + (over.expiresIn ?? 600_000)).toISOString(),
      });
    }
    if (path === "/api/partner/embed/ask") {
      return over.ask?.(call) ?? Response.json({ result: { chiefComplaint: "Dor" } });
    }
    if (path === CONSULTATIONS) return Response.json({ consultationId: "cons-1" });
    const chunk = path.match(/\/chunks\/(\d+)$/);
    if (chunk) return over.chunk?.(call, ++chunkTries) ?? Response.json({ ok: true });
    if (path.endsWith("/finish")) return Response.json({ state: "processing" });
    if (call.method === "DELETE") return Response.json({ ok: true });
    return Response.json(
      over.status?.() ?? {
        state: "drafted",
        transcript: [{ speaker: "professional", startMs: 0, text: "Bom dia." }],
        note: { chiefComplaint: "Enxaqueca" },
      },
    );
  };
  return { calls, handler };
}

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported = (type: string) => type === "audio/webm;codecs=opus";
  state = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  timeslice = 0;
  constructor(
    readonly stream: unknown,
    readonly options?: { mimeType: string },
  ) {
    FakeRecorder.instances.push(this);
  }
  start(timeslice: number) {
    this.state = "recording";
    this.timeslice = timeslice;
  }
  pause() {
    this.state = "paused";
  }
  resume() {
    this.state = "recording";
  }
  emit(...bytes: number[]) {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)], { type: "audio/webm" }) });
  }
  stop() {
    this.state = "inactive";
    this.emit(9);
    this.onstop?.();
  }
}

function fakeMic(options: { deny?: boolean } = {}) {
  const tracks = [{ stop: vi.fn() }];
  return {
    tracks,
    mediaDevices: {
      getUserMedia: vi.fn(async () => {
        if (options.deny) throw new Error("NotAllowedError");
        return { getTracks: () => tracks };
      }),
    },
  };
}

let fake: ReturnType<typeof server>;
const load = (over: Parameters<typeof server>[0] = {}) => {
  fake = server(over);
  vi.stubGlobal("fetch", vi.fn(fake.handler));
  rook().configure({ sessionUrl: "/corvo/session", origin: ORIGIN });
};

beforeEach(() => {
  FakeRecorder.instances = [];
  // biome-ignore lint/security/noGlobalEval: loads the built script the way a page would
  if (!(window as unknown as { Rook?: RookGlobal }).Rook?.ask) window.eval(source);
  load();
});
afterEach(() => vi.unstubAllGlobals());

describe("Rook.ask", () => {
  it("signs in with a code from the partner's route, then asks with the bearer token", async () => {
    const { result } = await rook().ask({ preset: "evolution", context: { notes: "n" } });
    expect(result).toEqual({ chiefComplaint: "Dor" });
    expect(fake.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /corvo/session",
      "POST /api/partner/embed/exchange",
      "POST /api/partner/embed/ask",
    ]);
    expect(fake.calls[1]?.body).toEqual({ code: "code-1" });
    const ask = fake.calls[2];
    expect(ask?.headers.authorization).toBe("Bearer token-1");
    expect(ask?.body).toEqual({ preset: "evolution", context: { notes: "n" } });
    // The same session serves the next call.
    await rook().ask({ task: "t" });
    expect(fake.calls.filter((c) => c.path === "/corvo/session")).toHaveLength(1);
  });

  it("renews a refused token once, and a token about to expire before it is used", async () => {
    let refused = false;
    load({
      ask: () => {
        if (refused) return Response.json({ result: { ok: true } });
        refused = true;
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      },
    });
    await expect(rook().ask({ task: "t" })).resolves.toEqual({ result: { ok: true } });
    expect(fake.calls.filter((c) => c.path === "/corvo/session")).toHaveLength(2);

    load({ expiresIn: 1000 });
    await rook().ask({ task: "t" });
    await rook().ask({ task: "t" });
    expect(fake.calls.filter((c) => c.path === "/corvo/session")).toHaveLength(2);
  });

  it("rejects with the server's error code", async () => {
    load({ ask: () => Response.json({ error: "invalid_output" }, { status: 422 }) });
    await expect(rook().ask({ task: "t" })).rejects.toMatchObject({
      name: "RookError",
      code: "invalid_output",
      status: 422,
    });
  });

  it("says so when there is no session route to sign in with", async () => {
    rook().configure({ sessionUrl: null, origin: ORIGIN });
    await expect(rook().ask({ task: "t" })).rejects.toMatchObject({ code: "no_session" });
  });

  it("streams the text as it is written and resolves with the validated result", async () => {
    const sse = [
      'event: delta\ndata: {"text":"{\\"chief"}\n\n',
      "event: retry\ndata: {}\n\n",
      'event: delta\ndata: {"text":"ok"}\n\n',
      'event: result\ndata: {"result":{"chiefComplaint":"Tosse"}}\n\n',
    ].join("");
    load({
      ask: (call) => {
        expect((call.body as { stream: boolean }).stream).toBe(true);
        return new Response(sse, { headers: { "content-type": "text/event-stream" } });
      },
    });
    const seen: string[] = [];
    const { result } = await rook().ask({
      task: "t",
      onText: (_piece: string, whole: string) => seen.push(whole),
    });
    expect(result).toEqual({ chiefComplaint: "Tosse" });
    // A retry starts the text over.
    expect(seen).toEqual(['{"chief', "ok"]);
  });

  it("rejects when the stream ends in an error", async () => {
    load({
      ask: () => new Response('event: error\ndata: {"error":"model_failed"}\n\n'),
    });
    await expect(rook().ask({ task: "t", onText: () => {} })).rejects.toMatchObject({
      code: "model_failed",
    });
  });
});

describe("Rook.recorder", () => {
  const make = (mic = fakeMic(), over: Record<string, unknown> = {}) => {
    const states: string[] = [];
    const events = {
      results: [] as Array<[Record<string, unknown>, Record<string, unknown>]>,
      transcripts: [] as Array<Record<string, unknown>>,
      errors: [] as string[],
      permissions: [] as string[],
    };
    const recorder = rook().recorder({
      preset: "anamnesis",
      clientId: "client-1",
      clientName: "Maria",
      consent: { method: "verbal", at: "2026-12-01T10:00:00Z" },
      mediaDevices: mic.mediaDevices,
      MediaRecorder: FakeRecorder,
      pollMs: 0,
      retryMs: 0,
      onState: (s: string) => states.push(s),
      onPermission: (p: string) => events.permissions.push(p),
      onResult: (r: Record<string, unknown>, meta: Record<string, unknown>) =>
        events.results.push([r, meta]),
      onTranscript: (t: Record<string, unknown>) => events.transcripts.push(t),
      onError: (e: { code: string }) => events.errors.push(e.code),
      ...over,
    });
    return { recorder, states, events, mic };
  };

  it("records, uploads chunks in order, and hands the schema's fields to onResult", async () => {
    const { recorder, states, events, mic } = make();
    await recorder.start();
    expect(recorder.state).toBe("recording");
    const media = FakeRecorder.instances[0] as FakeRecorder;
    expect(media.timeslice).toBe(10_000);
    expect(media.options).toEqual({ mimeType: "audio/webm;codecs=opus" });
    media.emit(1, 2);
    recorder.pause();
    expect(media.state).toBe("paused");
    recorder.resume();
    media.emit(3);
    await recorder.stop();

    expect(states).toEqual([
      "requesting",
      "recording",
      "paused",
      "recording",
      "uploading",
      "processing",
      "done",
    ]);
    expect(events.permissions).toEqual(["requesting", "granted"]);
    expect(mic.tracks[0]?.stop).toHaveBeenCalled();

    const create = fake.calls.find((c) => c.method === "POST" && c.path === CONSULTATIONS);
    expect(create?.body).toEqual({
      template: "structured",
      context: { clientId: "client-1", clientName: "Maria", output: { preset: "anamnesis" } },
      consent: { obtained: true, at: "2026-12-01T10:00:00Z", method: "verbal" },
    });
    const chunks = fake.calls.filter((c) => c.path.includes("/chunks/"));
    expect(chunks.map((c) => [c.path.split("/").pop(), c.method])).toEqual([
      ["0", "PUT"],
      ["1", "PUT"],
      ["2", "PUT"],
    ]);
    expect(chunks.map((c) => (c.body as { blob: number }).blob)).toEqual([2, 1, 1]);
    expect(chunks[0]?.headers["content-type"]).toBe("audio/webm");

    // Finish comes after the last chunk, and the result after that.
    const order = fake.calls.map((c) => c.path.split("/").pop());
    expect(order.indexOf("finish")).toBeGreaterThan(order.lastIndexOf("2"));
    expect(events.results).toEqual([
      [
        { chiefComplaint: "Enxaqueca" },
        {
          transcript: [{ speaker: "professional", startMs: 0, text: "Bom dia." }],
          consultationId: "cons-1",
        },
      ],
    ]);
    expect(events.transcripts.at(-1)).toMatchObject({
      final: true,
      source: "server",
      text: "Bom dia.",
    });
    // Nothing is kept by Rook once the page has the result, unless it asks to keep it.
    expect(fake.calls.at(-1)).toMatchObject({
      method: "DELETE",
      path: `${CONSULTATIONS}/cons-1`,
    });
  });

  it("keeps the recording when asked to", async () => {
    const { recorder } = make(fakeMic(), { keep: true });
    await recorder.start();
    await recorder.stop();
    expect(fake.calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("sends a schema, task and instructions the page registered instead of a preset", async () => {
    const schema = { type: "object", properties: { a: { type: "string" } } };
    const { recorder } = make(fakeMic(), {
      preset: undefined,
      schema,
      task: "Anamnesis",
      instructions: "Short.",
    });
    await recorder.start();
    const create = fake.calls.find((c) => c.path === CONSULTATIONS);
    expect((create?.body as { context: { output: unknown } } | undefined)?.context.output).toEqual({
      task: "Anamnesis",
      schema,
      instructions: "Short.",
    });
  });

  it("asks the page for consent first, and does nothing when it is refused", async () => {
    const mic = fakeMic();
    const { recorder, states } = make(mic, { consent: async () => false });
    await recorder.start();
    expect(states).toEqual(["requesting", "idle"]);
    expect(mic.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(fake.calls).toHaveLength(0);
  });

  it("uses the consent the page's function returns", async () => {
    const { recorder } = make(fakeMic(), { consent: async () => ({ method: "written" }) });
    await recorder.start();
    const create = fake.calls.find((c) => c.path === CONSULTATIONS);
    expect((create?.body as { consent: { method: string } } | undefined)?.consent.method).toBe(
      "written",
    );
  });

  it("reports a denied microphone and creates nothing", async () => {
    const { recorder, events } = make(fakeMic({ deny: true }));
    await recorder.start();
    expect(recorder.state).toBe("error");
    expect(events.errors).toEqual(["permission_denied"]);
    expect(events.permissions).toEqual(["requesting", "denied"]);
    expect(fake.calls.some((c) => c.path === CONSULTATIONS)).toBe(false);
  });

  it("fails with the server's reason when the recording cannot start", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) =>
        String(url).endsWith(CONSULTATIONS) && init?.method === "POST"
          ? Response.json({ error: "allowance_exhausted" }, { status: 402 })
          : fake.handler(String(url), init),
      ),
    );
    const { recorder, events, mic } = make();
    await recorder.start();
    expect(events.errors).toEqual(["allowance_exhausted"]);
    // The microphone is released.
    expect(mic.tracks[0]?.stop).toHaveBeenCalled();
  });

  it("retries a chunk that failed for the server's sake, then gives up with upload_failed", async () => {
    load({ chunk: (_call, n) => (n < 3 ? new Response("", { status: 503 }) : Response.json({})) });
    const { recorder, events } = make();
    await recorder.start();
    await recorder.stop();
    expect(events.errors).toEqual([]);
    expect(recorder.state).toBe("done");

    load({ chunk: () => new Response("", { status: 503 }) });
    const failing = make();
    await failing.recorder.start();
    await failing.recorder.stop();
    expect(failing.events.errors).toEqual(["upload_failed"]);
    // Nothing is finished when the audio did not arrive.
    expect(fake.calls.some((c) => c.path.endsWith("/finish"))).toBe(false);
  });

  it("stops on a chunk the server refuses for good", async () => {
    load({ chunk: () => Response.json({ error: "too_long" }, { status: 413 }) });
    const { recorder, events } = make();
    await recorder.start();
    await recorder.stop();
    expect(events.errors).toEqual(["too_long"]);
    expect(fake.calls.filter((c) => c.path.includes("/chunks/"))).toHaveLength(1);
  });

  it("reports why processing failed", async () => {
    load({ status: () => ({ state: "failed", error: { code: "no_speech" } }) });
    const { recorder, events } = make();
    await recorder.start();
    await recorder.stop();
    expect(recorder.state).toBe("error");
    expect(events.errors).toEqual(["no_speech"]);
    expect(events.results).toEqual([]);
  });

  it("polls until the result is drafted", async () => {
    let polls = 0;
    load({
      status: () =>
        ++polls < 3
          ? { state: "processing" }
          : { state: "drafted", transcript: [], note: { a: 1 } },
    });
    const { recorder, events } = make();
    await recorder.start();
    await recorder.stop();
    expect(polls).toBe(3);
    expect(events.results[0]?.[0]).toEqual({ a: 1 });
  });

  it("cancels: stops the microphone and deletes what was recorded", async () => {
    const { recorder, states, mic } = make();
    await recorder.start();
    await recorder.cancel();
    expect(states.at(-1)).toBe("idle");
    expect(mic.tracks[0]?.stop).toHaveBeenCalled();
    expect(fake.calls.at(-1)).toMatchObject({ method: "DELETE" });
    expect(fake.calls.some((c) => c.path.endsWith("/finish"))).toBe(false);
  });

  it("shows live captions from the browser while recording", async () => {
    class FakeSpeech {
      static last: FakeSpeech;
      continuous = false;
      interimResults = false;
      lang = "";
      onresult: ((event: unknown) => void) | null = null;
      onerror: (() => void) | null = null;
      stopped = false;
      constructor() {
        FakeSpeech.last = this;
      }
      start() {}
      stop() {
        this.stopped = true;
      }
    }
    const { recorder, events } = make(fakeMic(), { SpeechRecognition: FakeSpeech, lang: "pt-BR" });
    await recorder.start();
    const speech = FakeSpeech.last;
    expect(speech.lang).toBe("pt-BR");
    speech.onresult?.({
      resultIndex: 0,
      results: [Object.assign([{ transcript: "bom dia" }], { isFinal: false })],
    });
    expect(events.transcripts).toEqual([{ text: "bom dia", final: false, source: "browser" }]);
    await recorder.stop();
    expect(speech.stopped).toBe(true);
  });

  it("ignores start while already recording", async () => {
    const mic = fakeMic();
    const { recorder } = make(mic);
    await recorder.start();
    await recorder.start();
    expect(mic.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
  });
});
