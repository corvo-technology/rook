import type { OnboardingPicks } from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import {
  loadDoneSteps,
  loadPicks,
  mergeDoneSteps,
  saveDoneSteps,
  savePicks,
} from "./onboarding-progress";

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

describe("onboarding progress", () => {
  it("brings back the steps a person finished before a reload", () => {
    const storage = memoryStorage();
    saveDoneSteps("user-1", new Set(["workspace", "start"]), storage);
    expect(loadDoneSteps("user-1", storage)).toEqual(new Set(["workspace", "start"]));
  });

  it("does not give one account's progress to another in the same tab", () => {
    const storage = memoryStorage();
    saveDoneSteps("user-1", new Set(["workspace"]), storage);
    expect(loadDoneSteps("user-2", storage)).toEqual(new Set());
  });

  it("ignores unknown steps and unreadable data", () => {
    const storage = memoryStorage();
    storage.setItem("corvo:onboarding-progress", '{"userId":"u","done":["workspace","nope",3]}');
    expect(loadDoneSteps("u", storage)).toEqual(new Set(["workspace"]));
    storage.setItem("corvo:onboarding-progress", "not json");
    expect(loadDoneSteps("u", storage)).toEqual(new Set());
  });

  it("works without storage", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(loadDoneSteps("u", blocked)).toEqual(new Set());
    expect(() => saveDoneSteps("u", new Set(["bot"]), blocked)).not.toThrow();
    expect(loadDoneSteps("u", null)).toEqual(new Set());
  });

  it("keeps the picks for the same account and drops them for another", () => {
    const storage = memoryStorage();
    const picks: OnboardingPicks = { use: "work", categories: ["support", "sales"] };
    savePicks("user-1", picks, storage);
    expect(loadPicks("user-1", storage)).toEqual(picks);
    expect(loadPicks("user-2", storage)).toBeNull();
  });

  it("ignores stored picks that do not parse", () => {
    const storage = memoryStorage();
    storage.setItem(
      "corvo:onboarding-picks",
      JSON.stringify({ userId: "user-1", picks: { categories: ["nonsense"] } }),
    );
    expect(loadPicks("user-1", storage)).toBeNull();
    storage.setItem("corvo:onboarding-picks", "not json");
    expect(loadPicks("user-1", storage)).toBeNull();
  });
});

describe("resuming on another device", () => {
  it("counts the steps the server has beside the ones this tab kept", () => {
    expect(mergeDoneSteps(new Set(["workspace"]), ["start", "workspace"])).toEqual(
      new Set(["workspace", "start"]),
    );
  });
});
