// @vitest-environment jsdom
import type { ThreadMessage } from "@corvo/contracts";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { delegationKey } from "../../lib/delegation-states";
import { MessageView } from "./message-view";

vi.mock("../../lib/rpc", () => ({ rpc: {} }));
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
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

type Props = ComponentProps<typeof MessageView>;

function render(
  block: Record<string, unknown>,
  options: { delegation?: Props["delegation"]; peerStatus?: string } = {},
) {
  const message = {
    id: "m1",
    threadId: "t",
    seq: 1,
    role: "bot",
    createdAt: new Date().toISOString(),
    blocks: [block],
  } as unknown as ThreadMessage;
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
        peerBot={() => ({ color: "#14B8A6", status: options.peerStatus })}
        delegation={options.delegation}
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
  return container.querySelector<HTMLElement>('[data-testid="peer-state"]');
}

const sent = {
  kind: "bot_message_sent",
  toBotId: "fin",
  toBotName: "Finance",
  text: "Please check the cash flow",
  intent: "request",
};
const states = (value: "waiting" | "answered") =>
  new Map([[delegationKey("m1", 0), value]]) as Props["delegation"];

it("shows a request that has not been answered as waiting", () => {
  const state = render(sent, { delegation: states("waiting") });
  expect(state?.dataset.state).toBe("waiting");
  expect(state?.textContent).toContain("waiting");
});

it("shows it as working while the agent's run is active", () => {
  const state = render(sent, { delegation: states("waiting"), peerStatus: "running" });
  expect(state?.dataset.state).toBe("working");
});

it("shows it as answered once the agent sent a result, even if it is still busy", () => {
  const state = render(sent, { delegation: states("answered"), peerStatus: "running" });
  expect(state?.dataset.state).toBe("answered");
});

it("shows no state for a message with nothing to wait for, or when no states are given", () => {
  expect(render(sent)).toBeNull();
  expect(render({ ...sent, intent: "fyi" }, { delegation: new Map() })).toBeNull();
});

it("shows no state on a message the bot received", () => {
  const received = {
    kind: "bot_message_received",
    fromBotId: "fin",
    fromBotName: "Finance",
    text: "Here is the result",
    intent: "result",
  };
  expect(render(received, { delegation: states("waiting") })).toBeNull();
});
