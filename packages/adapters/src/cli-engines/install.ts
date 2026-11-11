import { randomUUID } from "node:crypto";
import { chmod, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { CliEngineId } from "@corvo/contracts";
import { downloadVerified } from "../verified-download.js";

/**
 * Where each engine's vendor publishes release binaries. HTTPS only, and the only hosts a
 * download may use, including after redirects.
 */
export const ENGINE_RELEASE_HOSTS: Record<CliEngineId, readonly string[]> = {
  claude: ["storage.googleapis.com"],
};

const CLAUDE_RELEASES_BASE =
  "https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases";

const SEMVER = /^\d+\.\d+\.\d+$/;
const SHA256 = /^[0-9a-f]{64}$/;
const TEXT_LIMIT_BYTES = 1024 * 1024;
const TEXT_TIMEOUT_MS = 30_000;

/** The platform name the vendor's release folders use, or null where it publishes no build. */
export function releaseTarget(
  id: CliEngineId,
  platform: NodeJS.Platform,
  arch: string,
  musl: boolean,
): string | null {
  if (id !== "claude") return null;
  const cpu = arch === "arm64" ? "arm64" : arch === "x64" ? "x64" : null;
  if (!cpu) return null;
  if (platform === "darwin") return `darwin-${cpu}`;
  if (platform === "linux") return musl ? `linux-${cpu}-musl` : `linux-${cpu}`;
  if (platform === "win32") return `win32-${cpu}`;
  return null;
}

export type ReleaseFile = { version: string; url: string; sha256: string };

/** Reads the vendor's manifest for one release. The digest comes from the vendor, never from us. */
export function parseClaudeManifest(
  json: unknown,
  version: string,
  target: string,
): ReleaseFile | null {
  if (!SEMVER.test(version)) return null;
  if (json === null || typeof json !== "object") return null;
  const platforms = (json as { platforms?: unknown }).platforms;
  if (platforms === null || typeof platforms !== "object") return null;
  const entry = (platforms as Record<string, unknown>)[target];
  const checksum =
    entry !== null && typeof entry === "object"
      ? (entry as { checksum?: unknown }).checksum
      : undefined;
  if (typeof checksum !== "string" || !SHA256.test(checksum)) return null;
  const name = target.startsWith("win32") ? "claude.exe" : "claude";
  return {
    version,
    url: `${CLAUDE_RELEASES_BASE}/${version}/${target}/${name}`,
    sha256: checksum,
  };
}

function assertReleaseUrl(id: CliEngineId, url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !ENGINE_RELEASE_HOSTS[id].includes(parsed.hostname)) {
    throw new Error("The release address is not an allowed vendor host.");
  }
}

async function readText(
  id: CliEngineId,
  url: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<string> {
  assertReleaseUrl(id, url);
  const response = await fetchImpl(url, {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(TEXT_TIMEOUT_MS)])
      : AbortSignal.timeout(TEXT_TIMEOUT_MS),
  });
  if (response.url) assertReleaseUrl(id, response.url);
  if (!response.ok) throw new Error(`Release lookup failed (HTTP ${response.status}).`);
  const text = await response.text();
  if (text.length > TEXT_LIMIT_BYTES) throw new Error("Release lookup answered too much.");
  return text;
}

export type InstallDeps = {
  dataDir: string;
  fetch?: typeof fetch;
  platform?: NodeJS.Platform;
  arch?: string;
  musl?: () => boolean;
  signal?: AbortSignal;
};

/** The engine's folder for installed builds: `<dataDir>/engines/<id>/<version>/`. */
export function installedEngineDir(dataDir: string, id: CliEngineId, version?: string): string {
  const base = path.join(dataDir, "engines", id);
  return version ? path.join(base, version) : base;
}

function binaryFileName(binaryName: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? `${binaryName}.exe` : binaryName;
}

function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
}

/** The newest build Corvo installed for an engine, or undefined when none is there. */
export async function installedEngineBinary(
  dataDir: string,
  id: CliEngineId,
  binaryName: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  const entries = await readdir(installedEngineDir(dataDir, id)).catch(() => [] as string[]);
  const versions = entries
    .filter((name) => SEMVER.test(name))
    .sort(compareVersions)
    .reverse();
  for (const version of versions) {
    const file = path.join(
      installedEngineDir(dataDir, id, version),
      binaryFileName(binaryName, platform),
    );
    if (
      await stat(file).then(
        (info) => info.isFile(),
        () => false,
      )
    )
      return file;
  }
  return undefined;
}

/**
 * Installs the vendor's own binary for an engine, checked against the SHA-256 the vendor
 * publishes for that release. The file is stored unmodified; nothing runs here, and a mismatch
 * leaves nothing installed.
 */
export async function installCliEngine(
  id: CliEngineId,
  binaryName: string,
  deps: InstallDeps,
): Promise<{ binary: string; version: string }> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const platform = deps.platform ?? process.platform;
  const target = releaseTarget(id, platform, deps.arch ?? process.arch, deps.musl?.() ?? false);
  if (!target) throw new Error("This computer has no published build of the CLI.");
  const version = (
    await readText(id, `${CLAUDE_RELEASES_BASE}/latest`, fetchImpl, deps.signal)
  ).trim();
  if (!SEMVER.test(version)) throw new Error("The latest release is not a version number.");
  const manifest: unknown = JSON.parse(
    await readText(id, `${CLAUDE_RELEASES_BASE}/${version}/manifest.json`, fetchImpl, deps.signal),
  );
  const release = parseClaudeManifest(manifest, version, target);
  if (!release) throw new Error("The release lists no checksum for this computer.");

  const root = installedEngineDir(deps.dataDir, id);
  const staging = path.join(root, `.staging-${randomUUID()}`);
  const fileName = binaryFileName(binaryName, platform);
  await mkdir(staging, { recursive: true, mode: 0o700 });
  try {
    await downloadVerified({
      url: release.url,
      sha256: release.sha256,
      file: path.join(staging, fileName),
      fetch: fetchImpl,
      signal: deps.signal,
      allowedHosts: ENGINE_RELEASE_HOSTS[id],
    });
    if (platform !== "win32") await chmod(path.join(staging, fileName), 0o755);
    const finalDir = installedEngineDir(deps.dataDir, id, version);
    await rm(finalDir, { recursive: true, force: true });
    await rename(staging, finalDir);
    return { binary: path.join(finalDir, fileName), version };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
