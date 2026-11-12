import type { Me } from "@corvo/contracts";
import { Button } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { XIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { CHOOSE_COMPUTER_EVENT } from "../components/ComputersUnavailableHint";
import { sandboxCheckFailureMessage } from "../lib/computer-sandbox";
import { desktopBridge } from "../lib/desktop";
import {
  chooseHostComputer,
  declineHostComputer,
  hostComputerDeclined,
} from "../lib/host-computer";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

/** Whether to ask at launch: a choice is open, and not one the person already put off. */
function asksOnLaunch(me: Me): boolean {
  if (!me.canChooseHostComputer || me.computerHost != null) return false;
  return me.sandboxProvider === "docker" || !hostComputerDeclined();
}

export function HostComputerPrompt({
  initialMe,
  onMeUpdated,
}: {
  initialMe?: Me;
  onMeUpdated?: (me: Me) => void;
}) {
  const { t } = useLingui();
  const headingId = useId();
  const desktop = desktopBridge();
  const [configuring, setConfiguring] = useState(false);
  // The desktop app's own engine has no Docker: there the choice is this computer or nothing.
  const [dockerOffered, setDockerOffered] = useState(true);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mac = desktop?.platform === "darwin";
  const hostLabel = mac ? t`this Mac` : t`this computer`;

  useEffect(() => {
    if (!desktop?.computer) return;
    const configure = () => {
      void rpc
        .me()
        .then((me) => {
          if (me.canChooseHostComputer) {
            setDockerOffered(me.sandboxProvider === "docker");
            setConfiguring(me.computerHost != null);
            setOpen(true);
          }
        })
        .catch(() => undefined);
    };
    const stopMenu = desktop.computer.onConfigure(configure);
    window.addEventListener(CHOOSE_COMPUTER_EVENT, configure);
    return () => {
      stopMenu();
      window.removeEventListener(CHOOSE_COMPUTER_EVENT, configure);
    };
  }, [desktop]);

  useEffect(() => {
    if (!desktop) return;
    if (initialMe) {
      if (asksOnLaunch(initialMe)) {
        setDockerOffered(initialMe.sandboxProvider === "docker");
        setOpen(true);
      }
      return;
    }
    void rpc
      .me()
      .then((me) => {
        if (asksOnLaunch(me)) {
          setDockerOffered(me.sandboxProvider === "docker");
          setOpen(true);
        }
      })
      .catch(() => undefined);
  }, [desktop, initialMe]);

  if (!open) return null;

  async function refreshChoiceState() {
    setChecking(true);
    setError(null);
    try {
      const me = await rpc.me();
      onMeUpdated?.(me);
      if (!me.canChooseHostComputer || me.computerHost != null) {
        setOpen(false);
      }
    } catch (err) {
      setError(sandboxCheckFailureMessage(err));
    } finally {
      setChecking(false);
    }
  }

  async function choose(computerHost: "docker" | "this-mac") {
    setPending(true);
    setError(null);
    try {
      if (!(await chooseHostComputer(desktop, computerHost))) {
        setPending(false);
        return;
      }
    } catch (err) {
      setError(errorText(err, t`Could not save that choice`));
      setPending(false);
      return;
    }
    try {
      const me = await rpc.me();
      onMeUpdated?.(me);
    } catch {
      // The choice is already saved. A failed refresh must not look like a failed save.
    }
    setOpen(false);
    setPending(false);
  }

  const busy = pending || checking;

  // An inline card, not a modal: the app stays usable while the choice is open.
  return (
    <section
      aria-labelledby={headingId}
      data-testid="host-computer-prompt"
      className="animate-panel-in fixed end-4 bottom-4 z-40 flex w-[min(26rem,calc(100vw-2rem))] flex-col gap-3 rounded-2xl bg-popover p-5 text-popover-foreground shadow-overlay"
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-2">
          <h2 id={headingId} className="flex-1 text-heading2 font-normal">
            <Trans>Where should bots run?</Trans>
          </h2>
          {configuring ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className="-me-2 -mt-1"
              aria-label={t`Close`}
              onClick={() => setOpen(false)}
            >
              <XIcon />
            </Button>
          ) : null}
        </div>
        <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
          <p>
            {dockerOffered ? (
              <Trans>
                Docker limits access to your computer for added security. Using {hostLabel} lets
                bots work with your local files and tools.
              </Trans>
            ) : (
              <Trans>Bots can work on {hostLabel} with your local files and tools.</Trans>
            )}
          </p>
          <p className="text-xs text-muted-foreground/80">
            <Trans>
              Local access lets bots run commands without asking. Avoid it on shared or public
              servers.
            </Trans>
          </p>
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        {dockerOffered ? (
          <Button variant="outline" size="lg" disabled={busy} onClick={() => void choose("docker")}>
            <Trans>Docker</Trans>
          </Button>
        ) : null}
        <Button variant="outline" size="lg" disabled={busy} onClick={() => void choose("this-mac")}>
          <Trans>Use {hostLabel}</Trans>
        </Button>
        {dockerOffered ? null : (
          <Button
            variant="ghost"
            size="lg"
            disabled={busy}
            onClick={() => {
              declineHostComputer();
              setOpen(false);
            }}
          >
            <Trans>Not now</Trans>
          </Button>
        )}
      </div>
      {error ? (
        <div className="mt-1 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void refreshChoiceState()}
          >
            {checking ? <Trans>Checking…</Trans> : <Trans>Check again</Trans>}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
