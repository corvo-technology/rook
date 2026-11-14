import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { prepareOpenCodeModels } from "./opencode-models.js";

const started = (port: number) => ({
  baseUrl: `http://127.0.0.1:${port}/secret/v1`,
  models: ["opencode/big-pickle"],
  close: async () => undefined,
});

describe("prepareOpenCodeModels", () => {
  it("returns the address and the models, and remembers its secret and port", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "corvo-oc-"));
    const start = vi.fn().mockResolvedValue(started(45001));
    const result = await prepareOpenCodeModels(dir, start);
    expect(result).toMatchObject({ url: "http://127.0.0.1:45001/secret/v1" });
    expect(result?.models).toEqual(["opencode/big-pickle"]);
    const saved = JSON.parse(await readFile(path.join(dir, "opencode-models.json"), "utf8"));
    expect(saved.port).toBe(45001);
    expect(saved.secret).toMatch(/^[a-f0-9]{48}$/);

    const again = vi.fn().mockResolvedValue(started(45001));
    await prepareOpenCodeModels(dir, again);
    expect(again).toHaveBeenCalledWith(
      expect.objectContaining({ secret: saved.secret, port: 45001 }),
    );
  });

  it("takes another port when the remembered one is in use", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "corvo-oc-"));
    await prepareOpenCodeModels(dir, vi.fn().mockResolvedValue(started(45002)));
    const busy = Object.assign(new Error("in use"), { code: "EADDRINUSE" });
    const start = vi.fn().mockRejectedValueOnce(busy).mockResolvedValueOnce(started(45003));
    const result = await prepareOpenCodeModels(dir, start);
    expect(result?.url).toContain(":45003/");
    expect(start.mock.calls[1]?.[0]).not.toHaveProperty("port");
  });

  it("goes on without it when it takes too long, and shuts the late server down", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "corvo-oc-"));
    const close = vi.fn().mockResolvedValue(undefined);
    const slow = vi
      .fn()
      .mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ ...started(45004), close }), 60)),
      );
    expect(await prepareOpenCodeModels(dir, slow, 10)).toBeUndefined();
    // The late server starts on a real timer; a busy machine may take longer than any fixed wait.
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce(), { timeout: 5_000 });
  });

  it("offers nothing when OpenCode is missing or anything goes wrong", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "corvo-oc-"));
    expect(await prepareOpenCodeModels(dir, vi.fn().mockResolvedValue(undefined))).toBeUndefined();
    expect(await prepareOpenCodeModels(dir, vi.fn().mockRejectedValue(new Error("boom")))).toBe(
      undefined,
    );
  });
});
