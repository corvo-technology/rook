import type {
  WikiChange,
  WikiPage,
  WikiPageInfo,
  WikiRevision,
  WikiSettings,
} from "@corvo/contracts";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { bootstrapI18n, i18n } from "../../src/lib/i18n";
import { applyResolvedAppearance } from "../../src/lib/ui-appearance";
import "../../src/styles.css";
import { type WikiApi, WikiBrowser } from "../../src/pages/WikiBrowser";

// The Wiki screen over a fake company, so its look can be checked without a backend.
// State lives in the URL (?theme=light|dark&locale=en|pt-BR&page=Title).

const params = new URLSearchParams(location.search);
const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

type Stored = { kind: string; body: string; revisions: WikiRevision[] };
const page = (kind: string, body: string, ages: number[] = [2 * HOUR]): Stored => ({
  kind,
  body,
  revisions: ages.map((age, index) => ({
    revision: ages.length - index,
    at: ago(age),
    bytes: body.length,
  })),
});

const pages = new Map<string, Stored>([
  [
    "Alpha Builders",
    page(
      "Client",
      "---\ntype: Client\n---\nA construction company renovating two office floors with us.\n\n## Contacts\n\n- [[Marina Costa]] runs the account and approves every quote.\n- Finance questions go to [[Rui Mendes]].\n\n## Status\n\nThe [[Office Renovation]] quote was approved on Oct 28. Waiting on the [[Safety Audit]] before work starts.",
      [26 * HOUR, 5 * HOUR, HOUR],
    ),
  ],
  [
    "Marina Costa",
    page(
      "Person",
      "Account lead at [[Alpha Builders]]. Prefers short updates by email, never calls before 10:00.",
    ),
  ],
  ["Rui Mendes", page("Person", "Finance contact at [[Alpha Builders]]. Pays within 15 days.")],
  [
    "Office Renovation",
    page(
      "Project",
      "Two floors, 600 m². Start planned for Nov 18, delivery Jan 30.\n\n## Decisions\n\n- Quote approved by [[Marina Costa]].\n- Dust control is mandatory, see [[Safety Audit]].",
      [3 * 24 * HOUR, 2 * HOUR],
    ),
  ],
  [
    "Safety Audit",
    page("Decision", "An audit of the site is required before work starts. Owner: [[Rui Mendes]]."),
  ],
  [
    "Invoice Policy",
    page("Decision", "Invoices go out on the last business day of the month, net 15."),
  ],
  [
    "Weekly Report",
    page(
      "Topic",
      "Every Friday the team writes one page: what moved, what is blocked, what is next.",
    ),
  ],
]);

const infoOf = (title: string): WikiPageInfo => {
  const stored = pages.get(title)!;
  const body = stored.body.replace(/^---[\s\S]*?---\n/, "");
  return {
    title,
    path: `${title}.md`,
    kind: stored.kind,
    summary: body
      .split(/(?<=\.)\s/)[0]!
      .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1")
      .slice(0, 90),
    revision: stored.revisions.length,
    updatedAt: stored.revisions[0]!.at,
  };
};
const read = (title: string): WikiPage => {
  const links = [...pages.get(title)!.body.matchAll(/\[\[([^\]|]+)/g)].map((m) => m[1]!);
  return {
    ...infoOf(title),
    body: pages.get(title)!.body,
    links,
    missing: links.filter((link) => !pages.has(link)),
    backlinks: [...pages.keys()]
      .filter((other) => other !== title && pages.get(other)!.body.includes(`[[${title}]]`))
      .sort(),
  };
};

// One edit waits for approval, as the curator leaves it after a conversation; ?changes=none hides it.
const changes: WikiChange[] =
  params.get("changes") === "none"
    ? []
    : [
        {
          id: "change-1",
          state: "pending",
          reason: "The quote was approved and the start date is set.",
          sourceTitle: "Renovation kickoff",
          pages: [{ title: "Office Renovation", op: "replace" }],
          edits: [
            {
              title: "Office Renovation",
              op: "replace",
              removed: "Start planned for Nov 18",
              added: "Start planned for Nov 25",
            },
          ],
          createdAt: ago(HOUR),
          canSeeSource: true,
          sourceText:
            "Marina: the quote is approved, we start on Nov 18.\nLeo: noted, I will update the plan.",
        },
      ];
// ?changes=two leaves a second edit waiting, which is when Approve all shows.
if (params.get("changes") === "two")
  changes.push({
    id: "change-2",
    state: "pending",
    reason: "The invoice day was agreed.",
    sourceTitle: "Billing chat",
    pages: [{ title: "Invoice Policy", op: "replace" }],
    edits: [
      {
        title: "Invoice Policy",
        op: "replace",
        removed: "net 15",
        added: "net 30",
      },
    ],
    createdAt: ago(HOUR / 2),
    canSeeSource: false,
  });
let settings: WikiSettings = { capture: true, edits: "approve" };

const api: WikiApi = {
  changes: {
    list: async ({ state } = {}) =>
      changes.filter((change) => !state || state.includes(change.state)),
    applyAll: async () => {
      let applied = 0;
      for (const change of changes.filter((item) => item.state === "pending")) {
        change.state = "applied";
        applied += 1;
      }
      return { applied, conflicts: 0 };
    },
    decide: async ({ changeId, decision }) => {
      const change = changes.find((item) => item.id === changeId)!;
      change.state =
        decision === "apply" ? "applied" : decision === "refuse" ? "refused" : "undone";
      return change;
    },
  },
  settings: {
    get: async () => settings,
    set: async (patch) => {
      settings = { ...settings, ...patch };
      return settings;
    },
  },
  index: async () => [...pages.keys()].map(infoOf),
  search: async ({ query }) =>
    [...pages.keys()]
      .filter((title) =>
        `${title} ${pages.get(title)!.body}`.toLowerCase().includes(query.toLowerCase()),
      )
      .map((title) => ({ title, kind: pages.get(title)!.kind, snippet: infoOf(title).summary })),
  read: async ({ title }) => read(title),
  write: async ({ title, body }) => {
    const existing = pages.get(title);
    const revision = (existing?.revisions.length ?? 0) + 1;
    pages.set(title, {
      kind: existing?.kind ?? "Other",
      body,
      revisions: [{ revision, at: ago(0), bytes: body.length }, ...(existing?.revisions ?? [])],
    });
    return read(title);
  },
  history: async ({ title }) => pages.get(title)!.revisions,
  restore: async ({ title, revision }) =>
    api.write({ title, body: `${pages.get(title)!.body}\n\n(restored from revision ${revision})` }),
  remove: async ({ title }) => {
    pages.delete(title);
    return { ok: true };
  },
};

function Screen() {
  const [title, setTitle] = useState<string | null>(params.get("page"));
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <h1 className="px-6 py-4 text-base font-medium">Wiki</h1>
      <WikiBrowser api={api} title={title} onOpen={setTitle} />
    </div>
  );
}

applyResolvedAppearance(params.get("theme") === "light" ? "light" : "dark");
await bootstrapI18n(params.get("locale") === "pt-BR" ? "pt-BR" : "en");
createRoot(document.getElementById("root")!).render(
  <I18nProvider i18n={i18n}>
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Screen />
    </QueryClientProvider>
  </I18nProvider>,
);
