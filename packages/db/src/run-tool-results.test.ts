import { describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import type { DataKey } from "./content-crypto.js";
import {
  clearRunToolResults,
  RUN_TOOL_RESULT_MAX_PER_RUN,
  readRunToolResult,
  saveRunToolResult,
} from "./run-tool-results.js";

const run = { runId: "run-1", spaceId: "space-1" };
const key = (spaceId: string): DataKey => ({
  id: `key-${spaceId}`,
  spaceId,
  version: 1,
  key: new Uint8Array(32).fill(spaceId === "space-1" ? 7 : 9),
});

type Row = Record<string, unknown> & { id: string; runId: string; spaceId: string };

function fixture(options: { encrypt?: boolean } = {}) {
  const rows: Row[] = [];
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([field, value]) => {
      if (field === "runId_toolCallId") {
        const pair = value as { runId: string; toolCallId: string };
        return row.runId === pair.runId && row.toolCallId === pair.toolCallId;
      }
      if (value && typeof value === "object" && "in" in value) {
        return (value as { in: unknown[] }).in.includes(row[field]);
      }
      return row[field] === value;
    });
  const client = {
    $contentEncryption: () =>
      options.encrypt
        ? {
            ring: {
              encryptWrites: true,
              current: async (spaceId: string) => key(spaceId),
              byId: async (id: string) => key(id.replace("key-", "")),
            },
          }
        : undefined,
    runToolResult: {
      findUnique: async ({ where }: { where: Record<string, unknown> }) =>
        rows.find((row) => matches(row, where)) ?? null,
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        rows.find((row) => matches(row, where)) ?? null,
      count: async ({ where }: { where: Record<string, unknown> }) =>
        rows.filter((row) => matches(row, where)).length,
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: Record<string, unknown>;
        create: Row;
        update: Partial<Row>;
      }) => {
        const found = rows.find((row) => matches(row, where));
        if (found) return Object.assign(found, update);
        rows.push(create);
        return create;
      },
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (matches(rows[i]!, where)) rows.splice(i, 1);
        }
        return { count: 0 };
      },
    },
  };
  return { client: client as unknown as PrismaClient, rows };
}

const body = `${Array.from({ length: 500 }, (_, i) => `row-${i}: customer-${i}`).join("\n")}\n`;

describe("run tool results", () => {
  it("pages a stored result and reports where the next page starts", async () => {
    const { client } = fixture();
    const handle = (await saveRunToolResult(client, run, {
      toolCallId: "call-1",
      toolName: "shell",
      text: body,
    }))!;
    const first = await readRunToolResult(client, run, { handle, length: 100 });
    expect(first).toMatchObject({
      tool: "shell",
      totalChars: body.length,
      offset: 0,
      text: body.slice(0, 100),
      nextOffset: 100,
    });
    const last = await readRunToolResult(client, run, { handle, offset: body.length - 10 });
    expect(last?.text).toBe(body.slice(-10));
    expect(last?.nextOffset).toBeUndefined();
  });

  it("finds literal matches case-insensitively and continues from an offset", async () => {
    const { client } = fixture();
    const handle = (await saveRunToolResult(client, run, {
      toolCallId: "call-1",
      toolName: "shell",
      text: body,
    }))!;
    const found = await readRunToolResult(client, run, { handle, grep: "CUSTOMER-42", context: 5 });
    expect(found?.matches?.[0]?.text).toContain("customer-42");
    expect(found?.matches?.[0]?.offset).toBe(body.indexOf("customer-42"));
    const many = await readRunToolResult(client, run, { handle, grep: "customer-" });
    expect(many?.matches).toHaveLength(20);
    expect(many?.hasMoreMatches).toBe(true);
    const next = await readRunToolResult(client, run, {
      handle,
      grep: "customer-",
      offset: many!.matches!.at(-1)!.offset + 1,
    });
    expect(next?.matches?.[0]?.offset).toBeGreaterThan(many!.matches!.at(-1)!.offset);
    // A regex is just text; it cannot run.
    expect((await readRunToolResult(client, run, { handle, grep: "row-.*" }))?.matches).toEqual([]);
  });

  it("does not let another run or another space read the handle", async () => {
    const { client } = fixture();
    const handle = (await saveRunToolResult(client, run, {
      toolCallId: "call-1",
      toolName: "shell",
      text: body,
    }))!;
    expect(await readRunToolResult(client, run, { handle })).toBeDefined();
    expect(await readRunToolResult(client, { ...run, runId: "run-2" }, { handle })).toBeUndefined();
    expect(
      await readRunToolResult(client, { ...run, spaceId: "space-2" }, { handle }),
    ).toBeUndefined();
    expect(await readRunToolResult(client, run, { handle: "unknown" })).toBeUndefined();
  });

  it("seals the text with the space key and refuses another space's key", async () => {
    const { client, rows } = fixture({ encrypt: true });
    const handle = (await saveRunToolResult(client, run, {
      toolCallId: "call-1",
      toolName: "shell",
      text: body,
    }))!;
    expect(String(rows[0]!.text)).toMatch(/^rkz1:/);
    expect(String(rows[0]!.text)).not.toContain("customer-1");
    expect((await readRunToolResult(client, run, { handle, length: 20 }))?.text).toBe(
      body.slice(0, 20),
    );
    // A row copied under another run no longer authenticates.
    rows[0]!.runId = "run-2";
    await expect(
      readRunToolResult(client, { ...run, runId: "run-2" }, { handle }),
    ).rejects.toThrow();
  });

  it("keeps a bounded number of results per run, replacing one call's own", async () => {
    const { client } = fixture();
    for (let i = 0; i < RUN_TOOL_RESULT_MAX_PER_RUN; i += 1) {
      expect(
        await saveRunToolResult(client, run, { toolCallId: `c${i}`, toolName: "t", text: "x" }),
      ).toBeDefined();
    }
    expect(
      await saveRunToolResult(client, run, { toolCallId: "over", toolName: "t", text: "x" }),
    ).toBeUndefined();
    expect(
      await saveRunToolResult(client, run, { toolCallId: "c0", toolName: "t", text: "y" }),
    ).toBeDefined();
  });

  it("is cleared when the run ends, leaving other runs alone", async () => {
    const { client, rows } = fixture();
    await saveRunToolResult(client, run, { toolCallId: "a", toolName: "t", text: "x" });
    await saveRunToolResult(
      client,
      { runId: "run-2", spaceId: "space-1" },
      { toolCallId: "a", toolName: "t", text: "x" },
    );
    await clearRunToolResults(client, [run.runId]);
    expect(rows.map((row) => row.runId)).toEqual(["run-2"]);
  });
});
