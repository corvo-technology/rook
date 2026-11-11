import type { Actor } from "@corvo/contracts";
import { AGENT_CATALOG } from "@corvo/core";
import { describe, expect, it, vi } from "vitest";
import { chiefAsFirstAgent, startStarterTeam } from "./starter-team.js";

const actor: Actor = {
  spaceId: "space-1",
  userId: "user-1",
  email: "fake@example.test",
  isDeploymentOwner: false,
};
const deps = { prisma: {}, jobs: {}, env: {} } as never;

const chief = { id: "chief-1", threadId: "t-1" } as never;

function steps(created: boolean) {
  const ensure = vi.fn(async () => ({
    botId: "chief-1",
    created,
    ...(created ? { bot: chief } : {}),
  }));
  const greet = vi.fn(async () => undefined);
  return { ensure, greet };
}

describe("startStarterTeam", () => {
  it("asks for the team in the person's language and has a new Chief greet them once", async () => {
    const s = steps(true);
    await expect(startStarterTeam(deps, actor, "pt-BR", s)).resolves.toEqual({
      botId: "chief-1",
      created: true,
    });
    expect(s.ensure).toHaveBeenCalledWith(expect.anything(), actor, "pt-BR");
    expect(s.greet).toHaveBeenCalledTimes(1);
    expect(s.greet).toHaveBeenCalledWith(deps, actor, chief);
  });

  it("starts nothing when the Chief was already there", async () => {
    const s = steps(false);
    await expect(startStarterTeam(deps, actor, "en", s)).resolves.toEqual({
      botId: "chief-1",
      created: false,
    });
    expect(s.greet).not.toHaveBeenCalled();
  });

  it("still returns the Chief when the greeting cannot be started", async () => {
    const s = steps(true);
    s.greet.mockRejectedValue(new Error("queue down"));
    await expect(startStarterTeam(deps, actor, "en", s)).resolves.toEqual({
      botId: "chief-1",
      created: true,
    });
  });
});

describe("startStarterTeam with picks", () => {
  const prospector = AGENT_CATALOG.find((entry) => entry.slug === "sales-prospector")!;
  function withPicks(over: { fleetManagement?: boolean; messages?: number } = {}) {
    const s = steps(true);
    const addAgent = vi.fn(async () => ({
      botId: "agent-1",
      name: "Agent",
      title: "",
      threadId: "t-2" as string | null,
      duplicate: false,
      skillsInstalled: [],
      appsToConnect: [],
    }));
    const prisma = {
      bot: {
        findUnique: vi.fn(async () => ({ fleetManagement: over.fleetManagement ?? true })),
      },
      message: { count: vi.fn(async () => over.messages ?? 0) },
    };
    const d = { prisma, jobs: {}, env: {} } as never;
    return { s, addAgent, d, steps: { ...s, addAgent: addAgent as never } };
  }

  it("adds the agent the picks name, beside the Chief, and hands back its first task", async () => {
    const w = withPicks();
    await expect(
      startStarterTeam(w.d, actor, "pt-BR", w.steps, { use: "work", categories: ["sales"] }),
    ).resolves.toEqual({
      botId: "chief-1",
      created: true,
      pickedAgent: { botId: "agent-1", task: prospector.firstTask?.["pt-BR"] },
    });
    expect(w.addAgent).toHaveBeenCalledTimes(1);
    expect(w.addAgent).toHaveBeenCalledWith(
      expect.anything(),
      { spaceId: "space-1", userId: "user-1" },
      expect.objectContaining({
        entry: expect.objectContaining({ slug: "sales-prospector" }),
        locale: "pt-BR",
        parentBotId: "chief-1",
      }),
    );
  });

  it("adds nothing without picks or without a category", async () => {
    for (const p of [undefined, { categories: [] }]) {
      const w = withPicks();
      const result = await startStarterTeam(w.d, actor, "en", w.steps, p);
      expect(w.addAgent).not.toHaveBeenCalled();
      expect(result).not.toHaveProperty("pickedAgent");
    }
  });

  it("returns no task once the agent's chat has a message", async () => {
    const w = withPicks({ messages: 1 });
    const result = await startStarterTeam(w.d, actor, "en", w.steps, { categories: ["sales"] });
    expect(result.pickedAgent).toEqual({ botId: "agent-1", task: null });
  });

  it("keeps the Chief when the agent cannot be added", async () => {
    const w = withPicks();
    w.addAgent.mockRejectedValue(new Error("limit"));
    await expect(
      startStarterTeam(w.d, actor, "en", w.steps, { categories: ["sales"] }),
    ).resolves.toEqual({ botId: "chief-1", created: true });
  });

  it("adds no Store agent for a Chief without Store access", async () => {
    const w = withPicks({ fleetManagement: false });
    const result = await startStarterTeam(w.d, actor, "en", w.steps, { categories: ["sales"] });
    expect(w.addAgent).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("pickedAgent");
  });

  it("greets through the Chief only", async () => {
    const w = withPicks();
    await startStarterTeam(w.d, actor, "en", w.steps, { categories: ["sales"] });
    expect(w.s.greet).toHaveBeenCalledTimes(1);
    expect(w.s.greet).toHaveBeenCalledWith(w.d, actor, chief);
  });
});

describe("chiefAsFirstAgent", () => {
  it("makes the Chief for the chat app the message came through, in English, and returns its id", async () => {
    const ensure = vi.fn(async () => ({ botId: "chief-1", created: true }));
    const firstAgent = chiefAsFirstAgent({} as never, ensure as never);
    const who = { ...actor, isDeploymentOwner: false as const };
    await expect(firstAgent({ actor: who, provider: "telegram", address: "42" })).resolves.toEqual({
      botId: "chief-1",
    });
    expect(ensure).toHaveBeenCalledWith(expect.anything(), who, "en", undefined, {
      channel: "telegram",
    });
  });

  it("lets a failure stop the account from being set up half-way", async () => {
    const ensure = vi.fn(async () => {
      throw new Error("down");
    });
    const firstAgent = chiefAsFirstAgent({} as never, ensure as never);
    await expect(
      firstAgent({
        actor: { ...actor, isDeploymentOwner: false },
        provider: "slack",
        address: "u1",
      }),
    ).rejects.toThrow("down");
  });
});
