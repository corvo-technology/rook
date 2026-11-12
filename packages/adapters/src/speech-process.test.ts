import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { childScript, type SpeechChild, SpeechProcess, spawnNodeChild } from "./speech-process.js";

vi.mock("@corvo/logging", () => ({
  getLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

type Job = { id: number; type: string; text?: string };

/** A child that answers from a script, or dies, without running any engine. */
class FakeChild extends EventEmitter implements SpeechChild {
  readonly jobs: Job[] = [];
  killed = false;

  constructor(private readonly behave: (job: Job, child: FakeChild) => void) {
    super();
  }

  send(message: unknown): boolean {
    const job = message as Job;
    this.jobs.push(job);
    queueMicrotask(() => this.behave(job, this));
    return true;
  }

  kill(): boolean {
    this.killed = true;
    return true;
  }

  reply(id: number, result: unknown) {
    this.emit("message", { id, result });
  }

  crash(signal = "SIGSEGV") {
    this.emit("exit", null, signal);
  }
}

function host(
  behaviors: Array<(job: Job, child: FakeChild) => void>,
  options: { timeoutMs?: number; idleMs?: number } = {},
) {
  const children: FakeChild[] = [];
  const process = new SpeechProcess<{ text?: string }>({
    name: "Speech",
    spawn: () => {
      const behave = behaviors[children.length] ?? behaviors[behaviors.length - 1];
      if (!behave) throw new Error("no behavior");
      const child = new FakeChild(behave);
      children.push(child);
      return child;
    },
    timeoutMs: options.timeoutMs ?? 5_000,
    idleMs: options.idleMs ?? 60_000,
    backoffMs: () => 0,
  });
  return { process, children };
}

const echo = (job: Job, child: FakeChild) => child.reply(job.id, { text: job.text });

describe("SpeechProcess", () => {
  it("answers requests in order and keeps one child for all of them", async () => {
    const { process, children } = host([echo]);
    const first = process.request({ type: "speak", text: "one" });
    const second = process.request({ type: "speak", text: "two" });
    expect(await first).toEqual({ text: "one" });
    expect(await second).toEqual({ text: "two" });
    expect(children).toHaveLength(1);
  });

  it("fails only the request in flight when the engine crashes, then starts a fresh child", async () => {
    const { process, children } = host([(_job, child) => child.crash(), echo]);
    await expect(process.request({ type: "speak", text: "boom" })).rejects.toMatchObject({
      kind: "crashed",
      message: expect.stringContaining("SIGSEGV"),
    });
    expect(await process.request({ type: "speak", text: "after" })).toEqual({ text: "after" });
    expect(children).toHaveLength(2);
  });

  it("does not let a crash fail the requests queued behind it", async () => {
    const { process } = host([(_job, child) => child.crash(), echo]);
    const crashed = process.request({ type: "speak", text: "boom" });
    const queued = process.request({ type: "speak", text: "queued" });
    await expect(crashed).rejects.toMatchObject({ kind: "crashed" });
    expect(await queued).toEqual({ text: "queued" });
  });

  it("starts a fresh child when the old one died while idle", async () => {
    const { process, children } = host([echo]);
    await process.request({ type: "speak", text: "one" });
    children[0]?.crash();
    expect(await process.request({ type: "speak", text: "two" })).toEqual({ text: "two" });
    expect(children).toHaveLength(2);
  });

  it("keeps the child after the engine reports a failure of its own", async () => {
    const { process, children } = host([
      (job, child) =>
        job.text === "bad"
          ? child.emit("message", { id: job.id, error: "no sound" })
          : echo(job, child),
    ]);
    await expect(process.request({ type: "speak", text: "bad" })).rejects.toMatchObject({
      kind: "failed",
      message: expect.stringContaining("no sound"),
    });
    expect(await process.request({ type: "speak", text: "ok" })).toEqual({ text: "ok" });
    expect(children).toHaveLength(1);
  });

  it("waits out a backoff after repeated crashes", async () => {
    vi.useFakeTimers();
    try {
      const children: FakeChild[] = [];
      const process = new SpeechProcess({
        name: "Speech",
        spawn: () => {
          const child = new FakeChild(children.length < 2 ? (_j, c) => c.crash() : echo);
          children.push(child);
          return child;
        },
        timeoutMs: 5_000,
        idleMs: 60_000,
        backoffMs: (crashes) => 1_000 * crashes,
      });
      await expect(process.request({ type: "speak" })).rejects.toMatchObject({ kind: "crashed" });
      const second = process.request({ type: "speak" });
      const secondFailed = expect(second).rejects.toMatchObject({ kind: "crashed" });
      await vi.advanceTimersByTimeAsync(1_000);
      await secondFailed;
      expect(children).toHaveLength(2);
      const third = process.request({ type: "speak", text: "third" });
      await vi.advanceTimersByTimeAsync(1_999);
      expect(children).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(await third).toEqual({ text: "third" });
      expect(children).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends a child that does not answer in time and starts a new one next time", async () => {
    vi.useFakeTimers();
    try {
      const { process, children } = host([() => undefined, echo], { timeoutMs: 1_000 });
      const hung = process.request({ type: "speak", text: "slow" });
      const failed = expect(hung).rejects.toMatchObject({ kind: "timeout" });
      await vi.advanceTimersByTimeAsync(1_000);
      await failed;
      expect(children[0]?.killed).toBe(true);
      expect(await process.request({ type: "speak", text: "next" })).toEqual({ text: "next" });
      expect(children).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends the child when the request is cancelled, and a late answer is ignored", async () => {
    const { process, children } = host([() => undefined, echo]);
    const controller = new AbortController();
    const cancelled = process.request({ type: "speak", text: "slow" }, controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ kind: "cancelled" });
    expect(children[0]?.killed).toBe(true);
    children[0]?.reply(1, { text: "late" });
    expect(await process.request({ type: "speak", text: "next" })).toEqual({ text: "next" });
    expect(children).toHaveLength(2);
  });

  it("does not start a request that was cancelled before its turn", async () => {
    const { process, children } = host([echo]);
    const controller = new AbortController();
    controller.abort();
    await expect(process.request({ type: "speak" }, controller.signal)).rejects.toMatchObject({
      kind: "cancelled",
    });
    expect(children).toHaveLength(0);
  });

  it("gives the models back after the idle time", async () => {
    vi.useFakeTimers();
    try {
      const { process, children } = host([echo], { idleMs: 1_000 });
      await process.request({ type: "speak", text: "one" });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(children[0]?.killed).toBe(true);
      expect(await process.request({ type: "speak", text: "two" })).toEqual({ text: "two" });
      expect(children).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("SpeechProcess with a real child process", () => {
  // The engine is stood in for by a module that always loads; the handler dies the way a native
  // crash does, with a signal, and answers with a typed array like the real ones.
  const script = childScript(`
function handle(job) {
  if (job.text === "crash") process.kill(process.pid, "SIGSEGV");
  return { samples: new Float32Array([0.5, -0.5]), text: job.text };
}`);
  const real = () =>
    new SpeechProcess<{ samples: Float32Array; text: string }>({
      name: "Speech",
      spawn: () => spawnNodeChild(script, { CORVO_SPEECH_ENGINE: "node:path" }),
      timeoutMs: 20_000,
      idleMs: 60_000,
      backoffMs: () => 0,
    });

  it("survives a native crash and serves the next request from a fresh process", async () => {
    const process = real();
    try {
      const first = await process.request({ type: "speak", text: "hello" });
      expect(Array.from(first.samples)).toEqual([0.5, -0.5]);
      await expect(process.request({ type: "speak", text: "crash" })).rejects.toMatchObject({
        kind: "crashed",
        message: expect.stringContaining("SIGSEGV"),
      });
      const after = await process.request({ type: "speak", text: "again" });
      expect(after.text).toBe("again");
    } finally {
      await process.close();
    }
  }, 30_000);
});
