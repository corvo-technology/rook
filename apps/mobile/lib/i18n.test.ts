import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createScanner, ScriptTarget } from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-localization", () => ({
  getLocales: vi.fn(() => [{ languageTag: "en-US" }]),
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

vi.mock("./ui-direction", () => ({
  applyMobileUiDirection: vi.fn(),
}));

/** Recursively collect source files used to validate mobile translation coverage. */
function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectSourceFiles(path));
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) files.push(path);
  }
  return files;
}

function translationIds(source: string): string[] {
  const scanner = createScanner(ScriptTarget.Latest, true);
  return [...source.matchAll(/\bt\(\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g)].map((match) => {
    scanner.setText(match[1]);
    scanner.scan();
    return scanner.getTokenValue();
  });
}

describe("mobile i18n", () => {
  beforeEach(async () => {
    vi.resetModules();
    const { getItemAsync, setItemAsync } = await import("expo-secure-store");
    vi.mocked(getItemAsync).mockReset();
    vi.mocked(setItemAsync).mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("falls back to the English source message when a translation is missing", async () => {
    const { resetI18nForTests, t } = await import("./i18n");
    resetI18nForTests("pt-BR");
    expect(t("Not a real string")).toBe("Not a real string");
  });

  it("translates seeded chrome in Portuguese and Spanish and keeps interpolations", async () => {
    const { resetI18nForTests, t } = await import("./i18n");
    resetI18nForTests("pt-BR");
    expect(t("Account")).toBe("Conta");
    expect(t("Sign in to Rook")).toBe("Entrar no Rook");
    expect(t("New bot")).toBe("Novo bot");
    expect(t("{runs} runs, {tokens} tokens", { runs: 3, tokens: 12 })).toBe(
      "3 execuções, 12 tokens",
    );
    expect(t("Delete {name}?", { name: "Scout" })).toBe("Excluir Scout?");

    resetI18nForTests("es");
    expect(t("Account")).toBe("Cuenta");
    expect(t("Sign in to Rook")).toBe("Inicia sesión en Rook");
    expect(t("New bot")).toBe("Nuevo bot");
    expect(t("{runs} runs, {tokens} tokens", { runs: 3, tokens: 12 })).toBe(
      "3 ejecuciones, 12 tokens",
    );
    expect(t("Delete {name}?", { name: "Scout" })).toBe("¿Eliminar Scout?");
  });

  it("preserves interpolations in every non-English catalog", async () => {
    const { PT_BR_MESSAGES } = await import("./locales/pt-BR");
    const { ES_MESSAGES } = await import("./locales/es");
    for (const messages of [PT_BR_MESSAGES, ES_MESSAGES]) {
      const empty = Object.entries(messages).filter(([, value]) => !value.trim());
      const interpolationMismatches = Object.entries(messages).filter(([id, value]) => {
        const tokens = (message: string) =>
          [...message.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1]).sort();
        return JSON.stringify(tokens(id)) !== JSON.stringify(tokens(value));
      });
      expect(empty).toEqual([]);
      expect(interpolationMismatches).toEqual([]);
    }
  });

  it("translates every mobile chrome t() id in every non-English catalog", async () => {
    const { PT_BR_MESSAGES } = await import("./locales/pt-BR");
    const { ES_MESSAGES } = await import("./locales/es");
    const { EMPTY_PLUGIN_CATALOG_MESSAGE, SLASH_ACTIONS, RUN_ERROR_LIMIT_MESSAGES } = await import(
      "@corvo/core"
    );
    const { AI_DATA_DISCLOSURES, OPENAI_COMPATIBLE_BASE_URL_HINT } = await import(
      "@corvo/contracts"
    );
    const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
    const ids = new Set<string>([
      ...Object.values(AI_DATA_DISCLOSURES),
      ...Object.values(RUN_ERROR_LIMIT_MESSAGES).flatMap(Object.values),
      "{summary} Your backup models also failed.",
      "{summary} No backup model was usable for this request.",
      "{summary} Backup models failed or were unavailable for this request.",
      "Your OpenRouter",
      "Your OpenAI",
      "Your Anthropic",
      "Your model provider",
      "The model provider returned an error.",
      "Connect a model in Settings before running bots.",
      "Connect your own API key in Models or choose Rook credits in Billing.",
      "{provider} is rate limiting requests. Try again shortly.",
      "{summary} Resets {date}.",
      "{provider} rejected the API key. Check your connection settings.",
      "{provider} can't run this model.",
      "{provider} denied access to this model.",
      "The model returned an unusable response. Try again.",
      "The model hit its output limit before finishing its reply.",
      "This model's context window is too small. Choose another model.",
      "{provider} couldn't be reached securely. A security program or network filter may be intercepting the connection.",
      "{provider} took too long to respond. Try again.",
      "{provider} sign-in is no longer valid.",
      "{provider} couldn't be reached through the network proxy. Check the proxy settings.",
      "{provider} is overloaded right now. Try again in a moment.",
      "{provider} couldn't be reached. Check that it's running.",
      "This conversation is too long for the model. Retrying won't help. Start a new chat or shorten your message.",

      EMPTY_PLUGIN_CATALOG_MESSAGE,
      OPENAI_COMPATIBLE_BASE_URL_HINT,
      ...SLASH_ACTIONS.map((action) => action.label),
      "Sign-in did not return a session",
      "Sign-up did not return a session",
      "{count} model",
      "{count} models",
      // Labels the t() literal scan cannot see: built from maps or ternaries.
      "System",
      "Light",
      "Dark",
      "Allow once",
      "Always allow",
      "Deny",
    ]);
    for (const file of collectSourceFiles(mobileRoot)) {
      const source = readFileSync(file, "utf8");
      for (const id of translationIds(source)) ids.add(id);
    }
    for (const messages of [PT_BR_MESSAGES, ES_MESSAGES]) {
      const missing = [...ids].filter((id) => !messages[id]?.trim()).sort();
      expect(missing).toEqual([]);
    }
  });

  it("decodes JavaScript string escapes in scanned translation ids", () => {
    expect(
      translationIds(
        String.raw`t('He said \"hi\"'); t('C:\\temp'); t('It\'s ready'); t("Say \"hi\""); t('\x41\u0042\n')`,
      ),
    ).toEqual(['He said "hi"', "C:\\temp", "It's ready", 'Say "hi"', "AB\n"]);
  });

  it.each([
    ["pt-BR", "Seu provedor de modelos demorou demais para responder. Tente novamente."],
    ["es", "Tu proveedor de modelos tardó demasiado en responder. Vuelve a intentarlo."],
  ] as const)("renders provider errors in %s", async (locale, expected) => {
    const { normalizeRunError } = await import("@corvo/core");
    const { resetI18nForTests, t, dateLocaleForUi } = await import("./i18n");
    resetI18nForTests(locale);
    expect(normalizeRunError("Request timed out", t, dateLocaleForUi()).summary).toBe(expected);
  });

  it("prefers the stored locale, then activates and persists a new choice", async () => {
    const { getItemAsync, setItemAsync } = await import("expo-secure-store");
    vi.mocked(getItemAsync).mockResolvedValue("pt-BR");
    const { applyMobileUiDirection } = await import("./ui-direction");
    const { bootstrapI18n, getActiveUiLocale, setUiLocale, t } = await import("./i18n");

    await expect(bootstrapI18n()).resolves.toBe("pt-BR");
    expect(getActiveUiLocale()).toBe("pt-BR");
    expect(t("Language")).toBe("Idioma");
    expect(applyMobileUiDirection).toHaveBeenCalledWith("pt-BR");

    await setUiLocale("en");
    expect(getActiveUiLocale()).toBe("en");
    expect(t("Language")).toBe("Language");
    expect(setItemAsync).toHaveBeenCalledWith("corvo.uiLocale", "en");
    expect(applyMobileUiDirection).toHaveBeenCalledWith("en");
  });

  it("normalizes a regional Spanish stored locale before activation", async () => {
    const { getItemAsync } = await import("expo-secure-store");
    vi.mocked(getItemAsync).mockResolvedValue("es-MX");
    const { bootstrapI18n, dateLocaleForUi, getActiveUiLocale, t } = await import("./i18n");

    await expect(bootstrapI18n()).resolves.toBe("es");
    expect(getActiveUiLocale()).toBe("es");
    expect(t("Language")).toBe("Idioma");
    expect(dateLocaleForUi()).toBe("es");
  });

  it("falls back to English when the stored locale is no longer shipped", async () => {
    const { getItemAsync } = await import("expo-secure-store");
    vi.mocked(getItemAsync).mockResolvedValue("sv-SE");
    const { bootstrapI18n, getActiveUiLocale, t } = await import("./i18n");

    await expect(bootstrapI18n()).resolves.toBe("en");
    expect(getActiveUiLocale()).toBe("en");
    expect(t("Language")).toBe("Language");
  });

  it("keeps the last locale when rapid setUiLocale calls finish out of order", async () => {
    const { setItemAsync } = await import("expo-secure-store");
    const { applyMobileUiDirection } = await import("./ui-direction");
    const { getActiveUiLocale, resetI18nForTests, setUiLocale } = await import("./i18n");
    resetI18nForTests("en");

    const gates = new Map<string, { release: () => void; wait: Promise<void> }>();
    for (const locale of ["en", "pt-BR"] as const) {
      let release!: () => void;
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      gates.set(locale, { release, wait });
    }
    vi.mocked(setItemAsync).mockImplementation(async (_key, value) => {
      await gates.get(String(value))?.wait;
    });

    const first = setUiLocale("en");
    const second = setUiLocale("pt-BR");
    // First write is slower to settle; second must still win after the queue drains.
    queueMicrotask(() => gates.get("pt-BR")?.release());
    queueMicrotask(() => gates.get("en")?.release());
    await Promise.all([first, second]);

    expect(getActiveUiLocale()).toBe("pt-BR");
    expect(setItemAsync).toHaveBeenLastCalledWith("corvo.uiLocale", "pt-BR");
    expect(applyMobileUiDirection).toHaveBeenLastCalledWith("pt-BR");
  });
});

it("restores Spanish after saving the language choice", async () => {
  const { getItemAsync, setItemAsync } = await import("expo-secure-store");
  const { applyMobileUiDirection } = await import("./ui-direction");
  const { bootstrapI18n, dateLocaleForUi, resetI18nForTests, setUiLocale, t } = await import(
    "./i18n"
  );
  const { ES_MESSAGES } = await import("./locales/es");
  await setUiLocale("es");
  expect(setItemAsync).toHaveBeenLastCalledWith("corvo.uiLocale", "es");
  resetI18nForTests();
  vi.mocked(getItemAsync).mockResolvedValue("es");
  await expect(bootstrapI18n()).resolves.toBe("es");
  expect(dateLocaleForUi()).toBe("es");
  expect(applyMobileUiDirection).toHaveBeenLastCalledWith("es");
  expect(t("Language")).toBe(ES_MESSAGES.Language);
  expect(t("Delete {name}?", { name: "Scout" })).toBe(
    ES_MESSAGES["Delete {name}?"]?.replace("{name}", "Scout"),
  );
});
