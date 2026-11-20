import { Alert, Platform } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { askAboutPastedKey, credentialReference, saveKeyCredential } from "./pasted-key";

vi.mock("react-native", () => ({
  Alert: { alert: vi.fn(), prompt: vi.fn() },
  Platform: { OS: "ios" },
}));

// A fake key with a real key's shape.
const KEY = `ghp_${"aB3dE5gH7jK9mN1pQ".repeat(3).slice(0, 36)}`;
const labels = {
  title: "Key?",
  save: "Save credential",
  sendAnyway: "Send anyway",
  cancel: "Cancel",
};
type Button = { text: string; onPress?: (value?: string) => void };

describe("saveKeyCredential", () => {
  it("stores the key as a command credential and returns the reference", async () => {
    const rpc = { list: vi.fn(async () => []), put: vi.fn(async () => undefined) };
    await expect(
      saveKeyCredential({ botId: "bot-1", name: "github-token", value: KEY, rpc }),
    ).resolves.toBe("$GITHUB_TOKEN");
    expect(rpc.put).toHaveBeenCalledWith({
      botId: "bot-1",
      destination: { name: "github-token", auth: { type: "command" } },
      value: KEY,
    });
  });

  it("never overwrites a credential with the same name", async () => {
    const rpc = {
      list: vi.fn(async () => [{ name: "github-token" }, { name: "github-token-2" }]),
      put: vi.fn(async () => undefined),
    };
    await expect(
      saveKeyCredential({ botId: "bot-1", name: "github-token", value: KEY, rpc }),
    ).resolves.toBe("$GITHUB_TOKEN_3");
  });

  it("rejects a name that cannot be a credential or a shell variable", async () => {
    const rpc = { list: vi.fn(async () => []), put: vi.fn(async () => undefined) };
    await expect(
      saveKeyCredential({ botId: "bot-1", name: "path", value: KEY, rpc }),
    ).rejects.toThrow();
    await expect(
      saveKeyCredential({ botId: "bot-1", name: "Bad Name", value: KEY, rpc }),
    ).rejects.toThrow();
    expect(rpc.put).not.toHaveBeenCalled();
  });
});

describe("askAboutPastedKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Platform.OS = "ios";
  });

  it("asks with the system prompt on iOS, prefilled with the name", () => {
    const onSave = vi.fn();
    const onSendAnyway = vi.fn();
    askAboutPastedKey({ ...labels, name: "github-token", onSave, onSendAnyway });
    const [title, message, buttons, type, value] = vi.mocked(Alert.prompt).mock.calls[0]!;
    expect(title).toBe("Key?");
    expect(message).toBeUndefined();
    expect(type).toBe("plain-text");
    expect(value).toBe("github-token");
    const [cancel, send, save] = buttons as Button[];
    expect([cancel?.text, send?.text, save?.text]).toEqual([
      "Cancel",
      "Send anyway",
      "Save credential",
    ]);
    send?.onPress?.("ignored");
    expect(onSendAnyway).toHaveBeenCalledOnce();
    save?.onPress?.("  my-key ");
    expect(onSave).toHaveBeenCalledWith("my-key");
  });

  it("falls back to the suggested name for an empty entry", () => {
    const onSave = vi.fn();
    askAboutPastedKey({ ...labels, name: "github-token", onSave, onSendAnyway: vi.fn() });
    const buttons = vi.mocked(Alert.prompt).mock.calls[0]![2] as Button[];
    buttons[2]?.onPress?.("  ");
    expect(onSave).toHaveBeenCalledWith("github-token");
  });

  it("uses a plain alert with the suggested name elsewhere", () => {
    Platform.OS = "android";
    const onSave = vi.fn();
    askAboutPastedKey({ ...labels, name: "github-token", onSave, onSendAnyway: vi.fn() });
    expect(Alert.prompt).not.toHaveBeenCalled();
    const buttons = vi.mocked(Alert.alert).mock.calls[0]![2] as Button[];
    buttons[2]?.onPress?.();
    expect(onSave).toHaveBeenCalledWith("github-token");
  });
});

describe("credentialReference", () => {
  it("is the variable the bot's commands receive", () => {
    expect(credentialReference("stripe-key")).toBe("$STRIPE_KEY");
  });
});
