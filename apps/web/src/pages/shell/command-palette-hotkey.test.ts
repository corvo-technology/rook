import { describe, expect, it } from "vitest";
import { isCreateMenuHotkey } from "./command-palette-hotkey";

function keyEvent(partial: Partial<KeyboardEvent> & Pick<KeyboardEvent, "key">): KeyboardEvent {
  return {
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    repeat: false,
    shiftKey: false,
    ...partial,
  } as KeyboardEvent;
}

describe("isCreateMenuHotkey", () => {
  it("matches Cmd/Ctrl-N only", () => {
    expect(isCreateMenuHotkey(keyEvent({ key: "n", metaKey: true }))).toBe(true);
    expect(isCreateMenuHotkey(keyEvent({ key: "N", ctrlKey: true }))).toBe(true);
    expect(isCreateMenuHotkey(keyEvent({ key: "n", metaKey: true, shiftKey: true }))).toBe(false);
    expect(isCreateMenuHotkey(keyEvent({ key: "k", metaKey: true }))).toBe(false);
  });
});
