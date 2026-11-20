import type { AdapterContext } from "@corvo/adapter-kit";
import { MediaGenerationError } from "@corvo/adapter-kit";
import { ATTACHMENT_MAX_BYTES } from "@corvo/contracts";
import { toolRequiresApproval } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import { describe, expect, it, vi } from "vitest";
import { MediaCreditsError } from "./media-credits.js";
import { FakeMediaGenerationProvider } from "./media-generation-provider.js";
import { generateMediaFromTool } from "./media-generation-tools.js";
import { selectBuiltinToolsForRun } from "./run-tool-selection.js";

const run = { id: "run", threadId: "thread", botId: "bot", spaceId: "space", userId: "owner" };
const context: AdapterContext = {
  ...run,
  operationId: "op",
  traceId: "trace",
  signal: new AbortController().signal,
};
function setup() {
  const provider = new FakeMediaGenerationProvider();
  const row = {
    id: "local-job",
    status: "media_pending",
    result: { provider: "fake", jobId: "remote-job" },
  };
  const externalEffect = {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi
      .fn()
      .mockResolvedValue({ ...row, status: "media_submitting", result: { provider: "fake" } }),
    update: vi.fn().mockResolvedValue(row),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const attach = vi.fn().mockResolvedValue({
    artifactId: "artifact",
    block: { kind: "image", artifactId: "artifact", name: "generated.png" },
  });
  const publish = vi.fn();
  const options = {
    name: "generate_image" as const,
    args: { prompt: "draw" } as Record<string, unknown>,
    executionId: "execution",
    provider,
    prisma: {
      externalEffect,
      artifact: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient,
    context,
    run,
    attach,
    publish,
  };
  return { options, externalEffect, provider, attach, publish, row };
}

describe("bot media tools", () => {
  it("uses existing approval and per-bot disable controls, hidden by default", () => {
    for (const name of ["generate_image", "generate_video"])
      expect(toolRequiresApproval(name, false)).toBe(true);
    const base = {
      graphicalToolsAllowed: false,
      groupId: null,
      trigger: "message",
      semanticMemoryEnabled: false,
      messagingChannelRun: false,
    };
    const names = (extra = {}) =>
      selectBuiltinToolsForRun({ ...base, ...extra }).map((tool) => tool.name);
    expect(names()).not.toContain("generate_image");
    expect(names()).not.toContain("generate_video");
    expect(names({ mediaImagesEnabled: true })).toContain("generate_image");
    expect(names({ mediaImagesEnabled: true })).not.toContain("generate_video");
    expect(names({ mediaVideoEnabled: true })).toContain("generate_video");
    expect(
      names({ trigger: "tickets", mediaImagesEnabled: true, mediaVideoEnabled: true }),
    ).not.toContain("generate_image");
    expect(
      names({ trigger: "tickets", mediaImagesEnabled: true, mediaVideoEnabled: true }),
    ).not.toContain("generate_video");
    expect(
      names({ mediaVideoEnabled: true, disabledBuiltinTools: ["generate_video"] }),
    ).not.toContain("generate_video");
  });
  it("reserves before generation and posts stored attachments", async () => {
    const { options, provider, attach, publish, externalEffect } = setup();
    const generate = vi.spyOn(provider, "generateImage");
    expect(await generateMediaFromTool(options)).toEqual({
      status: "completed",
      artifactId: "artifact",
      artifactIds: ["artifact"],
    });
    expect(externalEffect.create.mock.invocationCallOrder[0]).toBeLessThan(
      generate.mock.invocationCallOrder[0]!,
    );
    expect(attach).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: "image/png" }),
      "generated-local-job.png",
      expect.objectContaining({ id: "local-job" }),
    );
    expect(publish).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid inputs before reserving or billing", async () => {
    const { options, externalEffect } = setup();
    for (const args of [{ prompt: " " }, { prompt: "draw", jobId: "job" }, { jobId: 42 }]) {
      expect(await generateMediaFromTool({ ...options, args })).toHaveProperty("error");
    }
    expect(externalEffect.create).not.toHaveBeenCalled();
  });
  it("enforces durable two-submission limit", async () => {
    const { options, externalEffect, provider } = setup();
    externalEffect.create.mockRejectedValue({ code: "P2002" });
    const generate = vi.spyOn(provider, "generateImage");
    expect(await generateMediaFromTool(options)).toMatchObject({
      error: expect.stringContaining("limit reached"),
    });
    expect(externalEffect.create).toHaveBeenCalledTimes(2);
    expect(generate).not.toHaveBeenCalled();
  });
  it("does not rebill a replayed execution", async () => {
    const { options, externalEffect, row, provider } = setup();
    externalEffect.findFirst.mockResolvedValue(row);
    const generate = vi.spyOn(provider, "generateImage");
    expect(await generateMediaFromTool(options)).toHaveProperty("error");
    expect(generate).not.toHaveBeenCalled();
    expect(externalEffect.create).not.toHaveBeenCalled();
  });
  it("submits and persists async jobs without posting a pending result as a message", async () => {
    const { options, externalEffect, publish } = setup();
    expect(await generateMediaFromTool({ ...options, name: "generate_video" })).toMatchObject({
      status: "queued",
      jobId: "local-job",
    });
    expect(externalEffect.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "media_pending", result: { provider: "fake", jobId: "fake-video" } },
      }),
    );
    expect(publish).not.toHaveBeenCalled();
  });
  it("scopes polling to the owner, bot and thread and never accepts arbitrary provider IDs", async () => {
    const { options, externalEffect, provider } = setup();
    const poll = vi.spyOn(provider, "pollVideo");
    expect(
      await generateMediaFromTool({
        ...options,
        name: "generate_video",
        args: { jobId: "foreign" },
      }),
    ).toHaveProperty("error");
    expect(externalEffect.findFirst).toHaveBeenCalledWith({
      where: {
        id: "foreign",
        kind: "media_generation_job",
        spaceId: "space",
        run: { userId: "owner", botId: "bot", threadId: "thread" },
      },
    });
    expect(poll).not.toHaveBeenCalled();
  });
  it("resumes a saved job and posts completed video once", async () => {
    const { options, externalEffect, row, provider, publish, attach } = setup();
    externalEffect.findFirst.mockResolvedValue(row);
    const poll = vi.spyOn(provider, "pollVideo");
    expect(
      await generateMediaFromTool({ ...options, name: "generate_video", args: { jobId: row.id } }),
    ).toMatchObject({ status: "completed", artifactId: "artifact" });
    expect(poll).toHaveBeenCalledWith("remote-job", context);
    expect(attach).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: "video/mp4" }),
      "generated-local-job.mp4",
      expect.objectContaining({ id: "local-job" }),
    );
    expect(publish).toHaveBeenCalledTimes(1);
    externalEffect.findFirst.mockResolvedValue({
      ...row,
      result: { provider: "fake", artifactId: "artifact" },
    });
    await generateMediaFromTool({ ...options, name: "generate_video", args: { jobId: row.id } });
    expect(poll).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
  });
  it.each(["generate_image", "generate_video"] as const)(
    "recovers %s after storage succeeds and publication fails without generating again",
    async (name) => {
      const { options, externalEffect, row, provider, attach, publish } = setup();
      externalEffect.findFirst.mockResolvedValue({
        ...row,
        result: { ...row.result, artifactId: "artifact" },
      });
      const artifact = {
        id: "artifact",
        name: "generated.png",
        mimeType: "image/png",
        size: 4,
      };
      vi.mocked(options.prisma.artifact.findMany).mockResolvedValue([artifact] as never);
      const image = vi.spyOn(provider, "generateImage");
      const poll = vi.spyOn(provider, "pollVideo");
      publish.mockRejectedValueOnce(new Error("publication failed"));
      expect(
        await generateMediaFromTool({
          ...options,
          name,
          args: name === "generate_video" ? { jobId: row.id } : { prompt: "draw" },
        }),
      ).toHaveProperty("error");
      expect(
        await generateMediaFromTool({
          ...options,
          name,
          args: name === "generate_video" ? { jobId: row.id } : { prompt: "draw" },
        }),
      ).toEqual({ status: "completed", artifactId: artifact.id, artifactIds: [artifact.id] });
      expect(image).not.toHaveBeenCalled();
      expect(poll).not.toHaveBeenCalled();
      expect(attach).not.toHaveBeenCalled();
      expect(publish).toHaveBeenCalledWith(
        [expect.objectContaining({ artifactId: artifact.id })],
        row.id,
        [artifact.id],
      );
    },
  );
  it("never submits or reserves new work in recovery-only mode", async () => {
    const { options, externalEffect, provider } = setup();
    const submit = vi.spyOn(provider, "generateImage");
    expect(await generateMediaFromTool({ ...options, recoverOnly: true })).toBeUndefined();
    expect(submit).not.toHaveBeenCalled();
    expect(externalEffect.create).not.toHaveBeenCalled();
  });
  it("returns the existing running job when an interrupted poll is still claimed", async () => {
    const { options, externalEffect, row, provider } = setup();
    externalEffect.findFirst.mockResolvedValue(row);
    externalEffect.updateMany.mockResolvedValue({ count: 0 });
    const poll = vi.spyOn(provider, "pollVideo");
    expect(
      await generateMediaFromTool({
        ...options,
        name: "generate_video",
        args: { jobId: row.id },
        recoverOnly: true,
      }),
    ).toEqual({ jobId: row.id, status: "running" });
    expect(poll).not.toHaveBeenCalled();
  });
  it("does not concurrently poll a claimed job", async () => {
    const { options, externalEffect, row, provider } = setup();
    externalEffect.findFirst.mockResolvedValue(row);
    externalEffect.updateMany.mockResolvedValue({ count: 0 });
    const poll = vi.spyOn(provider, "pollVideo");
    expect(
      await generateMediaFromTool({ ...options, name: "generate_video", args: { jobId: row.id } }),
    ).toHaveProperty("error");
    expect(poll).not.toHaveBeenCalled();
  });
  it("releases failed polling claims without resubmitting", async () => {
    const { options, externalEffect, row, provider } = setup();
    externalEffect.findFirst.mockResolvedValue(row);
    vi.spyOn(provider, "pollVideo").mockRejectedValue(new Error("private provider failure"));
    expect(
      await generateMediaFromTool({ ...options, name: "generate_video", args: { jobId: row.id } }),
    ).toMatchObject({ error: expect.not.stringContaining("private") });
    expect(externalEffect.updateMany).toHaveBeenCalledWith({
      where: { id: row.id, status: { not: "media_completed" } },
      data: { status: "media_pending" },
    });
  });
  it("rejects oversized or wrong-MIME adapter output before storage", async () => {
    const { options, provider, attach } = setup();
    vi.spyOn(provider, "generateImage")
      .mockResolvedValueOnce([
        { bytes: new Uint8Array(ATTACHMENT_MAX_BYTES + 1), mimeType: "image/png" },
      ])
      .mockResolvedValueOnce([{ bytes: new Uint8Array([1]), mimeType: "video/mp4" }]);
    expect(await generateMediaFromTool(options)).toHaveProperty("error");
    expect(await generateMediaFromTool(options)).toHaveProperty("error");
    expect(attach).not.toHaveBeenCalled();
  });
});

describe("image generation on the customer's credit", () => {
  function credits() {
    const hold = {
      settle: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
    };
    return { hold, credits: { hold: vi.fn().mockResolvedValue(hold) } };
  }

  it("holds credit before the image and settles it at the cost the provider reports", async () => {
    const { options, provider } = setup();
    const { hold, credits: wallet } = credits();
    const generate = vi
      .spyOn(provider, "generateImage")
      .mockResolvedValue([{ bytes: Buffer.from("x"), mimeType: "image/png", costUsd: 0.04 }]);
    await generateMediaFromTool({ ...options, credits: wallet });
    expect(wallet.hold).toHaveBeenCalledWith({
      jobId: "local-job",
      provider: "fake",
      model: undefined,
      count: 1,
    });
    expect(wallet.hold.mock.invocationCallOrder[0]).toBeLessThan(
      generate.mock.invocationCallOrder[0]!,
    );
    expect(hold.settle).toHaveBeenCalledWith(0.04, 1);
    expect(hold.release).not.toHaveBeenCalled();
  });

  it("says plainly when the customer has no credit, and generates nothing", async () => {
    const { options, provider } = setup();
    const generate = vi.spyOn(provider, "generateImage");
    const wallet = {
      hold: vi
        .fn()
        .mockRejectedValue(
          new MediaCreditsError("Not enough credit for an image. Add credits in Billing."),
        ),
    };
    expect(await generateMediaFromTool({ ...options, credits: wallet })).toEqual({
      error: "Not enough credit for an image. Add credits in Billing.",
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("gives the credit back when the provider refused before generating", async () => {
    const { options, provider } = setup();
    const { hold, credits: wallet } = credits();
    vi.spyOn(provider, "generateImage").mockRejectedValue(new MediaGenerationError("rate_limit"));
    expect(await generateMediaFromTool({ ...options, credits: wallet })).toHaveProperty("error");
    expect(hold.release).toHaveBeenCalledTimes(1);
    expect(hold.settle).not.toHaveBeenCalled();
  });

  it("keeps the credit held when it cannot tell whether the image was made", async () => {
    for (const failure of [
      new MediaGenerationError("provider_failure", { uncertain: true }),
      new Error("connection reset"),
    ]) {
      const { options, provider } = setup();
      const { hold, credits: wallet } = credits();
      vi.spyOn(provider, "generateImage").mockRejectedValue(failure);
      expect(await generateMediaFromTool({ ...options, credits: wallet })).toHaveProperty("error");
      expect(hold.release).not.toHaveBeenCalled();
      expect(hold.settle).not.toHaveBeenCalled();
    }
  });

  it("still delivers the image when the settlement fails", async () => {
    const { options } = setup();
    const { hold, credits: wallet } = credits();
    hold.settle.mockRejectedValue(new Error("db down"));
    expect(await generateMediaFromTool({ ...options, credits: wallet })).toMatchObject({
      status: "completed",
    });
  });

  it("charges nothing when no credit is involved", async () => {
    const { options } = setup();
    expect(await generateMediaFromTool(options)).toMatchObject({ status: "completed" });
  });

  it("passes the proportion to the provider", async () => {
    const { options, provider } = setup();
    const generate = vi.spyOn(provider, "generateImage");
    await generateMediaFromTool({ ...options, args: { prompt: "draw", aspect_ratio: "4:5" } });
    expect(generate).toHaveBeenCalledWith(
      { prompt: "draw", aspectRatio: "4:5", count: 1 },
      expect.anything(),
    );
  });
  it("names the attachment for the format the model gave", async () => {
    for (const [mimeType, name] of [
      ["image/png", "generated-local-job.png"],
      ["image/jpeg", "generated-local-job.jpg"],
      ["image/webp", "generated-local-job.webp"],
    ] as const) {
      const { options, provider, attach } = setup();
      vi.spyOn(provider, "generateImage").mockResolvedValue([
        { bytes: Buffer.from("x"), mimeType },
      ]);
      await generateMediaFromTool(options);
      expect(attach).toHaveBeenCalledWith(
        expect.objectContaining({ mimeType }),
        name,
        expect.anything(),
      );
    }
  });
});
