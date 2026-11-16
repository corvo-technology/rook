import type { ImportFromAppInput, ImportFromAppPreview, SpaceImportResult } from "@corvo/contracts";
import { APP_IMPORT_PROMPT } from "@corvo/contracts";
import { Button, Spinner } from "@corvo/ui-web";
import { Textarea } from "@corvo/ui-web/components/ui/textarea";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  ArrowLeft,
  FileArchive,
  FileText,
  type LucideIcon,
  MessageSquare,
  Package,
} from "lucide-react";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { SuccessPop } from "../components/ai/primitives";
import { readAppImportFiles } from "../lib/app-import-files";
import { previewSpaceFile } from "../lib/space-file-preview";
import { useSpaceRpc } from "../lib/space-rpc";
import { errorText } from "../lib/user-error";

/** Where an import comes from; each source reaches the same preview and the same import. */
export type ImportSource = "rook" | "chatgpt" | "claude" | "gemini" | "grok" | "skills" | "text";

const SOURCES: { id: ImportSource; label: string; icon: LucideIcon }[] = [
  { id: "rook", label: "Rook", icon: Package },
  { id: "chatgpt", label: "ChatGPT", icon: MessageSquare },
  { id: "claude", label: "Claude", icon: MessageSquare },
  { id: "gemini", label: "Gemini", icon: MessageSquare },
  { id: "grok", label: "Grok", icon: MessageSquare },
  { id: "skills", label: "SKILL.md", icon: FileArchive },
  { id: "text", label: ".md .txt", icon: FileText },
];

type Stage =
  | { kind: "sources" }
  | { kind: "answer"; label: string }
  | { kind: "preview"; preview: ImportFromAppPreview }
  | { kind: "importing" }
  | { kind: "done"; result: SpaceImportResult };

/**
 * One way in for everything a person brings: a Rook space file, another assistant's answer to a
 * prompt, skill files or a text file. Pick a source, review what it holds, import it.
 */
export function ImportFlow({
  onBack,
  onFinish,
  onImported,
}: {
  onBack?: () => void;
  onFinish: () => void;
  onImported?: () => void;
}) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const rookFile = useRef<HTMLInputElement>(null);
  const skillFiles = useRef<HTMLInputElement>(null);
  const textFile = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>({ kind: "sources" });
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function previewApp(input: ImportFromAppInput) {
    setStage({ kind: "preview", preview: await rpc.bots.importFromApp(input) });
  }

  async function pickFiles(chosen: File[]) {
    const input = chosen.length > 0 ? await readAppImportFiles(chosen) : null;
    if (!input) {
      setError(t`Nothing to import in these files.`);
      return;
    }
    await previewApp(input);
  }

  async function pickRook(file: File) {
    const names = (await rpc.bots.list()).map((bot) => bot.name);
    const found = previewSpaceFile(await file.text(), names);
    if (!found) {
      setError(t`This isn't a Rook space file.`);
      return;
    }
    setStage({ kind: "preview", preview: found });
  }

  async function add(found: ImportFromAppPreview) {
    setStage({ kind: "importing" });
    try {
      const result = await rpc.bots.importSpace(found.space);
      setStage({ kind: "done", result });
      onImported?.();
    } catch (err) {
      setStage({ kind: "preview", preview: found });
      throw err;
    }
  }

  function choose(source: ImportSource) {
    setError(null);
    if (source === "rook") rookFile.current?.click();
    else if (source === "skills") skillFiles.current?.click();
    else if (source === "text") textFile.current?.click();
    else
      setStage({ kind: "answer", label: SOURCES.find((item) => item.id === source)?.label ?? "" });
  }

  const back = (to: () => void) => (
    <Button variant="ghost" size="sm" className="-ml-2 mb-4" disabled={busy} onClick={to}>
      <ArrowLeft aria-hidden className="size-4" />
      <Trans>Back</Trans>
    </Button>
  );

  const errorLine = error ? (
    <p role="alert" className="mt-3 text-[12.5px] text-destructive">
      {error}
    </p>
  ) : null;

  return (
    <div>
      {stage.kind === "sources" ? (
        <div>
          {onBack ? back(onBack) : null}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {SOURCES.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                disabled={busy}
                onClick={() => choose(id)}
                className="flex flex-col items-start gap-6 rounded-xl border border-border bg-card p-4 text-left text-card-foreground motion-safe:transition-colors hover:bg-muted/50 disabled:opacity-60"
              >
                <Icon aria-hidden className="size-5 text-muted-foreground" />
                <span className="font-medium text-sm">{label}</span>
              </button>
            ))}
          </div>
          {busy ? <Spinner className="mt-4 size-4" /> : null}
          {errorLine}
          <input
            ref={rookFile}
            type="file"
            accept=".json,application/json"
            hidden
            data-testid="import-rook-file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void run(() => pickRook(file));
            }}
          />
          <input
            ref={skillFiles}
            type="file"
            multiple
            accept=".zip,.md,.markdown"
            hidden
            data-testid="import-skill-files"
            onChange={(event) => {
              const chosen = [...(event.target.files ?? [])];
              event.target.value = "";
              void run(() => pickFiles(chosen));
            }}
          />
          <input
            ref={textFile}
            type="file"
            accept=".md,.markdown,.txt"
            hidden
            data-testid="import-text-file"
            onChange={(event) => {
              const chosen = [...(event.target.files ?? [])];
              event.target.value = "";
              void run(() => pickFiles(chosen));
            }}
          />
        </div>
      ) : null}

      {stage.kind === "answer" ? (
        <div className="space-y-3">
          {back(() => {
            setStage({ kind: "sources" });
            setError(null);
          })}
          <h2 className="font-medium text-lg">{stage.label}</h2>
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
          {errorLine}
          <Button
            disabled={busy || text.trim() === ""}
            onClick={() => void run(() => previewApp({ source: "prompt", text }))}
          >
            {busy ? <Spinner className="size-3 shrink-0" /> : null}
            <Trans>Preview</Trans>
          </Button>
        </div>
      ) : null}

      {stage.kind === "preview" ? (
        <div>
          {back(() => {
            setStage({ kind: "sources" });
            setError(null);
          })}
          <PreviewBody
            preview={stage.preview}
            busy={busy}
            error={error}
            onImport={() => void run(() => add(stage.preview))}
            onFinish={onFinish}
          />
        </div>
      ) : null}

      {stage.kind === "importing" ? (
        <div aria-live="polite" aria-busy className="flex items-center gap-2 py-6 text-sm">
          <Spinner className="size-4" />
          <Trans>Importing…</Trans>
        </div>
      ) : null}

      {stage.kind === "done" ? <Done result={stage.result} onFinish={onFinish} /> : null}
    </div>
  );
}

function Done({ result, onFinish }: { result: SpaceImportResult; onFinish: () => void }) {
  const { t } = useLingui();
  const parts = [
    result.added.length > 0
      ? plural(result.added.length, { one: "# agent", other: "# agents" })
      : null,
    result.skills > 0 ? plural(result.skills, { one: "# skill", other: "# skills" }) : null,
    result.routines > 0
      ? plural(result.routines, { one: "# routine (paused)", other: "# routines (paused)" })
      : null,
    result.wikiPages > 0
      ? plural(result.wikiPages, { one: "# wiki page", other: "# wiki pages" })
      : null,
    result.channels > 0 ? plural(result.channels, { one: "# channel", other: "# channels" }) : null,
    result.tickets > 0 ? plural(result.tickets, { one: "# ticket", other: "# tickets" }) : null,
  ].filter((part) => part !== null);
  return (
    <div className="space-y-4" aria-live="polite">
      <SuccessPop
        label={parts.length > 0 ? t`Added ${parts.join(", ")}.` : t`Everything is already here.`}
      />
      {result.added.length > 0 ? (
        <ul className="flex flex-wrap gap-2" data-testid="imported-agents">
          {result.added.map((name) => (
            <li key={name} className="rounded-full border border-border bg-muted px-3 py-1 text-sm">
              {name}
            </li>
          ))}
        </ul>
      ) : null}
      {result.modelsReset > 0 ? (
        <p className="text-muted-foreground text-sm">
          {plural(result.modelsReset, {
            one: "# routine now uses this space's model.",
            other: "# routines now use this space's model.",
          })}
        </p>
      ) : null}
      <Button onClick={onFinish}>
        <Trans>Continue</Trans>
      </Button>
    </div>
  );
}

function PreviewBody({
  preview,
  busy,
  error,
  onImport,
  onFinish,
}: {
  preview: ImportFromAppPreview;
  busy: boolean;
  error: string | null;
  onImport: () => void;
  onFinish: () => void;
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
      {nothingNew ? (
        <Button onClick={onFinish}>
          <Trans>Continue</Trans>
        </Button>
      ) : (
        <Button disabled={busy} onClick={onImport}>
          {busy ? <Spinner className="size-3 shrink-0" /> : null}
          <Trans>Import</Trans>
        </Button>
      )}
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
