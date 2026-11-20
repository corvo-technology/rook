import { ChatMarkdown } from "@corvo/chat-ui/web";
import type { ThreadMessage } from "@corvo/contracts";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@corvo/ui-web/components/ui/collapsible";
import { Trans } from "@lingui/react/macro";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type SubagentBlock = Extract<ThreadMessage["blocks"][number], { kind: "subagent" }>;

// A running helper's live card and the saved message that replaces it have different ids, so
// its row mounts again when the helper finishes. Remember open cards by agent id across that.
const openHelpers = new Set<string>();

/**
 * A helper's card. It starts folded to its name, status and one line of the task, so a long
 * brief or report does not fill the chat. The header opens it to the full task and the result
 * or progress.
 */
export function SubagentCard({
  block,
  loadFull,
}: {
  block: SubagentBlock;
  /** Reads the whole card, for a report that arrived as a preview. */
  loadFull?: () => Promise<SubagentBlock | undefined>;
}) {
  const [open, setOpen] = useState(() => openHelpers.has(block.agentId));
  const [full, setFull] = useState<SubagentBlock>();
  const wantsFull = open && block.truncated === true && !full;
  // The preview shows at once; the rest is read when the card is opened, once.
  const load = useRef(loadFull);
  load.current = loadFull;
  useEffect(() => {
    if (!wantsFull || !load.current) return;
    let current = true;
    load.current().then(
      (loaded) => current && loaded && setFull(loaded),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [wantsFull]);
  const running = block.status === "running";
  const failed = block.status === "failed";
  const shown = full ?? block;
  const body = shown.result || shown.progress || "";
  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => {
        if (next) openHelpers.add(block.agentId);
        else openHelpers.delete(block.agentId);
        setOpen(next);
      }}
      data-testid="subagent-card"
      className="w-[420px] max-w-full rounded-[18px] border border-border bg-muted px-[18px] py-4"
    >
      <CollapsibleTrigger className="block w-full min-w-0 cursor-pointer rounded-md text-start outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-muted">
        <span className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 flex-1 items-center text-[15px] font-medium text-foreground">
            <span className="truncate" dir="auto">
              {block.name}
            </span>
          </span>
          <span
            className={`${running ? "motion-safe:animate-[rkPulse_1.2s_ease-in-out_infinite]" : ""} shrink-0 rounded-full px-[11px] py-1 text-[13px] ${
              failed
                ? "bg-destructive/15 text-destructive"
                : running
                  ? "bg-warning/15 text-warning"
                  : "bg-success/15 text-success"
            }`}
          >
            {running ? (
              <Trans>Running</Trans>
            ) : failed ? (
              <Trans>Failed</Trans>
            ) : (
              <Trans>Completed</Trans>
            )}
          </span>
          <ChevronDown
            data-testid="subagent-chevron"
            aria-hidden
            size={14}
            strokeWidth={1.8}
            className={`shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none ${
              open ? "rotate-180" : ""
            }`}
          />
        </span>
        <span
          data-testid="subagent-task"
          className={`mt-2 block text-[13.5px] text-muted-foreground ${open ? "" : "truncate"}`}
          dir="auto"
        >
          {block.task}
        </span>
      </CollapsibleTrigger>
      {body ? (
        <CollapsibleContent>
          <div
            data-testid="subagent-body"
            className="mt-2.5 text-[14.5px] leading-[1.5] text-foreground/75"
          >
            <ChatMarkdown streaming={running}>{body}</ChatMarkdown>
          </div>
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}
