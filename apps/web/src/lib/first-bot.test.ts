import type { OnboardingPicks } from "@corvo/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOrReuseFirstBot, ensureFirstBot, findFirstBot } from "./first-bot";

const ensureTeam = vi.hoisted(() => vi.fn());
vi.mock("./rpc", () => ({ rpc: { onboarding: { ensureTeam } } }));

beforeEach(() => {
  ensureTeam.mockReset().mockResolvedValue({ botId: "chief-1", created: true });
});

describe("createOrReuseFirstBot", () => {
  it("asks the server for the Chief and its team in the app's language", async () => {
    await expect(createOrReuseFirstBot("pt-BR")).resolves.toEqual({ id: "chief-1" });
    expect(ensureTeam).toHaveBeenCalledWith({ locale: "pt-BR" });
  });

  it("sends the picks and returns the agent the server added", async () => {
    const picks: OnboardingPicks = { use: "work", categories: ["sales"] };
    ensureTeam.mockResolvedValue({
      botId: "chief-1",
      created: true,
      pickedAgent: { botId: "agent-1", task: "T" },
    });
    await expect(createOrReuseFirstBot("en", picks)).resolves.toEqual({
      id: "chief-1",
      pickedAgent: { botId: "agent-1", task: "T" },
    });
    expect(ensureTeam).toHaveBeenCalledWith({ locale: "en", picks });
  });

  it("returns only the Chief when the server names no picked agent", async () => {
    await expect(createOrReuseFirstBot("en", { categories: ["sales"] })).resolves.toEqual({
      id: "chief-1",
    });
  });

  it("gets the same Chief back when it was already made", async () => {
    ensureTeam.mockResolvedValue({ botId: "chief-1", created: false });
    await expect(createOrReuseFirstBot("en")).resolves.toEqual({ id: "chief-1" });
  });

  it("lets a failure reach the caller", async () => {
    ensureTeam.mockImplementation(async () => {
      throw new Error("down");
    });
    await expect(createOrReuseFirstBot("en")).rejects.toThrow("down");
  });
});

describe("findFirstBot", () => {
  it("finds the Chief by its key, and a Chief made before accounts were keyed by its old name", () => {
    expect(findFirstBot([{ id: "a", name: "Chefe", spawnKey: "onboarding:first" }])).toEqual({
      id: "a",
    });
    expect(findFirstBot([{ id: "old", name: "Chief", spawnKey: null }])).toEqual({ id: "old" });
    expect(findFirstBot([{ id: "x", name: "Other", spawnKey: null }])).toBeUndefined();
  });
});

describe("ensureFirstBot", () => {
  it("shares one in-flight attempt between concurrent callers", async () => {
    const [a, b] = await Promise.all([ensureFirstBot("en"), ensureFirstBot("en")]);
    expect(a).toEqual({ id: "chief-1" });
    expect(b).toEqual({ id: "chief-1" });
    expect(ensureTeam).toHaveBeenCalledTimes(1);
  });

  it("asks the server again once the earlier attempt has settled", async () => {
    await ensureFirstBot("en");
    await ensureFirstBot("en");
    expect(ensureTeam).toHaveBeenCalledTimes(2);
  });
});
