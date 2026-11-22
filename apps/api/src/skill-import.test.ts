import type { Actor } from "@corvo/contracts";
import { SKILL_IMPORT_MAX_BYTES } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import { createRouterClient } from "@orpc/server";
import { describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";
import { resolveSkillImport } from "./skill-import.js";

const SKILL = "---\nname: Weekly review\ndescription: Use when the week ends.\n---\n\nSteps.\n";
const PUBLIC = async () => [{ address: "185.199.108.133", family: 4 }];

function textResponse(body: string, init: ResponseInit = {}) {
  return new Response(body, { status: 200, headers: { "content-type": "text/plain" }, ...init });
}

describe("resolveSkillImport from a link", () => {
  it("fetches only the raw SKILL.md, once, with no redirect following", async () => {
    const fetch = vi.fn(async () => textResponse(SKILL));
    const content = await resolveSkillImport(
      { kind: "url", url: "https://github.com/acme/skills/tree/main/weekly" },
      { fetch, resolveHostname: PUBLIC },
    );
    expect(content).toContain("name: Weekly review");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [href, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(href).toBe("https://raw.githubusercontent.com/acme/skills/main/weekly/SKILL.md");
    expect(init.redirect).toBe("manual");
  });

  it("refuses other hosts before any request", async () => {
    const fetch = vi.fn(async () => textResponse(SKILL));
    await expect(
      resolveSkillImport({ kind: "url", url: "https://evil.test/a/b" }, { fetch }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      resolveSkillImport({ kind: "url", url: "http://169.254.169.254/latest" }, { fetch }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses an allowed host that resolves to a private address", async () => {
    const fetch = vi.fn(async () => textResponse(SKILL));
    await expect(
      resolveSkillImport(
        { kind: "url", url: "https://github.com/acme/skills" },
        { fetch, resolveHostname: async () => [{ address: "10.0.0.5", family: 4 }] },
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not follow a redirect, even to another GitHub host", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://raw.githubusercontent.com/other/repo/main/SKILL.md" },
        }),
    );
    await expect(
      resolveSkillImport(
        { kind: "url", url: "https://github.com/acme/skills" },
        { fetch, resolveHostname: PUBLIC },
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refuses an oversized body, a missing file and text that is not a skill", async () => {
    const cases = [
      textResponse(SKILL + "x".repeat(SKILL_IMPORT_MAX_BYTES + 1)),
      new Response("nope", { status: 404 }),
      textResponse("Just a README."),
    ];
    for (const response of cases) {
      await expect(
        resolveSkillImport(
          { kind: "url", url: "https://github.com/acme/skills" },
          { fetch: async () => response, resolveHostname: PUBLIC },
        ),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });
});

describe("resolveSkillImport from a zip", () => {
  it("refuses bytes that are not a zip", async () => {
    await expect(
      resolveSkillImport({ kind: "zip", dataBase64: Buffer.from("not a zip").toString("base64") }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("agentSkills routes", () => {
  const actor: Actor = {
    spaceId: "space-1",
    userId: "user-1",
    email: "user@corvo.test",
    isDeploymentOwner: false,
  };

  function setup(role: string) {
    const created: Array<Record<string, unknown>> = [];
    const prisma = {
      spaceMember: { findUnique: vi.fn(async () => ({ role, roles: [] })) },
      spaceRole: { findMany: vi.fn(async () => []) },
      agentSkill: {
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
        deleteMany: vi.fn(async () => ({ count: 1 })),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: "skill-1", createdAt: new Date(0), updatedAt: new Date(0), ...data };
          created.push(row);
          return row;
        }),
      },
    };
    const fetch = vi.fn(async () => textResponse(SKILL));
    const deps = {
      prisma: prisma as unknown as PrismaClient,
      skillImport: { fetch, resolveHostname: PUBLIC },
      env: {},
    } as unknown as RouterDeps;
    const client = createRouterClient(createRouter(deps), {
      context: { actor, stillAuthorized: async () => true },
    });
    return { client, prisma, fetch, created };
  }

  const link = { kind: "url", url: "https://github.com/acme/skills" } as const;

  it("lets an owner add a skill from a link and remove it", async () => {
    const { client, created, prisma } = setup("owner");
    const skill = await client.agentSkills.import(link);
    expect(skill).toMatchObject({ name: "Weekly review", source: "user" });
    expect(created).toHaveLength(1);
    await client.agentSkills.remove({ skillId: "skill-1" }).catch(() => undefined);
    expect(prisma.agentSkill.findFirst).toHaveBeenCalled();
  });

  it("refuses a member who is not an owner or admin, before any request", async () => {
    const { client, fetch, prisma } = setup("member");
    await expect(client.agentSkills.import(link)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      client.agentSkills.create({ name: "A", description: "B", body: "C" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(client.agentSkills.remove({ skillId: "skill-1" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(prisma.agentSkill.create).not.toHaveBeenCalled();
  });
});
