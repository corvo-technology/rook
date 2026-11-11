import { describe, expect, it } from "vitest";

import {
  botDraftKey,
  composerDraftStorageKey,
  prefillComposerDraft,
  readComposerDraft,
  writeComposerDraft,
} from "./composer-draft.js";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

describe("composer drafts", () => {
  it("scopes stored drafts per thread", () => {
    expect(composerDraftStorageKey("bot:1")).toBe("corvo.composerDraft.bot:1");
    expect(composerDraftStorageKey("group:2")).toBe("corvo.composerDraft.group:2");
  });

  it("round-trips a draft and clears the key when empty", () => {
    const storage = memoryStorage();
    expect(readComposerDraft("bot:1", storage)).toBe("");
    writeComposerDraft("bot:1", "hello @ada", storage);
    expect(readComposerDraft("bot:1", storage)).toBe("hello @ada");
    expect(readComposerDraft("group:2", storage)).toBe("");
    writeComposerDraft("bot:1", "", storage);
    expect(readComposerDraft("bot:1", storage)).toBe("");
  });

  it("tolerates missing storage", () => {
    expect(readComposerDraft("bot:1", null)).toBe("");
    expect(() => writeComposerDraft("bot:1", "hi", null)).not.toThrow();
  });
});

describe("prefillComposerDraft", () => {
  it("prefills an empty composer", () => {
    const storage = memoryStorage();
    expect(prefillComposerDraft("bot:1", "first task", storage)).toBe(true);
    expect(readComposerDraft("bot:1", storage)).toBe("first task");
  });

  it("leaves a draft the person already typed", () => {
    const storage = memoryStorage();
    writeComposerDraft("bot:1", "mine", storage);
    expect(prefillComposerDraft("bot:1", "first task", storage)).toBe(false);
    expect(readComposerDraft("bot:1", storage)).toBe("mine");
  });

  it("does nothing for empty text", () => {
    const storage = memoryStorage();
    expect(prefillComposerDraft("bot:1", "", storage)).toBe(false);
    expect(readComposerDraft("bot:1", storage)).toBe("");
  });

  it("keys a bot's chat the way the shell does", () => {
    expect(botDraftKey("b1")).toBe("bot:b1");
  });
});
