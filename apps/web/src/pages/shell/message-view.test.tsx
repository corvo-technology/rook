// @vitest-environment jsdom
import type { ThreadMessage } from "@corvo/contracts";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MessageView } from "./message-view";

const skills = vi.hoisted(() => ({
  updateDraft: vi.fn(async () => ({})),
  save: vi.fn(async () => ({})),
  testRun: vi.fn(async () => ({ runId: "run" })),
}));
vi.mock("../../lib/rpc", () => ({ rpc: { skills } }));

vi.mock("@lingui/core/macro", () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values),
  plural: (count: number, forms: { one: string; other: string }) =>
    (count === 1 ? forms.one : forms.other).replace("#", String(count)),
}));
vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values),
    i18n: { locale: "en" },
  }),
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

type PeerBot = ComponentProps<typeof MessageView>["peerBot"];

const handoff = (extra: { reason?: string } = {}) => [
  {
    kind: "handoff" as const,
    fromBotId: "chief",
    toBotId: "design",
    text: "Avaliar o hero",
    ...extra,
  },
];
const named: PeerBot = (id) => ({ name: id === "chief" ? "Chefe" : "Design", color: "orange" });
const missingBot: PeerBot = () => undefined;
const existingBot: PeerBot = () => ({ color: "orange" });

const planner = (status: "created" | "archived" | "deleted" = "created") => ({
  kind: "child_bot" as const,
  botId: "child",
  name: "Planner",
  status,
});

function renderMessage(
  blocks: ThreadMessage["blocks"],
  peerBot: PeerBot,
  mentions?: ReturnType<typeof planner>[],
) {
  const onOpenBot = vi.fn();
  const message: ThreadMessage = {
    id: "message",
    threadId: "thread",
    seq: 1,
    role: "bot",
    createdAt: new Date().toISOString(),
    blocks,
  };
  act(() =>
    root.render(
      <MessageView
        artifactTarget={{ botId: "parent" }}
        canAnswer={false}
        canDismiss={false}
        message={message}
        mentions={mentions}
        onAnswer={vi.fn()}
        onOpenBot={onOpenBot}
        onOpenPeerMessages={vi.fn()}
        onTogglePeerReplies={vi.fn()}
        peerBot={peerBot}
        onRefresh={vi.fn()}
        onBotChanged={vi.fn()}
        onAddRoutine={vi.fn()}
        voiceReady={false}
        speaking={false}
        onSpeak={vi.fn()}
        onOpenComputer={vi.fn()}
        showToolActivity={false}
        onReply={vi.fn()}
        onMarkUnread={vi.fn()}
        onReact={vi.fn()}
      />,
    ),
  );
  const mention = container.querySelector<HTMLElement>('[data-testid="bot-mention"]')!;
  act(() => mention.click());
  return { mention, onOpenBot };
}

it("names a new bot inline in the reply, in its color", () => {
  const { mention, onOpenBot } = renderMessage(
    [{ kind: "text", text: "Planner is ready." }],
    existingBot,
    [planner()],
  );
  const bubble = container.querySelector('[data-testid="message-bot-bubble"]');
  expect(bubble?.contains(mention)).toBe(true);
  expect(bubble?.textContent).toBe("Planner is ready.");
  expect(mention.tagName).toBe("BUTTON");
  expect(mention.querySelector("span[dir]")?.getAttribute("style")).toContain("color");
  expect(onOpenBot).toHaveBeenCalledWith("child");
});

it("puts the bot first when the reply does not name it", () => {
  renderMessage([{ kind: "text", text: "Ready when you are." }], existingBot, [planner()]);
  expect(container.querySelector('[data-testid="message-bot-bubble"]')?.textContent).toBe(
    "Planner Ready when you are.",
  );
});

it.each([
  ["no longer exists", "created", missingBot],
  ["was deleted", "deleted", existingBot],
] as const)("keeps the name without color or link when the bot %s", (_, status, peerBot) => {
  const { mention, onOpenBot } = renderMessage(
    [{ kind: "text", text: "Planner is gone." }],
    peerBot,
    [planner(status)],
  );
  expect(mention.textContent).toBe("Planner");
  expect(mention.tagName).toBe("SPAN");
  expect(mention.querySelector("span[dir]")?.getAttribute("style")).toBeNull();
  expect(onOpenBot).not.toHaveBeenCalled();
});

it("shows an announcement with no reply yet on its own", () => {
  const { mention, onOpenBot } = renderMessage([planner()], existingBot);
  expect(mention.textContent).toBe("Planner");
  expect(onOpenBot).toHaveBeenCalledWith("child");
});

it("names the bot once across a reply's text blocks", () => {
  renderMessage(
    [
      { kind: "text", text: "Setting up." },
      { kind: "text", text: "Planner is ready." },
    ],
    existingBot,
    [planner()],
  );
  expect(container.querySelectorAll('[data-testid="bot-mention"]')).toHaveLength(1);
  expect(container.textContent).toContain("Setting up.");
  expect(container.textContent).toContain("Planner is ready.");
});

it("keeps an edit made after a save when the saved status arrives late", async () => {
  const draft = {
    kind: "skill_draft" as const,
    skillId: "skill",
    name: "Weekly report",
    goal: "Send the weekly report",
    playbook: {
      whenToUse: "Fridays",
      inputs: [],
      steps: ["Collect"],
      howToCheck: "",
      whatToReturn: "",
      approvalBoundaries: "",
      failureHandling: "",
    },
    status: "draft" as const,
  };
  const render = (block: typeof draft | (Omit<typeof draft, "status"> & { status: "saved" })) =>
    root.render(
      <MessageView
        artifactTarget={{ botId: "parent" }}
        canAnswer={false}
        canDismiss={false}
        message={{
          id: "message",
          threadId: "thread",
          seq: 1,
          role: "bot",
          createdAt: new Date().toISOString(),
          blocks: [block],
        }}
        onAnswer={vi.fn()}
        onOpenBot={vi.fn()}
        onOpenPeerMessages={vi.fn()}
        onTogglePeerReplies={vi.fn()}
        peerBot={existingBot}
        onRefresh={() => Promise.reject(new Error("offline"))}
        onBotChanged={vi.fn()}
        onAddRoutine={vi.fn()}
        voiceReady={false}
        speaking={false}
        onSpeak={vi.fn()}
        onOpenComputer={vi.fn()}
        showToolActivity={false}
        onReply={vi.fn()}
        onMarkUnread={vi.fn()}
        onReact={vi.fn()}
      />,
    );
  act(() => render(draft));
  const card = container.querySelector('[data-testid="skill-draft-card"]')!;
  const button = () => card.querySelector("button")!;
  await act(async () => button().click());
  expect(button().textContent).toBe("Saved");

  const input = card.querySelector("input")!;
  const type = (value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  type("Edited");
  act(() => render({ ...draft, status: "saved" }));

  expect(input.value).toBe("Edited");
  expect(button().textContent).toBe("Save");

  // A different skill always loads its own fields.
  act(() => render({ ...draft, skillId: "other", name: "Other" }));
  expect(card.querySelector("input")!.value).toBe("Other");

  // A second save is not undone when the first save's status arrives after it.
  await act(async () => button().click());
  type("Newer");
  await act(async () => button().click());
  act(() => render({ ...draft, skillId: "other", name: "Other", status: "saved" }));
  expect(input.value).toBe("Newer");
  expect(button().textContent).toBe("Saved");
});

function renderHandoff(
  blocks: ThreadMessage["blocks"],
  peerBot: PeerBot,
  channelMembers?: { id: string; name: string }[],
) {
  const message: ThreadMessage = {
    id: "message",
    threadId: "thread",
    seq: 1,
    role: "bot",
    createdAt: new Date().toISOString(),
    blocks,
  };
  act(() =>
    root.render(
      <MessageView
        artifactTarget={{ botId: "parent" }}
        canAnswer={false}
        canDismiss={false}
        message={message}
        onAnswer={vi.fn()}
        onOpenBot={vi.fn()}
        onOpenPeerMessages={vi.fn()}
        onTogglePeerReplies={vi.fn()}
        peerBot={peerBot}
        channelMembers={channelMembers}
        onRefresh={vi.fn()}
        onBotChanged={vi.fn()}
        onAddRoutine={vi.fn()}
        voiceReady={false}
        speaking={false}
        onSpeak={vi.fn()}
        onOpenComputer={vi.fn()}
        showToolActivity={false}
        onReply={vi.fn()}
        onMarkUnread={vi.fn()}
        onReact={vi.fn()}
      />,
    ),
  );
}

it("shows why work was handed off beside the handoff", () => {
  renderHandoff(handoff({ reason: "Envolve analisar uma landing" }), named);
  const reason = container.querySelector('[data-testid="handoff-reason"]');
  expect(reason?.textContent).toBe("Envolve analisar uma landing");
  expect(container.textContent).toContain("Avaliar o hero");
});

it("shows nothing extra when a handoff has no reason", () => {
  renderHandoff(handoff(), named);
  expect(container.querySelector('[data-testid="handoff-reason"]')).toBeNull();
  expect(container.textContent).toContain("Avaliar o hero");
});

it("names a sender that is not a group member from the bot list", () => {
  renderHandoff(handoff(), named);
  expect(container.textContent).toContain("Chefe");
  expect(container.textContent).toContain("Design");
});

it("sets a handoff in a channel as a message from the sender to the agent", () => {
  renderHandoff(handoff({ reason: "Envolve analisar uma landing" }), named, [
    { id: "design", name: "Design" },
  ]);
  const row = container.querySelector('[data-testid="channel-handoff"]');
  expect(row?.textContent).toContain("Chefe");
  expect(row?.textContent).toContain("Design");
  expect(row?.textContent).toContain("Avaliar o hero");
  expect(row?.querySelector("time")).not.toBeNull();
  expect(row?.querySelector('[data-testid="handoff-reason"]')?.textContent).toBe(
    "Envolve analisar uma landing",
  );
});

function mountReply(
  speakerName?: string,
  continued = false,
  extra: Partial<ComponentProps<typeof MessageView>> = {},
  text = "Fixed the timeout.",
) {
  const message: ThreadMessage = {
    id: "reply",
    threadId: "thread",
    seq: 1,
    role: "bot",
    botId: "leo",
    createdAt: "2026-11-02T12:13:00.000Z",
    blocks: [{ kind: "text", text }],
  };
  act(() =>
    root.render(
      <MessageView
        {...extra}
        artifactTarget={{ botId: "leo" }}
        canAnswer={false}
        canDismiss={false}
        message={message}
        onAnswer={vi.fn()}
        onOpenBot={vi.fn()}
        onOpenPeerMessages={vi.fn()}
        onTogglePeerReplies={vi.fn()}
        peerBot={() => ({ name: "Leo", color: "#8B5CF6" })}
        speakerName={speakerName}
        continued={continued}
        onRefresh={vi.fn()}
        onBotChanged={vi.fn()}
        onAddRoutine={vi.fn()}
        voiceReady={false}
        speaking={false}
        onSpeak={vi.fn()}
        onOpenComputer={vi.fn()}
        showToolActivity={false}
        onReply={vi.fn()}
        onMarkUnread={vi.fn()}
        onReact={vi.fn()}
      />,
    ),
  );
}

it("sets an agent's message in a channel beside its face, under its name and time, with no bubble", () => {
  mountReply("Leo");
  expect(container.textContent).toContain("Leo");
  expect(container.querySelector("time")?.getAttribute("datetime")).toBe(
    "2026-11-02T12:13:00.000Z",
  );
  const face = container.querySelector<HTMLElement>(".corvo-mascot-avatar");
  expect(face?.style.width).toBe("36px");
  const bubble = container.querySelector('[data-testid="message-bot-bubble"]');
  expect(bubble?.textContent).toBe("Fixed the timeout.");
  expect(bubble?.className).not.toContain("rounded-[20px]");
});

it("keeps the bubble in a chat with one agent, which has no speaker line", () => {
  mountReply();
  expect(container.querySelector("time")).toBeNull();
  expect(container.querySelector(".corvo-mascot-avatar")).toBeNull();
  const bubble = container.querySelector('[data-testid="message-bot-bubble"]');
  expect(bubble?.className).toContain("rounded-[20px]");
});

it("shows a follow-up from the same agent without its name or face, keeping its column and time", () => {
  mountReply("Leo", true);
  expect(container.textContent).not.toContain("Leo");
  expect(container.querySelector(".corvo-mascot-avatar")).toBeNull();
  expect(container.querySelector("time")?.getAttribute("datetime")).toBe(
    "2026-11-02T12:13:00.000Z",
  );
  expect(container.querySelector('[data-testid="message-bot-bubble"]')?.textContent).toBe(
    "Fixed the timeout.",
  );
});

function renderAsk(canAnswer: boolean, status?: "pending" | "answered") {
  const message: ThreadMessage = {
    id: "ask-message",
    threadId: "thread",
    seq: 1,
    role: "bot",
    createdAt: new Date().toISOString(),
    blocks: [{ kind: "ask", text: "Which city?", ...(status ? { status } : {}) }],
  };
  act(() =>
    root.render(
      <MessageView
        artifactTarget={{ botId: "parent" }}
        canAnswer={canAnswer}
        canDismiss={false}
        message={message}
        onAnswer={vi.fn()}
        onOpenBot={vi.fn()}
        onOpenPeerMessages={vi.fn()}
        onTogglePeerReplies={vi.fn()}
        peerBot={() => undefined}
        onRefresh={vi.fn()}
        onBotChanged={vi.fn()}
        onAddRoutine={vi.fn()}
        voiceReady={false}
        speaking={false}
        onSpeak={vi.fn()}
        onOpenComputer={vi.fn()}
        showToolActivity={false}
        onReply={vi.fn()}
        onMarkUnread={vi.fn()}
        onReact={vi.fn()}
      />,
    ),
  );
}

it("marks an answerable unanswered ask as the coach anchor, and no other", () => {
  renderAsk(true, "pending");
  expect(container.querySelectorAll('[data-coach="ask"]')).toHaveLength(1);
  renderAsk(true, "answered");
  expect(container.querySelector("[data-coach]")).toBeNull();
  renderAsk(false, "pending");
  expect(container.querySelector("[data-coach]")).toBeNull();
});

it("steps through several proposal cards one at a time with a counter", () => {
  const card = (id: string, status: "pending" | "answered" = "pending") => ({
    kind: "ask" as const,
    text: `Change ${id}?`,
    status,
    approvalEffectId: id,
    proposal: true as const,
    actions: [
      { id: "allow", label: "Apply" },
      { id: "deny", label: "Dismiss" },
    ],
  });
  const message: ThreadMessage = {
    id: "message",
    threadId: "thread",
    seq: 1,
    role: "bot",
    createdAt: new Date().toISOString(),
    blocks: [card("a"), card("b"), card("c")],
  };
  const onAnswer = vi.fn();
  const view = (current: ThreadMessage) =>
    act(() =>
      root.render(
        <MessageView
          artifactTarget={{ botId: "parent" }}
          canAnswer
          canDismiss={false}
          message={current}
          onAnswer={onAnswer}
          onOpenBot={vi.fn()}
          onOpenPeerMessages={vi.fn()}
          onTogglePeerReplies={vi.fn()}
          peerBot={existingBot}
          onRefresh={vi.fn()}
          onBotChanged={vi.fn()}
          onAddRoutine={vi.fn()}
          voiceReady={false}
          speaking={false}
          onSpeak={vi.fn()}
          onOpenComputer={vi.fn()}
          showToolActivity={false}
          onReply={vi.fn()}
          onMarkUnread={vi.fn()}
          onReact={vi.fn()}
        />,
      ),
    );
  view(message);
  expect(container.textContent).toContain("1 of 3");
  expect(container.textContent).toContain("Change a?");
  expect(container.textContent).not.toContain("Change b?");
  const labelled = () =>
    [...container.querySelectorAll("button")].filter((node) => node.textContent);
  expect(labelled().map((node) => node.textContent)).toEqual(["Apply", "Dismiss"]);

  act(() => labelled()[0]!.click());
  expect(onAnswer).toHaveBeenCalledWith(message, "allow", undefined, undefined, "a");

  view({ ...message, blocks: [card("a", "answered"), card("b"), card("c")] });
  expect(container.textContent).toContain("2 of 3");
  expect(container.textContent).toContain("Change a?");
  expect(container.textContent).toContain("Change b?");
  expect(container.textContent).not.toContain("Change c?");
});

it("shows an agent's role muted beside its name in a channel", () => {
  mountReply("Leo", false, { speakerRole: "Backend engineer" });
  expect(container.textContent).toContain("LeoBackend engineer");
});

it("shows an @name of a channel agent as a chip, and leaves other words alone", () => {
  mountReply(
    "Leo",
    false,
    { channelMembers: [{ id: "cora", name: "Cora" }] },
    "@Cora can you plan it? Cora is great.",
  );
  const chips = container.querySelectorAll('[data-testid="bot-mention"]');
  expect(chips).toHaveLength(1);
  expect(chips[0]?.textContent).toBe("Cora");
  expect(container.textContent).toContain("can you plan it? Cora is great.");
});

it("sets the person's own message in the column of a channel, with no bubble", () => {
  const message = {
    id: "me",
    threadId: "thread",
    seq: 1,
    role: "user",
    createdAt: "2026-11-02T12:13:00.000Z",
    blocks: [{ kind: "text", text: "Ship it" }],
  } as unknown as ThreadMessage;
  act(() =>
    root.render(
      <MessageView
        artifactTarget={{ botId: "leo" }}
        canAnswer={false}
        canDismiss={false}
        message={message}
        onAnswer={vi.fn()}
        onOpenBot={vi.fn()}
        onOpenPeerMessages={vi.fn()}
        onTogglePeerReplies={vi.fn()}
        peerBot={() => undefined}
        speakerName="You"
        onRefresh={vi.fn()}
        onBotChanged={vi.fn()}
        onAddRoutine={vi.fn()}
        voiceReady={false}
        speaking={false}
        onSpeak={vi.fn()}
        onOpenComputer={vi.fn()}
        showToolActivity={false}
        onReply={vi.fn()}
        onMarkUnread={vi.fn()}
        onReact={vi.fn()}
      />,
    ),
  );
  expect(container.textContent).toContain("You");
  const bubble = container.querySelector('[data-testid="message-user-bubble"]');
  expect(bubble?.textContent).toBe("Ship it");
  expect(bubble?.className).not.toContain("bg-chat-user");
});

it("folds a received peer exchange into a thread footer in a channel", () => {
  const onToggle = vi.fn();
  const message = {
    id: "marker",
    threadId: "thread",
    seq: 1,
    role: "bot",
    createdAt: "2026-11-02T12:13:00.000Z",
    blocks: [{ kind: "bot_message_received", fromBotId: "cora", fromBotName: "Cora", text: "hi" }],
  } as unknown as ThreadMessage;
  act(() =>
    root.render(
      <MessageView
        artifactTarget={{ botId: "leo" }}
        canAnswer={false}
        canDismiss={false}
        message={message}
        onAnswer={vi.fn()}
        onOpenBot={vi.fn()}
        onOpenPeerMessages={vi.fn()}
        peerReplies="collapsed"
        threadSummary={{ count: 3, botIds: ["cora", "leo"], lastAt: "2026-11-02T12:20:00.000Z" }}
        onTogglePeerReplies={onToggle}
        peerBot={() => ({ name: "Cora", color: "#8B5CF6" })}
        onRefresh={vi.fn()}
        onBotChanged={vi.fn()}
        onAddRoutine={vi.fn()}
        voiceReady={false}
        speaking={false}
        onSpeak={vi.fn()}
        onOpenComputer={vi.fn()}
        showToolActivity={false}
        onReply={vi.fn()}
        onMarkUnread={vi.fn()}
        onReact={vi.fn()}
      />,
    ),
  );
  const footer = container.querySelector<HTMLElement>('[data-testid="peer-replies-toggle"]');
  expect(footer?.textContent).toContain("3 replies");
  expect(footer?.getAttribute("aria-expanded")).toBe("false");
  expect(footer?.querySelectorAll(".corvo-mascot-avatar")).toHaveLength(2);
  act(() => footer?.click());
  expect(onToggle).toHaveBeenCalledWith("marker");
});
