import { describe, expect, it } from "vitest";
import { PartnerTemplate } from "./partner.js";

describe("the partner template's Chief name and accent", () => {
  it("accepts both, or neither", () => {
    expect(PartnerTemplate.parse({ agents: [] })).toEqual({ agents: [] });
    expect(
      PartnerTemplate.parse({ agents: [], chiefName: "Assistente GreenBarber", accent: "#16A34A" }),
    ).toEqual({ agents: [], chiefName: "Assistente GreenBarber", accent: "#16A34A" });
  });

  it("refuses an accent that is not a plain #rrggbb, so it can never carry style rules", () => {
    for (const accent of ["red", "#fff", "16a34a", "#16a34a;x", "url(x)", ""]) {
      expect(PartnerTemplate.safeParse({ agents: [], accent }).success, accent).toBe(false);
    }
  });

  it("refuses an empty or oversized Chief name", () => {
    expect(PartnerTemplate.safeParse({ agents: [], chiefName: "  " }).success).toBe(false);
    expect(PartnerTemplate.safeParse({ agents: [], chiefName: "x".repeat(81) }).success).toBe(
      false,
    );
  });

  it("still refuses fields it does not know", () => {
    expect(PartnerTemplate.safeParse({ agents: [], logoUrl: "https://x" }).success).toBe(false);
  });
});

describe("the template's quick actions", () => {
  it("each send a message or open a place in the partner's product, never both or neither", () => {
    const ok = [
      { label: "Hoje", prompt: "Como está hoje?" },
      { label: "Gravar", open: "/gravar" },
    ];
    expect(PartnerTemplate.safeParse({ agents: [], quickActions: ok }).success).toBe(true);
    for (const bad of [
      { label: "x" },
      { label: "x", prompt: "y", open: "/z" },
      { label: "x", open: "//evil.example" },
      { label: "x", open: "https://evil.example" },
    ]) {
      expect(
        PartnerTemplate.safeParse({ agents: [], quickActions: [bad] }).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });
});

describe("the partner template's scheduled routines", () => {
  const routine = {
    key: "tomorrow",
    agent: "reception",
    name: "Confirm tomorrow",
    prompt: "List tomorrow's appointments.",
    crons: ["0 18 * * *"],
  };

  it("parses a template stored before they existed, and one with them", () => {
    expect(PartnerTemplate.safeParse({ agents: [], routines: [] }).success).toBe(true);
    const parsed = PartnerTemplate.parse({
      agents: [],
      timezone: "America/Sao_Paulo",
      scheduledRoutines: [routine],
    });
    expect(parsed.scheduledRoutines?.[0]?.active).toBe(true);
  });

  it("refuses schedules that fire more than hourly, shortcuts and an unknown timezone", () => {
    for (const crons of [["* * * * *"], ["*/5 * * * *"], ["@once"], ["0,30 * * * *"], []]) {
      const result = PartnerTemplate.safeParse({
        agents: [],
        scheduledRoutines: [{ ...routine, crons }],
      });
      expect(result.success, crons.join()).toBe(false);
    }
    expect(PartnerTemplate.safeParse({ agents: [], timezone: "Mars/Base" }).success).toBe(false);
  });

  it("counts both kinds of routine against one limit of 20 and keeps keys unique", () => {
    const event = (key: string) => ({
      key,
      agent: "reception",
      name: "x",
      prompt: "x",
      on: { type: "appointment.no_show" },
    });
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ...routine, key: `s${i}` }));
    expect(
      PartnerTemplate.safeParse({
        agents: [],
        routines: Array.from({ length: 15 }, (_, i) => event(`e${i}`)),
        scheduledRoutines: many(6),
      }).success,
    ).toBe(false);
    expect(
      PartnerTemplate.safeParse({
        agents: [],
        routines: [event("tomorrow")],
        scheduledRoutines: [routine],
      }).success,
    ).toBe(false);
  });
});
