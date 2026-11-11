import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installCliEngine,
  installedEngineBinary,
  parseClaudeManifest,
  releaseTarget,
} from "./install.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "cli-install-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const binary = Buffer.from("#!/bin/sh\necho fake\n");
const sha = createHash("sha256").update(binary).digest("hex");

function releases(options: { checksum?: string; version?: string; redirectTo?: string } = {}) {
  const version = options.version ?? "9.9.9";
  const respond = (text: string | Uint8Array<ArrayBuffer>, url: string) => {
    const response = new Response(text);
    Object.defineProperty(response, "url", { value: options.redirectTo ?? url });
    return response;
  };
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/latest")) return respond(`${version}\n`, url);
    if (url.endsWith("/manifest.json")) {
      return respond(
        JSON.stringify({
          version,
          platforms: { "linux-x64": { checksum: options.checksum ?? sha } },
        }),
        url,
      );
    }
    return respond(new Uint8Array(binary), url);
  }) as unknown as typeof fetch;
}

const deps = (fetchImpl: typeof fetch) => ({
  dataDir: dir,
  fetch: fetchImpl,
  platform: "linux" as const,
  arch: "x64",
  musl: () => false,
});

describe("releaseTarget", () => {
  it("covers darwin, linux and win32 on arm64 and x64, and nothing else", () => {
    expect(releaseTarget("claude", "darwin", "arm64", false)).toBe("darwin-arm64");
    expect(releaseTarget("claude", "darwin", "x64", false)).toBe("darwin-x64");
    expect(releaseTarget("claude", "linux", "x64", false)).toBe("linux-x64");
    expect(releaseTarget("claude", "linux", "arm64", true)).toBe("linux-arm64-musl");
    expect(releaseTarget("claude", "win32", "x64", false)).toBe("win32-x64");
    expect(releaseTarget("claude", "freebsd", "x64", false)).toBeNull();
    expect(releaseTarget("claude", "linux", "ia32", false)).toBeNull();
  });
});

describe("parseClaudeManifest", () => {
  const manifest = { platforms: { "linux-x64": { checksum: sha } } };
  it("reads the checksum the vendor lists", () => {
    expect(parseClaudeManifest(manifest, "1.2.3", "linux-x64")).toMatchObject({
      version: "1.2.3",
      sha256: sha,
    });
  });
  it("rejects a missing or malformed digest", () => {
    expect(parseClaudeManifest({ platforms: {} }, "1.2.3", "linux-x64")).toBeNull();
    expect(
      parseClaudeManifest(
        { platforms: { "linux-x64": { checksum: "XYZ" } } },
        "1.2.3",
        "linux-x64",
      ),
    ).toBeNull();
  });
  it("rejects a version that is not semver", () => {
    expect(parseClaudeManifest(manifest, "../../etc", "linux-x64")).toBeNull();
    expect(parseClaudeManifest(manifest, "1.2", "linux-x64")).toBeNull();
  });
});

describe("installCliEngine", () => {
  it("installs a fake binary byte for byte and finds it again", async () => {
    const result = await installCliEngine("claude", "claude", deps(releases()));
    expect(result.version).toBe("9.9.9");
    expect(result.binary).toBe(path.join(dir, "engines", "claude", "9.9.9", "claude"));
    expect(await readFile(result.binary)).toEqual(binary);
    expect((await stat(result.binary)).mode & 0o111).not.toBe(0);
    expect(await installedEngineBinary(dir, "claude", "claude", "linux")).toBe(result.binary);
  });

  it("a checksum mismatch installs nothing", async () => {
    await expect(
      installCliEngine("claude", "claude", deps(releases({ checksum: "0".repeat(64) }))),
    ).rejects.toThrow(/digest/i);
    expect(await readdir(path.join(dir, "engines", "claude"))).toEqual([]);
    expect(await installedEngineBinary(dir, "claude", "claude", "linux")).toBeUndefined();
  });

  it("refuses a redirect to a host outside the allowlist", async () => {
    await expect(
      installCliEngine(
        "claude",
        "claude",
        deps(releases({ redirectTo: "https://elsewhere.test/x" })),
      ),
    ).rejects.toThrow(/allowed/);
    expect(await installedEngineBinary(dir, "claude", "claude", "linux")).toBeUndefined();
  });

  it("refuses a latest version that is not a version number", async () => {
    await expect(
      installCliEngine("claude", "claude", deps(releases({ version: "../escape" }))),
    ).rejects.toThrow(/version number/);
  });

  it("reports no build where the vendor publishes none", async () => {
    await expect(
      installCliEngine("claude", "claude", { ...deps(releases()), platform: "freebsd" as const }),
    ).rejects.toThrow(/no published build/);
  });
});
