import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { MessageReaderContext, messageAuthorLabel } from "./message-reader";

vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() },
  Appearance: { getColorScheme: () => "dark", addChangeListener: () => ({ remove() {} }) },
  Linking: { openURL: vi.fn() },
  Platform: { OS: "ios", select: (options: { ios?: unknown }) => options.ios },
  Pressable: "button",
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: "span",
  TextInput: "input",
  View: "div",
}));

vi.mock("react-native-reanimated", () => ({
  default: { View: "div" },
  useAnimatedStyle: (style: () => unknown) => style(),
  useReducedMotion: () => true,
  useSharedValue: (value: number) => ({ value }),
  withTiming: (value: number) => value,
}));

vi.mock("expo-secure-store", () => ({}));
vi.mock("./live-notifications", () => ({ resumeLiveNotifications: vi.fn() }));
vi.mock("./network-cache", () => ({ clearNetworkCache: vi.fn() }));
vi.mock("./artifact-open", () => ({ openMobileArtifact: vi.fn() }));
vi.mock("./native", () => ({ native: {}, useResolvedAppearance: () => "dark" }));

vi.mock("@corvo/chat-ui/native", () => ({
  ChatMarkdown: () => null,
  withBlockMentions: <T,>(blocks: T) => blocks,
}));

vi.mock("../components/message-caption", () => ({
  MessageCaption: ({ text }: { text: string }) => <span>{text}</span>,
}));
vi.mock("../components/ComputerCard", () => ({
  ComputerCard: ({ onOpen }: { onOpen: () => void }) => {
    onOpen();
    return null;
  },
}));
// Cards this file doesn't exercise; each has its own tests.
vi.mock("../components/thread/ask-block", () => ({ AskBlock: () => null }));
vi.mock("../components/AskActions", () => ({ AskActions: () => null }));
vi.mock("../components/AppConnectCard", () => ({ AppConnectCard: () => null }));
vi.mock("../components/audio-attachment", () => ({ AudioAttachment: () => null }));
vi.mock("../components/bot-avatar", () => ({ BotAvatar: () => null }));
vi.mock("../components/ChoiceCard", () => ({ ChoiceCard: () => null }));
vi.mock("../components/inline-image-attachment", () => ({ InlineImageAttachment: () => null }));
vi.mock("../components/instruction-undo", () => ({ InstructionUndo: () => null }));
vi.mock("../components/McpApprovalCard", () => ({ McpApprovalCard: () => null }));
vi.mock("../components/native-symbol", () => ({ NativeSymbol: () => null }));

import { MessageBubble } from "../components/thread/message-bubble";

type BubbleProps = ComponentProps<typeof MessageBubble>;

function Bubble(props: Partial<BubbleProps> & Pick<BubbleProps, "message">) {
  return (
    <MessageBubble
      botId="bot-1"
      bots={[]}
      showBotSenderName={false}
      canAnswer={false}
      canDismiss={false}
      onAnswer={async () => undefined}
      onOpenBot={() => undefined}
      onOpenComputer={() => undefined}
      onPreviewMarkdown={() => undefined}
      onPreviewImage={() => undefined}
      onTogglePeerReplies={() => undefined}
      onOpenPeerChat={() => undefined}
      actionProps={{}}
      {...props}
    />
  );
}

const message = (over: Record<string, unknown>) =>
  ({
    id: "message",
    role: "user",
    blocks: [{ kind: "text", text: "Hello" }],
    ...over,
  }) as ComponentProps<typeof MessageBubble>["message"];

function render(readerId: string | undefined, over: Record<string, unknown>) {
  return renderToStaticMarkup(
    <MessageReaderContext.Provider value={readerId}>
      <Bubble message={message(over)} />
    </MessageReaderContext.Provider>,
  );
}

it("names a teammate above their message", () => {
  const html = render("user-1", { authorUserId: "user-2", authorName: "Marta" });
  expect(html).toContain(">Marta</span>");
  expect(html).toContain("Hello");
});

it("names a teammate above a message with an attachment too", () => {
  const html = render("user-1", {
    authorUserId: "user-2",
    authorName: "Marta",
    blocks: [{ kind: "image", name: "Picture", artifactId: "artifact-1", mimeType: "image/png" }],
  });
  expect(html).toContain(">Marta</span>");
});

it("leaves the reader's own messages and older ones unnamed", () => {
  expect(render("user-1", { authorUserId: "user-1", authorName: "Pedro" })).not.toContain("Pedro");
  expect(render("user-1", {})).not.toContain("message-author");
  expect(render(undefined, { authorUserId: "user-2", authorName: "Marta" })).toContain(">Marta<");
});

it("never names an agent's message", () => {
  expect(
    messageAuthorLabel({ role: "bot", authorUserId: "user-2", authorName: "Marta" }, "user-1"),
  ).toBeUndefined();
});
