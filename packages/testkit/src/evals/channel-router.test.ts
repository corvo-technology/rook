import { describe, expect, it } from "vitest";
import {
  ROUTER_INSTRUCTIONS,
  renderRouterPrompt,
} from "../../../../apps/api/src/channel-router.js";
import {
  CHANNEL_ROUTER_CASES,
  type ChannelRouterCase,
  channelRouterEvidence,
  gradeChannelRouter,
  routerPromptInput,
} from "./channel-router.js";
import type { EvalJudge } from "./judge.js";

const byId = (id: string) => CHANNEL_ROUTER_CASES.find((c) => c.id === id) as ChannelRouterCase;
const signal = new AbortController().signal;
const answer = (
  scores: Record<string, number>,
  extra: { forEveryone?: number; needsAgent?: number } = {},
) =>
  JSON.stringify({
    scores,
    forEveryone: extra.forEveryone ?? 0,
    needsAgent: extra.needsAgent ?? 0.9,
    reason: "fits the role",
  });
const passing: EvalJudge = async () => ({ pass: true, reason: "sound" });

describe("channel router cases", () => {
  it("are about twenty with unique ids and cover every kind of pick", () => {
    const ids = CHANNEL_ROUTER_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(20);
    expect(new Set(CHANNEL_ROUTER_CASES.map((c) => c.expected.kind))).toEqual(
      new Set(["nobody", "one", "several"]),
    );
  });

  it("only expect members the case offers", () => {
    for (const c of CHANNEL_ROUTER_CASES) {
      const offered = c.candidates.map((candidate) => candidate.id);
      if (c.expected.kind !== "nobody")
        for (const id of c.expected.acceptable) expect(offered).toContain(id);
    }
  });

  it("render through the product's prompt, with every candidate id in it", () => {
    expect(ROUTER_INSTRUCTIONS).toContain("Return JSON only");
    for (const c of CHANNEL_ROUTER_CASES) {
      const prompt = renderRouterPrompt(routerPromptInput(c));
      for (const candidate of c.candidates) expect(prompt).toContain(`[${candidate.id}]`);
      expect(prompt).toContain(JSON.stringify(c.text));
    }
  });
});

describe("gradeChannelRouter observable effect", () => {
  const email = byId("copy-email");

  it("passes the expected pick and fails another member", async () => {
    expect((await gradeChannelRouter(email, answer({ bento: 0.95, mia: 0.2 }))).status).toBe(
      "pass",
    );
    const wrong = await gradeChannelRouter(email, answer({ bento: 0.2, leo: 0.9 }));
    expect(wrong.status).toBe("fail");
  });

  it("fails a pick that wakes several where one is expected", async () => {
    const grade = await gradeChannelRouter(
      email,
      answer({ bento: 0.9, mia: 0.9 }, { forEveryone: 0.9 }),
    );
    expect(grade.status).toBe("fail");
  });

  it("passes nobody when the message needs no agent, and fails a wake", async () => {
    const greeting = byId("greeting");
    expect((await gradeChannelRouter(greeting, answer({}, { needsAgent: 0.1 }))).status).toBe(
      "pass",
    );
    expect((await gradeChannelRouter(greeting, answer({ chief: 0.9 }))).status).toBe("fail");
  });

  it("passes several for a message to everyone, and fails a single pick", async () => {
    const everyone = byId("risks-for-everyone");
    const wide = answer({ chief: 0.9, leo: 0.8, cora: 0.7 }, { forEveryone: 0.9 });
    expect((await gradeChannelRouter(everyone, wide)).status).toBe("pass");
    expect((await gradeChannelRouter(everyone, answer({ chief: 0.9 }))).status).toBe("fail");
  });

  it("never lets an id the case did not offer be picked", async () => {
    const grade = await gradeChannelRouter(email, answer({ ghost: 1 }));
    expect(grade.status).toBe("fail");
  });

  it("leaves an unreadable answer unqualified, never a pass", async () => {
    for (const text of ["", "bento", "{}", '{"scores":{}}']) {
      expect((await gradeChannelRouter(email, text)).status).toBe("unqualified");
    }
  });
});

describe("gradeChannelRouter judgment", () => {
  const vague = byId("vague-hero");
  const good = answer({ mia: 0.8 });

  it("judges the reason only for cases with more than one defensible answer", async () => {
    let calls = 0;
    const counting: EvalJudge = async () => {
      calls += 1;
      return { pass: true, reason: "sound" };
    };
    await gradeChannelRouter(byId("copy-email"), answer({ bento: 0.9 }), {
      judge: counting,
      signal,
    });
    expect(calls).toBe(0);
    await gradeChannelRouter(vague, good, { judge: counting, signal });
    expect(calls).toBe(1);
  });

  it("fails on a judge's failing verdict and never judges a wrong pick", async () => {
    const failing: EvalJudge = async () => ({ pass: false, reason: "generic" });
    expect((await gradeChannelRouter(vague, good, { judge: failing, signal })).status).toBe("fail");
    let called = false;
    const spy: EvalJudge = async () => {
      called = true;
      return { pass: true, reason: "x" };
    };
    await gradeChannelRouter(vague, answer({ leo: 0.9 }), { judge: spy, signal });
    expect(called).toBe(false);
  });

  it("is unqualified when the judge errors", async () => {
    const broken: EvalJudge = async () => {
      throw new Error("down");
    };
    const grade = await gradeChannelRouter(vague, good, { judge: broken, signal });
    expect(grade.status).toBe("unqualified");
    expect(grade.reason).toContain("down");
  });

  it("passes with the judge when the verdict passes, and without one on observable effect", async () => {
    expect((await gradeChannelRouter(vague, good, { judge: passing, signal })).status).toBe("pass");
    expect((await gradeChannelRouter(vague, good)).status).toBe("pass");
  });

  it("gives the judge the roles and the reason, not the scores", () => {
    const evidence = channelRouterEvidence(vague, ["mia"], "layout work");
    expect(evidence.picked).toEqual(["Mia"]);
    expect(evidence.reason).toBe("layout work");
    expect(JSON.stringify(evidence)).not.toContain("scores");
  });
});
