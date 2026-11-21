import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ApprovalCardCode, MetaCode } from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import { approvalCardCopy, metaCopy } from "./server-copy";

const catalog = (locale: string) => {
  const entries = new Map<string, string>();
  const text = readFileSync(
    fileURLToPath(new URL(`../locales/${locale}/messages.po`, import.meta.url)),
    "utf8",
  );
  for (const block of text.split("\n\n")) {
    const read = (key: string) => {
      const match = new RegExp(`^${key} ((?:".*"\\n?)+)`, "m").exec(block);
      return (match?.[1]?.match(/"(?:[^"\\]|\\.)*"/g) ?? [])
        .map((part) => JSON.parse(part) as string)
        .join("");
    };
    entries.set(read("msgid"), read("msgstr"));
  }
  return entries;
};

/** The wording of one string in the Portuguese catalog, with its `{name}` slots filled in. */
function portuguese(message: string, values: Record<string, string> = {}): string {
  const translated = catalog("pt-BR").get(message);
  if (!translated) throw new Error(`No pt-BR translation for: ${message}`);
  return translated.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}

describe("approval card wording", () => {
  it("says the routine step proposal from the screenshot in Portuguese, user content untouched", () => {
    const routine = "Visão financeira diária — Corvo, Greenbarber e Divellas";
    const params = {
      routine,
      lastAgent: "Fluxo de caixa",
      agent: "Precificação",
      instruction: "Avalie o relatório",
    };
    expect(portuguese("Add a step to “{routine}”?", params)).toBe(
      `Adicionar uma etapa a “${routine}”?`,
    );
    expect(portuguese("After {lastAgent} finishes, {agent} runs it", params)).toBe(
      "Quando Fluxo de caixa terminar, Precificação executa",
    );
    expect(portuguese("Instruction: {instruction}", params)).toBe("Instrução: Avalie o relatório");
  });

  it("keeps the English fallback wording for every code", () => {
    const params = {
      name: "Crew",
      members: "Scout, Ops",
      purpose: "Research",
      group: "Crew",
      rename: "Crew 2",
      add: "Writer",
      remove: "Ops",
      bot: "Scout",
      from: "A",
      to: "B",
      routine: "Brief",
      lastAgent: "Writer",
      agent: "Scout",
      instruction: "Check",
      prompt: "Go",
      cron: "0 9 * * *",
      at: "2026-10-18T09:30:00.000Z",
      timezone: "UTC",
      oldLength: "16",
      newLength: "17",
      accept: "1",
      provider: "WhatsApp",
      address: "+1",
    };
    expect(approvalCardCopy("add_routine_step", params)).toEqual({
      title: "Add a step to “Brief”?",
      lines: ["After Writer finishes, Scout runs it", "Instruction: Check"],
    });
    expect(approvalCardCopy("create_group", params)?.title).toBe("Create group “Crew”?");
    expect(approvalCardCopy("agent_connection", params)?.title).toBe(
      "Approve connection with “Crew”?",
    );
    expect(approvalCardCopy("open_website", { site: "planalto.gov.br" })?.title).toBe(
      "Open planalto.gov.br?",
    );
    for (const code of ApprovalCardCode.options) {
      expect(approvalCardCopy(code, params)?.title, code).toBeTruthy();
    }
  });

  it("takes the new instructions from the card detail", () => {
    const detail = "Old length: 3 characters\nNew length: 9 characters\n\nBe kind.\nBe brief.";
    expect(
      approvalCardCopy(
        "replace_instructions",
        { bot: "Scout", oldLength: "3", newLength: "9" },
        detail,
      )?.lines.at(-1),
    ).toBe("Be kind.\nBe brief.");
  });
});

describe("system notice wording", () => {
  it("words every code", () => {
    const params = { name: "Brief", used: "8000", limit: "10000", reason: "x" };
    for (const code of MetaCode.options) {
      expect(metaCopy(code, params), code).toBeTruthy();
    }
  });

  it("has a Portuguese line for each notice", () => {
    expect(portuguese("Stopped. This stayed queued without starting.")).toBe(
      "Interrompido. Ficou na fila sem começar.",
    );
    expect(portuguese("Switched to a stronger model")).toBeTruthy();
  });
});
