import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadDigestMismatchError, downloadVerified } from "./verified-download.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "verified-download-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const body = Buffer.from("fake release bytes");
const digest = createHash("sha256").update(body).digest("hex");
const serving = (url = "") =>
  vi.fn(async () => {
    const response = new Response(body);
    Object.defineProperty(response, "url", { value: url });
    return response;
  }) as unknown as typeof fetch;

describe("downloadVerified", () => {
  it("a checksum mismatch leaves no file and no partial", async () => {
    const file = path.join(dir, "out");
    await expect(
      downloadVerified({
        url: "https://releases.test/a",
        sha256: "0".repeat(64),
        file,
        fetch: serving(),
      }),
    ).rejects.toBeInstanceOf(DownloadDigestMismatchError);
    expect(await readdir(dir)).toEqual([]);
  });

  it("keeps the file byte for byte on a match", async () => {
    const file = path.join(dir, "out");
    await downloadVerified({
      url: "https://releases.test/a",
      sha256: digest,
      file,
      fetch: serving(),
    });
    expect(await readFile(file)).toEqual(body);
    expect(await readdir(dir)).toEqual(["out"]);
  });

  it("a redirect to a host outside the allowlist is refused before writing", async () => {
    const file = path.join(dir, "out");
    await expect(
      downloadVerified({
        url: "https://releases.test/a",
        sha256: digest,
        file,
        fetch: serving("https://elsewhere.test/a"),
        allowedHosts: ["releases.test"],
      }),
    ).rejects.toThrow(/not an allowed/);
    expect(await readdir(dir)).toEqual([]);
  });

  it("http URLs are refused without a request", async () => {
    const fetchImpl = serving();
    await expect(
      downloadVerified({
        url: "http://releases.test/a",
        sha256: digest,
        file: path.join(dir, "out"),
        fetch: fetchImpl,
        allowedHosts: ["releases.test"],
      }),
    ).rejects.toThrow(/HTTPS/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
