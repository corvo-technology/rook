// @vitest-environment jsdom

import type { ThreadMessage } from "@corvo/contracts";
import type { ComposerMention } from "@corvo/core";
import { i18n } from "@lingui/core";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});
vi.mock("./transcript", () => ({ Transcript: () => null }));

import { ThreadPanel } from "./thread-panel";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  i18n.load("en", {});
  i18n.activate("en");
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

const leo: ComposerMention = { kind: "bot", id: "bot-leo", name: "Leo" };
const everyone: ComposerMention = { kind: "everyone", id: "everyone", name: "everyone" };
const threadRoot = {
  id: "root-1",
  role: "bot",
  blocks: [{ kind: "text", text: "Draft is up." }],
} as unknown as ThreadMessage;

function renderPanel(
  onSend: (text: string, mentions: ComposerMention[], nonce: string) => Promise<void>,
  onClose: () => void = () => undefined,
) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <ThreadPanel
        root={threadRoot}
        replies={[]}
        transcriptProps={{ peerBot: () => undefined } as never}
        scrollRequest={null}
        onScrollRequestHandled={() => undefined}
        enterToSend
        mentionTargets={[leo, everyone]}
        onSend={onSend}
        onClose={onClose}
      />,
    ),
  );
  return container.querySelector("textarea") as HTMLTextAreaElement;
}

function type(textarea: HTMLTextAreaElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(textarea: HTMLTextAreaElement, key: string) {
  act(() => {
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

describe("the thread composer", () => {
  it("offers the same @ picker and sends the chosen agent with the reply", async () => {
    const onSend = vi.fn(async () => undefined);
    const textarea = renderPanel(onSend);
    type(textarea, "@Le");
    expect(container?.querySelector('[data-testid="mention-picker"]')?.textContent).toContain(
      "@Leo",
    );
    press(textarea, "Enter");
    expect(container?.querySelector('[data-testid="mention-chip"]')?.textContent).toBe("Leo");
    type(textarea, "check the numbers");
    press(textarea, "Enter");
    await act(async () => undefined);
    expect(onSend).toHaveBeenCalledWith("@Leo check the numbers", [leo], expect.any(String));
    expect(container?.querySelector('[data-testid="mention-chip"]')).toBeNull();
  });

  it("closes the picker on Escape without closing the thread", () => {
    const onClose = vi.fn();
    const textarea = renderPanel(
      vi.fn(async () => undefined),
      onClose,
    );
    type(textarea, "@");
    press(textarea, "Escape");
    expect(container?.querySelector('[data-testid="mention-picker"]')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});
