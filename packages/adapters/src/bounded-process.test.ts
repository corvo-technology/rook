import { describe, expect, it } from "vitest";
import { runBounded } from "./bounded-process.js";

const node = (script: string) => [process.execPath, ["-e", script]] as const;

describe("runBounded", () => {
  it("returns exit code and output", async () => {
    const [file, args] = node(
      "process.stdout.write('out'); process.stderr.write('err'); process.exit(3)",
    );
    const result = await runBounded(file, args, { timeoutMs: 5_000 });
    expect(result).toEqual({ code: 3, stdout: "out", stderr: "err", timedOut: false });
  });

  it("kills a child that ignores SIGTERM", async () => {
    const [file, args] = node("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)");
    const started = Date.now();
    const result = await runBounded(file, args, { timeoutMs: 200 });
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  it("resolves even when a grandchild holds the pipes", async () => {
    const [file, args] = node(
      `require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { detached: true, stdio: 'inherit' }).unref()`,
    );
    const started = Date.now();
    await runBounded(file, args, { timeoutMs: 300, graceMs: 300 });
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  it("never uses a shell", async () => {
    const result = await runBounded(
      process.execPath,
      ["-e", "process.stdout.write(process.argv[1])", "$(echo pwned)"],
      { timeoutMs: 5_000 },
    );
    expect(result.stdout).toBe("$(echo pwned)");
  });
});
