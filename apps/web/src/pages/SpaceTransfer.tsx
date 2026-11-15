import { Button, Spinner } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
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
  const [running, setRunning] = useState<"export" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function run(action: "export", work: () => Promise<void>) {
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
        <ImportFromApp onImported={onImported} />
      </div>
      <div aria-live="polite">{done ? <SuccessPop label={done} /> : null}</div>
      {error ? (
        <p role="alert" className="text-[12.5px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
