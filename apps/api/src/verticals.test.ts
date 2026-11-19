import type { Actor, CreateBotInput } from "@corvo/contracts";
import {
  listVerticalSummaries,
  VERTICAL_IDS,
  VERTICAL_LOCALES,
  VERTICAL_TEMPLATES,
  VerticalTemplate,
} from "@corvo/contracts";
import { APP_CATALOG, nextCronDateAcrossStrict } from "@corvo/core";
import { describe, expect, it, vi } from "vitest";
import type { VerticalDeps } from "./verticals.js";
import { applyVertical, verticalSpawnKey } from "./verticals.js";

const actor = (spaceId: string): Actor => ({
  spaceId,
  userId: `user-${spaceId}`,
  email: "owner@example.test",
  isDeploymentOwner: false,
});

function fixture() {
  const bots = new Map<string, { id: string; input: CreateBotInput }>();
  const routines = new Map<string, Record<string, unknown>>();
  const woken: string[] = [];
  const deps = {
    prisma: {
      routine: {
        findUnique: vi.fn(
          async ({
            where,
          }: {
            where: { botId_templateKey: { botId: string; templateKey: string } };
          }) => {
            const key = `${where.botId_templateKey.botId}/${where.botId_templateKey.templateKey}`;
            return routines.get(key) ?? null;
          },
        ),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: `routine-${routines.size + 1}`, ...data };
          routines.set(`${data.botId}/${data.templateKey}`, row);
          return row;
        }),
      },
    },
    createBot: vi.fn(async (who: Actor, input: CreateBotInput) => {
      const key = `${who.spaceId}/${input.spawnKey}`;
      const found = bots.get(key) ?? { id: `bot-${bots.size + 1}`, input };
      bots.set(key, found);
      return { id: found.id };
    }),
    scheduleRoutine: vi.fn(async (id: string) => {
      woken.push(id);
    }),
  };
  return { deps: deps as unknown as VerticalDeps, bots, routines, woken, raw: deps };
}

describe("the vertical templates", () => {
  it("ship in the order the picker lists them, each valid and complete in every language", () => {
    expect(VERTICAL_TEMPLATES.map((template) => template.id)).toEqual([...VERTICAL_IDS]);
    for (const template of VERTICAL_TEMPLATES) {
      expect(() => VerticalTemplate.parse(template)).not.toThrow();
      for (const locale of VERTICAL_LOCALES) {
        expect(template.name[locale].length).toBeGreaterThan(0);
        expect(template.description[locale].length).toBeGreaterThan(0);
      }
    }
  });

  it("has routines on agents it makes, with schedules that run and unique keys", () => {
    for (const template of VERTICAL_TEMPLATES) {
      const agents = new Set(template.agents.map((agent) => agent.key));
      expect(agents.size).toBe(template.agents.length);
      const keys = template.routines.map((routine) => routine.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const routine of template.routines) {
        expect(agents.has(routine.agent)).toBe(true);
        if (routine.trigger.kind === "schedule") {
          expect(nextCronDateAcrossStrict(routine.trigger.crons, new Date(), "UTC")).toBeTruthy();
        }
      }
    }
  });

  it("suggests only apps the Store carries and channels a person can connect", () => {
    const slugs = new Set(APP_CATALOG.map((app) => app.slug));
    for (const template of VERTICAL_TEMPLATES) {
      for (const connection of template.connections) expect(slugs.has(connection.app)).toBe(true);
      for (const channel of template.channels)
        expect(["whatsapp", "email"]).toContain(channel.kind);
    }
  });

  it("lists in the person's language, English when it is not one of ours", () => {
    const pt = listVerticalSummaries("pt-BR");
    expect(pt.map((entry) => entry.id)).toEqual([...VERTICAL_IDS]);
    expect(pt[0]?.name).toBe("Clínica");
    expect(pt[0]?.agents[0]?.name).toBe("Recepção");
    expect(listVerticalSummaries("ja")[0]?.name).toBe("クリニック");
    expect(listVerticalSummaries("xx")[0]?.name).toBe("Clinic");
    expect(listVerticalSummaries("es-MX")[0]?.name).toBe("Clínica");
  });
});

describe("applyVertical", () => {
  it("makes every agent and scheduled routine, with the active ones scheduled", async () => {
    const f = fixture();
    const result = await applyVertical(f.deps, actor("s1"), "barbearia_salao", {
      locale: "pt-BR",
      timezone: "America/Sao_Paulo",
    });
    expect(Object.keys(result.botIds)).toEqual(["reception", "followup", "manager"]);
    const first = f.raw.createBot.mock.calls[0]?.[1] as CreateBotInput;
    expect(first.name).toBe("Recepção");
    expect(first.spawnKey).toBe(verticalSpawnKey("barbearia_salao", "reception"));
    expect(first.intro).toBe(false);
    // Event routines belong to partner templates; the self-serve team only gets schedules.
    expect(Object.keys(result.routineIds).sort()).toEqual([
      "daily-summary",
      "morning-agenda",
      "weekly-returns",
    ]);
    const rows = [...f.routines.values()];
    expect(rows.find((row) => row.templateKey === "weekly-returns")?.active).toBe(false);
    expect(rows.find((row) => row.templateKey === "morning-agenda")?.timezone).toBe(
      "America/Sao_Paulo",
    );
    expect(f.woken).toHaveLength(2);
    expect(result.channels.map((channel) => channel.kind)).toEqual(["whatsapp", "email"]);
    expect(result.connections.map((connection) => connection.app)).toContain("stripe");
  });

  it("is safe to repeat: nothing is made twice and the same ids come back", async () => {
    const f = fixture();
    const first = await applyVertical(f.deps, actor("s1"), "clinica");
    const wokenAfterFirst = f.woken.length;
    const again = await applyVertical(f.deps, actor("s1"), "clinica");
    expect(again.botIds).toEqual(first.botIds);
    expect(again.routineIds).toEqual(first.routineIds);
    expect(f.routines.size).toBe(Object.keys(first.routineIds).length);
    expect(f.woken).toHaveLength(wokenAfterFirst);
  });

  it("makes only the agents and routines picked, and no routine for an agent left out", async () => {
    const f = fixture();
    const result = await applyVertical(f.deps, actor("s1"), "comercio", {
      agents: ["orders"],
      routines: ["low-stock", "daily-summary"],
    });
    expect(Object.keys(result.botIds)).toEqual(["orders"]);
    expect(Object.keys(result.routineIds)).toEqual(["low-stock"]);
  });

  it("refuses an agent or routine the vertical does not have, making nothing", async () => {
    const f = fixture();
    await expect(
      applyVertical(f.deps, actor("s1"), "clinica", { agents: ["ghost"] }),
    ).rejects.toThrow(/Unknown agent/);
    await expect(
      applyVertical(f.deps, actor("s1"), "clinica", { routines: ["ghost"] }),
    ).rejects.toThrow(/Unknown routine/);
    expect(f.raw.createBot).not.toHaveBeenCalled();
  });

  it("keeps spaces apart: the same vertical in two spaces makes two teams", async () => {
    const f = fixture();
    const a = await applyVertical(f.deps, actor("s1"), "agencia");
    const b = await applyVertical(f.deps, actor("s2"), "agencia");
    expect(a.botIds.accounts).not.toBe(b.botIds.accounts);
    expect(f.raw.createBot.mock.calls.every((call) => call[0].spaceId.startsWith("s"))).toBe(true);
  });
});
