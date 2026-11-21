import type { GroupMember } from "@corvo/contracts";
import { BOT_COLOR_LIST } from "@corvo/core";
import { I18nProvider } from "@lingui/react";
import { createRoot } from "react-dom/client";
import { bootstrapI18n, i18n } from "../../src/lib/i18n";
import { applyResolvedAppearance } from "../../src/lib/ui-appearance";
import "../../src/styles.css";
import { workingMembers } from "../../src/lib/roster-status";
import { ChannelHeader } from "../../src/pages/shell/channel-header";
import { ChannelPresence } from "../../src/pages/shell/channel-presence";

// A channel's sidebar row and header over fake members, in each state, so the look can be checked
// without a backend. State lives in the URL (?theme=light|dark).

const COLORS = ["green", "red", "blue", "purple", "orange", "pink"] as const;
const NAMES = ["Rook", "Leo", "Nina", "Theo", "Marina", "LinkedIn"];

function members(working: number[]): GroupMember[] {
  return NAMES.map((name, index) => ({
    botId: `bot-${index}`,
    name,
    color: BOT_COLOR_LIST.find((color) => color.id === COLORS[index])?.hex ?? "#3B82F6",
    status: working.includes(index) ? "running" : "idle",
  }));
}

const CHANNELS: { name: string; working: number[]; unread?: boolean; selected?: boolean }[] = [
  { name: "Crescimento no X", working: [], selected: true },
  { name: "Radar de oportunidades", working: [1] },
  { name: "Carreira e marca pessoal", working: [2, 3], unread: true },
  { name: "Conteúdo profissional", working: [0, 1, 2, 3, 4] },
];

function Row({ name, working, unread, selected }: (typeof CHANNELS)[number]) {
  const busy = workingMembers(members(working));
  return (
    <div
      data-testid="channel-row"
      className={`flex min-h-8 w-full items-center gap-1.5 rounded-lg px-2.5 py-1 text-start ${
        selected ? "bg-sidebar-accent" : ""
      }`}
    >
      <span
        aria-hidden="true"
        className="w-4 shrink-0 text-center text-[15px] font-normal text-muted-foreground"
      >
        #
      </span>
      <div className="flex min-w-0 flex-1 items-center justify-between gap-1.5">
        <span
          className={`min-w-0 truncate text-body2 text-foreground ${unread ? "font-semibold" : "font-normal"}`}
        >
          {name}
        </span>
        <ChannelPresence members={busy} />
        {unread ? <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-unread" /> : null}
      </div>
    </div>
  );
}

function Header({ working }: { working: number[] }) {
  return (
    <div className="relative h-[52px] border-b border-border" data-testid="channel-header-frame">
      <ChannelHeader
        name="Crescimento no X"
        purpose="Transforma o produto em uma série de posts"
        members={members(working)}
        onOpenNavigation={() => undefined}
        onOpenSettings={() => undefined}
        onOpenSquad={() => undefined}
      />
    </div>
  );
}

function Page() {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="w-[300px] shrink-0 border-e border-sidebar-border bg-sidebar p-2">
        <p className="px-2.5 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Channels
        </p>
        <div className="flex flex-col gap-0.5">
          {CHANNELS.map((channel) => (
            <Row key={channel.name} {...channel} />
          ))}
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col gap-6">
        <Header working={[]} />
        <Header working={[1]} />
        <Header working={[1, 2, 5]} />
      </main>
    </div>
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
