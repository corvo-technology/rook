import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
  }),
}));
vi.mock("@corvo/ui-web", () => ({ BotAvatar: () => <span data-mark /> }));

import { EmbedTabs } from "./embed-tabs";

const render = (tabs: Parameters<typeof EmbedTabs>[0]["tabs"], pathname = "/app/home") =>
  renderToString(
    <EmbedTabs
      tabs={tabs}
      pathname={pathname}
      chief={{ id: "chief", name: "Assistente Prontu", color: "#14B8A6" }}
      onOpen={() => undefined}
    />,
  );

it("names the Chief and lists only the tabs it is given", () => {
  const html = render(["home", "chats", "team"]);
  expect(html).toContain("Assistente Prontu");
  expect(html).toContain("embed-tab-home");
  expect(html).not.toContain("embed-tab-routines");
  for (const word of ["Billing", "Settings", "Store", "Download", "Switch", "Add account"]) {
    expect(html).not.toContain(word);
  }
});

it("marks a customer made with the partner's test key, and no one else", () => {
  const marked = renderToString(
    <EmbedTabs tabs={["home", "chats"]} pathname="/app/home" test onOpen={() => undefined} />,
  );
  expect(marked).toContain("embed-test-badge");
  expect(marked).toContain("Test");
  expect(render(["home", "chats"])).not.toContain("embed-test-badge");
});

it("marks the current tab in the accent, which is the app's main colour", () => {
  const html = render(["home", "chats"], "/app/bot-1");
  const chats = html.slice(html.indexOf("embed-tab-chats"));
  expect(chats).toContain('aria-current="page"');
  expect(chats).toContain("text-primary");
  const home = html.slice(html.indexOf("embed-tab-home"), html.indexOf("embed-tab-chats"));
  expect(home).not.toContain("aria-current");
});
