import { randomUUID } from "node:crypto";
import type { AgentRunRequest, AgentRuntime } from "@corvo/adapter-kit";
import {
  createDb,
  createThreadEvents,
  createWikiImport,
  listWikiImports,
  readWikiPage,
  runAsSystem,
  runAsTenant,
} from "@corvo/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { importFileToWiki, startAttachedFileImport } from "./wiki-import-run.js";

const postgres =
  process.env.VERIFY_DATABASE === "1" && process.env.DATABASE_URL ? describe : describe.skip;

const paragraph = (word: string) => `${word} `.repeat(400).trim();
const TWO_PARTS = [paragraph("alpha"), paragraph("beta"), paragraph("gamma")]
  .join("\n\n")
  .repeat(3);

postgres("reading a file into the wiki (PostgreSQL)", () => {
  const { prisma, pool } = createDb(process.env.DATABASE_URL!);
  const id = `import-${randomUUID()}`;
  const ids = { userId: `${id}-user`, spaceId: `${id}-space`, orgId: `${id}-org` };
  const scope = { spaceId: ids.spaceId, userId: ids.userId };
  const fixture = <T>(fn: () => Promise<T>) => runAsSystem("test fixture", fn);
  const tenant = <T>(fn: () => Promise<T>) => runAsTenant(scope, fn);

  beforeAll(() =>
    fixture(async () => {
      await prisma.user.create({
        data: { id: ids.userId, name: "Importer", email: `${id}@corvo.test` },
      });
      await prisma.organization.create({
        data: { id: ids.orgId, name: "Importer", slug: id, createdAt: new Date() },
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

  const create = (page: string, body: string) => ({
    op: "create",
    page,
    kind: "Policy",
    body,
    lasting: true,
  });
  const answer = (...changes: unknown[]) =>
    JSON.stringify({ worth: true, reason: "A policy", source_title: "Policy", changes });

  function setup(answers: (string | Error)[], bytes: string = TWO_PARTS) {
    const requests: AgentRunRequest[] = [];
    let call = 0;
    const runtime = {
      describe: () => ({
        capabilities: { streaming: false, compaction: true, tools: false, scripted: false },
      }),
      async *run(request: AgentRunRequest) {
        requests.push(request);
        const next = answers[Math.min(call, answers.length - 1)]!;
        call += 1;
        if (next instanceof Error) throw next;
        yield { type: "done", text: next };
      },
    } as unknown as AgentRuntime;
    const artifacts = {
      get: vi.fn(async () => new TextEncoder().encode(bytes)),
      remove: vi.fn(async () => undefined),
    };
    return {
      requests,
      artifacts,
      deps: {
        prisma,
        runtime,
        events: createThreadEvents(prisma),
        artifacts,
        resolveFastModel: vi.fn(async () => ({ provider: "test", id: "fast-1" }) as never),
      },
    };
  }
  const start = (name: string) => tenant(() => createWikiImport(prisma, scope, name));
  const run = (
    s: ReturnType<typeof setup>,
    row: { id: string },
    extra: { mimeType?: string } = {},
  ) =>
    tenant(() =>
      importFileToWiki(s.deps, {
        importId: row.id,
        storageKey: "stored-1",
        mimeType: extra.mimeType ?? "text/plain",
        temporary: true,
      }),
    );

  it("reads a long file part by part, keeps one change that cites the file, and clears the import", async () => {
    const s = setup([
      answer(create("Leave policy", "Twenty days a year. (Source: handbook.txt, part 1)")),
      answer({
        op: "append",
        page: "Leave policy",
        text: "Unused days expire in March. (Source: handbook.txt, part 2)",
        lasting: true,
      }),
    ]);
    const row = await start("handbook.txt");
    await run(s, row);

    expect(s.requests.length).toBeGreaterThan(1);
    expect(s.requests[0]?.instructions).toContain("(Source: handbook.txt, p. N)");
    expect(s.requests[0]?.prompt).toContain("handbook.txt, part 1");
    expect(s.requests[1]?.prompt).toContain("[[Leave policy]] create");
    const page = await tenant(() => readWikiPage(prisma, scope, "Leave policy"));
    expect(page?.body).toContain("Twenty days a year. (Source: handbook.txt, part 1)");
    expect(page?.body).toContain("Unused days expire in March.");
    const sources = await fixture(() =>
      prisma.wikiSource.findMany({ where: { spaceId: ids.spaceId, origin: "file" } }),
    );
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ title: "handbook.txt", threadId: null });
    expect(await tenant(() => listWikiImports(prisma, scope))).toEqual([]);
    expect(s.artifacts.remove).toHaveBeenCalledWith("stored-1", expect.anything());
  });

  it("reports a model that never answers usably, and writes nothing", async () => {
    const s = setup(["not json"]);
    const row = await start("broken.txt");
    await run(s, row);
    const [failed] = await tenant(() => listWikiImports(prisma, scope));
    expect(failed).toMatchObject({
      name: "broken.txt",
      state: "failed",
      error: "Reading this file did not work. Try again.",
    });
    await tenant(async () => {
      await prisma.wikiImport.deleteMany({ where: { id: row.id } });
    });
  });

  it("says what it cannot read, and a file with nothing worth keeping", async () => {
    const word = setup([answer()]);
    const row = await start("report.docx");
    await run(word, row, {
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const empty = setup([
      JSON.stringify({ worth: false, reason: "", source_title: "x", changes: [] }),
    ]);
    const quiet = await start("small-talk.txt");
    await run(empty, quiet);
    const failed = await tenant(() => listWikiImports(prisma, scope));
    expect(failed.find((item) => item.name === "report.docx")?.error).toMatch(/PDF and text/);
    expect(failed.find((item) => item.name === "small-talk.txt")?.error).toMatch(/Nothing/);
    expect(word.requests).toHaveLength(0);
    await tenant(async () => {
      await prisma.wikiImport.deleteMany({ where: { spaceId: ids.spaceId } });
    });
  });

  it("answers an agent's request at once and queues the read of an attached file", async () => {
    const jobs = { enqueue: vi.fn(async () => undefined) };
    const thread = await fixture(async () => {
      const bot = await prisma.bot.create({
        data: { spaceId: ids.spaceId, userId: ids.userId, name: "Leo", color: "ink" },
      });
      const artifact = await prisma.artifact.create({
        data: {
          spaceId: ids.spaceId,
          userId: ids.userId,
          botId: bot.id,
          name: "policy.txt",
          mimeType: "text/plain",
          size: 100,
          hash: "h",
          storageKey: "key-1",
        },
      });
      const thread = await prisma.thread.create({
        data: { spaceId: ids.spaceId, userId: ids.userId, botId: bot.id, nextMessageSeq: 1 },
      });
      await prisma.message.create({
        data: {
          threadId: thread.id,
          seq: 0,
          role: "user",
          blocks: [
            {
              kind: "file",
              artifactId: artifact.id,
              name: "policy.txt",
              mimeType: "text/plain",
              size: 100,
            },
          ],
        },
      });
      return thread;
    });
    const context = {
      ...scope,
      botId: "b",
      operationId: "o",
      traceId: "o",
      signal: new AbortController().signal,
    };
    const started = await tenant(() =>
      startAttachedFileImport(
        { prisma, jobs: jobs as never },
        { threadId: thread.id, context, file: "policy.txt" },
      ),
    );
    expect(started).toMatchObject({ ok: true, status: "reading", file: "policy.txt" });
    expect(jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "wiki.import",
        payload: expect.objectContaining({ storageKey: "key-1", threadId: thread.id }),
      }),
    );
    const missing = await tenant(() =>
      startAttachedFileImport(
        { prisma, jobs: jobs as never },
        { threadId: thread.id, context, file: "nope.pdf" },
      ),
    );
    expect(missing).toHaveProperty("error");
    expect(jobs.enqueue).toHaveBeenCalledTimes(1);
  });
});
