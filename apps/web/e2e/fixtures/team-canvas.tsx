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
import { BotAvatar, Button } from "@corvo/ui-web";
import { I18nProvider } from "@lingui/react";
import {
  Activity,
  CalendarClock,
  Home,
  ListChecks,
  Monitor,
  ShieldCheck,
  Users,
  Workflow,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { SidebarFooter } from "../../src/components/SidebarFooter";
import { bootstrapI18n, i18n } from "../../src/lib/i18n";
import { applyResolvedAppearance } from "../../src/lib/ui-appearance";
import { ChatModelPicker } from "../../src/pages/shell/chat-model-picker";
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
// `?view=agent` is a chat with one agent, the same rows as the channel.
const agentView = params.get("view") === "agent";
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
  agent("cto", "CTO", "Engineering", color("orange")),
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

// A chat with the Chief: the person asks, the Chief answers, and CTO's reply is relayed through it.
const askChief = message("user", [said("Is the deploy finished? Ask the CTO if you need to.")], {
  authorUserId: ME,
  authorName: "Pedro Henrique",
});
const chiefAnswer = message(
  "bot",
  [said("Checking with the CTO now. I will come back with the result.")],
  { botId: "chief" },
);
const relayed = message(
  "bot",
  [
    {
      kind: "bot_message_received",
      fromBotId: "cto",
      fromBotName: "CTO",
      text: "Deploy is green",
      intent: "result",
    },
  ],
  { botId: "chief" },
);
const chiefDone = message(
  "bot",
  [said("Done: the deploy is green and the three mismatches are in the report.")],
  { botId: "chief" },
);
const AGENT_MESSAGES = [askChief, chiefAnswer, relayed, chiefDone];

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
  const [messages] = useState(agentView ? AGENT_MESSAGES : MESSAGES);
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
            { key: "home", label: "Home", to: "/app/chief", icon: Home },
            {
              key: "approvals",
              label: "Approvals",
              to: "/app/approvals",
              icon: ShieldCheck,
              badge: 1,
            },
            { key: "tasks", label: "Tasks", to: "/app/board", icon: ListChecks },
            { key: "routines", label: "Routines", to: "/app/routines", icon: CalendarClock },
            { key: "activity", label: "Activity", to: "/app/activity", icon: Activity },
            { key: "team", label: "Team", to: "/app/team", icon: Users },
          ]}
          more={[{ key: "workflows", label: "Workflows", to: "/app/workflows", icon: Workflow }]}
          pathname={agentView ? "/app/chief" : "/app/team"}
          onOpen={noop}
          onQuickSwitch={noop}
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
            inGroup={!agentView}
            active={agentView ? BOTS[0] : undefined}
            activeGroup={agentView ? undefined : GROUPS[0]}
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
        <div className="mt-auto" />
        <SidebarFooter
          name="Pedro Henrique"
          initials="PH"
          open={false}
          onOpenChange={noop}
          onIntegrations={noop}
          onSettings={noop}
          onLogOut={noop}
          signingOut={false}
          logOutError={null}
          onActivity={noop}
        />
      </aside>
      <div className="relative flex min-w-0 flex-1 flex-col">
        {agentView ? (
          <div className="flex shrink-0 items-center gap-3 border-b border-border bg-background px-[22px] py-1.5">
            <BotAvatar color={BOTS[0]!.color} identity="chief" size={26} />
            <span className="flex items-baseline gap-2">
              <span className="text-name font-semibold">Chief</span>
              <span className="text-meta text-muted-foreground">Team chief</span>
            </span>
            <div className="ms-auto flex items-center gap-1">
              <ChatModelPicker
                chip
                id="canvas-model"
                choices={[
                  { key: "gpt", label: "GPT-5.6 Terra (OpenAI)" },
                  { key: "x", label: "Other" },
                ]}
                value="gpt"
                onChange={noop}
              />
              <Button variant="ghost" size="icon-sm" className="size-8" aria-label="Agent computer">
                <Monitor className="size-4" strokeWidth={1.6} />
              </Button>
            </div>
          </div>
        ) : (
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
        )}
        <main className={`flex min-h-0 flex-1 flex-col ${agentView ? "" : "pt-12"}`}>
          <Transcript
            artifactTarget={agentView ? { botId: "chief" } : { groupId: "group-1" }}
            intro={
              agentView
                ? { id: "chief", name: "Chief", title: "Team chief", color: BOTS[0]!.color }
                : undefined
            }
            showToolActivity
            currentUserId={ME}
            personRole={(userId) => (userId ? ROLE_NAME[userId] : undefined)}
            answerableAskIds={new Set(agentView ? [] : [report.id])}
            dismissableAskIds={new Set()}
            onOpenBot={noop}
            onAnswer={resolved}
            onMarkUnread={noop}
            onReact={resolved}
            onJumpToMessage={noop}
            onOpenPeerMessages={noop}
            memberName={(botId) => bot(botId)?.name}
            members={agentView ? undefined : MEMBERS}
            peerBot={(botId) => bot(botId) ?? BOTS[0]!}
            onRefresh={resolved}
            onBotChanged={resolved}
            onAddRoutine={noop}
            voiceReady={agentView}
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
      {agentView ? null : (
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
      )}
    </div>
  );
}

await bootstrapI18n("en");
createRoot(document.getElementById("root")!).render(
  <I18nProvider i18n={i18n}>
    <Canvas />
  </I18nProvider>,
);
