import { createHash } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";

const DEFAULT_STALL_MS = 5 * 60_000;

export type DownloadVerifiedInput = {
  url: string;
  /** The digest the publisher lists for this file, lowercase hex. */
  sha256: string;
  file: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  /** A download with no data for this long counts as failed. */
  stallMs?: number;
  /** When set, only HTTPS URLs on these hosts are fetched, including after redirects. */
  allowedHosts?: readonly string[];
  /** Called with the bytes written so far; it may throw to stop the download. */
  onProgress?: (bytes: number) => void | Promise<void>;
};

/** The bytes arrived, but they are not the file the publisher listed. */
export class DownloadDigestMismatchError extends Error {
  constructor() {
    super("Download failed: the file's digest does not match the expected one.");
    this.name = "DownloadDigestMismatchError";
  }
}

function assertAllowed(url: string, allowedHosts: readonly string[]): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Download refused: the address is not valid.");
  }
  if (parsed.protocol !== "https:") throw new Error("Download refused: the address is not HTTPS.");
  if (!allowedHosts.includes(parsed.hostname)) {
    throw new Error("Download refused: the host is not an allowed release host.");
  }
}

/**
 * Streams a file into `<file>.part` while hashing it, then renames it to `file` only when the
 * SHA-256 matches. On any failure the partial file is removed, so nothing unverified is left.
 */
export async function downloadVerified(input: DownloadVerifiedInput): Promise<void> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const stallMs = input.stallMs ?? DEFAULT_STALL_MS;
  const partial = `${input.file}.part`;
  if (input.allowedHosts) assertAllowed(input.url, input.allowedHosts);
  const response = await fetchImpl(input.url, { signal: input.signal });
  if (input.allowedHosts && response.url) assertAllowed(response.url, input.allowedHosts);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (HTTP ${response.status}).`);
  }
  const reader = response.body.getReader();
  const file = await open(partial, "w");
  const hash = createHash("sha256");
  let done = 0;
  const aborted = new Promise<never>((_, reject) => {
    const stop = () => reject(new Error("Download cancelled."));
    if (input.signal?.aborted) stop();
    else input.signal?.addEventListener("abort", stop, { once: true });
  });
  aborted.catch(() => undefined);
  try {
    for (;;) {
      let timer: NodeJS.Timeout | undefined;
      const stalled = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Download stalled: no data for ${stallMs} ms.`)),
          stallMs,
        );
      });
      const next = await Promise.race([reader.read(), stalled, aborted]).finally(() =>
        clearTimeout(timer),
      );
      if (next.done) break;
      hash.update(next.value);
      await file.write(next.value);
      done += next.value.byteLength;
      await input.onProgress?.(done);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    await file.close().catch(() => undefined);
    await rm(partial, { force: true });
    throw error;
  }
  await file.close();
  if (hash.digest("hex") !== input.sha256) {
    await rm(partial, { force: true });
    throw new DownloadDigestMismatchError();
  }
  await rename(partial, input.file);
}
