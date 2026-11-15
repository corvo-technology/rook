import { SpaceExportSchema } from "@corvo/contracts";
import { Button, Spinner } from "@corvo/ui-web";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
import { SuccessPop } from "../components/ai/primitives";
import { useSpaceRpc } from "../lib/space-rpc";
import { errorText } from "../lib/user-error";
import { ImportFromApp } from "./ImportFromApp";

/** Moves every bot of the space to another server as one file. */
export function SpaceTransfer({
  spaceName,
  onImported,
}: {
  spaceName: string;
  onImported?: () => void;
}) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const fileInput = useRef<HTMLInputElement>(null);
  const [running, setRunning] = useState<"export" | "import" | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function run(action: "export" | "import", work: () => Promise<void>) {
    setRunning(action);
    setError(null);
    setDone(null);
    try {
      await work();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setRunning(null);
    }
  }

  async function exportSpace() {
    const file = await rpc.export.space();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${spaceName.toLowerCase().replace(/\s+/g, "-")}-space.json`;
    a.click();
    URL.revokeObjectURL(url);
    setDone(t`Space exported.`);
  }

  async function importSpace(file: File) {
    let json: unknown;
    try {
      json = JSON.parse(await file.text());
    } catch {
      json = null;
    }
    const parsed = SpaceExportSchema.safeParse(json);
    if (!parsed.success) {
      setError(t`This isn't a Rook space file.`);
      return;
    }
    const result = await rpc.bots.importSpace(parsed.data);
    const count = result.added.length;
    const extras = [
      result.wikiPages > 0
        ? plural(result.wikiPages, { one: "# wiki page", other: "# wiki pages" })
        : null,
      result.channels > 0
        ? plural(result.channels, { one: "# channel", other: "# channels" })
        : null,
      result.tickets > 0 ? plural(result.tickets, { one: "# ticket", other: "# tickets" }) : null,
    ].filter((item) => item !== null);
    if (count === 0 && extras.length === 0) {
      setDone(t`Everything in this file is already here.`);
    } else {
      const added =
        result.routines > 0
          ? t`${plural(count, { one: "Added # bot", other: "Added # bots" })}. Routines start paused.`
          : plural(count, { one: "Added # bot.", other: "Added # bots." });
      const alsoAdded = t`Also added ${extras.join(", ")}.`;
      setDone(extras.length === 0 ? added : count === 0 ? alsoAdded : `${added} ${alsoAdded}`);
    }
    onImported?.();
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="rounded-full"
          disabled={running !== null}
          aria-busy={running === "export"}
          onClick={() => void run("export", exportSpace)}
        >
          {running === "export" ? <Spinner className="size-3 shrink-0" /> : null}
          {running === "export" ? <Trans>Exporting…</Trans> : <Trans>Export space</Trans>}
        </Button>
        <Button
          variant="outline"
          className="rounded-full"
          disabled={running !== null}
          aria-busy={running === "import"}
          onClick={() => fileInput.current?.click()}
        >
          {running === "import" ? <Spinner className="size-3 shrink-0" /> : null}
          {running === "import" ? <Trans>Importing…</Trans> : <Trans>Import space</Trans>}
        </Button>
        <ImportFromApp onImported={onImported} />
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setName(file.name);
            void run("import", () => importSpace(file));
          }}
        />
      </div>
      <div aria-live="polite">
        {running === "import" && name ? (
          <p className="text-[12.5px] text-muted-foreground">
            <Trans>Importing {name}…</Trans>
          </p>
        ) : null}
        {done ? <SuccessPop label={done} /> : null}
      </div>
      {error ? (
        <p role="alert" className="text-[12.5px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
