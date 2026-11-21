import { AGENT_LOADER_WORKING_AFTER_MS } from "@corvo/core";
import { useEffect, useState } from "react";
import { BotAvatar } from "./bot-avatar.js";
import { useSpinnerLabel } from "./components/ui/spinner.js";
import { cn } from "./lib/utils.js";

export { AGENT_LOADER_WORKING_AFTER_MS };

/**
 * The run status a wait shows: `queued` (the avatar thinks) at first, `running` (it works) once the
 * wait has passed `afterMs`. They are the same statuses an agent's own run goes through, so the
 * avatar's mapping draws them.
 */
export function useLoaderStatus(afterMs = AGENT_LOADER_WORKING_AFTER_MS): "queued" | "running" {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setLate(true), afterMs);
    return () => window.clearTimeout(timer);
  }, [afterMs]);
  return late ? "running" : "queued";
}

/**
 * The one loader of the app: the rook, or the agent whose thing is loading, thinking and then
 * working, in place of a spinner. Under reduced motion the avatar holds a still frame. It announces
 * itself as a status with the kit's loading label, or the `label` of the thing that is loading.
 */
export function AgentLoader({
  color = "",
  identity,
  size = 28,
  label,
  className,
}: {
  /** The agent's saved avatar value; the default rook when it is not known yet. */
  color?: string;
  identity?: string;
  size?: number;
  label?: string;
  className?: string;
}) {
  const fallback = useSpinnerLabel();
  const status = useLoaderStatus();
  return (
    <span
      role="status"
      aria-label={label ?? fallback}
      data-slot="agent-loader"
      data-status={status}
      className={cn("inline-flex shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <BotAvatar color={color} identity={identity} size={size} status={status} live />
    </span>
  );
}
