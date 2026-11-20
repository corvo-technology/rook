import type { PrismaClient } from "@corvo/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  organizationForMember: vi.fn(),
  creditAccount: vi.fn(),
  reserveModelCredits: vi.fn(),
  settleModelCredits: vi.fn(),
}));
vi.mock("@corvo/db", () => db);

import { MediaCreditsError, mediaCredits } from "./media-credits.js";

const hold1 = (model?: string, count = 1) => ({
  jobId: "job",
  provider: "openrouter",
  model,
  count,
});

const prisma = {} as PrismaClient;
const scope = { userId: "user", spaceId: "space", runId: "run" };

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  db.organizationForMember.mockResolvedValue({ organizationId: "org" });
  db.creditAccount.mockResolvedValue({ mode: "credits" });
  db.reserveModelCredits.mockResolvedValue("entry");
  db.settleModelCredits.mockResolvedValue(undefined);
});

describe("media credits", () => {
  it("holds the model's worst case for every picture, once per job", async () => {
    await mediaCredits(prisma, scope).hold({
      jobId: "job-1",
      provider: "openai-compatible",
      model: "gpt-image-1",
      count: 3,
    });
    expect(db.reserveModelCredits).toHaveBeenCalledWith(prisma, "org", 0.75, {
      callId: "media:job-1",
      userId: "user",
      spaceId: "space",
      runId: "run",
      provider: "openai-compatible",
      model: "gpt-image-1",
    });
  });

  it("holds a cautious price for a model that is not in the catalog", async () => {
    await mediaCredits(prisma, scope).hold(hold1("acme/unlisted", 2));
    expect(db.reserveModelCredits).toHaveBeenCalledWith(
      prisma,
      "org",
      0.6,
      expect.objectContaining({ model: "acme/unlisted" }),
    );
  });

  it("settles at the reported cost, else the catalog price of what was made, else the hold", async () => {
    const hold = await mediaCredits(prisma, scope).hold(hold1("gpt-image-1", 4));
    await hold.settle(0.08, 4);
    expect(db.settleModelCredits).toHaveBeenLastCalledWith(prisma, "entry", 0.08);
    await hold.settle(undefined, 3);
    expect(db.settleModelCredits).toHaveBeenLastCalledWith(prisma, "entry", 0.126);
    const unlisted = await mediaCredits(prisma, scope).hold(hold1("acme/unlisted", 2));
    await unlisted.settle(undefined);
    expect(db.settleModelCredits).toHaveBeenLastCalledWith(prisma, "entry", 0.6);
  });

  it("returns the whole hold on release", async () => {
    const hold = await mediaCredits(prisma, scope).hold(hold1());
    await hold.release();
    expect(db.settleModelCredits).toHaveBeenCalledWith(prisma, "entry", 0);
  });

  it("refuses an account that is not on credits, without holding anything", async () => {
    db.creditAccount.mockResolvedValue({ mode: "own_key" });
    await expect(mediaCredits(prisma, scope).hold(hold1())).rejects.toThrow(
      new MediaCreditsError("Image generation needs credits. Add credits in Billing."),
    );
    expect(db.reserveModelCredits).not.toHaveBeenCalled();
  });

  it("refuses a person with no organization", async () => {
    db.organizationForMember.mockResolvedValue(null);
    await expect(mediaCredits(prisma, scope).hold(hold1())).rejects.toBeInstanceOf(
      MediaCreditsError,
    );
  });

  it("says plainly when the balance is too low, and passes any other failure through", async () => {
    db.reserveModelCredits.mockRejectedValueOnce(
      new Error("Not enough model credits. Add credits in Billing or connect your own API key."),
    );
    await expect(mediaCredits(prisma, scope).hold(hold1())).rejects.toThrow(
      new MediaCreditsError("Not enough credit for an image. Add credits in Billing."),
    );
    const broken = new Error("connection lost");
    db.reserveModelCredits.mockRejectedValueOnce(broken);
    await expect(mediaCredits(prisma, scope).hold(hold1())).rejects.toBe(broken);
  });
});
