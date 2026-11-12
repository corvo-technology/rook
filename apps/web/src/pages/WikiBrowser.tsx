import { ChatMarkdown } from "@corvo/chat-ui/web";
import type {
  WikiApplyAllResult,
  WikiChange,
  WikiChangeState,
  WikiHit,
  WikiPage,
  WikiPageInfo,
  WikiRevision,
  WikiSettings,
} from "@corvo/contracts";
import { linkWikiTitles, parseWikiPage, wikiMentionHref, wikiSlug } from "@corvo/core";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RookGlyph,
  Spinner,
  Switch,
  Textarea,
} from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Link2, MoreHorizontal, Plus, Search, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { WikiChangeCard } from "../components/WikiChangeCard";
import { formatRelativeTime } from "../lib/relative-time";

/** What the browser needs of the wiki: the procedures of the `wiki` namespace, nothing else. */
export type WikiApi = {
  index(): Promise<WikiPageInfo[]>;
  search(input: { query: string; limit?: number }): Promise<WikiHit[]>;
  read(input: { title: string }): Promise<WikiPage>;
  write(input: { title: string; body: string; expectedRevision?: number }): Promise<WikiPage>;
  history(input: { title: string }): Promise<WikiRevision[]>;
  restore(input: { title: string; revision: number }): Promise<WikiPage>;
  remove(input: { title: string }): Promise<{ ok: true }>;
  changes: {
    list(input: { state?: WikiChangeState[] }): Promise<WikiChange[]>;
    decide(input: { changeId: string; decision: "apply" | "refuse" | "undo" }): Promise<WikiChange>;
    applyAll(): Promise<WikiApplyAllResult>;
  };
  review(): Promise<{ ok: true }>;
  settings: {
    get(): Promise<WikiSettings>;
    set(patch: Partial<WikiSettings>): Promise<WikiSettings>;
  };
};

type Mode = "view" | "edit" | "new" | "history" | "delete";

const MIN_SEARCH = 2;
const rowClass = (open: boolean) =>
  `block h-auto w-full min-w-0 justify-start whitespace-normal rounded-lg px-2.5 py-1.5 text-start font-normal ${open ? "bg-muted text-foreground" : "text-muted-foreground"}`;

/**
 * The team's wiki: its pages by kind, one page read at a time, and the few things a person does
 * with it (write, fix, look back, delete). Pages link to each other with [[Title]].
 */
export function WikiBrowser({
  api,
  title,
  onOpen,
}: {
  api: WikiApi;
  /** The page open now, or null for none. */
  title: string | null;
  onOpen: (title: string | null) => void;
}) {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<Mode>("view");
  const [draftTitle, setDraftTitle] = useState("");
  const [draft, setDraft] = useState("");
  const [loadedRevision, setLoadedRevision] = useState<number | undefined>();
  const [conflicted, setConflicted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const index = useQuery({ queryKey: ["wiki", "index"], queryFn: () => api.index() });
  const query = search.trim();
  const hits = useQuery({
    queryKey: ["wiki", "search", query],
    queryFn: () => api.search({ query }),
    enabled: query.length >= MIN_SEARCH,
  });
  const page = useQuery({
    queryKey: ["wiki", "page", title],
    queryFn: () => api.read({ title: title! }),
    enabled: Boolean(title) && mode !== "new",
  });
  const history = useQuery({
    queryKey: ["wiki", "history", title],
    queryFn: () => api.history({ title: title! }),
    enabled: Boolean(title) && mode === "history",
  });

  const waiting = useQuery({
    queryKey: ["wiki", "changes", "pending"],
    queryFn: () => api.changes.list({ state: ["pending"] }),
  });
  const settings = useQuery({ queryKey: ["wiki", "settings"], queryFn: () => api.settings.get() });
  const [deciding, setDeciding] = useState<string | null>(null);
  const [approvingAll, setApprovingAll] = useState(false);
  const [moved, setMoved] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const needsCare = (waiting.data ?? []).filter((change) => change.review);
  const asked = (waiting.data ?? []).filter((change) => !change.review);

  async function reviewNow() {
    if (reviewing) return;
    setReviewing(true);
    try {
      await api.review();
      // The review runs in the background: look again as it is likely to finish.
      for (const seconds of [8, 25, 60])
        setTimeout(
          () => void queryClient.invalidateQueries({ queryKey: ["wiki"] }),
          seconds * 1000,
        );
    } catch {
      setError(t`Could not save`);
      setReviewing(false);
    }
  }

  async function decide(changeId: string, decision: "apply" | "refuse" | "undo") {
    if (deciding) return;
    setDeciding(changeId);
    try {
      await api.changes.decide({ changeId, decision });
      await queryClient.invalidateQueries({ queryKey: ["wiki"] });
    } catch {
      setError(t`Could not save`);
    } finally {
      setDeciding(null);
    }
  }

  async function approveAll() {
    if (approvingAll) return;
    setApprovingAll(true);
    setMoved(false);
    try {
      const result = await api.changes.applyAll();
      setMoved(result.conflicts > 0);
      await queryClient.invalidateQueries({ queryKey: ["wiki"] });
    } catch {
      setError(t`Could not save`);
    } finally {
      setApprovingAll(false);
    }
  }

  async function changeSetting(patch: Partial<WikiSettings>) {
    queryClient.setQueryData(["wiki", "settings"], { ...settings.data, ...patch });
    try {
      queryClient.setQueryData(["wiki", "settings"], await api.settings.set(patch));
    } catch {
      await queryClient.invalidateQueries({ queryKey: ["wiki", "settings"] });
    }
  }

  const known = useMemo(
    () => new Set((index.data ?? []).map((entry) => wikiSlug(entry.title))),
    [index.data],
  );
  const kinds = useMemo(() => {
    const byKind = new Map<string, WikiPageInfo[]>();
    for (const entry of index.data ?? [])
      byKind.set(entry.kind, [...(byKind.get(entry.kind) ?? []), entry]);
    return [...byKind.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [index.data]);

  function show(next: string | null) {
    setMode("view");
    setConflicted(false);
    setError(null);
    onOpen(next);
  }

  async function refreshAfter(saved: WikiPage | null) {
    if (saved) queryClient.setQueryData(["wiki", "page", saved.title], saved);
    await queryClient.invalidateQueries({ queryKey: ["wiki"] });
  }

  async function save() {
    if (busy || conflicted) return;
    const creating = mode === "new";
    const name = creating ? draftTitle.trim() : (page.data?.title ?? "");
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api.write({
        title: name,
        body: draft,
        // A new page must not replace one that has the title: 0 asks for a free title.
        expectedRevision: creating ? 0 : loadedRevision,
      });
      await refreshAfter(saved);
      setMode("view");
      onOpen(saved.title);
    } catch (err) {
      if (err instanceof ORPCError && err.code === "CONFLICT") {
        // Someone wrote that title first: show what is there rather than replace it.
        if (creating) show(name);
        else setConflicted(true);
      } else setError(t`Could not save`);
    } finally {
      setBusy(false);
    }
  }

  async function restore(revision: number) {
    if (busy || !page.data) return;
    setBusy(true);
    setError(null);
    try {
      const restored = await api.restore({ title: page.data.title, revision });
      await refreshAfter(restored);
      setMode("view");
    } catch {
      setError(t`Could not save`);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy || !page.data) return;
    setBusy(true);
    setError(null);
    try {
      await api.remove({ title: page.data.title });
      queryClient.removeQueries({ queryKey: ["wiki", "page", page.data.title] });
      await queryClient.invalidateQueries({ queryKey: ["wiki"] });
      show(null);
    } catch {
      setError(t`Could not remove`);
    } finally {
      setBusy(false);
    }
  }

  function startEdit() {
    if (!page.data) return;
    setDraft(page.data.body);
    setLoadedRevision(page.data.revision);
    setConflicted(false);
    setError(null);
    setMode("edit");
  }

  function startNew() {
    setDraftTitle("");
    setDraft("");
    setConflicted(false);
    setError(null);
    setMode("new");
  }

  async function reload() {
    const fresh = await api.read({ title: title! });
    queryClient.setQueryData(["wiki", "page", fresh.title], fresh);
    setDraft(fresh.body);
    setLoadedRevision(fresh.revision);
    setConflicted(false);
  }

  const showingPage = Boolean(title) || mode === "new";
  const empty = index.isSuccess && !index.data.length;

  return (
    <div className="flex min-h-0 flex-1" data-testid="wiki">
      <aside
        className={`${showingPage ? "hidden md:flex" : "flex"} w-full shrink-0 flex-col gap-3 overflow-y-auto border-border/60 px-4 pb-6 md:w-64 md:border-e`}
      >
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label={t`Search`}
              className="rounded-full border-transparent bg-muted ps-8"
            />
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t`New page`}
            onClick={startNew}
            className="shrink-0"
          >
            <Plus />
          </Button>
          <Popover>
            <PopoverTrigger
              aria-label={t`Wiki settings`}
              className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-foreground"
            >
              <SlidersHorizontal size={15} strokeWidth={1.7} />
            </PopoverTrigger>
            <PopoverContent align="end" className="flex w-64 flex-col gap-3 p-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <Trans>Learn from conversations</Trans>
                <Switch
                  checked={settings.data?.capture ?? true}
                  aria-label={t`Learn from conversations`}
                  onCheckedChange={(capture) => void changeSetting({ capture })}
                />
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <Trans>Approve edits</Trans>
                <Switch
                  checked={(settings.data?.edits ?? "approve") === "approve"}
                  aria-label={t`Approve edits`}
                  onCheckedChange={(approve) =>
                    void changeSetting({ edits: approve ? "approve" : "auto" })
                  }
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="justify-start px-0"
                disabled={reviewing}
                onClick={() => void reviewNow()}
              >
                <Trans>Review now</Trans>
              </Button>
            </PopoverContent>
          </Popover>
        </div>
        {asked.length ? (
          <div className="flex flex-col gap-2" data-testid="wiki-pending">
            {asked.length > 1 ? (
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                disabled={approvingAll || deciding !== null}
                onClick={() => void approveAll()}
              >
                <Trans>Approve all</Trans>
              </Button>
            ) : null}
            {asked.map((change) => (
              <WikiChangeCard
                key={change.id}
                change={change}
                busy={deciding === change.id}
                onDecide={(decision) => void decide(change.id, decision)}
                onOpenPage={show}
              />
            ))}
          </div>
        ) : null}
        {needsCare.length ? (
          <section className="flex flex-col gap-2" data-testid="wiki-needs-care">
            <h2 className="px-2.5 text-xs text-muted-foreground">
              <Trans>Needs care</Trans>
            </h2>
            {needsCare.map((change) => (
              <WikiChangeCard
                key={change.id}
                change={change}
                busy={deciding === change.id}
                onDecide={(decision) => void decide(change.id, decision)}
                onOpenPage={show}
              />
            ))}
          </section>
        ) : null}
        {moved ? (
          <p className="px-1 text-sm text-muted-foreground" data-testid="wiki-moved">
            <Trans>A page changed since</Trans>
          </p>
        ) : null}
        {index.isPending ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : null}
        {empty ? (
          <p
            className="flex flex-col items-center gap-3 px-1 py-10 text-sm text-muted-foreground"
            data-testid="wiki-empty"
          >
            <RookGlyph state="asleep" size={32} />
            <Trans>No pages yet</Trans>
          </p>
        ) : null}
        {query.length >= MIN_SEARCH ? (
          <ul className="flex flex-col gap-0.5" data-testid="wiki-hits">
            {(hits.data ?? []).map((hit) => (
              <li key={hit.title}>
                <Button
                  variant="ghost"
                  className={rowClass(hit.title === title)}
                  onClick={() => show(hit.title)}
                >
                  <span className="block truncate text-sm">{hit.title}</span>
                  <span className="block line-clamp-2 text-xs text-muted-foreground">
                    {hit.snippet}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          kinds.map(([kind, entries]) => (
            <section
              key={kind}
              aria-label={kind}
              data-testid={`wiki-kind-${kind}`}
              className="flex flex-col gap-0.5"
            >
              <h2 className="px-2.5 pb-0.5 text-xs text-muted-foreground">{kind}</h2>
              {entries.map((entry) => (
                <Button
                  key={entry.title}
                  variant="ghost"
                  data-testid={`wiki-page-${entry.title}`}
                  className={rowClass(entry.title === title)}
                  onClick={() => show(entry.title)}
                >
                  <span className="block truncate text-sm">{entry.title}</span>
                  {entry.summary ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {entry.summary}
                    </span>
                  ) : null}
                </Button>
              ))}
            </section>
          ))
        )}
      </aside>

      <main
        className={`${showingPage ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col overflow-y-auto px-6 pb-16`}
      >
        {showingPage ? (
          <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 pt-2">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon-sm"
                className="md:hidden"
                aria-label={t`Back`}
                onClick={() => show(null)}
              >
                <ChevronLeft />
              </Button>
              {mode === "new" ? (
                <Input
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  aria-label={t`Title`}
                  className="text-base font-medium"
                  autoFocus
                />
              ) : (
                <h2
                  className="min-w-0 flex-1 text-3xl font-light tracking-tight text-balance"
                  data-testid="wiki-title"
                >
                  {page.data?.title ?? title}
                </h2>
              )}
              {mode === "view" && page.data ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t`Page options`}
                        className="shrink-0"
                      />
                    }
                  >
                    <MoreHorizontal />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={startEdit}>
                      <Trans>Edit</Trans>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setMode("history")}>
                      <Trans>History</Trans>
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onClick={() => setMode("delete")}>
                      <Trans>Delete</Trans>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>

            {mode === "edit" || mode === "new" ? (
              <Editor
                draft={draft}
                onDraft={setDraft}
                conflicted={conflicted}
                error={error}
                busy={busy}
                canSave={mode === "edit" || draftTitle.trim().length > 0}
                onSave={save}
                onCancel={() => (mode === "new" ? show(null) : show(title))}
                onReload={reload}
              />
            ) : mode === "history" ? (
              <HistoryList
                revisions={history.data}
                current={page.data?.revision}
                busy={busy}
                error={error}
                onRestore={restore}
                onClose={() => setMode("view")}
              />
            ) : page.isPending ? (
              <div className="flex justify-center py-10">
                <Spinner />
              </div>
            ) : page.data ? (
              <PageBody
                page={page.data}
                known={known}
                onOpen={show}
                deleting={mode === "delete"}
                busy={busy}
                error={error}
                onConfirmDelete={remove}
                onCancelDelete={() => setMode("view")}
              />
            ) : null}
          </div>
        ) : null}
      </main>
    </div>
  );
}

function PageBody({
  page,
  known,
  onOpen,
  deleting,
  busy,
  error,
  onConfirmDelete,
  onCancelDelete,
}: {
  page: WikiPage;
  known: ReadonlySet<string>;
  onOpen: (title: string) => void;
  deleting: boolean;
  busy: boolean;
  error: string | null;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  const { t } = useLingui();
  const body = useMemo(
    () =>
      linkWikiTitles(
        parseWikiPage(page.body).body,
        (title) => known.has(wikiSlug(title)),
        wikiMentionHref,
      ),
    [page.body, known],
  );
  const renderMention = (id: string, name?: ReactNode) => (
    <button
      type="button"
      className="cursor-pointer font-medium underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground"
      onClick={() => onOpen(id)}
    >
      {name ?? id}
    </button>
  );
  return (
    <>
      <div
        data-testid="wiki-body"
        className="text-[15.5px] leading-7 [&_h1]:mt-8 [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-normal [&_h1]:tracking-tight [&_h2]:mt-7 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-normal [&_h2]:tracking-tight [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-medium [&_p]:my-3"
      >
        <ChatMarkdown renderMention={renderMention}>{body}</ChatMarkdown>
      </div>
      {page.backlinks.length ? (
        <nav
          aria-label={t`Cited by`}
          className="flex flex-wrap items-center gap-1.5 text-muted-foreground"
        >
          <Link2 aria-hidden="true" className="size-3.5" />
          {page.backlinks.map((title) => (
            <Button key={title} variant="ghost" size="xs" onClick={() => onOpen(title)}>
              {title}
            </Button>
          ))}
        </nav>
      ) : null}
      {deleting ? (
        <div className="flex items-center gap-2">
          <Button variant="destructive" size="sm" disabled={busy} onClick={onConfirmDelete}>
            <Trans>Delete</Trans>
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancelDelete}>
            <Trans>Cancel</Trans>
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
}

function Editor({
  draft,
  onDraft,
  conflicted,
  error,
  busy,
  canSave,
  onSave,
  onCancel,
  onReload,
}: {
  draft: string;
  onDraft: (value: string) => void;
  conflicted: boolean;
  error: string | null;
  busy: boolean;
  canSave: boolean;
  onSave: () => void;
  onCancel: () => void;
  onReload: () => void;
}) {
  const { t } = useLingui();
  return (
    <div className="flex flex-col gap-3">
      <Textarea
        value={draft}
        onChange={(event) => onDraft(event.target.value)}
        aria-label={t`Page text`}
        className="min-h-72 w-full font-mono text-[13px] leading-relaxed"
        disabled={busy}
      />
      {conflicted ? (
        <div role="alert" className="flex items-center gap-2 text-sm text-warning">
          <span className="min-w-0 flex-1">
            <Trans>This page changed. Reload to see the latest.</Trans>
          </span>
          <Button variant="ghost" size="sm" onClick={onReload}>
            <Trans>Reload</Trans>
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy || conflicted || !canSave} onClick={onSave}>
          <Trans>Save</Trans>
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <Trans>Cancel</Trans>
        </Button>
      </div>
    </div>
  );
}

function HistoryList({
  revisions,
  current,
  busy,
  error,
  onRestore,
  onClose,
}: {
  revisions: WikiRevision[] | undefined;
  current: number | undefined;
  busy: boolean;
  error: string | null;
  onRestore: (revision: number) => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  return (
    <div className="flex flex-col gap-2" data-testid="wiki-history">
      {revisions ? null : (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      )}
      <ul className="flex flex-col">
        {(revisions ?? []).map((revision) => (
          <li
            key={revision.revision}
            className="flex items-center gap-3 border-b border-border py-2 text-sm last:border-b-0"
          >
            <span className="min-w-0 flex-1 truncate">
              {t`Revision ${revision.revision}`}
              <span className="ms-2 text-xs text-muted-foreground">
                {formatRelativeTime(revision.at)}
              </span>
            </span>
            {revision.revision === current ? null : (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => onRestore(revision.revision)}
              >
                <Trans>Restore</Trans>
              </Button>
            )}
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <Trans>Back</Trans>
        </Button>
      </div>
    </div>
  );
}
