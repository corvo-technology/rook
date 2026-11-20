import type { AgentRunRequest, AgentRuntime, AgentRuntimeEvent } from "@corvo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import { FakeWebProvider } from "./fake-web.js";
import type {
  ResearchDeps,
  ResearchJobRecord,
  ResearchOutcome,
  ResearchStore,
  StoredSource,
} from "./research-run.js";
import {
  REPORT_INSTRUCTIONS,
  RESEARCH_BUDGETS,
  researchQueryKey,
  runResearch,
} from "./research-run.js";

const PAGE_ONE =
  "Rook announced a pricing change on its team plan. The team plan now costs nine dollars.";
const PAGE_TWO =
  "Analysts expect the change to land in the spring. A second source confirms the date.";

function job(patch: Partial<ResearchJobRecord> = {}): ResearchJobRecord {
  return {
    id: "r1",
    spaceId: "s1",
    userId: "u1",
    botId: "b1",
    question: "What changed in team pricing?",
    scope: null,
    depth: "quick",
    watch: false,
    status: "running",
    steps: 0,
    tokens: 0,
    maxSteps: RESEARCH_BUDGETS.quick.maxSteps,
    maxTokens: RESEARCH_BUDGETS.quick.maxTokens,
    state: { planned: false, queue: [], asked: [], notes: [] },
    previousId: null,
    ...patch,
  };
}

/** The ledger and the job row in memory, with the same rules as the database store. */
function memoryStore(
  record: ResearchJobRecord,
  past?: { report: string; sources: StoredSource[] },
) {
  const ledger = new Map<string, StoredSource[]>([
    ["r1", []],
    ["past", past?.sources ?? []],
  ]);
  const outcomes: ResearchOutcome[] = [];
  const store: ResearchStore = {
    load: async () => structuredClone(record),
    progress: async (_id, patch) => {
      record.steps = patch.steps;
      record.tokens = patch.tokens;
      record.state = structuredClone(patch.state);
    },
    addSource: async (id, source) => {
      const rows = ledger.get(id) ?? [];
      const existing = rows.find((row) => row.url === source.url);
      if (existing) return existing;
      const row = { position: rows.length + 1, ...source };
      ledger.set(id, [...rows, row]);
      return row;
    },
    setExcerpt: async (id, position, excerpt) => {
      const row = ledger.get(id)?.find((candidate) => candidate.position === position);
      if (row) row.excerpt = excerpt;
    },
    sources: async (id) => structuredClone(ledger.get(id) ?? []),
    previous: async () => (past ? { id: "past", report: past.report } : null),
    finish: async (_id, outcome) => {
      outcomes.push(outcome);
      record.status = outcome.status;
    },
  };
  return { store, outcomes, ledger };
}

type Call = { tier: string; kind: "plan" | "notes" | "report"; model: string; prompt: string };

/** Answers each kind of call from its instructions; the model id shows which tier was asked. */
function fakeRuntime(answers: {
  plan?: string;
  notes?: (prompt: string) => string;
  report?: string;
  tokensPerCall?: number;
}) {
  const calls: Call[] = [];
  const runtime = {
    describe: () => ({ id: "fake", contractVersion: "1", adapterVersion: "1", capabilities: {} }),
    abort: async () => undefined,
    async *run(request: AgentRunRequest): AsyncIterable<AgentRuntimeEvent> {
      const kind = request.instructions.includes("plan web research")
        ? "plan"
        : request.instructions.includes("take research notes")
          ? "notes"
          : "report";
      calls.push({ tier: request.model.id, kind, model: request.model.id, prompt: request.prompt });
      const text =
        kind === "plan"
          ? (answers.plan ?? '{"questions":["what is the new price","when does it start"]}')
          : kind === "notes"
            ? (answers.notes?.(request.prompt) ?? "{}")
            : (answers.report ?? "");
      const usage = {
        type: "usage" as const,
        provider: "fake",
        model: request.model.id,
        inputTokens: answers.tokensPerCall ?? 100,
        outputTokens: 0,
      };
      await request.onUsage?.(usage);
      yield { ...usage, accounted: true };
      yield { type: "done", text };
    },
  } as unknown as AgentRuntime;
  return { runtime, calls };
}

const NOTES_ONE = JSON.stringify({
  notes: [
    {
      source: 1,
      text: "The team plan now costs nine dollars.",
      quote: "The team plan now costs nine dollars",
    },
  ],
  followUps: [],
  enough: true,
});

function setup(options: {
  record?: ResearchJobRecord;
  past?: { report: string; sources: StoredSource[] };
  answers?: Parameters<typeof fakeRuntime>[0];
  maySpend?: ResearchDeps["maySpend"];
  pages?: Array<{ url: string; text: string }>;
  /** Each search returns the next two pages, so every sub-question reads something new. */
  rotate?: boolean;
}) {
  const record = options.record ?? job();
  const memory = memoryStore(record, options.past);
  const { runtime, calls } = fakeRuntime(options.answers ?? {});
  const web = new FakeWebProvider();
  const pages = options.pages ?? [
    { url: "https://news.test/a", text: PAGE_ONE },
    { url: "https://news.test/b", text: PAGE_TWO },
  ];
  web.searchHits = pages.map((page, index) => ({
    title: `Page ${index + 1}`,
    url: page.url,
    snippet: page.text.slice(0, 30),
  }));
  if (options.rotate) {
    let round = 0;
    web.search = async () => {
      const start = (round++ * 2) % pages.length;
      return (web.searchHits as typeof web.searchHits).slice(start, start + 2);
    };
  }
  web.fetch = vi.fn(async (request) => {
    const page = pages.find((candidate) => candidate.url === request.url);
    if (!page) throw new Error("not found");
    return { url: page.url, title: `Title of ${page.url}`, text: page.text, truncated: false };
  });
  const usage: number[] = [];
  const deps: ResearchDeps = {
    store: memory.store,
    runtime,
    web,
    resolveFastModel: async () => ({ provider: "fake", id: "fast-model" }),
    resolveStrongModel: async () => ({ provider: "fake", id: "strong-model" }),
    resolveModel: async () => ({ provider: "fake", id: "main-model" }),
    recordUsage: async (event) => {
      usage.push(event.inputTokens ?? 0);
    },
    maySpend: options.maySpend ?? (async () => true),
    now: () => new Date("2026-12-01T00:00:00Z"),
  };
  return { deps, record, calls, usage, web, ...memory };
}

const REPORT = [
  "The team plan now costs nine dollars, and the change lands in the spring.",
  "",
  "Key findings",
  "- The team plan costs nine dollars. [1]",
  "- A second source confirms the spring date. [2]",
  "",
  "Next step: compare it with the plan of the closest competitor.",
].join("\n");

describe("runResearch", () => {
  it("plans, reads, notes with sources and reports with real citations", async () => {
    const { deps, calls, outcomes, ledger, usage } = setup({
      answers: { notes: () => NOTES_ONE, report: REPORT },
    });
    await runResearch(deps, "r1");

    expect(outcomes).toHaveLength(1);
    const outcome = outcomes[0] as ResearchOutcome;
    expect(outcome).toMatchObject({ status: "finished", changed: true, stopReason: "enough" });
    expect(outcome.report).toContain("[1]");
    // The source list comes from the ledger, for the numbers the report cites.
    expect(outcome.report).toContain("[1] Title of https://news.test/a - https://news.test/a");
    expect(outcome.report).toContain("[2] Title of https://news.test/b - https://news.test/b");

    const sources = ledger.get("r1") ?? [];
    expect(sources.map((source) => source.url)).toEqual([
      "https://news.test/a",
      "https://news.test/b",
    ]);
    expect(sources[0]).toMatchObject({ title: "Title of https://news.test/a" });
    // A quote the model gave that really is on the page becomes the excerpt.
    expect(sources[0]?.excerpt).toBe("The team plan now costs nine dollars");
    expect(sources[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(usage.length).toBeGreaterThan(0);
    expect(calls.map((call) => call.kind)).toEqual(["plan", "notes", "report"]);
  });

  it("uses the fast model to plan and take notes and the strong one only for the report", async () => {
    const { deps, calls } = setup({ answers: { notes: () => NOTES_ONE, report: REPORT } });
    await runResearch(deps, "r1");
    expect(Object.fromEntries(calls.map((call) => [call.kind, call.model]))).toEqual({
      plan: "fast-model",
      notes: "fast-model",
      report: "strong-model",
    });
  });

  it("falls back to the main model when no tier is configured", async () => {
    const { deps, calls } = setup({ answers: { notes: () => NOTES_ONE, report: REPORT } });
    deps.resolveFastModel = async () => undefined;
    deps.resolveStrongModel = async () => undefined;
    await runResearch(deps, "r1");
    expect(new Set(calls.map((call) => call.model))).toEqual(new Set(["main-model"]));
  });

  it("drops a quote that is not on the page and a citation that is not a source", async () => {
    const { deps, outcomes, ledger } = setup({
      answers: {
        notes: () =>
          JSON.stringify({
            notes: [{ source: 1, text: "A fact.", quote: "words the page never said at all" }],
            enough: true,
          }),
        report:
          "It costs nine dollars [1][7].\n\nKey findings\n- Nine dollars [1][9].\n\nNext step: ask.",
      },
    });
    await runResearch(deps, "r1");
    expect(ledger.get("r1")?.[0]?.excerpt).toContain("Rook announced a pricing change");
    const report = outcomes[0]?.report ?? "";
    expect(report).toContain("[1]");
    expect(report).not.toContain("[7]");
    expect(report).not.toContain("[9]");
  });

  it("fails a report that cites nothing real instead of posting it", async () => {
    const { deps, outcomes } = setup({
      answers: { notes: () => NOTES_ONE, report: "It costs nine dollars [4]." },
    });
    await runResearch(deps, "r1");
    expect(outcomes[0]).toMatchObject({ status: "failed" });
    expect(outcomes[0]?.report).toBeUndefined();
  });

  it("fails when no page could be read", async () => {
    const { deps, outcomes } = setup({ pages: [] });
    await runResearch(deps, "r1");
    expect(outcomes[0]).toMatchObject({
      status: "failed",
      error: "No readable sources were found for this question.",
    });
  });

  describe("budget", () => {
    const manyPages = Array.from({ length: 12 }, (_, index) => ({
      url: `https://news.test/p${index}`,
      text: `${PAGE_ONE} Page number ${index}.`,
    }));
    const keepAsking = (prompt: string) =>
      JSON.stringify({
        notes: [{ source: 1, text: "A fact.", quote: "" }],
        followUps: [`another question after ${prompt.length}`],
        enough: false,
      });

    it("stops gathering at the step limit and still writes the report", async () => {
      const { deps, record, outcomes, calls } = setup({
        record: job({ maxSteps: 2 }),
        pages: manyPages,
        rotate: true,
        answers: { notes: keepAsking, report: REPORT },
      });
      await runResearch(deps, "r1");
      expect(record.steps).toBe(2);
      expect(calls.filter((call) => call.kind === "notes")).toHaveLength(2);
      expect(outcomes[0]).toMatchObject({ status: "finished", stopReason: "steps" });
    });

    it("stops gathering when the token budget is used and reports with what it has", async () => {
      const { deps, record, outcomes } = setup({
        pages: manyPages,
        rotate: true,
        answers: { notes: keepAsking, report: REPORT, tokensPerCall: 20_000 },
      });
      await runResearch(deps, "r1");
      expect(record.tokens).toBeGreaterThanOrEqual(45_000);
      expect(outcomes[0]).toMatchObject({ status: "finished", stopReason: "tokens" });
    });

    it("stops when the agent's monthly budget runs out, after what it already spent", async () => {
      let allowed = 2;
      const { deps, outcomes, calls } = setup({
        pages: manyPages,
        rotate: true,
        answers: { notes: keepAsking, report: REPORT },
        maySpend: async () => allowed-- > 0,
      });
      await runResearch(deps, "r1");
      expect(calls.filter((call) => call.kind === "notes")).toHaveLength(1);
      expect(outcomes[0]).toMatchObject({ status: "finished", stopReason: "monthly_limit" });
    });

    it("does not start when the monthly budget is already used", async () => {
      const { deps, outcomes, calls } = setup({ maySpend: async () => false });
      await runResearch(deps, "r1");
      expect(calls).toHaveLength(0);
      expect(outcomes[0]).toMatchObject({ status: "failed" });
    });

    it("resumes from saved progress without planning or counting steps again", async () => {
      const { deps, calls } = setup({
        record: job({
          steps: 1,
          tokens: 500,
          state: {
            planned: true,
            queue: [],
            asked: ["what is the new price"],
            notes: [{ source: 1, text: "The team plan now costs nine dollars." }],
          },
        }),
        answers: { report: REPORT },
      });
      await deps.store.addSource("r1", {
        url: "https://news.test/a",
        title: "A",
        excerpt: "x",
        contentHash: "h",
        fetchedAt: new Date(),
      });
      await runResearch(deps, "r1");
      expect(calls.map((call) => call.kind)).toEqual(["report"]);
    });
  });

  describe("recurring research", () => {
    const hash = async (text: string) =>
      (await import("node:crypto")).createHash("sha256").update(text).digest("hex");
    const past = async (pageOne: string) => ({
      report: "Earlier: the team plan costs nine dollars. [1]",
      sources: [
        {
          position: 1,
          title: "A",
          url: "https://news.test/a",
          excerpt: "x",
          contentHash: await hash(pageOne),
        },
        {
          position: 2,
          title: "B",
          url: "https://news.test/b",
          excerpt: "y",
          contentHash: await hash(PAGE_TWO),
        },
      ],
    });

    it("ends silently, without a report call, when the pages are the same as last time", async () => {
      const { deps, outcomes, calls } = setup({
        record: job({ watch: true }),
        past: await past(PAGE_ONE),
        answers: { notes: () => NOTES_ONE, report: REPORT },
      });
      await runResearch(deps, "r1");
      expect(outcomes[0]).toMatchObject({ status: "finished", changed: false });
      expect(outcomes[0]?.report).toBeUndefined();
      expect(calls.some((call) => call.kind === "report")).toBe(false);
    });

    it("ends silently when the model says nothing material changed", async () => {
      const { deps, outcomes, calls } = setup({
        record: job({ watch: true }),
        past: await past("An older version of the first page."),
        answers: { notes: () => NOTES_ONE, report: "NO_RESPONSE" },
      });
      await runResearch(deps, "r1");
      expect(calls.some((call) => call.kind === "report")).toBe(true);
      expect(outcomes[0]).toMatchObject({ status: "finished", changed: false });
      expect(outcomes[0]?.report).toBeUndefined();
    });

    it("reports only the change, given the last report and which sources moved", async () => {
      const { deps, outcomes, calls } = setup({
        record: job({ watch: true }),
        past: await past("An older version of the first page."),
        answers: { notes: () => NOTES_ONE, report: "The price is now nine dollars [1]." },
      });
      await runResearch(deps, "r1");
      const report = calls.find((call) => call.kind === "report");
      expect(report?.prompt).toContain("Earlier: the team plan costs nine dollars.");
      expect(report?.prompt).toContain("(changed since the previous report)");
      expect(outcomes[0]).toMatchObject({ status: "finished", changed: true });
    });

    it("reports in full the first time, when there is nothing to compare with", async () => {
      const { deps, outcomes } = setup({
        record: job({ watch: true }),
        answers: { notes: () => NOTES_ONE, report: REPORT },
      });
      await runResearch(deps, "r1");
      expect(outcomes[0]).toMatchObject({ status: "finished", changed: true });
    });
  });

  it("leaves a job that is not running alone", async () => {
    const { deps, outcomes, calls } = setup({ record: job({ status: "finished" }) });
    await runResearch(deps, "r1");
    expect(calls).toHaveLength(0);
    expect(outcomes).toHaveLength(0);
  });
});

describe("the report instructions", () => {
  it("ask for a short summary, cited findings and one next step", () => {
    expect(REPORT_INSTRUCTIONS).toMatch(/2 to 4/);
    expect(REPORT_INSTRUCTIONS).toMatch(/Next step/i);
  });
});

describe("researchQueryKey", () => {
  it("is the same for the same question however it is written", () => {
    expect(researchQueryKey("What changed in team pricing?")).toBe(
      researchQueryKey("  what CHANGED in team   pricing "),
    );
    expect(researchQueryKey("a", "b")).not.toBe(researchQueryKey("a", "c"));
  });
});
