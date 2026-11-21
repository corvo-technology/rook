import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createMcpAccessKey,
  findMcpAccessKey,
  listMcpAccessKeys,
  McpAccessKeyNotFoundError,
  revokeMcpAccessKey,
} from "./mcp-access-keys.js";
import { runAsSystem, runAsTenant } from "./row-security.js";
import { wikiTestFixture } from "./wiki-test-fixture.js";

const describePostgres =
  process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe.sequential : describe.skip;

describePostgres("MCP access keys (PostgreSQL)", () => {
  let fx: Awaited<ReturnType<typeof wikiTestFixture>>;
  beforeAll(async () => {
    fx = await wikiTestFixture();
  });
  afterAll(() => fx?.close());

  const as = <T>(userId: string, work: () => Promise<T>) =>
    runAsTenant({ spaceId: fx.spaceId, userId }, work);

  it("keeps each person's keys from the other, in a list and by id", async () => {
    const mine = await as(fx.userId, () =>
      createMcpAccessKey(fx.prisma, fx.userId, { name: "mine", level: "talk" }),
    );
    const theirs = await as(fx.otherUserId, () =>
      createMcpAccessKey(fx.prisma, fx.otherUserId, { name: "theirs", level: "read" }),
    );
    expect(
      (await as(fx.userId, () => listMcpAccessKeys(fx.prisma, fx.userId))).map((k) => k.id),
    ).toEqual([mine.key.id]);
    // Even asking for another person's rows by user id returns none under this person's context.
    expect(await as(fx.userId, () => listMcpAccessKeys(fx.prisma, fx.otherUserId))).toEqual([]);
    await expect(
      as(fx.userId, () => revokeMcpAccessKey(fx.prisma, fx.otherUserId, theirs.key.id)),
    ).rejects.toBeInstanceOf(McpAccessKeyNotFoundError);
    expect(await findKey(theirs.secret)).not.toBeNull();
  });

  it("finds a key by its secret as a named system read, and not once revoked", async () => {
    const made = await as(fx.userId, () =>
      createMcpAccessKey(fx.prisma, fx.userId, { name: "cli", level: "configure" }),
    );
    expect(await findKey(made.secret)).toMatchObject({ userId: fx.userId, level: "configure" });
    await as(fx.userId, () => revokeMcpAccessKey(fx.prisma, fx.userId, made.key.id));
    expect(await findKey(made.secret)).toBeNull();
  });

  const findKey = (secret: string) =>
    runAsSystem("test lookup", () => findMcpAccessKey(fx.prisma, secret));
});
