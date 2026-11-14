import { SpaceExportSchema } from "@corvo/contracts";
import { Button } from "@corvo/ui-web";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
import { useSpaceRpc } from "../lib/space-rpc";
import { errorText } from "../lib/user-error";

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await work();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
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
    setDone(
      result.routines > 0
        ? t`${plural(count, { one: "Added # bot", other: "Added # bots" })}. Routines start paused.`
        : plural(count, { one: "Added # bot.", other: "Added # bots." }),
    );
    onImported?.();
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="rounded-full"
          disabled={busy}
          onClick={() => void run(exportSpace)}
        >
          <Trans>Export space</Trans>
        </Button>
        <Button
          variant="outline"
          className="rounded-full"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          <Trans>Import space</Trans>
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void run(() => importSpace(file));
          }}
        />
      </div>
      {error ? (
        <p role="alert" className="text-[12.5px] text-destructive">
          {error}
        </p>
      ) : null}
      {done ? <p className="text-[12.5px] text-muted-foreground">{done}</p> : null}
    </div>
  );
}
