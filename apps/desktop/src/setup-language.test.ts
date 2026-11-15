// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const read = (name: string) => readFileSync(path.join(import.meta.dirname, name), "utf8");

/** Loads the setup window the way Electron does: its page, its text, its script and a stand-in bridge. */
async function openSetup(
  savedLocale: string | null,
  options: { suggested?: string; saved?: unknown } = {},
) {
  const html = read("setup.html");
  document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.indexOf("<script"));
  const bridge = {
    platform: "darwin",
    quit: vi.fn(),
    setLocale: vi.fn(async () => undefined),
    save: vi.fn(async () => ({ ok: true })),
    test: vi.fn(async () => ({ ok: true, url: "http://127.0.0.1:1" })),
    state: vi.fn(async () => ({
      locale: { saved: savedLocale, suggested: options.suggested ?? "en" },
      saved: options.saved ?? null,
      defaultLocalUrl: "http://127.0.0.1:45173",
      cloudUrl: "https://app.rook.team",
      error: null,
    })),
    stack: {
      state: vi.fn(async () => ({ phase: "idle", output: [] })),
      start: vi.fn(async () => ({ phase: "idle", output: [] })),
      onChange: vi.fn(),
    },
  };
  // The page scrolls the chosen language into view, which jsdom does not implement.
  Element.prototype.scrollIntoView = () => undefined;
  const window = globalThis as unknown as Record<string, unknown>;
  window.corvoSetup = bridge;
  // The scripts run as plain scripts in the page, so they are evaluated in this global scope.
  new Function(read("setup-strings.js")).call(globalThis);
  new Function(read("setup.js")).call(globalThis);
  await new Promise((resolve) => setTimeout(resolve, 20));
  return bridge;
}

afterEach(() => {
  document.body.innerHTML = "";
});

const languageChoices = () => document.querySelectorAll("#language-form .choice");

describe("the language step of the setup window", () => {
  it("does not ask for a language first; the window follows the system language", async () => {
    await openSetup(null, { suggested: "pt-BR" });
    expect(document.getElementById("step-language")?.hidden).toBe(true);
    expect(document.getElementById("step-setup")?.hidden).toBe(false);
    expect(document.documentElement.lang).toBe("pt-BR");
    expect(document.querySelector("#step-setup h1")?.textContent).toBe("Bem-vindo ao Rook");
    expect(document.getElementById("quit")?.textContent).toBe("Sair");
    expect(document.getElementById("change-language")?.textContent).toBe("Idioma");
  });

  it("lists every language when it is opened again from the title bar", async () => {
    await openSetup("pt-BR");
    expect(document.getElementById("step-language")?.hidden).toBe(true);
    (document.getElementById("change-language") as HTMLButtonElement).click();
    expect(document.getElementById("step-language")?.hidden).toBe(false);
    expect(languageChoices()).toHaveLength(7);
    expect(
      (document.querySelector('#language-form input[value="pt-BR"]') as HTMLInputElement).checked,
    ).toBe(true);
  });
});

describe("where Rook runs in the setup window", () => {
  const radio = (mode: string) =>
    document.querySelector(`input[name="mode"][value="${mode}"]`) as HTMLInputElement;

  it("selects Rook Cloud and asks no question about where it runs", async () => {
    await openSetup("en");
    expect(radio("cloud").checked).toBe(true);
    expect(radio("cloud").disabled).toBe(false);
    expect(document.querySelector(".subheading")).toBeNull();
    expect(document.body.textContent).not.toContain("Where should Rook run");
  });

  it("keeps This computer and Existing server one choice away", async () => {
    await openSetup("en");
    expect(radio("new")).not.toBeNull();
    expect(radio("existing")).not.toBeNull();
  });

  it("continues to Rook Cloud as an ordinary server address", async () => {
    const bridge = await openSetup("en");
    (document.getElementById("setup") as HTMLFormElement).requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(bridge.save).toHaveBeenCalledWith({
      mode: "existing",
      serverUrl: "https://app.rook.team",
    });
  });

  it("shows a saved Rook Cloud as Rook Cloud and a saved server as that server", async () => {
    await openSetup("en", { saved: { mode: "existing", serverUrl: "https://app.rook.team" } });
    expect(radio("cloud").checked).toBe(true);
    document.body.innerHTML = "";
    await openSetup("en", { saved: { mode: "existing", serverUrl: "https://corvo.example.com" } });
    expect(radio("existing").checked).toBe(true);
    expect((document.getElementById("server-url") as HTMLInputElement).value).toBe(
      "https://corvo.example.com",
    );
  });
});
