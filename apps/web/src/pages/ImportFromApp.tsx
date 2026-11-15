import { Button } from "@corvo/ui-web";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@corvo/ui-web/components/ui/dialog";
import { Trans } from "@lingui/react/macro";
import type { ComponentProps } from "react";
import { useState } from "react";
import { ImportFlow } from "./ImportFlow";

/** The import in a dialog: for wherever a space is already open. */
export function ImportFromApp({
  variant = "outline",
  onImported,
}: {
  variant?: ComponentProps<typeof Button>["variant"];
  onImported?: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Closing starts the next import from the sources again.
  const [session, setSession] = useState(0);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSession((count) => count + 1);
      }}
    >
      <DialogTrigger render={<Button variant={variant} className="rounded-full" />}>
        <Trans>Import</Trans>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Trans>Import</Trans>
          </DialogTitle>
        </DialogHeader>
        <ImportFlow key={session} onFinish={() => setOpen(false)} onImported={onImported} />
      </DialogContent>
    </Dialog>
  );
}
