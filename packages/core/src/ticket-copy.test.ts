import { describe, expect, it } from "vitest";
import { ticketCopy } from "./ticket-copy.js";

describe("ticket comments", () => {
  it("reads in English without a translation", () => {
    for (const locale of [undefined, "en-US", "it"]) {
      const copy = ticketCopy(locale);
      expect(copy.idle(30, 1, 8)).toBe(
        "No activity for 30 minutes. Continuing (follow-up 1 of 8).",
      );
      expect(copy.continuing(2, 8, { kind: "left" }, "733 leads")).toBe(
        "Continuing (follow-up 2 of 8). The run ended with work left. Left: 733 leads",
      );
    }
  });

  it("reads in Brazilian Portuguese", () => {
    const copy = ticketCopy("pt-BR");
    expect(copy.idle(30, 1, 8)).toBe("Sem atividade há 30 minutos. Continuando (retomada 1 de 8).");
    expect(copy.continuing(2, 8, { kind: "cut" }, undefined)).toBe(
      "Continuando (retomada 2 de 8). O limite de chamadas de ferramentas encerrou a execução.",
    );
    expect(copy.stalled(8)).toContain("Parado: sem progresso após 8 retomadas");
    expect(copy.capped(8, { kind: "text", text: "Sem créditos." }, "100 leads")).toBe(
      "Parado após 8 retomadas sem atender aos critérios de aceite. Ainda falta: 100 leads Motivo: Sem créditos.",
    );
    expect(copy.outOfCredits).toContain("sem créditos");
  });

  it("has every message in every translated language", () => {
    for (const locale of ["pt-BR", "es", "de", "fr", "ja", "zh-CN"]) {
      const copy = ticketCopy(locale);
      const english = ticketCopy(undefined);
      expect(copy.stalled(8)).not.toBe(english.stalled(8));
      expect(copy.idle(30, 1, 8)).not.toBe(english.idle(30, 1, 8));
      expect(copy.outOfCredits).not.toBe(english.outOfCredits);
      expect(copy.continuing(1, 8, { kind: "cut" })).not.toBe(
        english.continuing(1, 8, { kind: "cut" }),
      );
    }
  });
});
