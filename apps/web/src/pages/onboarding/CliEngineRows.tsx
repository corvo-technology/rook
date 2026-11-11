import type {
  CliEngineId,
  CliEngineSetup,
  CliEngineStatus,
  CliLoginSession,
} from "@corvo/contracts";
import { Button, Input } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { Shimmer } from "../../components/ai/primitives";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";

const ENGINE_LABELS: Record<CliEngineId, string> = { claude: "Claude Code" };
const POLL_MS = 1_500;

type KeyName = "enter" | "up" | "down" | "esc";
const KEY_FOR_EVENT: Record<string, KeyName> = {
  ArrowUp: "up",
  ArrowDown: "down",
  Escape: "esc",
};

/** What the page should offer for an engine, from its status and what this computer can do. */
export function cliEngineAction(
  status: CliEngineStatus,
  setup: CliEngineSetup | undefined,
): "install" | "signIn" | null {
  if (!setup) return null;
  if (status.state === "missing") return setup.installable ? "install" : null;
  if (status.state === "signed_out") return setup.signIn ? "signIn" : null;
  return null;
}

/** Engines that can be acted on now, so the model step knows whether there is anything to show. */
export function useCliEngineSetup(engines: CliEngineStatus[] | undefined) {
  const [setup, setSetup] = useState<CliEngineSetup[]>([]);
  const needed = engines?.some((engine) => engine.state !== "ready") ?? false;
  useEffect(() => {
    if (!needed) return;
    let active = true;
    rpc.engines
      .setupState()
      .then((found) => active && setSetup(found))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [needed]);
  return setup;
}

/** One row per engine the person can install or sign in to without a terminal. */
export function CliEngineRows({
  engines,
  setup,
  onChanged,
}: {
  engines: CliEngineStatus[];
  setup: CliEngineSetup[];
  onChanged: () => void;
}) {
  return (
    <>
      {engines.map((status) => {
        const action = cliEngineAction(
          status,
          setup.find((item) => item.id === status.id),
        );
        return action ? (
          <CliEngineRow key={status.id} id={status.id} action={action} onChanged={onChanged} />
        ) : null;
      })}
    </>
  );
}

function CliEngineRow({
  id,
  action,
  onChanged,
}: {
  id: CliEngineId;
  action: "install" | "signIn";
  onChanged: () => void;
}) {
  const { t } = useLingui();
  const [installing, setInstalling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [session, setSession] = useState<{ id: string; mode: "browser" | "terminal" } | null>(null);
  const [screen, setScreen] = useState<CliLoginSession | null>(null);
  const [typed, setTyped] = useState("");
  const sessionRef = useRef<string | null>(null);

  async function install() {
    setInstalling(true);
    setMessage(null);
    try {
      const { state } = await rpc.engines.install({ id });
      if (state === "installed") onChanged();
      else if (state === "mismatch") {
        setMessage(t`The download did not match the published file. Nothing was installed.`);
      } else setMessage(t`Could not install`);
    } catch (err) {
      setMessage(errorText(err));
    }
    setInstalling(false);
  }

  async function signIn() {
    setMessage(null);
    try {
      const started = await rpc.engines.signIn({ id });
      sessionRef.current = started.sessionId;
      setScreen({ state: "running", lines: [] });
      setSession({ id: started.sessionId, mode: started.mode });
    } catch (err) {
      setMessage(errorText(err));
    }
  }

  const sessionId = session?.id;
  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    const timer = setInterval(() => {
      rpc.engines
        .loginScreen({ sessionId })
        .then((next) => {
          if (!active) return;
          setScreen(next);
          if (next.state === "running") return;
          clearInterval(timer);
          setSession(null);
          if (next.state === "done") onChanged();
          else if (next.state === "failed")
            setMessage(next.error ?? t`Something went wrong. Try again.`);
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
      // Leaving the step ends the CLI's sign-in instead of leaving it waiting.
      rpc.engines.cancelLogin({ sessionId }).catch(() => undefined);
    };
  }, [sessionId, onChanged, t]);

  function send(input: { text?: string; key?: KeyName }) {
    if (!sessionRef.current) return;
    void rpc.engines.loginInput({ sessionId: sessionRef.current, ...input }).catch(() => undefined);
  }

  const running = session !== null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border p-3">
      <p className="min-w-0 flex-1 text-sm text-foreground">{ENGINE_LABELS[id]}</p>
      {action === "install" ? (
        <Button type="button" size="sm" disabled={installing} onClick={() => void install()}>
          {installing ? (
            <Shimmer>
              <Trans>Installing…</Trans>
            </Shimmer>
          ) : (
            <Trans>Install</Trans>
          )}
        </Button>
      ) : screen?.url ? (
        <Button
          size="sm"
          nativeButton={false}
          render={<a href={screen.url} target="_blank" rel="noreferrer" />}
        >
          <Shimmer>
            <Trans>Sign in</Trans>
          </Shimmer>
        </Button>
      ) : (
        <Button type="button" size="sm" disabled={running} onClick={() => void signIn()}>
          {running ? (
            <Shimmer>
              <Trans>Sign in</Trans>
            </Shimmer>
          ) : (
            <Trans>Sign in</Trans>
          )}
        </Button>
      )}
      {message ? (
        <p className="basis-full text-sm text-destructive" role="alert">
          {message}
        </p>
      ) : null}
      {session?.mode === "terminal" ? (
        <div className="basis-full">
          <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs text-foreground">
            {screen?.lines.join("\n")}
          </pre>
          <Input
            aria-label={t`Terminal input`}
            className="mt-2 font-mono"
            autoComplete="off"
            spellCheck={false}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                send({ text: typed, key: "enter" });
                setTyped("");
                return;
              }
              const key = KEY_FOR_EVENT[event.key];
              if (key) {
                event.preventDefault();
                send({ key });
              }
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
