import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Duplex, Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
  demuxDockerFrames,
  exportArchiveArgv,
  extractWorkspaceArchive,
  importArchiveArgv,
  openWorkspaceArchive,
  resolveSupervisorHomes,
} from "./workspace-archive.js";

const dirs: string[] = [];
const temporary = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "corvo-supervisor-archive-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const frame = (stream: 1 | 2, data: string | Buffer) => {
  const payload = Buffer.from(data);
  const header = Buffer.alloc(8);
  header[0] = stream;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
};

async function collect(source: AsyncIterable<unknown>) {
  const parts: Buffer[] = [];
  for await (const part of source) parts.push(Buffer.from(part as Uint8Array));
  return Buffer.concat(parts);
}

describe("supervisor home mode", () => {
  it("defaults to a shared disk and accepts only the two modes", () => {
    expect(resolveSupervisorHomes(undefined)).toBe("local");
    expect(resolveSupervisorHomes("")).toBe("local");
    expect(resolveSupervisorHomes("remote")).toBe("remote");
    expect(() => resolveSupervisorHomes("rmeote")).toThrow("must be");
  });
});

describe("docker exec frames", () => {
  it("keeps binary payloads whole across chunk boundaries and separates stderr", async () => {
    const binary = Buffer.from([0, 255, 1, 2, 3, 128]);
    const bytes = Buffer.concat([frame(1, binary), frame(2, "warning"), frame(1, "tail")]);
    const pieces = [bytes.subarray(0, 3), bytes.subarray(3, 11), bytes.subarray(11)];
    const frames = [];
    for await (const item of demuxDockerFrames(Readable.from(pieces))) frames.push(item);
    expect(frames.map((item) => [item.stream, item.data.toString("hex")])).toEqual([
      ["stdout", binary.toString("hex")],
      ["stderr", Buffer.from("warning").toString("hex")],
      ["stdout", Buffer.from("tail").toString("hex")],
    ]);
  });

  it("rejects a stream that is not framed or ends inside a frame", async () => {
    await expect(
      collect(demuxDockerFrames(Readable.from([Buffer.from("plain text!")]))),
    ).rejects.toThrow("framing");
    await expect(
      collect(demuxDockerFrames(Readable.from([frame(1, "abcdef").subarray(0, 10)]))),
    ).rejects.toThrow("inside a frame");
  });
});

function fakeContainer(options: { output?: Buffer[]; exitCode?: number }) {
  const stdin: Buffer[] = [];
  const execs: Array<{ Cmd: string[]; AttachStdin?: boolean }> = [];
  const container = {
    exec: async (config: { Cmd: string[]; AttachStdin?: boolean }) => {
      execs.push(config);
      return {
        start: async () => {
          // Writes are tar's stdin; the command's output arrives once stdin closes.
          const stream = new Duplex({
            read() {},
            write(chunk: Buffer, _encoding, done) {
              stdin.push(chunk);
              done();
            },
            final(done) {
              for (const piece of options.output ?? []) stream.push(piece);
              stream.push(null);
              done();
            },
          });
          if (!execs.at(-1)?.AttachStdin) {
            setImmediate(() => {
              for (const piece of options.output ?? []) stream.push(piece);
              stream.push(null);
            });
          }
          return stream;
        },
        inspect: async () => ({ ExitCode: options.exitCode ?? 0 }),
      };
    },
  };
  return { container: container as never, stdin, execs };
}

describe("streaming a home out", () => {
  it("passes the archive bytes through as they arrive", async () => {
    const { container, execs } = fakeContainer({ output: [frame(1, "abc"), frame(1, "def")] });
    const body = await openWorkspaceArchive(container);
    expect((await collect(body)).toString()).toBe("abcdef");
    expect(execs[0]?.Cmd[0]).toBe("bash");
  });

  it("errors the stream when the command fails, so a cut-short archive is not taken for a whole one", async () => {
    const { container } = fakeContainer({
      output: [frame(1, "abc"), frame(2, "tar: cannot read")],
      exitCode: 2,
    });
    await expect(collect(await openWorkspaceArchive(container))).rejects.toThrow(
      "tar: cannot read",
    );
  });
});

describe("streaming a home in", () => {
  const body = (text: string) =>
    new Response(text).body as unknown as Parameters<typeof extractWorkspaceArchive>[1];

  it("writes the archive to tar's stdin and finishes when tar exits cleanly", async () => {
    const { container, stdin, execs } = fakeContainer({});
    await extractWorkspaceArchive(container, body("archive bytes"));
    expect(Buffer.concat(stdin).toString()).toBe("archive bytes");
    expect(execs[0]).toMatchObject({ AttachStdin: true });
    expect(execs[0]?.Cmd).toEqual(importArchiveArgv());
  });

  it("fails with tar's own message when it exits non-zero", async () => {
    const { container } = fakeContainer({ output: [frame(2, "tar: Unexpected EOF")], exitCode: 2 });
    await expect(extractWorkspaceArchive(container, body("short"))).rejects.toThrow(
      "tar: Unexpected EOF",
    );
  });
});

const hasGnuTar = spawnSync("tar", ["--version"]).stdout?.toString().includes("GNU tar") ?? false;

describe.skipIf(!hasGnuTar)("the archive commands against real tar", () => {
  /** Runs an exec argv with `/home/corvo` replaced by a temporary directory. */
  function run(argv: string[], home: string, input?: Buffer) {
    const rewritten = argv.map((part) => part.replaceAll("/home/corvo", home));
    return new Promise<{ code: number | null; stdout: Buffer }>((resolve, reject) => {
      const child = spawn(rewritten[0]!, rewritten.slice(1), { stdio: ["pipe", "pipe", "pipe"] });
      const out: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, stdout: Buffer.concat(out) }));
      child.stdin.end(input);
    });
  }

  const list = (archive: Buffer) =>
    spawnSync("tar", ["--list", "--gzip"], { input: archive })
      .stdout.toString()
      .split("\n")
      .filter(Boolean)
      .sort();

  it("exports regular files, skipping browser caches and links, and imports them back", async () => {
    const home = temporary();
    mkdirSync(path.join(home, "notes"), { recursive: true });
    writeFileSync(path.join(home, "notes", "todo.txt"), "write the report");
    writeFileSync(path.join(home, "-dash.txt"), "starts with a dash");
    mkdirSync(path.join(home, ".browser-profiles", "chromium-bot-1", "Default", "Cache"), {
      recursive: true,
    });
    writeFileSync(
      path.join(home, ".browser-profiles", "chromium-bot-1", "Default", "Cache", "x"),
      "cache",
    );
    writeFileSync(
      path.join(home, ".browser-profiles", "chromium-bot-1", "Default", "Cookies"),
      "login",
    );
    writeFileSync(path.join(home, ".browser-profiles", "chromium-bot-1", "SingletonLock"), "lock");
    symlinkSync("/etc/passwd", path.join(home, "link-out"));

    const exported = await run(exportArchiveArgv(), home);
    expect(exported.code).toBe(0);
    expect(list(exported.stdout)).toEqual([
      "./-dash.txt",
      "./.browser-profiles/chromium-bot-1/Default/Cookies",
      "./notes/todo.txt",
    ]);

    const fresh = temporary();
    const imported = await run(importArchiveArgv(), fresh, exported.stdout);
    expect(imported.code).toBe(0);
    const files = spawnSync("find", [fresh, "-type", "f"])
      .stdout.toString()
      .split("\n")
      .filter(Boolean);
    expect(files.map((file) => path.relative(fresh, file)).sort()).toEqual([
      "-dash.txt",
      ".browser-profiles/chromium-bot-1/Default/Cookies",
      "notes/todo.txt",
    ]);
  });

  it("exits non-zero when the home cannot be entered", async () => {
    const result = await run(exportArchiveArgv(), path.join(temporary(), "missing"));
    expect(result.code).not.toBe(0);
  });
});
