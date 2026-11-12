// @vitest-environment jsdom
import type { GroupMember, ThreadMessage } from "@corvo/contracts";
import { foldPeerReplies, foldThreadReplies } from "@corvo/core";
import type { ComponentProps, ReactNode } from "react";
import { act, createRef } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Each moving face is one animation loop. Both avatar engines render a marker here, so the test
// counts what is live without drawing anything.
vi.mock("../../../../../packages/ui-web/src/character-avatar", () => ({
  LIVELY_FROM: 56,
  CharacterAvatar: ({ live }: { live?: boolean }) => <i data-face data-live={String(!!live)} />,
}));
vi.mock("../../../../../packages/ui-web/src/rook-avatar", () => ({
  RookAvatar: ({ live }: { live?: boolean }) => <i data-face data-live={String(!!live)} />,
}));
vi.mock("../../lib/rpc", () => ({ rpc: {} }));
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

import { LIVE_FACE_MESSAGES, Transcript } from "./transcript";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Element.prototype.scrollTo = () => undefined;
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

// A rook and four characters, so both avatar engines are in the fixture.
const MEMBERS: GroupMember[] = [
  { botId: "chief", name: "Chief", color: "#6D4AFF" },
  { botId: "bento", name: "Bento", color: "#1FBF68::char_sprout" },
  { botId: "cora", name: "Cora", color: "#E5484D::char_sprout" },
  { botId: "leo", name: "Leo", color: "#3B82F6::char_sprout" },
  { botId: "ana", name: "Ana", color: "#F59E0B::char_sprout" },
];

function busyChannel(count: number): ThreadMessage[] {
  return Array.from({ length: count }, (_, index) => {
    const seq = index + 1;
    const bot = MEMBERS[index % MEMBERS.length]!;
    return {
      id: `m${seq}`,
      threadId: "thread",
      seq,
      // Every other message is a person's, so the bots' faces are spread through the history.
      role: seq % 6 === 0 ? "user" : "bot",
      ...(seq % 6 === 0 ? {} : { botId: bot.botId }),
      createdAt: new Date(Date.UTC(2026, 10, 10, 9, seq * 3)).toISOString(),
      blocks: [{ kind: "text", text: `Message ${seq}` }],
    } satisfies ThreadMessage;
  });
}

function renderChannel(count: number) {
  const noop = () => undefined;
  const resolved = async () => undefined;
  const props: ComponentProps<typeof Transcript> = {
    scrollRef: createRef<HTMLDivElement>(),
    scrollRequest: null,
    onScrollRequestHandled: noop,
    artifactTarget: { groupId: "group" },
    transcript: foldThreadReplies(
      foldPeerReplies(busyChannel(count), { includePeerReceipts: true }),
    ),
    showToolActivity: false,
    olderCursor: null,
    unreadAfterSeq: null,
    loadingOlder: false,
    answerableAskIds: new Set(),
    dismissableAskIds: new Set(),
    running: false,
    workingBots: [],
    onLoadOlder: noop,
    onOpenBot: noop,
    onAnswer: resolved,
    onMarkUnread: noop,
    onReact: resolved,
    onJumpToMessage: noop,
    onOpenPeerMessages: noop,
    memberName: (botId) => MEMBERS.find((member) => member.botId === botId)?.name,
    members: MEMBERS,
    peerBot: (botId) => MEMBERS.find((member) => member.botId === botId) ?? MEMBERS[0]!,
    onRefresh: resolved,
    onBotChanged: resolved,
    onAddRoutine: noop,
    voiceReady: false,
    speakingMessageId: null,
    onSpeak: noop,
    onOpenComputer: noop,
  };
  act(() => root.render(<Transcript {...props} />));
}

const liveFaces = () => container.querySelectorAll('[data-face][data-live="true"]').length;

describe("live faces in a busy channel", () => {
  it("keeps the moving faces within the cap however long the history is", () => {
    renderChannel(400);
    expect(container.querySelectorAll("[data-face]").length).toBeGreaterThan(LIVE_FACE_MESSAGES);
    expect(liveFaces()).toBeGreaterThan(0);
    expect(liveFaces()).toBeLessThanOrEqual(LIVE_FACE_MESSAGES);
  });

  it("does not grow when the channel grows", () => {
    renderChannel(60);
    const small = liveFaces();
    renderChannel(400);
    expect(liveFaces()).toBe(small);
  });
});
