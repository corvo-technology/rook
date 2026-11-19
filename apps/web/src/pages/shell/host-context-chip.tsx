import { useLingui } from "@lingui/react/macro";
import { useHostContext } from "../../lib/embed-host";

/** What the person is looking at in the partner's product, so they see what the agent sees. */
export function HostContextChip() {
  const { t } = useLingui();
  const context = useHostContext();
  const label = context?.entities[0]?.label ?? context?.title;
  if (!label) return null;
  return (
    <div className="px-3 pb-2">
      <span
        data-testid="host-context-chip"
        className="inline-flex max-w-full items-center rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground"
      >
        <span className="truncate">{t`Viewing: ${label}`}</span>
      </span>
    </div>
  );
}
