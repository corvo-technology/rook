import { businessCopy } from "@corvo/core";
import { describe, expect, it, vi } from "vitest";
import { businessWikiBody, readHomeChecklist } from "./onboarding-profile.js";

describe("businessWikiBody", () => {
  it("leads with the person's sentence, which the wiki index shows to every agent", () => {
    const body = businessWikiBody({ kind: "agency", summary: "We run ads for dentists" });
    expect(body).toContain("---\ntype: Business\n---\nWe run ads for dentists.\n");
    expect(body).toContain("Type of business: Agency.");
  });

  it("falls back to the kind when there is no sentence", () => {
    expect(businessWikiBody({ kind: "clinic", summary: "" })).toContain("\nClinic or practice.\n");
  });

  it("is written in the member's language, with no English left in pt-BR", () => {
    const body = businessWikiBody({ kind: "clinic", summary: "" }, "pt-BR");
    expect(body).toBe(
      "---\ntype: Negócio\n---\nClínica ou consultório.\n\nTipo de negócio: Clínica ou consultório.\n",
    );
    expect(businessCopy("pt-BR").title).toBe("Sobre o negócio");
    expect(businessCopy("pt").title).toBe("Sobre o negócio");
  });

  it("has a title in every shipped language and reads English for any other", () => {
    for (const locale of ["en", "pt-BR", "es", "de", "fr", "ja", "zh-CN"]) {
      expect(businessCopy(locale).title).toBeTruthy();
    }
    expect(businessCopy("pt-BR").title).not.toBe(businessCopy("en").title);
    expect(businessCopy("sv").title).toBe("About the business");
  });
});

describe("readHomeChecklist", () => {
  function prisma(counts: Record<string, number>) {
    const count = (key: string) => vi.fn(async () => counts[key] ?? 0);
    return {
      run: { count: count("run") },
      connection: { count: count("connection") },
      routine: { count: count("routine") },
      spaceMember: { count: count("members") },
      spaceInvitation: { count: count("invitations") },
      bot: { findFirst: vi.fn(async () => ({ id: "chief" })) },
    } as never;
  }
  const scope = { spaceId: "s", userId: "u" };

  it("marks what the space already has and points at the Chief", async () => {
    const list = await readHomeChecklist(prisma({ connection: 1, invitations: 1 }), scope);
    expect(list).toMatchObject({ done: 2, total: 4, chiefId: "chief" });
    expect(list?.items.filter((item) => item.done).map((item) => item.id)).toEqual([
      "connect",
      "invite",
    ]);
  });

  it("counts a second member as an invitation", async () => {
    const list = await readHomeChecklist(prisma({ members: 2 }), scope);
    expect(list?.items.find((item) => item.id === "invite")?.done).toBe(true);
  });

  it("is null once everything is done", async () => {
    expect(
      await readHomeChecklist(prisma({ run: 1, connection: 1, routine: 1, members: 2 }), scope),
    ).toBeNull();
  });
});
