import type { ComputerStatus } from "@corvo/contracts";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  InlineConfirm,
} from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { MoreHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { computerUpdates } from "../lib/computer-updates";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

type Action = "stop" | "recover" | "reset" | "update";

export function ComputerMaintenanceActions({
  botId,
  computer,
  onChanged,
  visibleRecover = false,
}: {
  botId: string;
  computer: ComputerStatus | null;
  onChanged: () => Promise<void>;
  visibleRecover?: boolean;
}) {
  const { t } = useLingui();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, setPending] = useState<Action | null>(null);
  // Reset and recover lose unsaved work, so the first click arms the item and the second runs it.
  const [armed, setArmed] = useState<"reset" | "recover" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(null), 4000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  if (!computer) return null;

  const busy = Boolean(computer.busyBotName) || computer.state === "booting";
  const showRecover =
    computer.state === "error" ||
    computer.state === "running" ||
    computer.state === "suspended" ||
    computer.state === "stopped";
  const showReset = showRecover;
  const showStop = computer.state === "running";
  const showUpdate = computer.canUpdate;
  const hasActions = showStop || showRecover || showReset || showUpdate;
  if (!hasActions) return null;

  async function run(action: Action) {
    setPending(action);
    setError(null);
    try {
      if (action === "stop") await rpc.computer.stop({ botId });
      else if (action === "recover") await computerUpdates.start(botId, "recover");
      else if (action === "reset") await rpc.computer.reset({ botId });
      else await computerUpdates.start(botId);
      setArmed(null);
      setMenuOpen(false);
      await onChanged();
    } catch (err) {
      setError(
        errorText(
          err,
          action === "stop" ? t`Could not stop computer` : t`Could not update computer`,
        ),
      );
    } finally {
      setPending(null);
    }
  }

  function arm(action: "reset" | "recover") {
    setError(null);
    if (armed === action) void run(action);
    else setArmed(action);
  }

  if (visibleRecover)
    return (
      <>
        <InlineConfirm
          variant="outline"
          size="sm"
          disabled={busy || pending !== null}
          confirmLabel={t`Confirm recover?`}
          onConfirm={() => void run("recover")}
        >
          <Trans>Recover computer</Trans>
        </InlineConfirm>
        {error ? (
          <p role="alert" className="text-[13px] text-destructive">
            {error}
          </p>
        ) : null}
      </>
    );

  return (
    <DropdownMenu
      open={menuOpen}
      onOpenChange={(open) => {
        if (open) setError(null);
        else setArmed(null);
        setMenuOpen(open);
      }}
    >
      <DropdownMenuTrigger
        data-testid="computer-more-button"
        aria-label={t`More computer actions`}
        disabled={busy && pending === null}
        render={<Button variant="ghost" size="icon-sm" className="text-muted-foreground" />}
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" data-testid="computer-more-menu" className="w-auto min-w-44">
        {showStop ? (
          <DropdownMenuItem
            closeOnClick={false}
            disabled={busy || pending !== null}
            onClick={() => void run("stop")}
          >
            {pending === "stop" ? <Trans>Stopping…</Trans> : <Trans>Stop computer</Trans>}
          </DropdownMenuItem>
        ) : null}
        {showRecover ? (
          <DropdownMenuItem
            closeOnClick={false}
            disabled={busy || pending !== null}
            aria-label={armed === "recover" ? t`Confirm recover?` : t`Recover computer`}
            className="flex flex-col items-start"
            onClick={() => arm("recover")}
          >
            <span className={armed === "recover" ? "text-destructive" : undefined}>
              {pending === "recover" ? (
                <Trans>Recovering…</Trans>
              ) : armed === "recover" ? (
                <Trans>Confirm recover?</Trans>
              ) : (
                <Trans>Recover computer</Trans>
              )}
            </span>
            <span className="text-xs text-muted-foreground">
              <Trans>Recreate a computer that is not working.</Trans>
            </span>
          </DropdownMenuItem>
        ) : null}
        {showReset ? (
          <DropdownMenuItem
            closeOnClick={false}
            aria-label={armed === "reset" ? t`Confirm reset?` : t`Reset computer`}
            className="flex flex-col items-start"
            disabled={busy || pending !== null}
            onClick={() => arm("reset")}
          >
            <span className={armed === "reset" ? "text-destructive" : undefined}>
              {pending === "reset" ? (
                <Trans>Resetting…</Trans>
              ) : armed === "reset" ? (
                <Trans>Confirm reset?</Trans>
              ) : (
                <Trans>Reset computer</Trans>
              )}
            </span>
            <span className="text-xs text-muted-foreground">
              <Trans>Restore the last saved workspace.</Trans>
            </span>
          </DropdownMenuItem>
        ) : null}
        {showUpdate ? (
          <DropdownMenuItem
            closeOnClick={false}
            disabled={busy || pending !== null}
            aria-label={t`Update computer`}
            className="flex flex-col items-start"
            onClick={() => void run("update")}
          >
            <span>
              {pending === "update" ? <Trans>Updating…</Trans> : <Trans>Update computer</Trans>}
            </span>
            <span className="text-xs text-muted-foreground">
              <Trans>Save the workspace and install current software.</Trans>
            </span>
          </DropdownMenuItem>
        ) : null}
        {error ? <p className="px-1.5 py-1 text-[12.5px] text-destructive">{error}</p> : null}
        <span role="status" aria-live="polite" className="sr-only">
          {armed === "recover" ? t`Confirm recover?` : armed === "reset" ? t`Confirm reset?` : ""}
        </span>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
