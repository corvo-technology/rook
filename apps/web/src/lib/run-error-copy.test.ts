import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { RunErrorInfo } from "@corvo/contracts";
import { RUN_ERROR_CODES } from "@corvo/contracts";
import { i18n } from "@lingui/core";
import { afterEach, describe, expect, it } from "vitest";
import { describeRunError, runFailureLines } from "./run-error-copy";

function catalog(locale: string): Record<string, string> {
  const entries: Record<string, string> = {};
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
    const id = read("msgid");
    if (id && !block.includes("#~")) entries[id] = read("msgstr");
  }
  return entries;
}

function use(locale: "en" | "pt-BR") {
  i18n.load(locale, locale === "en" ? {} : catalog(locale));
  i18n.activate(locale);
}

afterEach(() => use("en"));

const storage: RunErrorInfo = {
  code: "computer_storage_full",
  params: {
    agent: "QA",
    usedMb: "10035",
    totalMb: "10240",
    top: ".codex 475 MB, .browser-profiles 340 MB",
  },
};
const rawStorage = "Couldn't start the agent's computer.\nThe computer's storage is full.";
const rawProvider =
  'OpenAI API error (401): {"error":{"type":"authentication_error","message":"Incorrect API key provided"}}';

/** A sample of every code, with the params the server saves for it. */
const SAMPLES: Record<(typeof RUN_ERROR_CODES)[number], { info: RunErrorInfo; raw: string }> = {
  computer_storage_full: { info: storage, raw: rawStorage },
  computer_start_failed: {
    info: { code: "computer_start_failed", params: { agent: "QA" } },
    raw: "Couldn't start the agent's computer.\nsandbox exploded",
  },
  computer_home_lost: { info: { code: "computer_home_lost" }, raw: "x" },
  model_provider_error: {
    info: {
      code: "model_provider_error",
      params: { provider: "openai", model: "gpt-x", kind: "auth", reason: "Incorrect API key" },
    },
    raw: rawProvider,
  },
  model_rate_limited: {
    info: { code: "model_rate_limited" },
    raw: '429: {"error":{"message":"Too many requests"}}',
  },
  monthly_limit: { info: { code: "monthly_limit", params: { scope: "bot" } }, raw: "x" },
  daily_credit_limit: { info: { code: "daily_credit_limit", params: { scope: "bot" } }, raw: "x" },
  paused: { info: { code: "paused", params: { scope: "space" } }, raw: "x" },
  reply_cap: { info: { code: "reply_cap" }, raw: "x" },
  plan_storage_full: { info: { code: "plan_storage_full" }, raw: "x" },
  plan_computer_limit: { info: { code: "plan_computer_limit" }, raw: "x" },
  no_model_access: { info: { code: "no_model_access" }, raw: "x" },
  model_not_allowed: { info: { code: "model_not_allowed" }, raw: "x" },
  timeout: { info: { code: "timeout" }, raw: "Request timed out" },
  turn_stopped: { info: { code: "turn_stopped", params: { kind: "loop" } }, raw: "x" },
  unknown: { info: { code: "unknown" }, raw: "boom" },
};

describe("describeRunError", () => {
  it("words the full computer from the screenshot in Portuguese", () => {
    use("pt-BR");
    const view = describeRunError(storage, rawStorage);
    expect(view.title).toBe("O computador do QA está sem espaço");
    expect(view.line).toContain("Usa 9,8 GB de 10 GB.");
    expect(view.line).toContain("Os maiores: .codex 475 MB, perfis do navegador 340 MB.");
    expect(view.actions).toEqual(["free-space", "recover"]);
  });

  it("words the same card in English", () => {
    const view = describeRunError(storage, rawStorage);
    expect(view.title).toBe("QA's computer is out of space");
    expect(view.line).toContain("Using 9.8 GB of 10 GB.");
  });

  it("says what to do when the disk was not measured", () => {
    expect(describeRunError({ code: "computer_storage_full", params: {} }, rawStorage).title).toBe(
      "The computer is out of space",
    );
    expect(describeRunError({ code: "computer_storage_full", params: {} }, rawStorage).line).toBe(
      "Free up space or recover the computer.",
    );
  });

  it("has a code sample for every code", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...RUN_ERROR_CODES].sort());
  });

  it.each(RUN_ERROR_CODES)("%s has no English left in Portuguese", (code) => {
    use("pt-BR");
    const { info, raw } = SAMPLES[code];
    const view = describeRunError(info, raw);
    const english = describeRunErrorEnglish(info, raw);
    expect(view.title).not.toBe(english.title);
    expect(view.line).not.toBe(english.line);
    for (const text of [view.title, view.line]) {
      expect(text).not.toMatch(/\b(?:the|your|is|its|computer|model|limit|reached|try)\b/i);
    }
  });

  it.each(RUN_ERROR_CODES)(
    "%s keeps Details to technical text and never repeats the title",
    (code) => {
      const { info, raw } = SAMPLES[code];
      const view = describeRunError(info, raw);
      expect(view.details.split("\n")[0]).toBe(code);
      expect(view.details).not.toContain(view.title);
      expect(view.details).not.toContain("Couldn't start the agent's computer.");
    },
  );

  it("shows the provider's own message in Details for a model error", () => {
    const view = describeRunError(SAMPLES.model_provider_error.info, rawProvider);
    expect(view.details).toContain("Incorrect API key provided");
  });

  it("masks secrets in Details", () => {
    const view = describeRunError(
      { code: "unknown" },
      "failed with Bearer sk-live-1234567890abcdef",
    );
    expect(view.details).not.toContain("sk-live-1234567890abcdef");
  });

  it.each([
    ["computer_start_failed", ["retry", "recover"]],
    ["computer_home_lost", ["recover", "retry"]],
    ["model_rate_limited", ["retry"]],
    ["timeout", ["retry"]],
    ["monthly_limit", ["adjust-limit", "open-usage"]],
    ["daily_credit_limit", ["adjust-limit", "open-usage"]],
    ["paused", ["resume"]],
    ["reply_cap", ["adjust-limit", "retry"]],
    ["plan_storage_full", ["open-usage"]],
    ["plan_computer_limit", []],
    ["no_model_access", ["connect"]],
    ["model_not_allowed", ["change-model"]],
    ["turn_stopped", ["retry"]],
    ["unknown", ["retry"]],
  ] as const)("offers the actions that fit %s", (code, actions) => {
    const { info, raw } = SAMPLES[code];
    expect(describeRunError(info, raw).actions).toEqual(actions);
  });

  it("offers a model change and a retry for a model error", () => {
    const view = describeRunError(
      { code: "model_provider_error", params: { model: "gpt-x" } },
      '404: {"error":{"message":"The model does not exist"}}',
    );
    expect(view.actions).toEqual(["change-model", "retry"]);
  });
});

describe("runFailureLines", () => {
  it("words a coded failure in the viewer's language", () => {
    use("pt-BR");
    expect(runFailureLines(rawStorage, storage, "pt-BR").title).toBe(
      "O computador do QA está sem espaço",
    );
  });

  it("still renders an old failure that has no code, through its text", () => {
    const lines = runFailureLines(rawProvider, undefined, "en");
    expect(lines.title).toBe(
      "Your model provider rejected the API key. Check your connection settings.",
    );
    expect(lines.line).toBeUndefined();
    expect(lines.details).toBe(rawProvider);
  });
});

/** The English wording, whatever language is active. */
function describeRunErrorEnglish(info: RunErrorInfo, raw: string) {
  const active = i18n.locale;
  i18n.activate("en");
  try {
    return describeRunError(info, raw);
  } finally {
    i18n.activate(active);
  }
}
