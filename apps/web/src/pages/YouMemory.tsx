import type {
  UserMemory,
  UserMemoryDecision,
  UserMemorySettings,
  UserMemoryState,
} from "@corvo/contracts";
import { USER_MEMORY_TEXT_MAX } from "@corvo/contracts";
import { Button, Input, Switch } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PencilIcon, XIcon } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { errorText } from "../lib/user-error";

/** What the screen needs of what agents know about the person: the procedures of the `you` namespace. */
export type YouApi = {
  list(input: { state?: UserMemoryState[] }): Promise<UserMemory[]>;
  add(input: { text: string }): Promise<UserMemory>;
  edit(input: { memoryId: string; text: string }): Promise<UserMemory>;
  decide(input: { memoryId: string; decision: UserMemoryDecision }): Promise<UserMemory | null>;
  settings: {
    get(): Promise<UserMemorySettings>;
    set(patch: Partial<UserMemorySettings>): Promise<UserMemorySettings>;
  };
};

const rowClass = "flex min-h-9 items-center justify-between gap-3 text-[14px]";

/**
 * What the person's agents know about them, in their hands: suggestions to save or drop, the facts
 * with edit and forget, the ones not confirmed for a long time, and the forgotten ones, which are
 * kept only so they are not learned again until the person deletes them for good.
 */
export function YouMemory({ api }: { api: YouApi }) {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const learnId = useId();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const memories = useQuery({ queryKey: ["you", "list"], queryFn: () => api.list({}) });
  const settings = useQuery({ queryKey: ["you", "settings"], queryFn: () => api.settings.get() });

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      await queryClient.invalidateQueries({ queryKey: ["you"] });
      return true;
    } catch (err) {
      setError(errorText(err, t`Could not save`));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const decide = (memoryId: string, decision: UserMemoryDecision) =>
    run(() => api.decide({ memoryId, decision }));

  async function add(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    if (await run(() => api.add({ text }))) setDraft("");
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    const text = editing?.text.trim();
    if (!editing || !text || busy) return;
    if (await run(() => api.edit({ memoryId: editing.id, text }))) setEditing(null);
  }

  async function learn(next: boolean) {
    queryClient.setQueryData<UserMemorySettings>(["you", "settings"], { learn: next });
    await run(() => api.settings.set({ learn: next }));
  }

  const all = memories.data ?? [];
  const waiting = all.filter((memory) => memory.state === "pending");
  const stale = all.filter((memory) => memory.state === "saved" && memory.stale);
  const known = all.filter((memory) => memory.state === "saved" && !memory.stale);
  const forgotten = all.filter((memory) => memory.state === "forgotten");

  const button = (
    label: string,
    memory: UserMemory,
    decision: UserMemoryDecision,
    ghost = false,
  ) => (
    <Button
      size="sm"
      variant={ghost ? "ghost" : "default"}
      disabled={busy}
      onClick={() => void decide(memory.id, decision)}
    >
      {label}
    </Button>
  );

  return (
    <section className="rounded-xl border border-border px-4 py-4" data-testid="you-memory">
      <h3 className="text-heading3 font-medium text-foreground">
        <Trans>You</Trans>
      </h3>
      <form onSubmit={(event) => void add(event)} className="mt-3">
        <Input
          value={draft}
          maxLength={USER_MEMORY_TEXT_MAX}
          disabled={busy}
          placeholder={t`Teach something about you`}
          aria-label={t`Teach something about you`}
          onChange={(event) => setDraft(event.target.value)}
        />
      </form>
      {error ? <p className="mt-2 text-[13px] text-destructive">{error}</p> : null}

      {waiting.length ? (
        <div className="mt-4" data-testid="you-new">
          <h4 className="text-xs font-medium text-muted-foreground">
            <Trans>New</Trans>
          </h4>
          <ul>
            {waiting.map((memory) => (
              <li key={memory.id} className={rowClass}>
                <span dir="auto">{memory.text}</span>
                <span className="flex shrink-0 gap-1">
                  {button(t`Save`, memory, "save")}
                  {button(t`Discard`, memory, "discard", true)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {stale.length ? (
        <div className="mt-4" data-testid="you-stale">
          <h4 className="text-xs font-medium text-muted-foreground">
            <Trans>Still true?</Trans>
          </h4>
          <ul>
            {stale.map((memory) => (
              <li key={memory.id} className={rowClass}>
                <span dir="auto">{memory.text}</span>
                <span className="flex shrink-0 gap-1">
                  {button(t`Keep`, memory, "keep")}
                  {button(t`Forget`, memory, "forget", true)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {known.length ? (
        <ul className="mt-4" data-testid="you-list">
          {known.map((memory) =>
            editing?.id === memory.id ? (
              <li key={memory.id} className="py-1">
                <form onSubmit={(event) => void saveEdit(event)}>
                  <Input
                    autoFocus
                    value={editing.text}
                    maxLength={USER_MEMORY_TEXT_MAX}
                    disabled={busy}
                    aria-label={t`Edit`}
                    onChange={(event) => setEditing({ id: memory.id, text: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setEditing(null);
                    }}
                  />
                </form>
              </li>
            ) : (
              <li key={memory.id} className={rowClass}>
                <span dir="auto">{memory.text}</span>
                <span className="flex shrink-0">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t`Edit`}
                    disabled={busy}
                    onClick={() => setEditing({ id: memory.id, text: memory.text })}
                  >
                    <PencilIcon />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t`Forget`}
                    disabled={busy}
                    onClick={() => void decide(memory.id, "forget")}
                  >
                    <XIcon />
                  </Button>
                </span>
              </li>
            ),
          )}
        </ul>
      ) : null}

      {forgotten.length ? (
        <details className="mt-4 text-[14px]" data-testid="you-forgotten">
          <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground">
            <Trans>Forgotten</Trans> ({forgotten.length})
          </summary>
          <ul className="mt-1">
            {forgotten.map((memory) => (
              <li key={memory.id} className={rowClass}>
                <span className="text-muted-foreground" dir="auto">
                  {memory.text}
                </span>
                {button(t`Delete for good`, memory, "erase", true)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="mt-4 flex min-h-9 items-center justify-between gap-3 text-[14px]">
        <label htmlFor={learnId}>
          <Trans>Suggest from what I say</Trans>
        </label>
        <Switch
          id={learnId}
          checked={settings.data?.learn ?? false}
          disabled={!settings.data || busy}
          onCheckedChange={(next) => void learn(next)}
        />
      </div>
    </section>
  );
}
