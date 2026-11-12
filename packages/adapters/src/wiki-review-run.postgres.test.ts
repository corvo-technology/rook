import { randomUUID } from "node:crypto";
import type { AgentRunRequest, AgentRuntime } from "@corvo/adapter-kit";
import {
  applyAllWikiChanges,
  createDb,
  createWikiChange,
  decideWikiChange,
  listWikiChanges,
  readWikiPage,
  runAsSystem,
  runAsTenant,
  writeWikiPage,
} from "@corvo/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { retryWikiChange, reviewWiki } from "./wiki-review-run.js";

const postgres =
  process.env.VERIFY_DATABASE === "1" && process.env.DATABASE_URL ? describe : describe.skip;

postgres("the weekly wiki review (PostgreSQL)", () => {
  const { prisma, pool } = createDb(process.env.DATABASE_URL!);
  const id = `review-${randomUUID()}`;
  const ids = { userId: `${id}-user`, spaceId: `${id}-space`, orgId: `${id}-org` };
  const scope = { spaceId: ids.spaceId, userId: ids.userId };
  const fixture = <T>(fn: () => Promise<T>) => runAsSystem("test fixture", fn);
  const tenant = <T>(fn: () => Promise<T>) => runAsTenant(scope, fn);
  const NOW = new Date("2026-11-12T10:00:00.000Z");
  const DAY = 24 * 3_600_000;

  beforeAll(() =>
    fixture(async () => {
      await prisma.user.create({
        data: { id: ids.userId, name: "Reviewer", email: `${id}@corvo.test` },
      });
      await prisma.organization.create({
        data: { id: ids.orgId, name: "Review", slug: id, createdAt: new Date() },
      });
      await prisma.space.create({
        data: { id: ids.spaceId, organizationId: ids.orgId, name: "x" },
      });
    }),
  );
  afterAll(async () => {
    await fixture(async () => {
      await prisma.organization.deleteMany({ where: { id: ids.orgId } });
      await prisma.user.deleteMany({ where: { id: ids.userId } });
    });
    await prisma.$disconnect();
    await pool.end();
  });

  function deps(answer: string, model: unknown = { provider: "test", id: "fast-1" }) {
    const requests: AgentRunRequest[] = [];
    const runtime = {
      describe: () => ({
        capabilities: { streaming: false, compaction: true, tools: false, scripted: false },
      }),
      async *run(request: AgentRunRequest) {
        requests.push(request);
        yield { type: "done", text: answer };
      },
    } as unknown as AgentRuntime;
    return {
      requests,
      value: { prisma, runtime, resolveFastModel: vi.fn(async () => model as never) },
    };
  }
  const found = (title: string, old = "Oct 30") =>
    JSON.stringify({
      findings: [
        {
          kind: "contradiction",
          title,
          reason: "Alpha and Renovation disagree on the date.",
          changes: [{ op: "replace", page: "Renovation", old, new: "Oct 28" }],
        },
      ],
    });
  const reviewChanges = () =>
    tenant(async () => (await listWikiChanges(prisma, scope)).filter((change) => change.review));
  const review = (d: ReturnType<typeof deps>, manual = false, now = NOW) =>
    tenant(() => reviewWiki(d.value, { ...scope, ...(manual ? { manual } : {}) }, now));

  it("does nothing with a single page, and with no model", async () => {
    await tenant(() =>
      writeWikiPage(prisma, scope, { title: "Alpha", body: "Quote approved Oct 28." }),
    );
    const d = deps(found("Date differs"));
    await review(d, true);
    expect(d.requests).toHaveLength(0);

    await tenant(() =>
      writeWikiPage(prisma, scope, { title: "Renovation", body: "Quote approved Oct 30." }),
    );
    const none = deps(found("Date differs"), null);
    await review(none, true);
    expect(none.requests).toHaveLength(0);
    expect(await reviewChanges()).toHaveLength(0);
  });

  it("keeps a finding as a change that waits, without ever writing at once", async () => {
    const d = deps(found("Date differs"));
    await review(d, true);
    expect(d.requests[0]?.tools).toEqual([]);
    expect(d.requests[0]?.usageOperationKind).toBe("wiki");
    expect(d.requests[0]?.prompt).toContain("Quote approved Oct 30.");

    const [change] = await reviewChanges();
    expect(change).toMatchObject({ state: "pending", sourceTitle: "Date differs", review: true });
    expect(change?.edits).toEqual([
      { title: "Renovation", op: "replace", removed: "Oct 30", added: "Oct 28" },
    ]);
    const page = await tenant(() => readWikiPage(prisma, scope, "Renovation"));
    expect(page?.body).toContain("Oct 30");

    // Approving it is the normal flow and writes the page.
    await tenant(() => decideWikiChange(prisma, scope, change!.id, "apply"));
    expect((await tenant(() => readWikiPage(prisma, scope, "Renovation")))?.body).toContain(
      "Oct 28",
    );
  });

  it("waits a week between reviews, but runs when asked, and does not repeat a finding", async () => {
    const soon = deps(found("Another"));
    await review(soon, false, new Date(NOW.getTime() + 2 * DAY));
    expect(soon.requests).toHaveLength(0);

    await tenant(() =>
      writeWikiPage(prisma, scope, { title: "Renovation", body: "Quote approved Oct 30 again." }),
    );
    const before = (await reviewChanges()).length;
    await review(deps(found("Still differs", "Oct 30")), false, new Date(NOW.getTime() + 8 * DAY));
    expect(await reviewChanges()).toHaveLength(before + 1);
    // A week later the same finding still waits, so it is not made twice and the model is told so.
    const again = deps(found("Still differs", "Oct 30"));
    await review(again, false, new Date(NOW.getTime() + 16 * DAY));
    expect(again.requests).toHaveLength(1);
    expect(again.requests[0]?.prompt).toContain("Still differs");
    expect(await reviewChanges()).toHaveLength(before + 1);
  });

  it("is never approved in bulk, and a bad answer is retried by the queue", async () => {
    await tenant(() =>
      writeWikiPage(prisma, scope, { title: "Renovation", body: "Quote approved Oct 30." }),
    );
    await review(deps(found("Third", "Oct 30")), true);
    const pending = (await reviewChanges()).filter((change) => change.state === "pending");
    expect(pending.length).toBeGreaterThan(0);
    expect(await tenant(() => applyAllWikiChanges(prisma, scope))).toEqual({
      applied: 0,
      conflicts: 0,
    });
    await expect(review(deps("not json"), true)).rejects.toThrow(/usable findings/);
  });

  it("writes a conflicting change again against the newer page", async () => {
    await tenant(() =>
      writeWikiPage(prisma, scope, { title: "Plan", body: "Status: planning.\n\nOwner: Ana." }),
    );
    const change = await tenant(() =>
      createWikiChange(prisma, scope, {
        source: {
          origin: "message",
          title: "Kickoff",
          text: "Status is now building.",
          threadId: undefined,
        },
        ops: [{ op: "replace", page: "Plan", old: "Status: planning.", new: "Status: building." }],
        reason: "Moved on",
        anchor: {},
        edits: "approve",
      }),
    );
    // A person edits the page before it is approved, so approving ends in conflict.
    await tenant(() =>
      writeWikiPage(prisma, scope, { title: "Plan", body: "Status: planning.\n\nOwner: Rui." }),
    );
    expect((await tenant(() => decideWikiChange(prisma, scope, change!.id, "apply"))).state).toBe(
      "conflict",
    );

    const d = deps(
      JSON.stringify({
        changes: [
          { op: "replace", page: "Plan", old: "Status: planning.", new: "Status: building." },
        ],
      }),
    );
    await tenant(() => retryWikiChange(d.value, { ...scope, changeId: change!.id }));
    expect(d.requests[0]?.prompt).toContain("Owner: Rui.");
    const [again] = (await tenant(() => listWikiChanges(prisma, scope))).filter(
      (item) => item.id === change!.id,
    );
    expect(again?.state).toBe("pending");
    expect((await tenant(() => decideWikiChange(prisma, scope, change!.id, "apply"))).state).toBe(
      "applied",
    );
    expect((await tenant(() => readWikiPage(prisma, scope, "Plan")))?.body).toContain(
      "Status: building.",
    );

    // One that is not in conflict is left alone.
    const idle = deps("{}");
    await tenant(() => retryWikiChange(idle.value, { ...scope, changeId: change!.id }));
    expect(idle.requests).toHaveLength(0);
  });
});
