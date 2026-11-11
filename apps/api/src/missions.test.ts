import type { Actor } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { createRouterClient } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const missions = vi.hoisted(() => ({
  readMissions: vi.fn(),
  completeMission: vi.fn(),
  markPartSeen: vi.fn(),
  showAllNavigation: vi.fn(),
}));

vi.mock("@corvo/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@corvo/db")>()),
  ...missions,
}));

import { withModelRoles } from "../../../packages/adapters/src/testing/model-roles.js";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

const actor = {
  spaceId: "space-1",
  userId: "user-1",
  email: "user@corvo.test",
  isDeploymentOwner: false,
} satisfies Actor;

function setup(row: { shownAllAt: Date | null } | null = null, answered = true) {
  const enqueue = vi.fn(async () => undefined);
  const answerRunInput = vi.fn(async () => answered);
  const prisma = {
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        email: actor.email,
        name: "Test",
        timezone: null,
        signupSurvey: null,
      }),
    },
    missionState: { findUnique: vi.fn(async () => row) },
    bot: {
      findFirst: vi.fn().mockResolvedValue({
        id: "bot-1",
        thread: { id: "thread-1" },
        computer: null,
      }),
    },
    partnerTenant: { findFirst: vi.fn().mockResolvedValue(null) },
    userModelPreference: { findFirst: vi.fn().mockResolvedValue(null) },
    deploymentSettings: { findUnique: vi.fn().mockResolvedValue(null) },
  } as unknown as PrismaClient;
  const deps = {
    prisma,
    env: { defaultProvider: "fake", defaultModel: "fake-model", sandboxProvider: "fake" },
    dataDir: "/tmp/corvo-missions-test",
    jobs: { enqueue },
    events: { answerRunInput },
  } as unknown as RouterDeps;
  withModelRoles(deps.prisma);
  const router = createRouter(deps);
  return {
    answerRunInput,
    client: createRouterClient(router, { context: { actor } as never }),
    anonymous: createRouterClient(router, { context: {} as never }),
  };
}

describe("missions", () => {
  beforeEach(() => {
    for (const fn of Object.values(missions)) fn.mockReset().mockResolvedValue(undefined);
  });

  it("reports short navigation only while a row exists and is not ended", async () => {
    await expect(setup(null).client.me()).resolves.toMatchObject({ shortNav: false });
    await expect(setup({ shownAllAt: null }).client.me()).resolves.toMatchObject({
      shortNav: true,
    });
    await expect(setup({ shownAllAt: new Date() }).client.me()).resolves.toMatchObject({
      shortNav: false,
    });
    expect(missions.readMissions).not.toHaveBeenCalled();
  });

  it("returns null without a row", async () => {
    missions.readMissions.mockResolvedValue(null);
    await expect(setup().client.missions.get()).resolves.toBeNull();
    expect(missions.readMissions).toHaveBeenCalledWith(expect.anything(), actor);
  });

  it("rejects an unknown part", async () => {
    await expect(setup().client.missions.seen({ part: "bogus" as never })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(missions.markPartSeen).not.toHaveBeenCalled();
  });

  it("records a seen part and ends short mode for the actor", async () => {
    const { client } = setup();
    await expect(client.missions.seen({ part: "usage" })).resolves.toEqual({ ok: true });
    await expect(client.missions.showAll()).resolves.toEqual({ ok: true });
    expect(missions.markPartSeen).toHaveBeenCalledWith(expect.anything(), actor, "usage");
    expect(missions.showAllNavigation).toHaveBeenCalledWith(expect.anything(), actor);
  });

  it("refuses anonymous calls", async () => {
    const { anonymous } = setup();
    await expect(anonymous.missions.get()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonymous.missions.seen({ part: "usage" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(anonymous.missions.showAll()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  describe("answering a request", () => {
    const answer = { botId: "bot-1", runId: "run-1", messageId: "message-1", answer: "Paris" };

    it("completes the mission for an accepted answer", async () => {
      await expect(setup().client.threads.answer(answer)).resolves.toEqual({ ok: true });
      expect(missions.completeMission).toHaveBeenCalledWith(expect.anything(), actor, "decide");
    });

    it("does not complete it for a dismissal", async () => {
      await setup().client.threads.answer({ ...answer, answer: "", dismiss: true });
      expect(missions.completeMission).not.toHaveBeenCalled();
    });

    it("does not complete it for a rejected answer", async () => {
      await expect(setup(null, false).client.threads.answer(answer)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(missions.completeMission).not.toHaveBeenCalled();
    });

    it("still succeeds when recording the mission fails", async () => {
      missions.completeMission.mockRejectedValue(new Error("database unavailable"));
      await expect(setup().client.threads.answer(answer)).resolves.toEqual({ ok: true });
    });
  });
});
