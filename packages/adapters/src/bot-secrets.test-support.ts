import type { PrismaClient } from "@corvo/db";
import { vi } from "vitest";

// No database is available offline, so these run against an in-memory stand-in for the
// bot_secrets table. Encryption, validation, and redaction are the real implementations.
type Row = {
  id: string;
  userId: string;
  spaceId: string;
  botId: string | null;
  name: string;
  origin: string;
  auth: unknown;
  ciphertext: string;
  scope?: string;
  grants?: Array<{ botId: string }>;
};
type Where = Record<string, unknown>;

// Prisma-style filter, enough for the credential queries: equality, `not`, AND, OR and a
// `grants: { some: { botId } }` relation. A row without a scope is a pre-Vault row (space).
export function matchesBotSecretWhere(row: Row, where: Where): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "AND") return (value as Where[]).every((part) => matchesBotSecretWhere(row, part));
    if (key === "OR") return (value as Where[]).some((part) => matchesBotSecretWhere(row, part));
    if (key === "grants") {
      const some = (value as { some: Where }).some;
      return (row.grants ?? []).some((grant) =>
        matchesBotSecretWhere(grant as unknown as Row, some),
      );
    }
    const field = key === "scope" ? (row.scope ?? "space") : row[key as keyof Row];
    if (value && typeof value === "object" && "not" in value) return field !== value.not;
    return field === value;
  });
}

export function fakeDatabase() {
  let rows: Row[] = [];
  const botSecret = {
    findFirst: vi.fn(async ({ where }: { where: Where }) => {
      const row = rows.find((r) => matchesBotSecretWhere(r, where));
      return row ? { ...row, grants: row.grants ?? [] } : null;
    }),
    findMany: vi.fn(async ({ where, take }: { where: Where; take?: number }) =>
      rows
        .filter((row) => matchesBotSecretWhere(row, where))
        .sort((left, right) => left.name.localeCompare(right.name))
        .slice(0, take ?? rows.length)
        .map((row) => ({ ...row, grants: row.grants ?? [] })),
    ),
    count: vi.fn(
      async ({ where }: { where: Where }) =>
        rows.filter((r) => matchesBotSecretWhere(r, where)).length,
    ),
    create: vi.fn(async ({ data }: { data: Row }) => {
      rows.push({ ...data });
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
      Object.assign(rows.find((row) => row.id === where.id)!, data);
    }),
    delete: vi.fn(async ({ where }: { where: { id: string } }) => {
      rows = rows.filter((row) => row.id !== where.id);
    }),
    deleteMany: vi.fn(async ({ where }: { where: Where }) => {
      const before = rows.length;
      rows = rows.filter((row) => !matchesBotSecretWhere(row, where));
      return { count: before - rows.length };
    }),
  };
  const client: Record<string, unknown> = {
    botSecret,
    botSecretGrant: {
      deleteMany: vi.fn(async ({ where }: { where: { secretId: string; botId: string } }) => {
        const row = rows.find((entry) => entry.id === where.secretId);
        if (row) row.grants = (row.grants ?? []).filter((grant) => grant.botId !== where.botId);
        return { count: 1 };
      }),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    botSecretUse: {
      create: vi.fn(async () => ({})),
      findFirst: vi.fn(async () => null),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    secret: { count: vi.fn(async () => 0) },
    integrationProviderConfig: { count: vi.fn(async () => 0) },
    $queryRaw: vi.fn(async () => []),
  };
  // One transaction at a time, as the bot row lock serializes them in Postgres, and a failed
  // one leaves the rows as they were.
  let queue: Promise<unknown> = Promise.resolve();
  client.$transaction = (fn: (tx: unknown) => Promise<unknown>) => {
    const next = queue.then(async () => {
      const before = rows.map((row) => ({ ...row }));
      try {
        return await fn(client);
      } catch (error) {
        rows = before;
        throw error;
      }
    });
    queue = next.catch(() => undefined);
    return next;
  };
  return {
    rows: () => rows,
    prisma: client as unknown as PrismaClient,
  };
}
