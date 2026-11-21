// @vitest-environment jsdom
import type { ThreadMessage } from "@corvo/contracts";
import { foldPeerReplies, foldThreadReplies } from "@corvo/core";
import type { ComponentProps, ReactNode } from "react";
import { act, createRef } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../packages/ui-web/src/character-avatar", () => ({
  LIVELY_FROM: 56,
  CharacterAvatar: () => <i data-face />,
}));
vi.mock("../../../../../packages/ui-web/src/rook-avatar", () => ({
  RookAvatar: () => <i data-face />,
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

import { Transcript } from "./transcript";

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

const MESSAGES: ThreadMessage[] = [
  {
    id: "m1",
    threadId: "thread",
    seq: 1,
    role: "user",
    authorUserId: "owner",
    authorName: "Clinic Account",
    createdAt: "2026-11-10T09:00:00.000Z",
    blocks: [{ kind: "text", text: "How are we today?" }],
  },
];

function render(embeddedViewer?: { name: string | null }, messages: ThreadMessage[] = MESSAGES) {
  const noop = () => undefined;
  const resolved = async () => undefined;
  const props: ComponentProps<typeof Transcript> = {
    scrollRef: createRef<HTMLDivElement>(),
    scrollRequest: null,
    onScrollRequestHandled: noop,
    artifactTarget: { botId: "bot" },
    transcript: foldThreadReplies(foldPeerReplies(messages, { includePeerReceipts: true })),
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
    peerBot: () => undefined,
    onRefresh: resolved,
    onBotChanged: resolved,
    onAddRoutine: noop,
    voiceReady: false,
    speakingMessageId: null,
    onSpeak: noop,
    onOpenComputer: noop,
    currentUserId: "owner",
    personRole: () => "Owner",
    embeddedViewer,
  };
  act(() => root.render(<Transcript {...props} />));
}

describe("who a message is from inside a partner's product", () => {
  it("names the person the partner passed, never the customer account or its role", () => {
    render({ name: "Dra. Ana" });
    expect(container.textContent).toContain("Dra. Ana");
    expect(container.textContent).not.toContain("Clinic Account");
    expect(container.textContent).not.toContain("Owner");
  });

  it("says You when the partner passed no name, still not the account", () => {
    render({ name: null });
    expect(container.textContent).toContain("You");
    expect(container.textContent).not.toContain("Clinic Account");
  });

  it("keeps the account's name and role outside a partner's product", () => {
    render(undefined);
    expect(container.textContent).toContain("Clinic Account");
    expect(container.textContent).toContain("Owner");
  });
});

describe("what a confirmed page action did", () => {
  const resultMessage: ThreadMessage = {
    id: "m2",
    threadId: "thread",
    seq: 2,
    role: "user",
    authorUserId: "owner",
    authorName: "Clinic Account",
    createdAt: "2026-11-10T09:01:00.000Z",
    blocks: [
      { kind: "text", text: 'The page carried out "Open the agenda". Nothing was created.' },
      { kind: "host_result", outcome: "done" },
    ],
  };

  it("is a system chip, not a message the person typed", () => {
    render({ name: "Dra. Ana" }, [resultMessage]);
    const chip = container.querySelector('[data-testid="host-result-chip"]');
    expect(chip?.textContent).toBe("Done");
    // Neither the person's name nor the text the agent reads is shown as their words.
    expect(container.textContent).not.toContain("Dra. Ana");
    expect(container.textContent).not.toContain("Nothing was created");
  });

  it("says when it did not work", () => {
    render({ name: null }, [
      { ...resultMessage, blocks: [{ kind: "host_result", outcome: "failed" }] },
    ]);
    expect(container.querySelector('[data-testid="host-result-chip"]')?.textContent).toBe(
      "That didn't work",
    );
  });
});
