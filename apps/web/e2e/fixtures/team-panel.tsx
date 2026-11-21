import type { CustomSpaceRole, PendingApproval, SpaceMember } from "@corvo/contracts";
import { BOT_COLOR_LIST } from "@corvo/core";
import { I18nProvider } from "@lingui/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { bootstrapI18n, i18n } from "../../src/lib/i18n";
import { applyResolvedAppearance } from "../../src/lib/ui-appearance";
import "../../src/styles.css";
import { ApprovalsInbox } from "../../src/pages/ApprovalsInbox";
import { ChannelMembersPanel } from "../../src/pages/shell/channel-members";
import { SidebarNav } from "../../src/pages/shell/sidebar-team";

// The members panel of the #finance channel and the approvals inbox, over fake data. `?view=panel`
// shows the channel with its panel open; `?view=approvals` the inbox, whose count and list follow
// each decision. State lives in the URL (?theme, ?view, ?private).

const params = new URLSearchParams(location.search);
applyResolvedAppearance(params.get("theme") === "dark" ? "dark" : "light");
const view = params.get("view") === "approvals" ? "approvals" : "panel";

const color = (id: string) => BOT_COLOR_LIST.find((item) => item.id === id)?.hex ?? "#3B82F6";
const role = (id: string, name: string, position: number, systemKey: "everyone" | null) =>
  ({
    id,
    name,
    position,
    systemKey,
    color: null,
    keys: [],
    memberCount: 1,
  }) satisfies CustomSpaceRole;
const ROLES = [role("r-fin", "Finance", 0, null), role("r-all", "Everyone", 99, "everyone")];
const person = (userId: string, name: string, kind: SpaceMember["role"], roleIds: string[] = []) =>
  ({
    userId,
    name,
    email: `${userId}@example.test`,
    role: kind,
    roleIds,
    joinedAt: "2026-11-01T00:00:00.000Z",
  }) satisfies SpaceMember;
const MEMBERS = [
  person("u-pedro", "Pedro", "owner"),
  person("u-joao", "Joao", "member", ["r-fin"]),
  person("u-marta", "Marta", "member"),
];
const AGENTS = [
  { id: "bento", name: "Bento", title: "Finance", color: color("blue") },
  { id: "cora", name: "Cora", title: "Reports", color: color("green") },
  { id: "chief", name: "Rook", title: "Team chief", color: color("purple") },
];

const ask = (id: string, text: string, detail: string): PendingApproval["block"] => ({
  kind: "ask",
  text,
  detail,
  detailFormat: "code",
  approvalEffectId: `effect-${id}`,
  actions: [
    { id: "allow", label: "Allow once" },
    { id: "deny", label: "Not now" },
  ],
});
const INITIAL: PendingApproval[] = [
  {
    runId: "run-1",
    messageId: "m1",
    botId: "cora",
    botName: "Cora",
    botColor: color("green"),
    groupId: "finance",
    groupName: "finance",
    block: ask(
      "1",
      "Send October's close to the accountant",
      "Gmail · send_email · accountant@firm.example · income-statement-october.xlsx",
    ),
    createdAt: "2026-11-10T09:14:00.000Z",
  },
  {
    runId: "run-2",
    messageId: "m2",
    botId: "bento",
    botName: "Bento",
    botColor: color("blue"),
    block: ask("2", "Pay the supplier invoice", "ERP · create_payment · 1,280.00 · supplier-0042"),
    createdAt: "2026-11-10T09:20:00.000Z",
  },
];

function Panel() {
  const restricted = params.get("private") === "1";
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <main className="flex-1 px-6 py-5">
        <div className="text-[15px] font-semibold"># finance</div>
        <p className="mt-1 text-[13px] text-muted-foreground">Close, accounts and reconciliation</p>
      </main>
      <aside className="w-[300px] shrink-0 border-s border-border px-5 py-[17px]">
        <ChannelMembersPanel
          members={MEMBERS}
          roles={ROLES}
          people={{
            restricted,
            userIds: ["u-pedro", "u-joao"],
            canManage: true,
          }}
          agents={AGENTS}
          allAgents={AGENTS}
          currentUserId="u-pedro"
          onClose={() => undefined}
          onAddPeople={() => undefined}
          onAddAgent={() => undefined}
          onRemovePerson={() => undefined}
          onMakePrivate={() => undefined}
          onOpenToEveryone={() => undefined}
        />
      </aside>
    </div>
  );
}

function Inbox() {
  const [items, setItems] = useState(INITIAL);
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <nav className="w-[240px] shrink-0 border-e border-sidebar-border bg-sidebar px-2.5 py-4">
        <SidebarNav
          items={[
            { key: "home", label: "Home", to: "/app/chief" },
            { key: "approvals", label: "Approvals", to: "/app/approvals", badge: items.length },
            { key: "activity", label: "Activity", to: "/app/activity" },
            { key: "team", label: "Team", to: "/app/team" },
          ]}
          more={[]}
          pathname="/app/approvals"
          onOpen={() => undefined}
        />
      </nav>
      <main className="flex-1 px-6 py-5">
        <h1 className="mb-4 text-xl font-light tracking-tight">Approvals</h1>
        <ApprovalsInbox
          items={items}
          onAnswer={async (item) => {
            setItems((current) => current.filter((entry) => entry.messageId !== item.messageId));
          }}
          onOpenChat={() => undefined}
        />
      </main>
    </div>
  );
}

await bootstrapI18n("en");
createRoot(document.getElementById("root")!).render(
  <I18nProvider i18n={i18n}>{view === "approvals" ? <Inbox /> : <Panel />}</I18nProvider>,
);
