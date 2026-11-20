import { beforeEach, describe, expect, it, vi } from "vitest";

const membership = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("@corvo/db", () => ({
  getSpaceMembershipFor: (...args: unknown[]) => membership(...args),
  runAsSystem: (_why: string, fn: () => unknown) => fn(),
}));

import { appMapTools } from "./run-tools-app-map.js";

function ctxFor(partners = 0) {
  return {
    deps: {
      prisma: {
        space: { findUnique: vi.fn(async () => ({ organizationId: "org-1" })) },
        partnerMember: { count: vi.fn(async () => partners) },
      },
    },
    run: { spaceId: "space-1", userId: "user-1" },
  } as unknown as Parameters<(typeof appMapTools)["find_in_app"]>[0];
}

const run = (ctx: ReturnType<typeof ctxFor>, args: Record<string, unknown>) => {
  const finish = vi.fn(async (result: unknown) => result);
  return appMapTools.find_in_app!(ctx, { name: "find_in_app", args, finish } as never) as Promise<
    Record<string, any>
  >;
};

beforeEach(() => membership.mockReset());

describe("find_in_app", () => {
  it("points an owner to the billing settings with a link", async () => {
    membership.mockResolvedValue({ isOwner: true, roleIds: [], permissions: [] });
    const result = await run(ctxFor(), { query: "how do I change my plan", language: "en" });
    expect(result.matches[0]).toMatchObject({ title: "Billing", link: "/settings/billing" });
    expect(result.locked).toBeUndefined();
  });

  it("answers in Portuguese when the person speaks it", async () => {
    membership.mockResolvedValue({ isOwner: true, roleIds: [], permissions: [] });
    const result = await run(ctxFor(), { query: "onde conecto o Gmail", language: "pt-BR" });
    expect(result.matches[0]).toMatchObject({ title: "Conexões", link: "/settings/connections" });
  });

  it("never links a plain member to an owner-only screen and says who can open it", async () => {
    membership.mockResolvedValue({ isOwner: false, roleIds: [], permissions: [] });
    const result = await run(ctxFor(), { query: "change my plan", language: "en" });
    expect(result.matches.map((match: { link: string }) => match.link)).not.toContain(
      "/settings/billing",
    );
    expect(result.locked[0]).toMatchObject({
      title: "Billing",
      availableTo: "space owners and admins",
    });
  });

  it("treats someone who left the space or a failed lookup as a plain member", async () => {
    membership.mockRejectedValue(new Error("db down"));
    const result = await run(ctxFor(), { query: "invite someone" });
    expect(result.matches.map((match: { link: string }) => match.link)).not.toContain(
      "/settings/members",
    );
    membership.mockResolvedValue(null);
    const gone = await run(ctxFor(), { query: "invite someone" });
    expect(gone.locked[0].title).toBe("Members");
  });

  it("shows the partner console only to an owner of a partner organization", async () => {
    membership.mockResolvedValue({ isOwner: true, roleIds: [], permissions: [] });
    const plain = await run(ctxFor(0), { query: "partner console" });
    expect(plain.locked[0]).toMatchObject({ availableTo: "partners" });
    const partner = await run(ctxFor(1), { query: "partner console" });
    expect(partner.matches[0].link).toBe("/app/partner");
  });

  it("says it does not know when nothing matches, and needs a query", async () => {
    membership.mockResolvedValue({ isOwner: true, roleIds: [], permissions: [] });
    const none = await run(ctxFor(), { query: "zzzz qqqq" });
    expect(none.matches).toEqual([]);
    expect(none.note).toContain("do not know");
    expect((await run(ctxFor(), { query: " " })).error).toContain("needs a query");
  });
});
