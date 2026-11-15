import type { ImportFromAppPreview } from "@corvo/contracts";
import { APP_IMPORT_PROMPT, type ImportFromAppInput } from "@corvo/contracts";
import { Button, Spinner } from "@corvo/ui-web";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@corvo/ui-web/components/ui/dialog";
import { Textarea } from "@corvo/ui-web/components/ui/textarea";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ComponentProps, ReactNode } from "react";
import { useRef, useState } from "react";
import { SuccessPop } from "../components/ai/primitives";
import { readAppImportFiles } from "../lib/app-import-files";
import { useSpaceRpc } from "../lib/space-rpc";
import { errorText } from "../lib/user-error";

type Stage =
  | { kind: "choose" }
  | { kind: "preview"; preview: ImportFromAppPreview }
  | { kind: "done"; label: string };

/** Brings an agent in from another app: its own answer to a prompt, skill files, or a text file. */
export function ImportFromApp({
  variant = "outline",
  onImported,
}: {
  variant?: ComponentProps<typeof Button>["variant"];
  onImported?: () => void;
}) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: "choose" });
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset(next: boolean) {
    setOpen(next);
    if (next) return;
    setStage({ kind: "choose" });
    setText("");
    setError(null);
    setCopied(false);
  }

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function preview(input: ImportFromAppInput) {
    setStage({ kind: "preview", preview: await rpc.bots.importFromApp(input) });
  }

  async function pick(chosen: File[]) {
    const input = chosen.length > 0 ? await readAppImportFiles(chosen) : null;
    if (!input) {
      setError(t`Nothing to import in these files.`);
      return;
    }
    await preview(input);
  }

  async function add(found: ImportFromAppPreview) {
    const result = await rpc.bots.importSpace(found.space);
    const parts = [
      result.added.length > 0
        ? plural(result.added.length, { one: "# agent", other: "# agents" })
        : null,
      result.skills > 0 ? plural(result.skills, { one: "# skill", other: "# skills" }) : null,
      result.routines > 0
        ? plural(result.routines, { one: "# routine (paused)", other: "# routines (paused)" })
        : null,
    ].filter((part) => part !== null);
    setStage({
      kind: "done",
      label: parts.length > 0 ? t`Added ${parts.join(", ")}.` : t`Everything is already here.`,
    });
    onImported?.();
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger render={<Button variant={variant} className="rounded-full" />}>
        <Trans>Import from another app</Trans>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Trans>Import from another app</Trans>
          </DialogTitle>
          {stage.kind === "choose" ? (
            <DialogDescription>
              <Trans>
                Paste the prompt into ChatGPT, Claude, Gemini or Grok, then paste its answer here.
              </Trans>
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {stage.kind === "choose" ? (
          <div className="space-y-3">
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(APP_IMPORT_PROMPT)
                  .then(() => setCopied(true))
                  .catch(() => undefined);
              }}
            >
              {copied ? <Trans>Copied</Trans> : <Trans>Copy prompt</Trans>}
            </Button>
            <Textarea
              aria-label={t`Answer`}
              placeholder={t`Paste the answer`}
              rows={6}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setError(null);
              }}
            />
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => files.current?.click()}
              >
                <Trans>Choose files</Trans>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => folder.current?.click()}
              >
                <Trans>Choose folder</Trans>
              </Button>
            </div>
            <input
              ref={files}
              type="file"
              multiple
              accept=".zip,.md,.markdown,.txt"
              hidden
              onChange={(event) => {
                const chosen = [...(event.target.files ?? [])];
                event.target.value = "";
                void run(() => pick(chosen));
              }}
            />
            <input
              ref={folder}
              type="file"
              hidden
              {...{ webkitdirectory: "" }}
              onChange={(event) => {
                const chosen = [...(event.target.files ?? [])];
                event.target.value = "";
                void run(() => pick(chosen));
              }}
            />
            {error ? (
              <p role="alert" className="text-[12.5px] text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                disabled={busy || text.trim() === ""}
                onClick={() => void run(() => preview({ source: "prompt", text }))}
              >
                {busy ? <Spinner className="size-3 shrink-0" /> : null}
                <Trans>Preview</Trans>
              </Button>
            </DialogFooter>
          </div>
        ) : null}

        {stage.kind === "preview" ? (
          <PreviewBody
            preview={stage.preview}
            busy={busy}
            error={error}
            onBack={() => {
              setStage({ kind: "choose" });
              setError(null);
            }}
            onImport={() => void run(() => add(stage.preview))}
          />
        ) : null}

        {stage.kind === "done" ? (
          <div aria-live="polite" className="py-2">
            <SuccessPop label={stage.label} />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PreviewBody({
  preview,
  busy,
  error,
  onBack,
  onImport,
}: {
  preview: ImportFromAppPreview;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onImport: () => void;
}) {
  const nothingNew =
    !preview.agents.some((agent) => !agent.exists) &&
    preview.skills.length === 0 &&
    preview.facts === 0;
  return (
    <div className="space-y-4" data-testid="app-import-preview">
      {preview.agents.map((agent) => (
        <section key={agent.name} className="space-y-1">
          <h3 className="font-medium text-sm">
            {agent.name}
            {agent.exists ? (
              <span className="ml-2 font-normal text-muted-foreground">
                <Trans>Already here</Trans>
              </span>
            ) : null}
          </h3>
          {agent.title ? <p className="text-muted-foreground text-sm">{agent.title}</p> : null}
          {agent.instructions ? (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                <Trans>Instructions</Trans>
              </summary>
              <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-[12.5px]">
                {agent.instructions}
              </pre>
            </details>
          ) : null}
        </section>
      ))}
      <PreviewList title={<Trans>Skills</Trans>} items={preview.skills} />
      <PreviewList
        title={<Trans>Routines</Trans>}
        items={preview.routines.map((routine) => routine.name)}
        note={<Trans>Start paused</Trans>}
      />
      {preview.facts > 0 ? (
        <p className="text-sm">
          {plural(preview.facts, { one: "# fact to review", other: "# facts to review" })}
        </p>
      ) : null}
      <PreviewList title={<Trans>Add these files again</Trans>} items={preview.files} />
      <PreviewList title={<Trans>To connect</Trans>} items={preview.connections} />
      {preview.leftOut > 0 ? (
        <p className="text-muted-foreground text-sm">
          {plural(preview.leftOut, { one: "# item left out", other: "# items left out" })}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-[12.5px] text-destructive">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button variant="ghost" disabled={busy} onClick={onBack}>
          <Trans>Back</Trans>
        </Button>
        <Button disabled={busy || nothingNew} onClick={onImport}>
          {busy ? <Spinner className="size-3 shrink-0" /> : null}
          <Trans>Import</Trans>
        </Button>
      </DialogFooter>
    </div>
  );
}

function PreviewList({
  title,
  items,
  note,
}: {
  title: ReactNode;
  items: string[];
  note?: ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-1">
      <h3 className="font-medium text-sm">
        {title}
        {note ? <span className="ml-2 font-normal text-muted-foreground">{note}</span> : null}
      </h3>
      <ul className="list-disc pl-5 text-sm">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
