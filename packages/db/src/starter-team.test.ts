import type { Actor } from "@corvo/contracts";
import { chiefInstructions } from "@corvo/core";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import { CHIEF_SPAWN_KEY, ensureStarterTeam } from "./starter-team.js";

const actor: Actor = {
  spaceId: "space-1",
  userId: "user-1",
  email: "fake@example.test",
  isDeploymentOwner: false,
};

type Bot = { id: string; name: string; spawnKey: string | null };

function fixture(initial: Bot[] = [], over: { chiefRace?: boolean } = {}) {
  const bots: Bot[] = [...initial];
  const inputs: Array<Record<string, unknown>> = [];
  const prisma = {
    bot: { findMany: vi.fn(async () => bots.map((bot) => ({ ...bot }))) },
  } as unknown as PrismaClient;
  const createBot = vi.fn(async (_actor: unknown, input: Record<string, unknown>) => {
    inputs.push(input);
    if (input.spawnKey === CHIEF_SPAWN_KEY && over.chiefRace) {
      bots.push({ id: "winner", name: "Chief", spawnKey: CHIEF_SPAWN_KEY });
      throw new Error("duplicate spawn key");
    }
    const bot = {
      id: `bot-${bots.length + 1}`,
      name: String(input.name),
      spawnKey: String(input.spawnKey),
    };
    bots.push(bot);
    return bot;
  });
  return { prisma, createBot, inputs, bots };
}

const run = (
  f: ReturnType<typeof fixture>,
  locale: "en" | "pt-BR" = "en",
  options?: { channel?: string; storeAccess?: boolean; name?: string },
) => ensureStarterTeam(f.prisma, actor, locale, { createBot: f.createBot as never }, options);

describe("ensureStarterTeam", () => {
  it("creates the Chief in the person's language, able to look up and add Store agents", async () => {
    const f = fixture();
    const result = await run(f, "pt-BR");
    expect(result.created).toBe(true);
    // The caller gets the Chief it made, to start its greeting.
    expect(result.bot).toMatchObject({ name: "Rook" });
    expect(f.inputs.find((input) => input.spawnKey === CHIEF_SPAWN_KEY)).toMatchObject({
      name: "Rook",
      title: "Braço direito",
      instructions: chiefInstructions("pt-BR"),
      fleetManagement: true,
    });
  });

  it("creates only the Chief, with squad routing; it adds the other agents itself", async () => {
    const f = fixture();
    await run(f);
    expect(f.inputs).toHaveLength(1);
    expect(f.inputs[0]).toMatchObject({
      spawnKey: CHIEF_SPAWN_KEY,
      squadRouting: true,
      // A second space at the plan's computer cap still gets its Chief.
      allowWithoutComputer: true,
    });
  });

  it("lets the Chief add Store agents unless the caller says otherwise", async () => {
    const f = fixture();
    await run(f);
    expect(f.inputs[0]).toMatchObject({ fleetManagement: true });
    const partner = fixture();
    await run(partner, "en", { storeAccess: false });
    expect(partner.inputs[0]).toMatchObject({ fleetManagement: false, squadRouting: true });
  });

  it("names the Chief as the partner asked, and finds it again by its key rather than its name", async () => {
    const f = fixture();
    const first = await run(f, "pt-BR", { name: "Assistente GreenBarber" });
    expect(first.bot).toMatchObject({ name: "Assistente GreenBarber" });
    const again = await run(f, "pt-BR", { name: "Assistente GreenBarber" });
    expect(again.created).toBe(false);
    expect(f.inputs).toHaveLength(1);
  });

  it("keeps the localized name when no name is given", async () => {
    const f = fixture();
    expect((await run(f, "pt-BR")).bot).toMatchObject({ name: "Rook" });
  });

  it("writes the Chief for the chat app the person came through", async () => {
    const f = fixture();
    await run(f, "en", { channel: "telegram" });
    expect(f.inputs.find((input) => input.spawnKey === CHIEF_SPAWN_KEY)?.instructions).toBe(
      chiefInstructions("en", "telegram"),
    );
  });

  it("returns the Chief the account already has and makes nothing it does not need", async () => {
    const f = fixture([{ id: "old", name: "Chefe", spawnKey: CHIEF_SPAWN_KEY }]);
    await expect(run(f)).resolves.toEqual({ botId: "old", created: false });
    expect(f.createBot).not.toHaveBeenCalled();
  });

  it("recognizes a Chief made before accounts were keyed", async () => {
    const f = fixture([{ id: "legacy", name: "Chief", spawnKey: null }]);
    await expect(run(f)).resolves.toMatchObject({ botId: "legacy", created: false });
  });

  it("uses the Chief another request created when it wins the race", async () => {
    const f = fixture([], { chiefRace: true });
    await expect(run(f)).resolves.toEqual({ botId: "winner", created: false });
  });

  it("makes the Chief in English for every other language", async () => {
    const f = fixture();
    await run(f, "en");
    expect(f.inputs.find((input) => input.spawnKey === CHIEF_SPAWN_KEY)).toMatchObject({
      name: "Rook",
      title: "Right hand",
    });
  });

  it("still finds an older Chief that was renamed to Rook before it had a spawn key", async () => {
    const f = fixture([{ id: "old", name: "Rook", spawnKey: null }]);
    await expect(run(f)).resolves.toEqual({ botId: "old", created: false });
  });
});
