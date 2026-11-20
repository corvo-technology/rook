import { describe, expect, it, vi } from "vitest";
import { assertMessageModel } from "./model-pins.js";

const validate = vi.fn();
vi.mock("@corvo/adapters", async (original) => ({
  ...(await original<typeof import("@corvo/adapters")>()),
  validateConnectedModelChoice: (...args: unknown[]) => validate(...args),
}));

const deps = { prisma: {}, secrets: {} } as never;
const actor = { userId: "user-1", spaceId: "space-1" } as never;
const model = { provider: "hosted", modelId: "big" };

describe("assertMessageModel", () => {
  it("passes the hosted provider so credits can serve the model", async () => {
    validate.mockResolvedValueOnce(undefined);
    await assertMessageModel(deps, actor, model, {
      codexCatalog: {} as never,
      hostedProvider: "hosted",
    });
    expect(validate).toHaveBeenLastCalledWith(
      deps.prisma,
      deps.secrets,
      actor,
      "hosted",
      "big",
      expect.objectContaining({ hostedProvider: "hosted" }),
    );
  });

  it("refuses a model the person cannot run, such as a credit model without credits", async () => {
    validate.mockResolvedValueOnce("Connect that model provider first");
    await expect(
      assertMessageModel(deps, actor, model, { codexCatalog: {} as never }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
