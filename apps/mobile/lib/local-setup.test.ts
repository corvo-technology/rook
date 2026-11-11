import type { LocalModelOption, LocalSetupReport } from "@corvo/contracts";
import { DISABLED_LOCAL_SETUP } from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import { localFoundRows } from "./local-setup";
import { DE_MESSAGES } from "./locales/de";
import { ES_MESSAGES } from "./locales/es";
import { JA_MESSAGES } from "./locales/ja";
import { PT_BR_MESSAGES } from "./locales/pt-BR";
import { ZH_MESSAGES } from "./locales/zh";

const server: LocalModelOption = {
  id: "server:11434",
  kind: "server",
  label: "Ollama",
  provider: "openai-compatible",
  models: ["fake-model", "other-model"],
  modelId: "fake-model",
  backgroundModelId: null,
  testable: true,
};
const local: LocalModelOption = {
  ...server,
  id: "local",
  kind: "local",
  label: "Local models",
  provider: "local",
  models: ["fake-local"],
  modelId: "fake-local",
};
const report = (options: LocalModelOption[]): LocalSetupReport => ({
  enabled: true,
  checking: false,
  checkedAt: 1,
  options,
});

describe("localFoundRows", () => {
  it("no rows for a disabled report", () => {
    expect(localFoundRows(DISABLED_LOCAL_SETUP)).toEqual([]);
    expect(localFoundRows(undefined)).toEqual([]);
    expect(localFoundRows(report([]))).toEqual([]);
  });

  it("one row per option, preselected model as subtitle", () => {
    expect(localFoundRows(report([server, local]))).toEqual([
      { optionId: "server:11434", modelId: "fake-model", title: "Ollama", subtitle: "fake-model" },
      { optionId: "local", modelId: "fake-local", title: "Local models", subtitle: "fake-local" },
    ]);
  });

  it("local option uses the Local models label", () => {
    const rows = localFoundRows(report([local]), (message) => `translated:${message}`);
    expect(rows[0]?.title).toBe("translated:Local models");
  });

  it("leaves out connections the account already has", () => {
    expect(
      localFoundRows(report([{ ...server, id: "connection:one", kind: "connection" }])),
    ).toEqual([]);
  });

  it("keys exist in every locale", () => {
    for (const messages of [ES_MESSAGES, DE_MESSAGES, JA_MESSAGES, PT_BR_MESSAGES, ZH_MESSAGES]) {
      for (const key of ["Found on this computer", "Local models", "Use"]) {
        expect(messages[key]?.trim()).toBeTruthy();
      }
    }
  });
});
