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
