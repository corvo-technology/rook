import type { PendingApproval } from "@corvo/contracts";
import { BotAvatar, EmptyState } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { AskCard } from "../components/AskCard";

/**
 * Everything waiting on this person, across every chat: whose it is, where it came from, and the
 * same card that decides it in the chat, held to approve.
 */
export function ApprovalsInbox({
  items,
  onAnswer,
  onOpenChat,
}: {
  items: readonly PendingApproval[];
  onAnswer: (
    item: PendingApproval,
    answer: string,
    username: string | undefined,
    approvalEffectId: string | undefined,
  ) => Promise<void>;
  onOpenChat: (item: PendingApproval) => void;
}) {
  const { t } = useLingui();
  if (items.length === 0) {
    return <EmptyState data-testid="approvals-empty" title={t`Nothing to approve`} />;
  }
  return (
    <ul data-testid="approvals-inbox" className="flex flex-col gap-6">
      {items.map((item) => (
        <li
          key={`${item.messageId}:${item.block.kind === "ask" ? item.block.approvalEffectId : ""}`}
          data-testid="approval-item"
          className="flex flex-col gap-2"
        >
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <BotAvatar color={item.botColor} identity={item.botId} size={24} />
            <span className="font-medium">{item.botName}</span>
            <button
              type="button"
              onClick={() => onOpenChat(item)}
              className="min-w-0 truncate rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {item.groupName ? `#${item.groupName}` : <Trans>Open chat</Trans>}
            </button>
          </div>
          {item.block.kind === "ask" ? (
            <div className="max-w-xl">
              <AskCard
                block={item.block}
                canAnswer
                agent={{ id: item.botId, name: item.botName }}
                canDismiss={false}
                onAnswer={(answer, username, approvalEffectId) =>
                  onAnswer(item, answer, username, approvalEffectId)
                }
                onDismiss={async () => undefined}
              />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
