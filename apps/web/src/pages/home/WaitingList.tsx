import type { PendingApproval } from "@corvo/contracts";
import { BotAvatar } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { waitingKey } from "../../lib/home-live";

const text = (item: PendingApproval): string => (item.block.kind === "ask" ? item.block.text : "");

/** The body of the "Waiting for you" card: longest wait first; a row opens the conversation. */
export function WaitingList({ items }: { items: readonly PendingApproval[] }) {
  const { t } = useLingui();
  const navigate = useNavigate();
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{t`Nothing waiting for you now.`}</p>;
  }
  return (
    <ul className="flex flex-col pb-10">
      {items.map((item) => (
        <li key={waitingKey(item)} className="rk-home-row-in">
          <button
            type="button"
            className="rk-home-lift group flex w-full min-w-0 items-start gap-3 rounded-xl px-2 py-2 text-start outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => navigate(item.groupId ? `/app/g/${item.groupId}` : `/app/${item.botId}`)}
          >
            <BotAvatar
              color={item.botColor}
              identity={item.botId}
              size={30}
              status="waiting_input"
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-semibold">{item.botName}</span>
              <span className="line-clamp-2 text-[13px] text-muted-foreground">{text(item)}</span>
            </span>
            <ChevronRight
              aria-hidden
              className="mt-2 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            />
          </button>
        </li>
      ))}
    </ul>
  );
}
