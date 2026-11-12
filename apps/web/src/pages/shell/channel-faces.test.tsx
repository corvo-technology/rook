// @vitest-environment jsdom
import type { ThreadMessage } from "@corvo/contracts";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The character itself is covered in ui-web; here only what the conversation asks of it matters.
const faces = vi.hoisted(() => ({
  props: [] as { live?: boolean; lookAt?: { x: number; y: number }; mood: string; size: number }[],
}));
vi.mock("../../../../../packages/ui-web/src/character-avatar", () => ({
  LIVELY_FROM: 56,
  CharacterAvatar: (props: {
    live?: boolean;
    lookAt?: { x: number; y: number };
    mood: string;
    size: number;
  }) => {
    faces.props.push(props);
    return null;
  },
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

import { clearComposerTyping, noteComposerTyping } from "../../lib/composer-typing";
import { MessageView } from "./message-view";

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
  faces.props.length = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => clearComposerTyping());
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

// The speaker's face is the only one at message size; mentions carry small ones.
const last = () => faces.props.filter((props) => props.size === 36).at(-1);
const peerBot: ComponentProps<typeof MessageView>["peerBot"] = (id) => ({
  name: id,
  color: "#1FBF68::char_sprout",
  status: id === "chief" ? "running" : "idle",
});

function render(
  blocks: ThreadMessage["blocks"],
  extra: Partial<ComponentProps<typeof MessageView>> = {},
) {
  const message: ThreadMessage = {
    id: "m",
    threadId: "thread",
    seq: 1,
    role: "bot",
    botId: "chief",
    createdAt: new Date().toISOString(),
    blocks,
  };
  act(() =>
    root.render(
      <MessageView
        artifactTarget={{ botId: "chief" }}
        canAnswer={false}
        canDismiss={false}
        message={message}
        onAnswer={vi.fn()}
        onOpenBot={vi.fn()}
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
        speakerName="Chief"
        channelMembers={[{ id: "design", name: "Design" }]}
        {...extra}
      />,
    ),
  );
}

const text = [{ kind: "text" as const, text: "Done." }];
const handoff = [
  { kind: "handoff" as const, fromBotId: "chief", toBotId: "design", text: "Review the hero" },
];

describe("an agent's face in a channel", () => {
  it("is a still picture unless it is among the latest messages", () => {
    render(text);
    expect(last()?.live).toBe(false);
    render(text, { face: "live" });
    expect(last()?.live).toBe(true);
  });

  it("looks at the composer while the person types, and back to idle after", () => {
    render(text, { face: "live" });
    expect(last()?.lookAt).toBeUndefined();
    act(() => noteComposerTyping());
    expect(last()?.lookAt).toEqual({ x: 0, y: 0.9 });
    act(() => clearComposerTyping());
    expect(last()?.lookAt).toBeUndefined();
  });

  it("does not look at the composer when it is a still picture", () => {
    render(text);
    act(() => noteComposerTyping());
    expect(last()?.lookAt).toBeUndefined();
  });

  it("looks toward the agent it hands work to", () => {
    render(handoff, { face: "live" });
    expect(last()?.lookAt).toEqual({ x: 0.9, y: -0.15 });
  });

  it("shows that the agent is at work only on its latest message", () => {
    render(text, { face: "live" });
    expect(last()?.mood).toBe("idle");
    render(text, { face: "current" });
    expect(last()?.mood).toBe("thinking");
  });
});
