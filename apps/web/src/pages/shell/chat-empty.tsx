import { BotAvatar, Button } from "@corvo/ui-web";
import { Trans } from "@lingui/react/macro";
import { ChatStarters } from "./chat-starters";

/** Who the person is talking to while the chat is empty: the agent, then ways to begin. */
export function ChatEmpty({
  intro,
  starters,
  onPick,
  app,
}: {
  intro: { id: string; name: string; title: string; color: string };
  starters: readonly string[];
  onPick: (text: string) => void;
  /** One app the agent works with that signs in with a click and is not connected yet. */
  app?: { name: string; pending: boolean; onConnect: () => void };
}) {
  return (
    <div className="my-auto flex flex-col items-center gap-3 py-8 text-center">
      <BotAvatar color={intro.color} identity={intro.id} size={72} />
      <div className="corvo-message-in min-w-0 max-w-full">
        <h2 dir="auto" className="truncate text-heading2 font-medium text-foreground">
          {intro.name}
        </h2>
        {intro.title ? (
          <p dir="auto" className="mt-0.5 text-body2 text-muted-foreground text-pretty">
            {intro.title}
          </p>
        ) : null}
      </div>
      {app ? (
        <Button variant="outline" size="sm" disabled={app.pending} onClick={app.onConnect}>
          <Trans>Connect {app.name}</Trans>
        </Button>
      ) : null}
      <ChatStarters starters={starters} onPick={onPick} align="center" />
    </div>
  );
}
