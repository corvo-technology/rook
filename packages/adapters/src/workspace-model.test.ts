import { MEMBER_MONTHLY_LIMIT_RUN_ERROR, WORKSPACE_PERSONAL_MODEL_RUN_ERROR } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import { describe, expect, it, vi } from "vitest";
import type { ExecutorDeps } from "./executor-deps.js";
import { memberMonthlyLimitReached } from "./member-monthly-limit.js";
import { effectiveModelRole } from "./model-roles.js";
import { findConnectedModelCredential } from "./model-selection.js";
import { resolveModelKey } from "./run-model.js";

const SPACE = "space-1";
const OTHER_SPACE = "space-2";
const OWNER = "owner";
const MEMBER = "member";
const OUTSIDER = "outsider";

type World = {
  /** Spaces whose owner lent their models, by space id. */
  lent: Record<string, string>;
  members: Array<{ spaceId: string; userId: string; useOwnModel?: boolean }>;
  settings?: Record<string, { monthlyTokenLimit?: bigint | null }>;
  /** Connections by user: provider to secret plaintext. */
  connections: Record<string, Record<string, string>>;
  usedTokens?: number;
  runningRuns?: number;
};

function world(input: World) {
  const credentialRows = Object.entries(input.connections).flatMap(([userId, providers]) =>
    Object.keys(providers).map((provider) => ({
      id: `credential-${userId}-${provider}`,
      userId,
      provider,
      label: provider,
      secretId: `secret-${userId}-${provider}`,
      supportsImages: false,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    })),
  );
  const secrets = new Map(
    Object.entries(input.connections).flatMap(([userId, providers]) =>
      Object.entries(providers).map(([provider, plaintext]) => [
        `secret-${userId}-${provider}`,
        { id: `secret-${userId}-${provider}`, userId, ciphertext: plaintext },
      ]),
    ),
  );
  const secretReads: string[] = [];
  const prisma = {
    spaceModelConnection: {
      findUnique: async ({ where }: { where: { spaceId: string } }) =>
        input.lent[where.spaceId] ? { ownerUserId: input.lent[where.spaceId] } : null,
    },
    spaceMember: {
      findUnique: async ({
        where,
      }: {
        where: { spaceId_userId: { spaceId: string; userId: string } };
      }) => {
        const row = input.members.find(
          (member) =>
            member.spaceId === where.spaceId_userId.spaceId &&
            member.userId === where.spaceId_userId.userId,
        );
        return row ? { modelSetting: { useOwnModel: row.useOwnModel ?? false } } : null;
      },
    },
    spaceMemberModelSetting: {
      findUnique: async ({
        where,
      }: {
        where: { spaceId_userId: { spaceId: string; userId: string } };
      }) => input.settings?.[where.spaceId_userId.userId] ?? null,
    },
    userModelPreference: { findMany: async () => [], findFirst: async () => null },
    userModelCredential: {
      findMany: async ({ where }: { where: { userId: string } }) =>
        credentialRows.filter((row) => row.userId === where.userId),
      findFirst: async () => null,
    },
    userModelRoleChoice: {
      findMany: async ({ where }: { where: { userId: string; role: string } }) =>
        where.userId === OWNER && where.role === "main"
          ? [
              {
                role: "main",
                position: 0,
                provider: "anthropic",
                modelId: "claude-sonnet-4-5",
                thinkingLevel: null,
                credentialId: `credential-${OWNER}-anthropic`,
              },
            ]
          : [],
    },
    spaceModelRoleChoice: { findMany: async () => [] },
    spaceSettingOverride: { findUnique: async () => null, findFirst: async () => null },
    secret: {
      findFirst: async ({ where }: { where: { id: string; userId: string } }) => {
        secretReads.push(`${where.userId}:${where.id}`);
        const row = secrets.get(where.id);
        return row && row.userId === where.userId ? row : null;
      },
    },
    run: { count: async () => input.runningRuns ?? 0 },
    $queryRaw: async () => [{ tokens: BigInt(input.usedTokens ?? 0) }],
  };
  return { prisma: prisma as unknown as PrismaClient, secretReads };
}

const secretStore = { load: async (ciphertext: string) => ciphertext };

describe("a connection the owner lent to the space", () => {
  const base: World = {
    lent: { [SPACE]: OWNER },
    members: [
      { spaceId: SPACE, userId: OWNER },
      { spaceId: SPACE, userId: MEMBER },
      { spaceId: OTHER_SPACE, userId: OUTSIDER },
    ],
    connections: { [OWNER]: { anthropic: "sk-owner-key" }, [OUTSIDER]: { anthropic: "sk-out" } },
  };

  it("serves a member, whose own connections stay out of it", async () => {
    const { prisma } = world({
      ...base,
      connections: { ...base.connections, [MEMBER]: { anthropic: "sk-member-key" } },
    });
    const found = await findConnectedModelCredential(
      prisma,
      secretStore,
      { userId: MEMBER, spaceId: SPACE },
      "anthropic",
    );
    expect(found?.userId).toBe(OWNER);
  });

  it("serves a member with no connection of their own", async () => {
    const { prisma } = world(base);
    const found = await findConnectedModelCredential(
      prisma,
      secretStore,
      { userId: MEMBER, spaceId: SPACE },
      "anthropic",
    );
    expect(found?.id).toBe(`credential-${OWNER}-anthropic`);
  });

  it("follows the owner's main model for a member who chose nothing", async () => {
    const { prisma } = world(base);
    const role = await effectiveModelRole(prisma, { userId: MEMBER, spaceId: SPACE }, "main", {});
    expect(role.primary).toMatchObject({ provider: "anthropic", modelId: "claude-sonnet-4-5" });
  });

  it("is left by a member who chose their own connections", async () => {
    const { prisma } = world({
      ...base,
      members: base.members.map((m) => (m.userId === MEMBER ? { ...m, useOwnModel: true } : m)),
      connections: { ...base.connections, [MEMBER]: { anthropic: "sk-member-key" } },
    });
    const found = await findConnectedModelCredential(
      prisma,
      secretStore,
      { userId: MEMBER, spaceId: SPACE },
      "anthropic",
    );
    expect(found?.userId).toBe(MEMBER);
  });

  it("changes nothing for the owner", async () => {
    const { prisma } = world(base);
    const found = await findConnectedModelCredential(
      prisma,
      secretStore,
      { userId: OWNER, spaceId: SPACE },
      "anthropic",
    );
    expect(found?.userId).toBe(OWNER);
  });

  it("does not reach a member of another space", async () => {
    const { prisma } = world(base);
    const found = await findConnectedModelCredential(
      prisma,
      secretStore,
      { userId: OUTSIDER, spaceId: OTHER_SPACE },
      "anthropic",
    );
    expect(found?.userId).toBe(OUTSIDER);
    const none = await findConnectedModelCredential(
      prisma,
      secretStore,
      { userId: "someone-else", spaceId: OTHER_SPACE },
      "anthropic",
    );
    expect(none).toBeNull();
  });

  it("is gone at once for someone removed from the space", async () => {
    const { prisma } = world({
      ...base,
      members: base.members.filter((member) => member.userId !== MEMBER),
    });
    const found = await findConnectedModelCredential(
      prisma,
      secretStore,
      { userId: MEMBER, spaceId: SPACE },
      "anthropic",
    );
    expect(found).toBeNull();
  });

  it("changes nothing in a space where nothing is lent", async () => {
    const { prisma } = world({
      ...base,
      lent: {},
      connections: { ...base.connections, [MEMBER]: { anthropic: "sk-member-key" } },
    });
    const found = await findConnectedModelCredential(
      prisma,
      secretStore,
      { userId: MEMBER, spaceId: SPACE },
      "anthropic",
    );
    expect(found?.userId).toBe(MEMBER);
  });
});

describe("running on a lent connection", () => {
  const deps = (prisma: PrismaClient) =>
    ({ prisma, secretStore, billingEnabled: false }) as unknown as ExecutorDeps;
  const lent: World = {
    lent: { [SPACE]: OWNER },
    members: [
      { spaceId: SPACE, userId: OWNER },
      { spaceId: SPACE, userId: MEMBER },
    ],
    connections: { [OWNER]: { anthropic: "sk-owner-key" } },
  };

  it("uses the owner's key for the member's run", async () => {
    const { prisma, secretReads } = world(lent);
    const credential = await findConnectedModelCredential(
      prisma,
      secretStore,
      { userId: MEMBER, spaceId: SPACE },
      "anthropic",
    );
    const resolved = await resolveModelKey(
      deps(prisma),
      MEMBER,
      SPACE,
      credential,
      "anthropic",
      "claude-sonnet-4-5",
    );
    expect(resolved.apiKey).toBe("sk-owner-key");
    expect(secretReads).toEqual([`${OWNER}:secret-${OWNER}-anthropic`]);
  });

  it("refuses a personal sign-in", async () => {
    const oauth = JSON.stringify({
      type: "oauth",
      access: "a",
      refresh: "r",
      expires: Date.now() + 60_000,
    });
    const { prisma } = world({ ...lent, connections: { [OWNER]: { anthropic: oauth } } });
    const credential = await findConnectedModelCredential(
      prisma,
      secretStore,
      { userId: MEMBER, spaceId: SPACE },
      "anthropic",
    );
    await expect(
      resolveModelKey(deps(prisma), MEMBER, SPACE, credential, "anthropic", "claude-sonnet-4-5"),
    ).rejects.toThrow(WORKSPACE_PERSONAL_MODEL_RUN_ERROR);
  });

  it("refuses a coding agent signed in on someone's computer", async () => {
    const { prisma } = world(lent);
    await expect(
      resolveModelKey(deps(prisma), MEMBER, SPACE, null, "cli-engine", "claude"),
    ).rejects.toThrow(WORKSPACE_PERSONAL_MODEL_RUN_ERROR);
  });
});

describe("a member's monthly limit", () => {
  const limited = (overrides: Partial<World> = {}): World => ({
    lent: { [SPACE]: OWNER },
    members: [
      { spaceId: SPACE, userId: OWNER },
      { spaceId: SPACE, userId: MEMBER },
    ],
    settings: { [MEMBER]: { monthlyTokenLimit: 1_000n } },
    connections: { [OWNER]: { anthropic: "sk-owner-key" } },
    ...overrides,
  });
  const run = (userId = MEMBER) => ({ id: "run-1", userId, spaceId: SPACE });

  it("has a clear message", () => {
    expect(MEMBER_MONTHLY_LIMIT_RUN_ERROR).toBe(
      "You reached your monthly limit on this space's model.",
    );
  });

  it("stops a run once the month's tokens reach it", async () => {
    const { prisma } = world(limited({ usedTokens: 1_000 }));
    expect(await memberMonthlyLimitReached(prisma, run())).toBe(true);
  });

  it("lets a run start below it", async () => {
    const { prisma } = world(limited({ usedTokens: 500 }));
    expect(await memberMonthlyLimitReached(prisma, run())).toBe(false);
  });

  it("counts what runs in flight may still spend, so runs started together do not all pass", async () => {
    const { prisma } = world(limited({ usedTokens: 850, runningRuns: 2 }));
    expect(await memberMonthlyLimitReached(prisma, run())).toBe(true);
    const calm = world(limited({ usedTokens: 850, runningRuns: 0 }));
    expect(await memberMonthlyLimitReached(calm.prisma, run())).toBe(false);
  });

  it("never limits the owner's own runs", async () => {
    const { prisma } = world(
      limited({ usedTokens: 5_000, settings: { [OWNER]: { monthlyTokenLimit: 1n } } }),
    );
    expect(await memberMonthlyLimitReached(prisma, run(OWNER))).toBe(false);
  });

  it("does not apply to a member on their own connections", async () => {
    const { prisma } = world(
      limited({
        usedTokens: 5_000,
        members: [
          { spaceId: SPACE, userId: OWNER },
          { spaceId: SPACE, userId: MEMBER, useOwnModel: true },
        ],
      }),
    );
    expect(await memberMonthlyLimitReached(prisma, run())).toBe(false);
  });

  it("does not apply when nothing is lent or no limit is set", async () => {
    const none = world(limited({ usedTokens: 5_000, lent: {} }));
    expect(await memberMonthlyLimitReached(none.prisma, run())).toBe(false);
    const open = world(limited({ usedTokens: 5_000, settings: {} }));
    const queried = vi.spyOn(open.prisma, "$queryRaw");
    expect(await memberMonthlyLimitReached(open.prisma, run())).toBe(false);
    expect(queried).not.toHaveBeenCalled();
  });
});
