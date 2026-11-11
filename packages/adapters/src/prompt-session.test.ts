import { describe, expect, it } from "vitest";
import {
  MAX_STALE_LIVE_TOKENS,
  type PromptSessionPlan,
  PromptSessions,
  promptSessionKey,
  type ShownMessage,
  shownMessage,
} from "./prompt-session.js";

const shown = (...ids: string[]): ShownMessage[] =>
  ids.map((id) => shownMessage({ id, content: `text ${id}` }));
const outcome = (
  over: Partial<Parameters<PromptSessions["end"]>[2]> & { shown: ShownMessage[] },
) => ({ ok: true, setup: "s", live: "", staleLiveTokens: 0, ...over });

function store(now = () => 0) {
  return new PromptSessions({ now });
}

function record(
  sessions: PromptSessions,
  key: string,
  over: Parameters<typeof outcome>[0],
  live = over.live ?? "",
) {
  const plan = sessions.begin(key, { setup: "s", shown: over.shown, live });
  sessions.end(key, plan, outcome(over));
  return plan;
}

describe("PromptSessions", () => {
  it("starts new", () => {
    expect(store().begin("k", { setup: "s", shown: shown("a"), live: "" })).toEqual({
      resume: false,
      reason: "new",
      owner: true,
    });
  });

  it("resumes with only new messages after the seen ones", () => {
    const sessions = store();
    record(sessions, "k", {
      shown: shown("a", "b"),
      live: "L1",
      sent: { beforeId: "b", text: "L1" },
    });
    const plan = sessions.begin("k", { setup: "s", shown: shown("a", "b", "c", "d"), live: "L1" });
    expect(plan).toEqual({
      resume: true,
      replay: [{ beforeId: "b", text: "L1" }],
      sendLive: false,
      owner: true,
    });
  });

  it("sends live again when it changed, or when it emptied", () => {
    const sessions = store();
    record(sessions, "k", {
      shown: shown("a"),
      live: "L1",
      sent: { beforeId: "a", text: "L1" },
    });
    expect(sessions.begin("k", { setup: "s", shown: shown("a", "b"), live: "L2" })).toMatchObject({
      resume: true,
      sendLive: "changed",
    });
    const emptied = store();
    record(emptied, "k", { shown: shown("a"), live: "L1", sent: { beforeId: "a", text: "L1" } });
    expect(emptied.begin("k", { setup: "s", shown: shown("a", "b"), live: "" })).toMatchObject({
      resume: true,
      sendLive: "emptied",
    });
    const nothing = store();
    record(nothing, "k", { shown: shown("a"), live: "" });
    expect(nothing.begin("k", { setup: "s", shown: shown("a", "b"), live: "" })).toMatchObject({
      resume: true,
      sendLive: false,
    });
  });

  it.each([
    ["setup", "k", { setup: "other", shown: shown("a", "b", "c"), live: "" }],
    ["missing", "k", { setup: "s", shown: shown("a", "c"), live: "" }],
    [
      "edited",
      "k",
      {
        setup: "s",
        shown: [...shown("a"), shownMessage({ id: "b", content: "edited" }), ...shown("c")],
        live: "",
      },
    ],
    ["inserted", "k", { setup: "s", shown: shown("a", "x", "b", "c"), live: "" }],
  ])("starts fresh: %s", (reason, key, input) => {
    const sessions = store();
    record(sessions, key, { shown: shown("a", "b") });
    expect(sessions.begin(key, input)).toMatchObject({ resume: false, reason, owner: true });
  });

  it("starts fresh after a turn that did not end well", () => {
    const sessions = store();
    record(sessions, "k", { shown: shown("a"), ok: false });
    expect(sessions.begin("k", { setup: "s", shown: shown("a", "b"), live: "" })).toMatchObject({
      resume: false,
      reason: "failed",
    });
  });

  it("expires after the declared retention, never without one", () => {
    let now = 1_000;
    const sessions = store(() => now);
    record(sessions, "k", { shown: shown("a") });
    now += 300_001;
    expect(
      sessions.begin("k", { setup: "s", shown: shown("a", "b"), live: "", retentionMs: 300_000 }),
    ).toMatchObject({ resume: false, reason: "expired" });
    const forever = store(() => now);
    record(forever, "k", { shown: shown("a") });
    now += 10_000_000_000;
    expect(forever.begin("k", { setup: "s", shown: shown("a", "b"), live: "" })).toMatchObject({
      resume: true,
    });
  });

  it("starts fresh when superseded live blocks grow too large", () => {
    for (const [tokens, resume] of [
      [MAX_STALE_LIVE_TOKENS + 1, false],
      [MAX_STALE_LIVE_TOKENS, true],
    ] as const) {
      const sessions = store();
      record(sessions, "k", { shown: shown("a"), staleLiveTokens: tokens });
      const plan = sessions.begin("k", { setup: "s", shown: shown("a", "b"), live: "" });
      expect(plan.resume).toBe(resume);
      if (!plan.resume) expect(plan.reason).toBe("stale-live");
    }
  });

  it("does not let an overlapping run share or overwrite a record", () => {
    const sessions = store();
    record(sessions, "k", { shown: shown("a"), live: "L1", sent: { beforeId: "a", text: "L1" } });
    const first = sessions.begin("k", { setup: "s", shown: shown("a", "b"), live: "L1" });
    const second = sessions.begin("k", { setup: "s", shown: shown("a", "b"), live: "L1" });
    expect(second).toEqual({ resume: false, reason: "busy", owner: false });
    sessions.end("k", second, outcome({ shown: shown("z"), live: "ZZ" }));
    sessions.end("k", first, outcome({ shown: shown("a", "b"), live: "L1" }));
    expect(
      sessions.begin("k", { setup: "s", shown: shown("a", "b", "c"), live: "L1" }),
    ).toMatchObject({ resume: true, sendLive: false });
  });

  it("keeps at most maxEntries sessions, dropping the least recently used", () => {
    const sessions = new PromptSessions({ maxEntries: 2 });
    for (const key of ["one", "two"]) record(sessions, key, { shown: shown("a") });
    // Touch "one" so "two" is the least recently used.
    const touched = sessions.begin("one", { setup: "s", shown: shown("a", "b"), live: "" });
    sessions.end("one", touched, outcome({ shown: shown("a", "b") }));
    record(sessions, "three", { shown: shown("a") });
    expect(sessions.begin("two", { setup: "s", shown: shown("a"), live: "" })).toMatchObject({
      reason: "new",
    });
    expect(sessions.begin("one", { setup: "s", shown: shown("a", "b"), live: "" })).toMatchObject({
      resume: true,
    });
  });

  it("forgets replayed blocks after a fresh start", () => {
    const sessions = store();
    record(sessions, "k", { shown: shown("a"), live: "L1", sent: { beforeId: "a", text: "L1" } });
    const fresh: PromptSessionPlan = sessions.begin("k", {
      setup: "other",
      shown: shown("a", "b"),
      live: "L2",
    });
    expect(fresh.resume).toBe(false);
    sessions.end(
      "k",
      fresh,
      outcome({
        setup: "other",
        shown: shown("a", "b"),
        live: "L2",
        sent: { beforeId: "b", text: "L2" },
      }),
    );
    expect(
      sessions.begin("k", { setup: "other", shown: shown("a", "b", "c"), live: "L2" }),
    ).toMatchObject({ resume: true, replay: [{ beforeId: "b", text: "L2" }] });
  });
});

describe("keys and hashes", () => {
  it("fingerprints a message by its text and images", () => {
    const a = shownMessage({ id: "m", content: "x" });
    expect(shownMessage({ id: "m", content: "x" })).toEqual(a);
    expect(shownMessage({ id: "m", content: "y" }).hash).not.toBe(a.hash);
    expect(
      shownMessage({ id: "m", content: "x", images: [{ name: "i.png", mimeType: "image/png" }] })
        .hash,
    ).not.toBe(a.hash);
  });

  it("keys differ by any part", () => {
    const base = { botId: "b", threadId: "t", provider: "p", modelId: "m" };
    expect(promptSessionKey(base)).toBe(promptSessionKey({ ...base }));
    for (const change of [
      { spaceId: "s" },
      { userId: "u" },
      { botId: "b2" },
      { threadId: "t2" },
      { provider: "p2" },
      { connectionId: "c" },
      { baseUrl: "http://x" },
      { modelId: "m2" },
    ])
      expect(promptSessionKey({ ...base, ...change })).not.toBe(promptSessionKey(base));
  });
});
