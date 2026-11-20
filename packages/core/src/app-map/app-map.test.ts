import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_CATALOG } from "../app-catalog-data.js";
import { APP_MAP_SCREENS, appMap, canOpen, findInApp } from "./index.js";

const OWNER = { owner: true, partner: false };
const MEMBER = { owner: false, partner: false };
const PARTNER = { owner: true, partner: true };

function top(query: string, language: string, viewer = OWNER) {
  return findInApp({ query, language, viewer }).matches[0]?.link;
}

describe("find in app", () => {
  it("finds the screen for representative English questions", () => {
    expect(top("where do I connect Notion?", "en")).toBe("/settings/connections");
    expect(top("how do I change my plan", "en")).toBe("/settings/billing");
    expect(top("invite a teammate", "en")).toBe("/settings/members");
    expect(top("add an openai api key", "en")).toBe("/settings/models");
    expect(top("where do I download the files and reports my agent produced", "en")).toBe(
      "/app/artifacts",
    );
    expect(top("schedule an agent every day", "en")).toBe("/app/routines");
    expect(top("what is waiting for my approval", "en")).toBe("/app/approvals");
    expect(top("check for a new desktop version", "en")).toBe("/settings/updates");
  });

  it("finds the screen for representative Portuguese questions", () => {
    expect(top("onde eu conecto o Gmail?", "pt-BR")).toBe("/settings/connections");
    expect(top("como troco meu plano?", "pt-BR")).toBe("/settings/billing");
    expect(top("convidar uma pessoa para o espaço", "pt-BR")).toBe("/settings/members");
    expect(top("onde coloco a chave de api", "pt-BR")).toBe("/settings/models");
    expect(top("agendar uma rotina todo dia", "pt-BR")).toBe("/app/routines");
    expect(top("ações esperando aprovação", "pt-BR")).toBe("/app/approvals");
    expect(top("quanto gastei de tokens", "pt-BR")).toBe("/settings/usage");
  });

  it("answers in the person's language and still understands the other one", () => {
    const pt = findInApp({ query: "billing", language: "pt-BR", viewer: OWNER }).matches[0];
    expect(pt?.title).toBe("Cobrança");
    const en = findInApp({ query: "cobrança", language: "en", viewer: OWNER }).matches[0];
    expect(en?.title).toBe("Billing");
  });

  it("finds an app of the catalog by its name and says where to connect it", () => {
    for (const app of APP_CATALOG) {
      const match = findInApp({ query: `connect ${app.name}`, viewer: MEMBER }).matches[0];
      expect(match?.title, app.slug).toBe(`Connect ${app.name}`);
      expect(match?.link).toBe("/settings/connections");
    }
    const desktopOnly = APP_CATALOG.find((app) => app.desktopOnly);
    if (desktopOnly) {
      const match = findInApp({ query: desktopOnly.name, viewer: MEMBER }).matches[0];
      expect(match?.surfaces).toEqual(["desktop"]);
    }
  });

  it("returns nothing for a question the map does not cover", () => {
    expect(findInApp({ query: "zzzz qqqq", viewer: OWNER })).toEqual({ matches: [], locked: [] });
    expect(findInApp({ query: "   ", viewer: OWNER })).toEqual({ matches: [], locked: [] });
  });

  it("never links a member to an owner-only screen and says who can open it", () => {
    const result = findInApp({ query: "change my plan billing", viewer: MEMBER });
    expect(result.matches.map((match) => match.link)).not.toContain("/settings/billing");
    expect(result.locked[0]).toMatchObject({
      title: "Billing",
      availableTo: "space owners and admins",
    });
    expect(top("invite someone", "en", MEMBER)).not.toBe("/settings/members");
    expect(findInApp({ query: "invite someone", viewer: MEMBER }).locked[0]?.title).toBe("Members");
  });

  it("keeps the partner console for partners", () => {
    const query = "partner console customers";
    expect(findInApp({ query, viewer: OWNER }).matches.map((match) => match.link)).not.toContain(
      "/app/partner",
    );
    expect(findInApp({ query, viewer: OWNER }).locked[0]?.availableTo).toBe("partners");
    expect(findInApp({ query, viewer: PARTNER }).matches[0]?.link).toBe("/app/partner");
    expect(canOpen("partner", { owner: false, partner: true })).toBe(false);
  });

  it("has unique ids and both languages for every entry", () => {
    const entries = appMap();
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
    for (const entry of entries) {
      for (const locale of ["en", "pt-BR"] as const) {
        const { title, description, keywords } = entry.text[locale];
        expect(title.length, entry.id).toBeGreaterThan(0);
        expect(description.length, entry.id).toBeGreaterThan(0);
        expect(keywords.length, entry.id).toBeGreaterThan(0);
      }
      expect(entry.path.startsWith("/"), entry.id).toBe(true);
      expect(entry.surfaces.length, entry.id).toBeGreaterThan(0);
    }
  });
});

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

/** Routes that are not a place to send someone: auth, callbacks, the chat itself, operator tools. */
const NOT_A_DESTINATION = new Set([
  "/",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/invite/:token",
  "/join/:token",
  "/embed",
  "/mcp/oauth/callback",
  "/integrations/setup",
  "/onboarding/:step?",
  "/app",
  "/app/g/:groupId",
  "/app/g/:groupId/squad",
  "/app/dm/:userId",
  "/app/dm",
  "/settings/space/:spaceId",
  "/settings/:section?",
  "/app/platform/:section?",
  "/app/x/:linkId",
  "/app/:botId",
]);

function stripParams(route: string) {
  return route
    .split("/")
    .filter((segment) => !segment.startsWith(":"))
    .join("/");
}

describe("the map does not drift from the app", () => {
  const mapPaths = new Set(APP_MAP_SCREENS.map((entry) => entry.path));

  it("has an entry for every web route", () => {
    const routes = [...read("apps/web/src/App.tsx").matchAll(/<Route[^>]*?path="([^"]+)"/gs)].map(
      (match) => match[1] as string,
    );
    expect(routes.length).toBeGreaterThan(15);
    const missing = routes
      .filter((route) => !NOT_A_DESTINATION.has(route))
      .filter((route) => !mapPaths.has(stripParams(route)));
    expect(missing).toEqual([]);
  });

  it("has an entry for every settings section", () => {
    const sections = [
      ...read("apps/web/src/pages/Settings.tsx").matchAll(/\bid: "([a-z-]+)",\s+label:/g),
    ].map((match) => match[1] as string);
    expect(sections).toContain("connections");
    expect(sections.filter((id) => !mapPaths.has(`/settings/${id}`))).toEqual([]);
  });

  it("has an entry for every command palette page", () => {
    const pages = [
      ...read("apps/web/src/pages/shell/command-palette.tsx").matchAll(/\{ to: "([^"]+)"/g),
    ].map((match) => match[1] as string);
    expect(pages.length).toBeGreaterThan(5);
    expect(pages.filter((path) => !mapPaths.has(path))).toEqual([]);
  });

  it("has no entry for a screen that no longer exists", () => {
    const routes = [...read("apps/web/src/App.tsx").matchAll(/<Route[^>]*?path="([^"]+)"/gs)].map(
      (match) => stripParams(match[1] as string),
    );
    const sections = new Set(
      [...read("apps/web/src/pages/Settings.tsx").matchAll(/\bid: "([a-z-]+)",\s+label:/g)].map(
        (match) => `/settings/${match[1]}`,
      ),
    );
    const stale = [...mapPaths].filter((path) => !routes.includes(path) && !sections.has(path));
    expect(stale).toEqual([]);
  });

  it("names screens as the app does, in both languages", () => {
    const po = new Map<string, string>();
    const lines = read("apps/web/src/locales/pt-BR/messages.po").split("\n");
    for (let index = 0; index < lines.length; index++) {
      const id = /^msgid "(.*)"$/.exec(lines[index] as string)?.[1];
      const str = /^msgstr "(.*)"$/.exec(lines[index + 1] ?? "")?.[1];
      if (id && str) po.set(id, str);
    }
    const mismatched: string[] = [];
    for (const entry of APP_MAP_SCREENS) {
      const en = entry.text.en.title;
      const pt = entry.text["pt-BR"].title;
      if (!po.has(en)) mismatched.push(`${entry.id}: "${en}" is not a label of the app`);
      else if (po.get(en) !== pt) mismatched.push(`${entry.id}: "${pt}" is not "${po.get(en)}"`);
    }
    expect(mismatched).toEqual([]);
  });
});
