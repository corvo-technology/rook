// @vitest-environment jsdom
import type {
  WikiChange,
  WikiHit,
  WikiPage,
  WikiPageInfo,
  WikiRevision,
  WikiSettings,
} from "@corvo/contracts";
import { ORPCError } from "@orpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { act, cloneElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

const { text } = vi.hoisted(() => ({
  text: (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((out, part, index) => out + part + (values[index] ?? ""), ""),
}));
vi.mock("@lingui/core/macro", () => ({ t: text }));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: text }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@corvo/ui-web", () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
  Switch: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked: boolean;
    onCheckedChange: (value: boolean) => void;
  } & Omit<ComponentProps<"button">, "onChange">) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      {...props}
    />
  ),
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: (props: ComponentProps<"button">) => <button type="button" {...props} />,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Button: ({
    variant: _v,
    size: _s,
    ...props
  }: ComponentProps<"button"> & { variant?: string; size?: string }) => (
    <button type="button" {...props} />
  ),
  Input: (props: ComponentProps<"input">) => <input {...props} />,
  Textarea: (props: ComponentProps<"textarea">) => <textarea {...props} />,
  Spinner: () => <span role="status" />,
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ render, children }: { render: ReactElement; children: ReactNode }) =>
    cloneElement(render, {}, children),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" role="menuitem" onClick={onClick}>
      {children}
    </button>
  ),
}));
// The real renderer is its own package's business; this one turns a mention link into what the
// page passes to renderMention, so the links a page makes can be followed in the test.
vi.mock("@corvo/chat-ui/web", () => ({
  ChatMarkdown: ({
    children,
    renderMention,
  }: {
    children: string;
    renderMention: (id: string, name: ReactNode) => ReactNode;
  }) => (
    <div>
      {children.split(/(\[[^\]]+\]\(corvo-mention:[^)]+\))/).map((part, index) => {
        const link = part.match(/^\[([^\]]+)\]\(corvo-mention:([^)]+)\)$/);
        return link ? (
          <span key={index}>{renderMention(decodeURIComponent(link[2]!), link[1])}</span>
        ) : (
          <span key={index}>{part}</span>
        );
      })}
    </div>
  ),
}));

import { type WikiApi, WikiBrowser } from "./WikiBrowser";

type Stored = { body: string; kind: string; revision: number; revisions: WikiRevision[] };
const NOW = Date.now();
const iso = (ago: number) => new Date(NOW - ago).toISOString();

function fakeApi(seed: Record<string, { body: string; kind?: string }> = {}) {
  const pages = new Map<string, Stored>(
    Object.entries(seed).map(([title, { body, kind }]) => [
      title,
      {
        body,
        kind: kind ?? "Other",
        revision: 1,
        revisions: [{ revision: 1, at: iso(3_600_000), bytes: body.length }],
      },
    ]),
  );
  const info = (title: string): WikiPageInfo => {
    const page = pages.get(title)!;
    return {
      title,
      path: `${title}.md`,
      kind: page.kind,
      summary: page.body.split("\n")[0]!.slice(0, 60),
      revision: page.revision,
      updatedAt: iso(0),
    };
  };
  const full = (title: string): WikiPage => ({
    ...info(title),
    body: pages.get(title)!.body,
    links: [],
    missing: [],
    backlinks: [...pages.keys()].filter(
      (other) => other !== title && pages.get(other)!.body.includes(`[[${title}]]`),
    ),
  });
  const changes: WikiChange[] = [];
  let settings: WikiSettings = { capture: true, edits: "approve" };
  const api = {
    changes: {
      list: vi.fn(async ({ state }: { state?: string[] } = {}) =>
        changes.filter((change) => !state || state.includes(change.state)),
      ),
      applyAll: vi.fn(async () => {
        let applied = 0;
        let conflicts = 0;
        for (const change of changes.filter((item) => item.state === "pending")) {
          if (change.id.startsWith("moved")) {
            change.state = "conflict";
            conflicts += 1;
          } else {
            change.state = "applied";
            applied += 1;
          }
        }
        return { applied, conflicts };
      }),
      decide: vi.fn(async ({ changeId, decision }: { changeId: string; decision: string }) => {
        const change = changes.find((item) => item.id === changeId)!;
        change.state = decision === "apply" ? "applied" : "refused";
        return change;
      }),
    },
    settings: {
      get: vi.fn(async () => settings),
      set: vi.fn(async (patch: Partial<WikiSettings>) => {
        settings = { ...settings, ...patch };
        return settings;
      }),
    },
    index: vi.fn(async () => [...pages.keys()].map(info)),
    search: vi.fn(
      async ({ query }: { query: string }): Promise<WikiHit[]> =>
        [...pages.keys()]
          .filter((title) => pages.get(title)!.body.toLowerCase().includes(query.toLowerCase()))
          .map((title) => ({ title, kind: pages.get(title)!.kind, snippet: `…${query}…` })),
    ),
    read: vi.fn(async ({ title }: { title: string }) => full(title)),
    write: vi.fn(
      async ({ title, body }: { title: string; body: string; expectedRevision?: number }) => {
        const existing = pages.get(title);
        const revision = (existing?.revision ?? 0) + 1;
        pages.set(title, {
          body,
          kind: existing?.kind ?? "Other",
          revision,
          revisions: [{ revision, at: iso(0), bytes: body.length }, ...(existing?.revisions ?? [])],
        });
        return full(title);
      },
    ),
    history: vi.fn(async ({ title }: { title: string }) => pages.get(title)!.revisions),
    restore: vi.fn(async ({ title, revision }: { title: string; revision: number }) => {
      const page = pages.get(title)!;
      return api.write({ title, body: `restored from ${revision} (${page.body.length})` });
    }),
    remove: vi.fn(async ({ title }: { title: string }) => {
      pages.delete(title);
      return { ok: true as const };
    }),
  };
  return { api: api as unknown as WikiApi & typeof api, pages, changes };
}

let host: HTMLDivElement;
let opened: Array<string | null>;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.replaceChildren(host);
  opened = [];
});

async function settle() {
  for (let i = 0; i < 6; i += 1)
    await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
}
async function mount(api: WikiApi, start: string | null = null) {
  function Host() {
    const [title, setTitle] = useState<string | null>(start);
    return (
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <WikiBrowser
          api={api}
          title={title}
          onOpen={(next) => {
            opened.push(next);
            setTitle(next);
          }}
        />
      </QueryClientProvider>
    );
  }
  const root = createRoot(host);
  await act(async () => root.render(<Host />));
  await settle();
  return () => act(async () => root.unmount());
}
const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const button = (label: string) =>
  [...host.querySelectorAll<HTMLElement>("button")].find(
    (b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label,
  );
const click = async (el: Element | undefined | null) => {
  await act(async () => (el as HTMLElement).click());
  await settle();
};
async function type(el: Element, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

it("says the wiki is empty with one line and one action", async () => {
  const { api } = fakeApi();
  const unmount = await mount(api);
  expect(q("wiki-empty")?.textContent).toBe("No pages yet");
  expect(button("New page")).toBeTruthy();
  await unmount();
});

it("lists the pages by kind, each with the sentence that sums it up", async () => {
  const { api } = fakeApi({
    "Ana Souza": { body: "Leads the account.\nMore.", kind: "Person" },
    Plan: { body: "The launch plan.", kind: "Project" },
  });
  const unmount = await mount(api);
  expect(q("wiki-kind-Person")?.textContent).toContain("Ana Souza");
  expect(q("wiki-kind-Person")?.textContent).toContain("Leads the account.");
  expect(q("wiki-kind-Project")?.textContent).toContain("Plan");
  await unmount();
});

it("opens a page and shows its text without its front matter", async () => {
  const { api } = fakeApi({ Plan: { body: "---\ntype: Project\n---\nThe launch plan." } });
  const unmount = await mount(api);
  await click(q("wiki-page-Plan"));
  expect(q("wiki-title")?.textContent).toBe("Plan");
  expect(q("wiki-body")?.textContent).toContain("The launch plan.");
  expect(q("wiki-body")?.textContent).not.toContain("type: Project");
  expect(opened).toEqual(["Plan"]);
  await unmount();
});

it("follows a link to a page that exists, and leaves a link to one that does not as plain text", async () => {
  const { api } = fakeApi({
    Plan: { body: "Owner: [[Ana Souza]]. Blocked on [[Budget]]." },
    "Ana Souza": { body: "Leads the account." },
  });
  const unmount = await mount(api, "Plan");
  const body = q("wiki-body")!;
  expect(body.textContent).toContain("Blocked on Budget.");
  expect([...body.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Ana Souza"]);
  await click(body.querySelector("button"));
  expect(opened.at(-1)).toBe("Ana Souza");
  expect(q("wiki-title")?.textContent).toBe("Ana Souza");
  await unmount();
});

it("shows which pages cite this one, and opens them", async () => {
  const { api } = fakeApi({ Hub: { body: "The hub." }, Spoke: { body: "Part of [[Hub]]." } });
  const unmount = await mount(api, "Hub");
  const group = host.querySelector('nav[aria-label="Cited by"]')!;
  await click(group.querySelector("button"));
  expect(q("wiki-title")?.textContent).toBe("Spoke");
  await unmount();
});

it("saves an edit from the revision that was opened", async () => {
  const { api } = fakeApi({ Plan: { body: "Old text." } });
  const unmount = await mount(api, "Plan");
  await click(button("Edit"));
  const area = host.querySelector("textarea")!;
  expect(area.value).toBe("Old text.");
  await type(area, "New text.");
  await click(button("Save"));
  expect(api.write).toHaveBeenCalledWith({ title: "Plan", body: "New text.", expectedRevision: 1 });
  expect(q("wiki-body")?.textContent).toContain("New text.");
  expect(host.querySelector("textarea")).toBeNull();
  await unmount();
});

it("holds a save the page has moved on from, and lets the person reload", async () => {
  const { api, pages } = fakeApi({ Plan: { body: "Old text." } });
  const unmount = await mount(api, "Plan");
  await click(button("Edit"));
  await type(host.querySelector("textarea")!, "My text.");
  pages.get("Plan")!.body = "Someone else's text.";
  pages.get("Plan")!.revision = 2;
  api.write.mockRejectedValueOnce(new ORPCError("CONFLICT"));
  await click(button("Save"));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("This page changed");
  expect((button("Save") as HTMLButtonElement).disabled).toBe(true);
  await click(button("Reload"));
  expect(host.querySelector("textarea")!.value).toBe("Someone else's text.");
  expect((button("Save") as HTMLButtonElement).disabled).toBe(false);
  await type(host.querySelector("textarea")!, "Merged.");
  await click(button("Save"));
  expect(api.write).toHaveBeenLastCalledWith({
    title: "Plan",
    body: "Merged.",
    expectedRevision: 2,
  });
  await unmount();
});

it("writes a new page under the title that was typed", async () => {
  const { api } = fakeApi({ Plan: { body: "x" } });
  const unmount = await mount(api);
  await click(button("New page"));
  expect((button("Save") as HTMLButtonElement).disabled).toBe(true);
  await type(host.querySelector('input[aria-label="Title"]')!, "Budget");
  await type(host.querySelector("textarea")!, "Numbers.");
  await click(button("Save"));
  expect(api.write).toHaveBeenCalledWith({
    title: "Budget",
    body: "Numbers.",
    expectedRevision: 0,
  });
  expect(opened.at(-1)).toBe("Budget");
  await unmount();
});

it("opens the page that already has the title a new page was given, instead of replacing it", async () => {
  const { api } = fakeApi({ Plan: { body: "Written last week." } });
  const unmount = await mount(api);
  await click(button("New page"));
  await type(host.querySelector('input[aria-label="Title"]')!, "Plan");
  await type(host.querySelector("textarea")!, "Mine.");
  api.write.mockRejectedValueOnce(new ORPCError("CONFLICT"));
  await click(button("Save"));
  expect(opened.at(-1)).toBe("Plan");
  expect(q("wiki-title")?.textContent).toBe("Plan");
  expect(q("wiki-body")?.textContent).toContain("Written last week.");
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await unmount();
});

it("shows the revisions, newest first, and restores an older one", async () => {
  const { api } = fakeApi({ Plan: { body: "First." } });
  await api.write({ title: "Plan", body: "Second." });
  const unmount = await mount(api, "Plan");
  await click(button("History"));
  const rows = [...q("wiki-history")!.querySelectorAll("li")];
  expect(rows.map((row) => row.textContent)).toEqual([
    expect.stringContaining("Revision 2"),
    expect.stringContaining("Revision 1"),
  ]);
  expect(rows[0]!.querySelector("button")).toBeNull();
  await click(rows[1]!.querySelector("button"));
  expect(api.restore).toHaveBeenCalledWith({ title: "Plan", revision: 1 });
  expect(q("wiki-body")?.textContent).toContain("restored from 1");
  await unmount();
});

it("deletes a page only after it is asked twice", async () => {
  const { api } = fakeApi({ Plan: { body: "x" }, Other: { body: "y" } });
  const unmount = await mount(api, "Plan");
  await click(
    [...host.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent === "Delete"),
  );
  expect(api.remove).not.toHaveBeenCalled();
  await click(
    [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Delete" && b.getAttribute("role") !== "menuitem",
    ),
  );
  expect(api.remove).toHaveBeenCalledWith({ title: "Plan" });
  expect(opened.at(-1)).toBeNull();
  expect(q("wiki-page-Plan")).toBeNull();
  await unmount();
});

it("searches the text of the pages and shows the matches in place of the kinds", async () => {
  const { api } = fakeApi({
    Launch: { body: "The marigold campaign." },
    Budget: { body: "Numbers only." },
  });
  const unmount = await mount(api);
  await type(host.querySelector('input[aria-label="Search"]')!, "mari");
  expect(api.search).toHaveBeenCalledWith({ query: "mari" });
  expect(q("wiki-hits")?.textContent).toContain("Launch");
  expect(q("wiki-hits")?.textContent).not.toContain("Budget");
  expect(q("wiki-kind-Other")).toBeNull();
  await type(host.querySelector('input[aria-label="Search"]')!, "m");
  expect(q("wiki-kind-Other")).toBeTruthy();
  await unmount();
});

const waiting = (id: string, title: string): WikiChange => ({
  id,
  state: "pending",
  reason: "Plan moved on",
  sourceTitle: "Planning call",
  pages: [{ title, op: "replace" }],
  edits: [{ title, op: "replace", removed: "planning", added: "building" }],
  createdAt: new Date(NOW).toISOString(),
  canSeeSource: false,
});

it("shows nothing about changes while none is waiting", async () => {
  const { api } = fakeApi({ Plan: { body: "Status: planning." } });
  const unmount = await mount(api);
  expect(q("wiki-pending")).toBeNull();
  await unmount();
});

it("lists what waits for approval, and approving writes it and clears it", async () => {
  const { api, changes } = fakeApi({ Plan: { body: "Status: planning." } });
  changes.push(waiting("c1", "Plan"));
  const unmount = await mount(api);
  expect(q("wiki-pending")?.textContent).toContain("Waiting for approval");
  expect(q("wiki-pending")?.textContent).toContain("Plan");
  await click(button("Approve"));
  expect(api.changes.decide).toHaveBeenCalledWith({ changeId: "c1", decision: "apply" });
  expect(q("wiki-pending")).toBeNull();
  await unmount();
});

it("refuses a change from the same list", async () => {
  const { api, changes } = fakeApi({ Plan: { body: "Status: planning." } });
  changes.push(waiting("c2", "Plan"));
  const unmount = await mount(api);
  await click(button("Refuse"));
  expect(api.changes.decide).toHaveBeenCalledWith({ changeId: "c2", decision: "refuse" });
  await unmount();
});

it("keeps the Space's two wiki settings as two switches, each changed on its own", async () => {
  const { api } = fakeApi({ Plan: { body: "Status: planning." } });
  const unmount = await mount(api);
  const learn = button("Learn from conversations");
  const approve = button("Approve edits");
  expect(learn?.getAttribute("aria-checked")).toBe("true");
  expect(approve?.getAttribute("aria-checked")).toBe("true");
  await click(approve);
  expect(api.settings.set).toHaveBeenCalledWith({ edits: "auto" });
  await click(learn);
  expect(api.settings.set).toHaveBeenLastCalledWith({ capture: false });
  expect(button("Approve edits")?.getAttribute("aria-checked")).toBe("false");
  expect(button("Learn from conversations")?.getAttribute("aria-checked")).toBe("false");
  await unmount();
});

it("offers Approve all only when two or more changes wait", async () => {
  const { api, changes } = fakeApi({ Plan: { body: "Status: planning." } });
  changes.push(waiting("c1", "Plan"));
  const unmount = await mount(api);
  expect(button("Approve all")).toBeUndefined();
  await unmount();
  changes.push(waiting("c2", "Plan"));
  const again = await mount(api);
  expect(button("Approve all")).toBeDefined();
  await again();
});

it("approves every waiting change with one call and clears the list", async () => {
  const { api, changes } = fakeApi({ Plan: { body: "Status: planning." } });
  changes.push(waiting("c1", "Plan"), waiting("c2", "Plan"));
  const unmount = await mount(api);
  await click(button("Approve all"));
  expect(api.changes.applyAll).toHaveBeenCalledTimes(1);
  expect(q("wiki-pending")).toBeNull();
  expect(q("wiki-moved")).toBeNull();
  await unmount();
});

it("says a page changed when approving all leaves a conflict", async () => {
  const { api, changes } = fakeApi({ Plan: { body: "Status: planning." } });
  changes.push(waiting("c1", "Plan"), waiting("moved2", "Plan"));
  const unmount = await mount(api);
  await click(button("Approve all"));
  expect(q("wiki-moved")?.textContent).toContain("A page changed since");
  await unmount();
});
