import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import {
  SKIPPED_BROWSER_PROFILE_DIRECTORIES,
  SKIPPED_BROWSER_PROFILE_FILES,
} from "@corvo/core/node/workspace-skips";
import type Docker from "dockerode";

const HOME = "/home/corvo";
const ENV = [`HOME=${HOME}`, "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"];
const MAX_STDERR_CHARS = 4096;

/** Where a supervisor keeps the computer homes: next to Compose (`local`) or on its own host. */
export type SupervisorHomes = "local" | "remote";

export function resolveSupervisorHomes(value = process.env.SANDBOX_SUPERVISOR_HOMES) {
  const mode = value?.trim() || "local";
  if (mode === "local" || mode === "remote") return mode;
  throw new Error('SANDBOX_SUPERVISOR_HOMES must be "local" or "remote"');
}

/**
 * Archives every regular file of the home as a gzipped pax tar on stdout, without the browser
 * state exports skip. The same walk as an export through the API chooses the files, so a symbolic
 * link is never selected and tar stores hard links as files. A file that changed while it was read
 * is tolerated (tar exits 1); any other failure exits non-zero.
 */
export function exportArchiveArgv(): string[] {
  const names = (set: ReadonlySet<string>) =>
    [...set].flatMap((name, index) => (index ? ["-o", "-name", name] : ["-name", name]));
  const profiles = "./.browser-profiles/*";
  const expression = [
    ...["(", "-type", "d", "-path", profiles, "(", ...names(SKIPPED_BROWSER_PROFILE_DIRECTORIES)],
    ...[")", "-prune", ")", "-o"],
    ...["(", "-type", "f", "-path", profiles, "(", ...names(SKIPPED_BROWSER_PROFILE_FILES), ")"],
    ...[")", "-o", "-type", "f", "-printf", "%p\\0"],
  ];
  const script = [
    `cd ${HOME} || exit 2`,
    // Names start with ./, so tar never reads one as an option.
    'find . -mindepth 1 "$@" | tar --create --format=pax --null --no-recursion --hard-dereference --files-from=- --use-compress-program="gzip -1" --file=-',
    'status="${PIPESTATUS[1]}"',
    'if [ "$status" -eq 1 ]; then status=0; fi',
    'exit "$status"',
  ].join("\n");
  return ["bash", "-c", script, "corvo-archive", ...expression];
}

/** Extracts a gzipped tar from stdin into the home, owned by the computer's user. */
export function importArchiveArgv(): string[] {
  return ["tar", "--extract", "--gzip", "--no-same-owner", "--directory", HOME, "--file=-"];
}

/**
 * The frames of a Docker exec stream, which is multiplexed when the exec has no terminal: an
 * 8-byte header (stream, three zero bytes, big-endian length) before each payload. Unlike the
 * string demuxer, payloads stay bytes, because an archive is binary.
 */
export async function* demuxDockerFrames(
  source: AsyncIterable<Buffer | Uint8Array | string>,
): AsyncGenerator<{ stream: "stdout" | "stderr"; data: Buffer }> {
  let pending = Buffer.alloc(0);
  for await (const chunk of source) {
    pending = Buffer.concat([pending, typeof chunk === "string" ? Buffer.from(chunk) : chunk]);
    while (pending.length >= 8) {
      const kind = pending[0];
      const length = pending.readUInt32BE(4);
      if ((kind !== 1 && kind !== 2) || pending[1] !== 0 || pending[2] !== 0 || pending[3] !== 0) {
        throw new Error("unexpected Docker stream framing");
      }
      if (pending.length < 8 + length) break;
      const data = pending.subarray(8, 8 + length);
      pending = pending.subarray(8 + length);
      if (length) yield { stream: kind === 1 ? "stdout" : "stderr", data };
    }
  }
  if (pending.length) throw new Error("Docker stream ended inside a frame");
}

async function execStream(container: Docker.Container, cmd: string[], options: { stdin: boolean }) {
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdin: options.stdin,
    AttachStdout: true,
    AttachStderr: true,
    WorkingDir: HOME,
    Env: ENV,
  });
  const stream = await exec.start({ hijack: true, stdin: options.stdin });
  return { exec, stream };
}

function failure(stderr: string, code: number, what: string) {
  return new Error(stderr.trim() || `${what} failed with status ${code}`);
}

/**
 * The home as a gzipped tar the caller reads while it is produced. The stream errors, instead of
 * ending cleanly, when the archive command fails, so a cut-short archive is never mistaken for a
 * whole one. Closing the stream stops the command.
 */
export async function openWorkspaceArchive(
  container: Docker.Container,
): Promise<WebReadableStream> {
  const { exec, stream } = await execStream(container, exportArchiveArgv(), { stdin: false });
  async function* archive() {
    let stderr = "";
    try {
      for await (const frame of demuxDockerFrames(stream)) {
        if (frame.stream === "stdout") yield frame.data;
        else if (stderr.length < MAX_STDERR_CHARS) stderr += frame.data.toString("utf8");
      }
      const code = (await exec.inspect()).ExitCode ?? 0;
      if (code !== 0) throw failure(stderr, code, "workspace archive");
    } finally {
      stream.destroy();
    }
  }
  return Readable.toWeb(Readable.from(archive()));
}

/** Streams a gzipped tar into the home. Resolves once tar has finished and exited cleanly. */
export async function extractWorkspaceArchive(
  container: Docker.Container,
  body: WebReadableStream,
): Promise<void> {
  const { exec, stream } = await execStream(container, importArchiveArgv(), { stdin: true });
  let stderr = "";
  const output = (async () => {
    for await (const frame of demuxDockerFrames(stream)) {
      if (frame.stream === "stderr" && stderr.length < MAX_STDERR_CHARS) {
        stderr += frame.data.toString("utf8");
      }
    }
  })();
  const source = Readable.fromWeb(body);
  try {
    await new Promise<void>((resolve, reject) => {
      source.once("error", reject);
      stream.once("error", reject);
      source.once("end", () => {
        // Closing stdin tells tar the archive is complete.
        stream.end();
        resolve();
      });
      source.pipe(stream, { end: false });
    });
    await output;
  } catch (error) {
    stream.destroy();
    source.destroy();
    await output.catch(() => undefined);
    throw error;
  }
  const code = (await exec.inspect()).ExitCode ?? 0;
  if (code !== 0) throw failure(stderr, code, "workspace import");
}
