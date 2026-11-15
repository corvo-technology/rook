import type { AppNotification, PresenceStatus } from "@corvo/contracts";
import { I18nProvider } from "@lingui/react";
import { createRoot } from "react-dom/client";
import { bootstrapI18n, i18n } from "../../src/lib/i18n";
import { applyResolvedAppearance } from "../../src/lib/ui-appearance";
import "../../src/styles.css";
import { InboxPanel } from "../../src/components/InboxPanel";
import { PeopleList } from "../../src/components/PeopleList";
import { UnreadBadge } from "../../src/components/UnreadBadge";

// The sidebar's unread counts and presence dots, and the inbox panel, over fake data so the look
// can be checked without a backend. State lives in the URL (?theme=light|dark).

const NOW = Date.parse("2026-01-01T12:00:00.000Z");
const CHANNELS = [
  { name: "general", count: 4, mentions: 0, unread: true },
  { name: "launch", count: 12, mentions: 2, unread: true },
  { name: "support", count: 150, mentions: 0, unread: true },
  { name: "ideas", count: 0, mentions: 0, unread: true },
  { name: "random", count: 0, mentions: 0, unread: false },
];
const PEOPLE = [
  { userId: "u1", name: "Ana Souza", image: null, threadId: "t1", unread: true, unreadCount: 3 },
  { userId: "u2", name: "Bruno Lima", image: null, threadId: null, unread: false },
  { userId: "u3", name: "Carla Dias", image: null, threadId: null, unread: false },
];
const PRESENCE = new Map<string, PresenceStatus>([
  ["u1", "online"],
  ["u2", "away"],
  ["u3", "offline"],
]);
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const base = {
  threadId: null,
  groupId: "g1",
  messageId: null,
  botId: null,
  actor: null,
  preview: null,
  detail: null,
  read: false,
};
const ITEMS: AppNotification[] = [
  {
    ...base,
    id: "n1",
    kind: "mention",
    threadId: "t-launch",
    source: "launch",
    actor: { userId: "u1", name: "Ana Souza", image: null },
    preview: "@you can you check the release notes before noon?",
    createdAt: ago(4),
  },
  {
    ...base,
    id: "n2",
    kind: "approval",
    threadId: "t-ops",
    groupId: null,
    botId: "b1",
    source: "Ops agent",
    preview: "Wants to send the weekly report",
    createdAt: ago(35),
  },
  {
    ...base,
    id: "n3",
    kind: "alert",
    source: "Budget",
    detail: "Monthly limit reached at 90%",
    createdAt: ago(180),
  },
  {
    ...base,
    id: "n4",
    kind: "reply",
    threadId: "t-general",
    source: "general",
    actor: { userId: "u2", name: "Bruno Lima", image: null },
    preview: "Thanks, merged.",
    read: true,
    createdAt: ago(60 * 26),
  },
];

function Page() {
  return (
    <main className="flex min-h-screen items-start gap-6 bg-background p-6 text-foreground">
      <aside
        data-testid="sidebar"
        className="flex w-[260px] flex-col gap-0.5 rounded-lg bg-sidebar p-2.5 text-sidebar-foreground"
      >
        {CHANNELS.map((channel) => (
          <div
            key={channel.name}
            data-testid="channel-row"
            className="flex items-center justify-between gap-1.5 px-2 py-1 text-nav"
          >
            <span className={channel.unread ? "font-semibold" : "text-foreground/75"}>
              {`# ${channel.name}`}
            </span>
            <UnreadBadge
              count={channel.count}
              mentions={channel.mentions}
              unread={channel.unread}
            />
          </div>
        ))}
        <div className="pt-3">
          <PeopleList people={PEOPLE} onOpen={() => {}} presence={PRESENCE} />
        </div>
      </aside>
      <section
        data-testid="inbox"
        className="w-[340px] rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
      >
        <InboxPanel
          items={ITEMS}
          unreadCount={3}
          now={NOW}
          onOpen={() => {}}
          onMarkAllRead={() => {}}
          onActivity={() => {}}
        />
      </section>
    </main>
  );
}

const theme = new URLSearchParams(location.search).get("theme") === "light" ? "light" : "dark";
applyResolvedAppearance(theme);
await bootstrapI18n("en");
createRoot(document.getElementById("root")!).render(
  <I18nProvider i18n={i18n}>
    <Page />
  </I18nProvider>,
);
