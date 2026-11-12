import type { ApprovalBatchClass, ApprovalBatchItem } from "@corvo/core";
import { Button } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { errorText } from "../lib/user-error";

type Batch = { batchClass: ApprovalBatchClass; items: ApprovalBatchItem[] };

/**
 * Allows several pending approvals of one class in one step. Each card stays as it is until the
 * backend reports it decided; a card that could not be decided is counted for as long as it waits.
 */
export function ApproveAllBar({
  batches,
  pendingEffectIds,
  onApproveAll,
}: {
  batches: Batch[];
  /** Every approval still waiting, so a failure is reported only while its card is. */
  pendingEffectIds: ReadonlySet<string>;
  /** Resolves with the approval ids that were not decided. */
  onApproveAll: (batchClass: ApprovalBatchClass, items: ApprovalBatchItem[]) => Promise<string[]>;
}) {
  const { t } = useLingui();
  const [sending, setSending] = useState<ApprovalBatchClass | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const failedCount = failed.filter((id) => pendingEffectIds.has(id)).length;
  const note = error ?? (failedCount > 0 ? t`${failedCount} could not be approved` : null);
  if (batches.length === 0 && !note) return null;
  return (
    <div data-testid="approve-all" className="flex flex-wrap items-center gap-3">
      {batches.map((batch) => (
        <Button
          key={batch.batchClass}
          variant="brand"
          className="rounded-full px-5"
          disabled={sending !== null}
          onClick={async () => {
            setSending(batch.batchClass);
            setError(null);
            setFailed([]);
            try {
              setFailed(await onApproveAll(batch.batchClass, batch.items));
            } catch (err) {
              setError(errorText(err, t`Could not submit this answer`));
            } finally {
              setSending(null);
            }
          }}
        >
          {sending === batch.batchClass ? (
            <Trans>Sending…</Trans>
          ) : (
            <ApproveAllLabel count={batch.items.length} />
          )}
        </Button>
      ))}
      {note ? <span className="text-[13px] text-destructive">{note}</span> : null}
    </div>
  );
}

function ApproveAllLabel({ count }: { count: number }) {
  return <Trans>Approve all {count}</Trans>;
}
