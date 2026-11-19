import type { PartnerTemplate } from "@corvo/contracts";
import type { PartnerEntry } from "@corvo/db";
import { describe, expect, it, vi } from "vitest";
import type { PartnerMemberDeps } from "./partner-members.js";
import {
  admitPartnerEntry,
  onlyAgentsSeenBy,
  sealMemberAgents,
  visibleAgentIds,
} from "./partner-members.js";

const agent = (key: string) => ({ key, name: key, instructions: "", usesConnector: true });

const TEMPLATE: PartnerTemplate = {
  connector: { slug: "acme-system", name: "Acme System", endpoint: "https://mcp.example.test/mcp" },
  agents: [agent("recepcao"), agent("escriba"), agent("gestor")],
  roles: {
    reception: { agents: ["recepcao"], permissions: ["talk_to_agents"] },
    professional: { agents: ["escriba"], permissions: ["talk_to_agents"] },
  },
};

const entry = (over: Partial<PartnerEntry> = {}): PartnerEntry => ({
  userId: "owner-user",
  tenantId: "tenant-1",
  partnerId: "partner-1",
  organizationId: "org-1",
  externalUserId: "ext-1",
  externalEmail: null,
  role: null,
  scope: null,
  ...over,
});

function fixture() {
  const deps = {
    template: vi.fn(async () => TEMPLATE),
    admit: vi.fn(async (input: { role: string; externalUserId: string; ownerUserId: string }) => ({
      userId: input.role === "owner" ? input.ownerUserId : `user-of-${input.externalUserId}`,
      previousRole: null,
      created: true,
    })),
    installForMember: vi.fn(async () => ({ botIds: {} })),
    seal: vi.fn(async () => undefined),
  } satisfies PartnerMemberDeps;
  return deps;
}

describe("admitPartnerEntry", () => {
  it("opens the owner for a session without a role, as before roles existed", async () => {
    const deps = fixture();
    const result = await admitPartnerEntry(deps, entry({ role: null }));
    expect(result.userId).toBe("owner-user");
    expect(result.role.owner).toBe(true);
    expect(deps.admit).toHaveBeenCalledWith(
      expect.objectContaining({ role: "owner", ownerUserId: "owner-user" }),
    );
    expect(deps.installForMember).not.toHaveBeenCalled();
    expect(deps.seal).not.toHaveBeenCalled();
  });

  it("opens a user of their own for any other role, with only that role's agents", async () => {
    const deps = fixture();
    const result = await admitPartnerEntry(
      deps,
      entry({ role: "reception", scope: { branchIds: ["b-1"] } }),
    );
    expect(result.userId).toBe("user-of-ext-1");
    expect(deps.admit).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "reception",
        scope: { branchIds: ["b-1"] },
        permissions: ["talk_to_agents"],
      }),
    );
    const [, partnerId, content] = deps.installForMember.mock.calls[0] as unknown as [
      unknown,
      string,
      { agents: Array<{ key: string }>; forUserId: string; connectorSlug: string },
    ];
    expect(partnerId).toBe("partner-1");
    expect(content.agents.map((a) => a.key)).toEqual(["recepcao"]);
    expect(content.forUserId).toBe("user-of-ext-1");
    expect(content.connectorSlug).toBe("acme-system");
  });

  it("gives two people of the same role their own copies, never a shared one", async () => {
    const deps = fixture();
    await admitPartnerEntry(deps, entry({ role: "professional", externalUserId: "ext-1" }));
    await admitPartnerEntry(deps, entry({ role: "professional", externalUserId: "ext-2" }));
    const owners = deps.installForMember.mock.calls.map(
      (call) => (call as unknown as [unknown, string, { forUserId: string }])[2].forUserId,
    );
    expect(owners).toEqual(["user-of-ext-1", "user-of-ext-2"]);
  });

  it("applies a changed role from the next session: new rights, new agents, old ones sealed off", async () => {
    const deps = fixture();
    await admitPartnerEntry(deps, entry({ role: "reception" }));
    await admitPartnerEntry(deps, entry({ role: "professional" }));
    const roles = deps.admit.mock.calls.map((call) => call[0].role);
    expect(roles).toEqual(["reception", "professional"]);
    const sealed = deps.seal.mock.calls.map((call) => call[0].allowedAgentKeys);
    expect(sealed).toEqual([["recepcao"], ["escriba"]]);
  });

  it("gives a role the template never heard of no agents, and still records them", async () => {
    const deps = fixture();
    const result = await admitPartnerEntry(deps, entry({ role: "intern" }));
    expect(result.role.agents).toEqual([]);
    expect(deps.admit).toHaveBeenCalledTimes(1);
    expect(deps.installForMember).not.toHaveBeenCalled();
    expect(deps.seal).toHaveBeenCalledWith(expect.objectContaining({ allowedAgentKeys: [] }));
  });

  it("gives a partner without a template the owner's account and nothing for anyone else", async () => {
    const deps = fixture();
    deps.template.mockResolvedValue(undefined as never);
    const result = await admitPartnerEntry(deps, entry({ role: "reception" }));
    expect(result.role.agents).toEqual([]);
    expect(deps.installForMember).not.toHaveBeenCalled();
  });
});

describe("agents seen by each person", () => {
  const bots = [
    { id: "chief", userId: "owner", audienceRestricted: true, audienceUserIds: [] },
    { id: "open", userId: "owner", audienceRestricted: false, audienceUserIds: [] },
    { id: "ana-copy", userId: "owner", audienceRestricted: true, audienceUserIds: ["ana"] },
    { id: "bia-copy", userId: "owner", audienceRestricted: true, audienceUserIds: ["bia"] },
  ];

  it("shows each person their own copy and nobody else's, the owner included", () => {
    expect([...visibleAgentIds(bots, "ana")].sort()).toEqual(["ana-copy", "open"]);
    expect([...visibleAgentIds(bots, "bia")].sort()).toEqual(["bia-copy", "open"]);
    expect([...visibleAgentIds(bots, "owner")].sort()).toEqual(["chief", "open"]);
  });

  it("lists every agent as before outside a partner's customer", async () => {
    const prisma = {
      partnerTenant: { findFirst: vi.fn(async () => null) },
      bot: { findMany: vi.fn() },
    };
    const all = [{ id: "a" }, { id: "b" }];
    await expect(
      onlyAgentsSeenBy(prisma as never, { spaceId: "s", userId: "u" }, all),
    ).resolves.toEqual(all);
    expect(prisma.bot.findMany).not.toHaveBeenCalled();
  });

  it("hides the copies of other people in a partner's customer", async () => {
    const prisma = {
      partnerTenant: { findFirst: vi.fn(async () => ({ id: "t" })) },
      bot: { findMany: vi.fn(async () => bots.filter((bot) => bot.audienceRestricted)) },
    };
    const listed = bots.map(({ id }) => ({ id }));
    const forAna = await onlyAgentsSeenBy(
      prisma as never,
      { spaceId: "org-1", userId: "ana" },
      listed,
    );
    expect(forAna.map((bot) => bot.id).sort()).toEqual(["ana-copy", "open"]);
  });
});

describe("sealMemberAgents", () => {
  it("archives the copies a role no longer has, restores those it has again, and closes the owner's agents", async () => {
    const update = vi.fn(async () => ({}));
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const prisma = {
      bot: {
        findMany: vi.fn(async () => [
          { id: "b1", spawnKey: "partner:p:recepcao:m:u1", archivedAt: null },
          { id: "b2", spawnKey: "partner:p:escriba:m:u1", archivedAt: new Date() },
        ]),
        update,
        updateMany,
      },
    };
    await sealMemberAgents(prisma as never, {
      organizationId: "org",
      ownerUserId: "owner",
      partnerId: "p",
      userId: "u1",
      allowedAgentKeys: ["escriba"],
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { archivedAt: expect.any(Date) },
    });
    expect(update).toHaveBeenCalledWith({ where: { id: "b2" }, data: { archivedAt: null } });
    expect(updateMany).toHaveBeenCalledWith({
      where: { spaceId: "org", userId: "owner", audienceRestricted: false },
      data: { audienceRestricted: true, audienceUserIds: [], audienceRoleIds: [] },
    });
  });
});
