import type { Mailbox } from "@corvo/adapters";
import { FakeMailbox } from "@corvo/adapters";
import { describe, expect, it } from "vitest";
import { createMailboxService } from "./mailboxes.js";

const scope = { spaceId: "space-1", userId: "owner" };
const input = {
  address: "owner@example.test",
  username: "owner",
  password: "app-password-123",
  imap: { host: "imap.example.test", port: 993, secure: true },
  smtp: { host: "smtp.example.test", port: 465, secure: true },
};

function fakePrisma(bots: Array<{ id: string; userId: string }>) {
  const mailboxes: Array<Record<string, any>> = [];
  const grants: Array<{ mailboxId: string; botId: string }> = [];
  const secrets: Array<Record<string, any>> = [];
  const tx = {
    secret: {
      create: async ({ data }: any) => secrets.push(data),
      deleteMany: async ({ where }: any) => {
        for (let i = secrets.length - 1; i >= 0; i -= 1)
          if (secrets[i]!.id === where.id) secrets.splice(i, 1);
      },
    },
    mailbox: {
      create: async ({ data }: any) => {
        const row = { id: `mbx-${mailboxes.length + 1}`, createdAt: new Date(0), ...data };
        mailboxes.push(row);
        return { ...row, grants: [] };
      },
      delete: async ({ where }: any) => {
        mailboxes.splice(
          mailboxes.findIndex((row) => row.id === where.id),
          1,
        );
      },
    },
    botMailbox: {
      deleteMany: async ({ where }: any) => {
        const keep = grants.filter(
          (g) => g.mailboxId !== where.mailboxId || where.botId.notIn.includes(g.botId),
        );
        grants.splice(0, grants.length, ...keep);
      },
      createMany: async ({ data }: any) => {
        for (const item of data)
          if (!grants.some((g) => g.mailboxId === item.mailboxId && g.botId === item.botId))
            grants.push(item);
      },
    },
  };
  const withGrants = (row: Record<string, any>) => ({
    ...row,
    grants: grants.filter((g) => g.mailboxId === row.id).map((g) => ({ botId: g.botId })),
  });
  const prisma = {
    $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx),
    mailbox: {
      ...tx.mailbox,
      findMany: async () => mailboxes.map(withGrants),
      findFirst: async ({ where }: any) => {
        const row = mailboxes.find(
          (m) => m.id === where.id && m.userId === where.userId && m.spaceId === where.spaceId,
        );
        return row ? withGrants(row) : null;
      },
    },
    bot: {
      findMany: async ({ where }: any) =>
        bots.filter((bot) => where.id.in.includes(bot.id) && bot.userId === where.userId),
    },
  };
  return { prisma: prisma as never, mailboxes, grants, secrets };
}

function service(
  bots: Array<{ id: string; userId: string }>,
  mailbox: Mailbox = new FakeMailbox(),
) {
  const db = fakePrisma(bots);
  const stored: string[] = [];
  const api = createMailboxService({
    prisma: db.prisma,
    secrets: {
      put: async (plaintext: string) => {
        stored.push(plaintext);
        return { id: "secret-1", ciphertext: "ciphertext-1" };
      },
    } as never,
    allowPrivateEndpoint: false,
    open: () => mailbox,
  });
  return { api, db, stored };
}

describe("mailbox service", () => {
  it("checks the login before saving and keeps the password out of the row", async () => {
    const { api, db, stored } = service([]);
    const created = await api.create(scope, input, new AbortController().signal);
    expect(created).toMatchObject({ address: "owner@example.test", botIds: [] });
    expect(stored).toEqual(["app-password-123"]);
    expect(JSON.stringify(db.mailboxes)).not.toContain("app-password-123");
    expect(JSON.stringify(created)).not.toContain("app-password-123");
    expect(db.secrets[0]).toMatchObject({ ciphertext: "ciphertext-1", kind: "mailbox" });
  });

  it("saves nothing when the server refuses the login, and hides the password in the reason", async () => {
    const refusing = new FakeMailbox();
    refusing.verify = async () => {
      throw new Error("AUTH failed for app-password-123");
    };
    const { api, db, stored } = service([], refusing);
    const error = await api.create(scope, input, new AbortController().signal).catch((e) => e);
    expect(error.message).toMatch(/Could not sign in/);
    expect(error.message).not.toContain("app-password-123");
    expect(stored).toHaveLength(0);
    expect(db.mailboxes).toHaveLength(0);
  });

  it("gives a mailbox only to the owner's own agents", async () => {
    const { api } = service([
      { id: "mine", userId: "owner" },
      { id: "theirs", userId: "someone-else" },
    ]);
    const { id } = await api.create(scope, input, new AbortController().signal);
    await expect(api.setAgents(scope, id, ["mine", "theirs"])).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect((await api.list(scope))[0]!.botIds).toEqual([]);
    expect((await api.setAgents(scope, id, ["mine"])).botIds).toEqual(["mine"]);
    expect((await api.setAgents(scope, id, [])).botIds).toEqual([]);
  });

  it("does not show or change another user's mailbox", async () => {
    const { api } = service([{ id: "mine", userId: "owner" }]);
    const { id } = await api.create(scope, input, new AbortController().signal);
    const stranger = { spaceId: "space-1", userId: "stranger" };
    await expect(api.setAgents(stranger, id, [])).rejects.toMatchObject({ code: "NOT_FOUND" });
    await api.remove(stranger, id);
    expect(await api.list(scope)).toHaveLength(1);
  });

  it("removes the mailbox and its saved password", async () => {
    const { api, db } = service([]);
    const { id } = await api.create(scope, input, new AbortController().signal);
    await api.remove(scope, id);
    expect(db.mailboxes).toHaveLength(0);
    expect(db.secrets).toHaveLength(0);
  });
});
