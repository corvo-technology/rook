import type { AdapterContext } from "@corvo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import { makePdf } from "./document-fixtures.test-support.js";
import { DOCUMENT_READ_CHARS, readThreadDocument } from "./thread-documents.js";

const context = {
  operationId: "op",
  traceId: "trace",
  spaceId: "space-1",
  userId: "user-1",
  botId: "bot-1",
  signal: new AbortController().signal,
} as AdapterContext & { botId: string };

type Row = { id: string; name: string; mimeType: string; size: number; storageKey: string };
const row = (id: string, name: string, mimeType: string, size = 100): Row => ({
  id,
  name,
  mimeType,
  size,
  storageKey: `key-${id}`,
});

/** A thread with these files attached (newest last); only these belong to this user and Space. */
function world(files: Array<Row & { bytes: Uint8Array; attached?: boolean }>) {
  const byId = new Map(files.map((file) => [file.id, file]));
  const prisma = {
    artifact: {
      findFirst: vi.fn(
        async ({ where }: { where: { id: string; spaceId: string; userId: string } }) =>
          where.spaceId === "space-1" && where.userId === "user-1"
            ? (byId.get(where.id) ?? null)
            : null,
      ),
    },
    message: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { blocks: { array_contains: Array<{ artifactId: string }> } };
        }) =>
          byId.get(where.blocks.array_contains[0]!.artifactId)?.attached === false
            ? null
            : { id: "m" },
      ),
      findMany: vi.fn(async () => [
        {
          blocks: [...files].reverse().map((file) => ({
            kind: "file",
            artifactId: file.id,
            name: file.name,
            mimeType: file.mimeType,
            size: file.size,
          })),
        },
      ]),
    },
  };
  const artifacts = {
    get: vi.fn(async (storageKey: string) => {
      const file = files.find((item) => item.storageKey === storageKey);
      if (!file) throw new Error("missing");
      return file.bytes;
    }),
  };
  return { prisma, artifacts };
}
const read = (w: ReturnType<typeof world>, input: { file?: string; offset?: number }) =>
  readThreadDocument(w as never, { threadId: "thread-1", context, ...input });

const alpha = {
  ...row("a1", "Alpha plan.pdf", "application/pdf"),
  bytes: makePdf(["Alpha is the client.", "Beta is the vendor."]),
};

describe("readThreadDocument", () => {
  it("lists the documents attached in the conversation, newest first, when no file is named", async () => {
    const w = world([
      alpha,
      { ...row("t1", "notes.txt", "text/plain"), bytes: new TextEncoder().encode("hi") },
      { ...row("v1", "clip.mp4", "video/mp4"), bytes: new Uint8Array() },
    ]);
    const result = (await read(w, {})) as { documents: Array<Record<string, unknown>> };
    expect(result.documents.map((d) => d.name)).toEqual([
      "clip.mp4",
      "notes.txt",
      "Alpha plan.pdf",
    ]);
    expect(result.documents[2]).toMatchObject({ path: "attachments/a1.pdf", readable: true });
    expect(result.documents[0]).toMatchObject({ readable: false });
  });

  it("reads a PDF by the path it was given, page by page, as data and not as instructions", async () => {
    const result = await read(world([alpha]), { file: "attachments/a1.pdf" });
    expect(result).toMatchObject({
      file: "Alpha plan.pdf",
      pages: 2,
      offset: 0,
      text: "[page 1]\nAlpha is the client.\n\n[page 2]\nBeta is the vendor.",
      untrusted: true,
    });
    expect(result).not.toHaveProperty("next_offset");
    expect(String((result as { note: string }).note)).toMatch(/data/i);
  });

  it("finds a file by its name too, ignoring case", async () => {
    const result = await read(world([alpha]), { file: "alpha PLAN.pdf" });
    expect(result).toMatchObject({ file: "Alpha plan.pdf" });
  });

  it("hands a long document over in parts, each saying where the next one starts", async () => {
    const long = {
      ...row("l1", "long.txt", "text/plain"),
      bytes: new TextEncoder().encode("x".repeat(DOCUMENT_READ_CHARS * 2 + 10)),
    };
    const w = world([long]);
    const first = (await read(w, { file: "attachments/l1.txt" })) as Record<string, unknown>;
    expect(String(first.text)).toHaveLength(DOCUMENT_READ_CHARS);
    expect(first.next_offset).toBe(DOCUMENT_READ_CHARS);
    expect(first.total_chars).toBe(DOCUMENT_READ_CHARS * 2 + 10);
    const last = (await read(w, {
      file: "attachments/l1.txt",
      offset: DOCUMENT_READ_CHARS * 2,
    })) as Record<string, unknown>;
    expect(String(last.text)).toHaveLength(10);
    expect(last).not.toHaveProperty("next_offset");
  });

  it("says a PDF has no text to read instead of handing over nothing, as with a scan", async () => {
    const scan = { ...row("s1", "scan.pdf", "application/pdf"), bytes: makePdf(["", ""]) };
    const result = (await read(world([scan]), { file: "attachments/s1.pdf" })) as Record<
      string,
      unknown
    >;
    expect(result.text).toBe("");
    expect(String(result.note)).toMatch(/no text/i);
  });

  it("refuses a file that is not attached to this conversation, though it is the person's", async () => {
    const elsewhere = { ...alpha, attached: false };
    expect(await read(world([elsewhere]), { file: "attachments/a1.pdf" })).toEqual({
      error: expect.stringMatching(/not attached to this conversation/i),
    });
  });

  it("refuses a file of another person or Space, and one that does not exist", async () => {
    const w = world([alpha]);
    expect(await read(w, { file: "attachments/nope.pdf" })).toEqual({
      error: expect.stringMatching(/no attached file/i),
    });
    const other = { ...context, userId: "someone-else" };
    expect(
      await readThreadDocument(w as never, {
        threadId: "thread-1",
        context: other,
        file: "attachments/a1.pdf",
      }),
    ).toEqual({ error: expect.stringMatching(/no attached file/i) });
  });

  it("refuses a file over the size limit before reading it", async () => {
    const big = { ...row("b1", "big.pdf", "application/pdf", 50_000_000), bytes: makePdf(["x"]) };
    const w = world([big]);
    const result = await readThreadDocument({ ...w, maxUploadSizeBytes: 1_000 } as never, {
      threadId: "thread-1",
      context,
      file: "attachments/b1.pdf",
    });
    expect(result).toEqual({ error: expect.stringMatching(/too large/i) });
    expect(w.artifacts.get).not.toHaveBeenCalled();
  });

  it("explains a kind of file it cannot read, and a PDF that is damaged", async () => {
    const video = { ...row("v1", "clip.mp4", "video/mp4"), bytes: new Uint8Array([1]) };
    expect(await read(world([video]), { file: "attachments/v1.mp4" })).toEqual({
      error: expect.stringMatching(/can read PDF, Word/i),
    });
    const broken = {
      ...row("p1", "broken.pdf", "application/pdf"),
      bytes: new TextEncoder().encode("not a pdf"),
    };
    expect(await read(world([broken]), { file: "attachments/p1.pdf" })).toEqual({
      error: expect.stringMatching(/not a readable PDF/i),
    });
  });

  it("says so when the file's bytes cannot be fetched, without a stack trace", async () => {
    const w = world([alpha]);
    w.artifacts.get.mockRejectedValueOnce(new Error("ENOENT: /data/artifacts/secret/path"));
    const result = (await read(w, { file: "attachments/a1.pdf" })) as { error: string };
    expect(result.error).toMatch(/could not be opened/i);
    expect(result.error).not.toContain("/data/artifacts");
  });
});
