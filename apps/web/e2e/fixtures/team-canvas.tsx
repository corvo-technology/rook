import type {
  Bot,
  CustomSpaceRole,
  DirectPerson,
  Group,
  GroupMember,
  MessageBlock,
  SpaceMember,
  ThreadMessage,
} from "@corvo/contracts";
import { BOT_COLOR_LIST, foldPeerReplies, foldThreadReplies } from "@corvo/core";
import { I18nProvider } from "@lingui/react";
import { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { bootstrapI18n, i18n } from "../../src/lib/i18n";
import { applyResolvedAppearance } from "../../src/lib/ui-appearance";
import "../../src/styles.css";
import { ChannelFind, pinSignature } from "../../src/pages/shell/channel-find";
import { ChannelHeader } from "../../src/pages/shell/channel-header";
import { ChannelMembersPanel } from "../../src/pages/shell/channel-members";
import { SidebarRoster } from "../../src/pages/shell/sidebar-roster";
import { SidebarNav, SidebarPeople } from "../../src/pages/shell/sidebar-team";
import { sidebarGroupsForSpaces } from "../../src/pages/shell/space-sidebar";
import { SpaceSwitcher } from "../../src/pages/shell/space-switcher";
import { Transcript } from "../../src/pages/shell/transcript";

// The #finance channel as the approved team-chat canvas draws it: the space and its places on the
// left, the channel with people and agents in one column, and who sees it on the right. Fake data;
// state lives in the URL (?theme).

const params = new URLSearchParams(location.search);
applyResolvedAppearance(params.get("theme") === "dark" ? "dark" : "light");

const color = (id: string) => BOT_COLOR_LIST.find((item) => item.id === id)?.hex ?? "#3B82F6";
const ME = "u-pedro";
const BOT_DEFAULTS = {
  spaceId: "space-1",
  ownerUserId: ME,
  unread: false,
  pinned: false,
  sectionId: null,
  preview: "",
  status: "idle",
  updatedAt: "2026-11-10T09:00:00.000Z",
  spawnKey: null,
  runErrorId: null,
};
const agent = (id: string, name: string, title: string, hex: string, extra = {}) =>
  ({ ...BOT_DEFAULTS, id, name, title, color: hex, ...extra }) as unknown as Bot;
const BOTS = [
  agent("chief", "Chief", "Team chief", color("purple"), { spawnKey: "onboarding:first" }),
  agent("bento", "Bento", "Finance", color("blue")),
  agent("cora", "Cora", "Reports", color("green")),
  agent("davi", "Davi", "Sales", color("pink")),
];
const MEMBERS: GroupMember[] = BOTS.slice(0, 3).map((bot) => ({
  botId: bot.id,
  name: bot.name,
  color: bot.color,
}));
const channel = (id: string, name: string, unread = false) =>
  ({
    ...BOT_DEFAULTS,
    id,
    name,
    unread,
    members: MEMBERS,
    purpose: "",
  }) as unknown as Group;
const GROUPS = [
  channel("group-1", "finance"),
  channel("group-2", "sales", true),
  channel("group-3", "support"),
];

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
const PEOPLE = [
  person(ME, "Pedro Henrique", "owner"),
  person("u-joao", "João Victor", "member", ["r-fin"]),
];
const ROLE_NAME: Record<string, string> = { [ME]: "Owner", "u-joao": "Finance" };
const DIRECT: DirectPerson[] = [
  { userId: "u-joao", name: "João Victor", image: null, unread: true } as DirectPerson,
];

let seq = 0;
function message(
  role: ThreadMessage["role"],
  blocks: MessageBlock[],
  extra: Partial<ThreadMessage> = {},
): ThreadMessage {
  seq += 1;
  return {
    id: `m${seq}`,
    threadId: "thread-1",
    seq,
    role,
    blocks,
    createdAt: new Date(Date.UTC(2026, 10, 10, 8, seq * 3)).toISOString(),
    ...extra,
  };
}
const said = (text: string): MessageBlock => ({ kind: "text", text });
const morning = message(
  "bot",
  [
    said(
      "Good morning. 38 entries came in yesterday and 37 matched the bank. One does not: 12.90 too much.",
    ),
  ],
  { botId: "cora", routineName: "Daily reconciliation" },
);
const question = message(
  "user",
  [said("@Bento can you check that difference? I think the bill fee was entered twice.")],
  { authorUserId: "u-joao", authorName: "João Victor" },
);
const found = message(
  "bot",
  [
    {
      kind: "steps",
      steps: [
        { label: "Using erp_find_entries", count: 2 },
        { label: "Using bank_get_statement", count: 1 },
      ],
      durationMs: 40_000,
    },
    said(
      "It was: the 12.90 fee went into the ERP twice. I removed the duplicate and the balance matches the bank.",
    ),
  ],
  { botId: "bento" },
);
const thanks = message("user", [said("👍")], {
  replyToMessageId: found.id,
  authorUserId: "u-joao",
});
const close = message("user", [said("Nice. @Cora close October and send it to the accountant.")], {
  authorUserId: ME,
  authorName: "Pedro Henrique",
});
const report = message(
  "bot",
  [
    said(
      "October's income statement is ready in the company sheet, with the month's 3 mismatches highlighted.",
    ),
    { kind: "ticket", ref: "FIN-42", title: "Review 3 mismatches from October" },
    {
      kind: "ask",
      text: "Send the October close to the accountant",
      approvalEffectId: "effect-1",
      status: "pending",
      detail:
        "Gmail · send_email\nto: accountant@office.example\nattachment: income-statement-october.xlsx",
      detailFormat: "code",
      actions: [
        { id: "allow", label: "Allow once" },
        { id: "deny", label: "Deny" },
      ],
    },
  ],
  { botId: "cora", runId: "run-1" },
);
const MESSAGES = [morning, question, found, thanks, close, report];

const noop = () => {};
const resolved = async () => {};
const groups = sidebarGroupsForSpaces(
  [
    {
      id: "space-1",
      name: "Greenflow",
      bots: BOTS,
      groups: GROUPS,
      botSections: [],
    } as never,
  ],
  "",
  { pinned: "Pinned", unassigned: "Agents", groups: "Channels" },
);

function Canvas() {
  const [messages] = useState(MESSAGES);
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const transcript = useMemo(
    () => foldThreadReplies(foldPeerReplies(messages, { includePeerReceipts: true })),
    [messages],
  );
  const bot = (botId: string | undefined) => BOTS.find((item) => item.id === botId);
  return (
    <div className="flex h-dvh bg-background text-foreground">
      <aside
        data-testid="canvas-sidebar"
        className="flex w-[260px] shrink-0 flex-col gap-0.5 overflow-y-auto border-e border-sidebar-border bg-sidebar pt-4"
      >
        <SpaceSwitcher
          summary="2 people · 4 agents"
          spaces={[{ id: "space-1", name: "Greenflow", bots: BOTS }]}
          currentSpaceId="space-1"
          onSelect={noop}
        />
        <SidebarNav
          items={[
            { key: "home", label: "Home", to: "/app/chief" },
            { key: "approvals", label: "Approvals", to: "/app/approvals", badge: 1 },
            { key: "tasks", label: "Tasks", to: "/app/board" },
            { key: "routines", label: "Routines", to: "/app/routines" },
            { key: "activity", label: "Activity", to: "/app/activity" },
            { key: "team", label: "Team", to: "/app/team" },
          ]}
          more={[{ key: "workflows", label: "Workflows", to: "/app/workflows" }]}
          pathname="/app/chief"
          onOpen={noop}
        />
        <div className="flex flex-col gap-0.5 px-2.5">
          <SidebarRoster
            sidebarGroups={groups}
            collapsedSidebarSections={new Set()}
            bootstrapMe={{ spaceId: "space-1" }}
            botSections={[]}
            spaces={[]}
            rosterDropKey={null}
            setRosterDropKey={noop}
            rosterDropAction={() => null}
            applyRosterDrop={noop}
            openSpaceChat={noop}
            spaceMenuAnchor={anchor as never}
            setSpaceMenu={noop}
            setRenameSectionTarget={noop}
            setDeleteSectionTarget={noop}
            toggleSidebarSection={noop}
            inGroup
            active={undefined}
            activeGroup={GROUPS[0]}
            botsSidebarDensity="comfortable"
            dismissedRunErrorIds={new Set()}
            displayedRunError={null}
            draggedBotId={null}
            setDraggedBotId={noop}
            botMenu={null}
            setBotMenu={noop}
            reorderRosterBot={noop}
            activeSnapshot={null}
            botMenuContent={null}
          />
          <SidebarPeople people={DIRECT} onOpen={noop} />
        </div>
      </aside>
      <div className="relative flex min-w-0 flex-1 flex-col">
        <ChannelHeader
          name="finance"
          purpose="Close, accounts and reconciliation"
          members={MEMBERS}
          peopleCount={PEOPLE.length}
          membersOpen
          onOpenMembers={noop}
          onOpenNavigation={noop}
          onOpenSettings={noop}
          onOpenSquad={noop}
          find={
            <ChannelFind
              groupId="group-1"
              channelName="finance"
              pins={pinSignature(messages)}
              memberName={(botId) => bot(botId)?.name}
              onJump={noop}
            />
          }
        />
        <main className="flex min-h-0 flex-1 flex-col pt-12">
          <Transcript
            artifactTarget={{ groupId: "group-1" }}
            showToolActivity
            currentUserId={ME}
            personRole={(userId) => (userId ? ROLE_NAME[userId] : undefined)}
            answerableAskIds={new Set([report.id])}
            dismissableAskIds={new Set()}
            onOpenBot={noop}
            onAnswer={resolved}
            onMarkUnread={noop}
            onReact={resolved}
            onJumpToMessage={noop}
            onOpenPeerMessages={noop}
            memberName={(botId) => bot(botId)?.name}
            members={MEMBERS}
            peerBot={(botId) => bot(botId) ?? BOTS[0]!}
            onRefresh={resolved}
            onBotChanged={resolved}
            onAddRoutine={noop}
            voiceReady={false}
            speakingMessageId={null}
            onSpeak={noop}
            onOpenComputer={noop}
            scrollRef={scrollRef}
            scrollRequest={null}
            onScrollRequestHandled={noop}
            transcript={transcript}
            olderCursor={null}
            unreadAfterSeq={null}
            loadingOlder={false}
            running={false}
            workingBots={[]}
            onLoadOlder={noop}
            onReply={noop}
            onQuote={noop}
          />
        </main>
      </div>
      <aside className="w-[300px] shrink-0 border-s border-border bg-sidebar px-4 py-5">
        <ChannelMembersPanel
          members={PEOPLE}
          roles={ROLES}
          people={{ restricted: false, userIds: [], canManage: true }}
          agents={MEMBERS.map((member) => ({
            id: member.botId,
            name: member.name,
            color: member.color,
            title: bot(member.botId)?.title ?? "",
          }))}
          allAgents={BOTS}
          currentUserId={ME}
          onClose={noop}
          onAddPeople={noop}
          onAddAgent={noop}
          onRemovePerson={noop}
          onMakePrivate={noop}
          onOpenToEveryone={noop}
        />
      </aside>
    </div>
  );
}

await bootstrapI18n("en");
createRoot(document.getElementById("root")!).render(
  <I18nProvider i18n={i18n}>
    <Canvas />
  </I18nProvider>,
);
