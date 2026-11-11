import type { MissionId } from "@corvo/contracts";
import { MISSIONS } from "@corvo/core";
import { Button } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { Check } from "lucide-react";
import { useMissions } from "../lib/use-missions";

/** Where each mission is done; a request comes from an agent, so `decide` has no place to go. */
const DESTINATION: Partial<Record<MissionId, string>> = {
  talk: "/app",
  connect: "/app?integrations",
  second: "/app?integrations",
  routine: "/app/routines",
  memory: "/app?settings=memory",
};

/** The first missions of a new account. They check themselves off; clicking one never completes it. */
export function MissionList({
  navigate,
  onNavigate,
}: {
  navigate: (path: string) => void;
  onNavigate?: () => void;
}) {
  const { t } = useLingui();
  const { view, listed, showAll, showingAll } = useMissions();
  if (!listed || !view) return null;
  const titles: Record<MissionId, string> = {
    talk: t`Talk to your agent`,
    decide: t`Answer a request`,
    connect: t`Connect an app`,
    second: t`Add a second agent`,
    routine: t`Schedule a routine`,
    memory: t`Keep a memory`,
  };
  return (
    <div className="flex flex-col gap-1 px-3 pb-2">
      <ol aria-label={t`Missions`} data-coach="missions" className="flex flex-col">
        {MISSIONS.map(({ id }) => {
          const done = view.completed.includes(id);
          const to = DESTINATION[id];
          const row = (
            <>
              <span
                aria-hidden
                className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${done ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
              >
                {done ? <Check className="size-3" strokeWidth={3} /> : null}
              </span>
              <span className={done ? "text-muted-foreground line-through" : undefined}>
                {titles[id]}
              </span>
            </>
          );
          return (
            <li key={id}>
              {to && !done ? (
                <button
                  type="button"
                  onClick={() => {
                    navigate(to);
                    onNavigate?.();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {row}
                </button>
              ) : (
                // A native checkbox carries the done state without any copy of its own.
                <label className="flex items-center gap-2 px-2 py-1.5 text-sm">
                  <input type="checkbox" checked={done} disabled readOnly className="sr-only" />
                  {row}
                </label>
              )}
            </li>
          );
        })}
      </ol>
      <Button variant="ghost" size="sm" disabled={showingAll} onClick={showAll}>
        {t`Show everything`}
      </Button>
    </div>
  );
}
