import type { PendingApproval } from "@corvo/contracts";
import { Spinner } from "@corvo/ui-web";
import { Trans } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useSpaceQueries } from "../lib/query";
import { rpc } from "../lib/rpc";
import { usePendingApprovals } from "../lib/use-pending-approvals";
import { ApprovalsInbox } from "./ApprovalsInbox";
import { WindowChrome } from "./WindowChrome";

/** The approvals this person may decide, from every channel and agent in one list. */
export function ApprovalsPage() {
  const navigate = useNavigate();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const approvals = usePendingApprovals();
  const listKey = queries.approvals.list.queryOptions({ input: {} }).queryKey;

  async function answer(
    item: PendingApproval,
    text: string,
    username: string | undefined,
    approvalEffectId: string | undefined,
  ) {
    await rpc.threads.answer({
      ...(item.groupId ? { groupId: item.groupId } : { botId: item.botId }),
      runId: item.runId,
      messageId: item.messageId,
      answer: text,
      username,
      approvalEffectId,
    });
    // Deciding changes the count at once; the next poll only confirms it.
    queryClient.setQueryData(listKey, (current: PendingApproval[] | undefined) =>
      current?.filter(
        (entry) =>
          !(
            entry.messageId === item.messageId &&
            entry.block.kind === "ask" &&
            entry.block.approvalEffectId === approvalEffectId
          ),
      ),
    );
    await queryClient.invalidateQueries({ queryKey: listKey });
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background text-foreground">
      <div className="app-drag flex items-center gap-2 px-4 pt-3">
        <WindowChrome />
      </div>
      <h1 className="mx-auto w-full max-w-3xl px-6 py-4 text-xl font-light tracking-tight">
        <Trans>Approvals</Trans>
      </h1>
      <div className="mx-auto w-full max-w-3xl px-6 pb-8">
        {approvals.isPending ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : (
          <ApprovalsInbox
            items={approvals.data ?? []}
            onAnswer={answer}
            onOpenChat={(item) =>
              navigate(item.groupId ? `/app/g/${item.groupId}` : `/app/${item.botId}`)
            }
          />
        )}
      </div>
    </div>
  );
}
