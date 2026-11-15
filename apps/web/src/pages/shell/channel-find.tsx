import type { SearchHit, ThreadMessage } from "@corvo/contracts";
import { Input, Popover, PopoverContent, PopoverTrigger } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { Pin, PinOff, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { rpc } from "../../lib/rpc";
import { previewMessageText } from "./chat-shared";

/** How long typing pauses before the channel is searched. */
export const SEARCH_DELAY_MS = 250;

/** Changes whenever a loaded message is pinned or unpinned, so the pin list reads again. */
export function pinSignature(messages: readonly Pick<ThreadMessage, "id" | "pinnedAt">[]): string {
  return messages
    .filter((message) => message.pinnedAt)
    .map((message) => `${message.id}:${message.pinnedAt}`)
    .join(",");
}

const iconButton =
  "grid size-7 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

/** The channel's own search and its pinned messages, side by side in the channel header. */
export function ChannelFind({
  groupId,
  pins,
  memberName,
  onJump,
}: {
  groupId: string;
  /** Changes when a pin does; see `pinSignature`. */
  pins: string;
  memberName: (botId: string | undefined) => string | undefined;
  /** Scrolls the channel to a message. */
  onJump: (messageId: string) => void;
}) {
  return (
    <>
      <ChannelSearch groupId={groupId} onJump={onJump} />
      <ChannelPins groupId={groupId} pins={pins} memberName={memberName} onJump={onJump} />
    </>
  );
}

function ChannelSearch({
  groupId,
  onJump,
}: {
  groupId: string;
  onJump: (messageId: string) => void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits(null);
      setFailed(false);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      rpc.search
        .query({ q, within: { groupId } })
        .then((result) => {
          if (!current) return;
          setFailed(false);
          setHits(result.hits.filter((hit) => hit.messageId));
        })
        .catch(() => {
          if (!current) return;
          setHits(null);
          setFailed(true);
        });
    }, SEARCH_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, groupId]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger aria-label={t`Search`} className={iconButton}>
        <Search className="size-4" strokeWidth={1.7} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-1.5rem)]">
        <Input
          type="search"
          autoFocus
          value={query}
          aria-label={t`Search`}
          placeholder={t`Search`}
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />
        {hits?.length ? (
          <ul data-testid="channel-search-results" className="max-h-72 overflow-y-auto">
            {hits.map((hit) => (
              <li key={`${hit.kind}:${hit.messageId}:${hit.url ?? ""}`}>
                <button
                  type="button"
                  dir="auto"
                  onClick={() => {
                    if (hit.messageId) onJump(hit.messageId);
                    setOpen(false);
                    setQuery("");
                  }}
                  className="block w-full rounded-md px-2 py-1.5 text-start text-[13px] leading-snug text-foreground outline-none hover:bg-accent focus-visible:bg-accent"
                >
                  <span className="line-clamp-2">{hit.snippet}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : failed ? (
          <p role="status" className="px-2 py-1 text-[13px] text-muted-foreground">
            {t`Could not search`}
          </p>
        ) : hits ? (
          <p role="status" className="px-2 py-1 text-[13px] text-muted-foreground">
            {t`No matches`}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function ChannelPins({
  groupId,
  pins,
  memberName,
  onJump,
}: {
  groupId: string;
  pins: string;
  memberName: (botId: string | undefined) => string | undefined;
  onJump: (messageId: string) => void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);

  useEffect(() => {
    let current = true;
    setMessages([]);
    rpc.threads
      .pinned({ groupId })
      .then((result) => {
        if (current) setMessages(result.messages);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [groupId, pins]);

  // The button is only there once something is pinned.
  if (messages.length === 0) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger aria-label={t`Pinned messages`} className={iconButton}>
        <Pin className="size-4" strokeWidth={1.7} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-1.5rem)]">
        <ul data-testid="channel-pins" className="max-h-80 overflow-y-auto">
          {messages.map((message) => (
            <li key={message.id} className="flex items-start gap-1">
              <button
                type="button"
                dir="auto"
                onClick={() => {
                  onJump(message.id);
                  setOpen(false);
                }}
                className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-start outline-none hover:bg-accent focus-visible:bg-accent"
              >
                <span className="block text-[12px] font-medium text-muted-foreground">
                  {message.role === "user" ? t`You` : (memberName(message.botId) ?? t`Bot`)}
                </span>
                <span className="line-clamp-2 text-[13px] leading-snug text-foreground">
                  {previewMessageText(message)}
                </span>
              </button>
              <button
                type="button"
                aria-label={t`Unpin`}
                onClick={() => {
                  setMessages((current) => current.filter((item) => item.id !== message.id));
                  void rpc.threads
                    .pin({ groupId, messageId: message.id, pinned: false })
                    .catch(() => undefined);
                }}
                className={iconButton}
              >
                <PinOff className="size-3.5" strokeWidth={1.7} />
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
