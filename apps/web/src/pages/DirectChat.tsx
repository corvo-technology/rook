import { ChatMarkdown } from "@corvo/chat-ui/web";
import type { ThreadMessage } from "@corvo/contracts";
import { newClientId } from "@corvo/core";
import { Button, Spinner, Textarea } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PersonAvatar } from "../components/PersonAvatar";
import { useSpaceQueries } from "../lib/query";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

const RECONNECT_MS = 2_000;

function textOf(message: ThreadMessage): string {
  return message.blocks.flatMap((block) => (block.kind === "text" ? [block.text] : [])).join("\n");
}

/**
 * A conversation between two people. Only they can read it, and no agent takes part: it is a
 * thread of messages like a channel's, written by name.
 */
export function DirectChat({ userId, currentUserId }: { userId: string; currentUserId: string }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  const opened = useQuery({
    queryKey: ["direct-open", userId],
    queryFn: () => rpc.directMessages.open({ userId }),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const threadId = opened.data?.threadId;
  const getOptions = queries.directMessages.get.queryOptions({
    input: { threadId: threadId ?? "" },
    enabled: Boolean(threadId),
  });
  const thread = useQuery(getOptions);
  const [startCursor, setStartCursor] = useState<number | null>(null);
  if (thread.data && startCursor === null) setStartCursor(thread.data.cursor);
  const unreadKey = queries.directMessages.people.queryOptions({ input: {} }).queryKey;

  useEffect(() => {
    if (!threadId || startCursor === null) return;
    const controller = new AbortController();
    void (async () => {
      let from = startCursor;
      while (!controller.signal.aborted) {
        try {
          const stream = await rpc.directMessages.subscribe(
            { threadId, cursor: from },
            { signal: controller.signal },
          );
          for await (const event of stream) {
            if (event.type === "heartbeat") continue;
            from = Math.max(from, event.seq);
            void queryClient.invalidateQueries({ queryKey: getOptions.queryKey });
          }
        } catch {
          if (controller.signal.aborted) return;
        }
        await new Promise((resolve) => setTimeout(resolve, RECONNECT_MS));
      }
    })();
    return () => controller.abort();
  }, [threadId, startCursor]);

  const lastSeq = thread.data?.messages.at(-1)?.seq;
  useEffect(() => {
    if (!threadId || lastSeq === undefined) return;
    end.current?.scrollIntoView({ block: "end" });
    void rpc.directMessages
      .markRead({ threadId })
      .then(() => queryClient.invalidateQueries({ queryKey: unreadKey }))
      .catch(() => undefined);
  }, [threadId, lastSeq]);

  async function send() {
    const text = draft.trim();
    if (!text || !threadId || sending) return;
    setSending(true);
    setError(null);
    try {
      await rpc.directMessages.send({ threadId, text, clientNonce: newClientId() });
      setDraft("");
      await queryClient.invalidateQueries({ queryKey: getOptions.queryKey });
    } catch (cause) {
      setError(errorText(cause, t`Could not send`));
    } finally {
      setSending(false);
    }
  }

  if (!thread.data) {
    return (
      <div className="flex flex-1 items-center justify-center">
        {thread.isError || opened.isError ? null : <Spinner />}
      </div>
    );
  }
  const partner = thread.data.partner;
  const activeName = partner.name;
  return (
    <div data-testid="direct-chat" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2.5 border-b border-border px-6 py-3">
        <PersonAvatar name={partner.name} image={partner.image} size={28} />
        <h1 className="text-[15px] font-semibold">{partner.name}</h1>
      </div>
      <div className="rk-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
        {thread.data.messages.map((message) => {
          const mine = message.authorUserId === currentUserId;
          return (
            <div
              key={message.id}
              data-testid="direct-message"
              className={`flex max-w-full gap-2.5 ${mine ? "justify-end" : "justify-start"}`}
            >
              {mine ? null : <PersonAvatar name={partner.name} image={partner.image} size={28} />}
              <div
                className={`min-w-0 max-w-[min(100%,640px)] rounded-[20px] px-[18px] py-3 text-body1 ${
                  mine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                }`}
              >
                <ChatMarkdown>{textOf(message)}</ChatMarkdown>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <div className="px-6 pb-5">
        {error ? (
          <p role="alert" className="mb-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              void send();
            }}
            rows={1}
            placeholder={t`Message ${activeName}`}
            aria-label={t`Message ${activeName}`}
            className="max-h-40 min-h-9 flex-1 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          <Button
            size="icon"
            aria-label={t`Send`}
            disabled={!draft.trim() || sending}
            onClick={() => void send()}
          >
            <ArrowUp size={16} strokeWidth={2} />
          </Button>
        </div>
      </div>
    </div>
  );
}
