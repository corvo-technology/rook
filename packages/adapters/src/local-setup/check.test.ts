import { chmod, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalSetupCheck } from "./check.js";
import { type FoundServer, probeLoopbackServers } from "./loopback-servers.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "local-setup-"));
});
afterEach(async () => {
  vi.useRealTimers();
  await chmod(dir, 0o700).catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });

const server = (port = 11434): FoundServer => ({
  port,
  label: "Ollama",
  baseUrl: `http://127.0.0.1:${port}/v1`,
  models: ["fake-model"],
});

describe("probeLoopbackServers", () => {
  it("requests only the three loopback model lists", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return json({ data: [{ id: "fake-model" }] });
    });
    await probeLoopbackServers({
      fetch: fetchImpl as unknown as typeof fetch,
      signal: new AbortController().signal,
    });
    expect(urls.sort()).toEqual(
      [
        "http://127.0.0.1:11434/v1/models",
        "http://127.0.0.1:1234/v1/models",
        "http://127.0.0.1:8080/v1/models",
      ].sort(),
    );
  });

  it("drops a port that answers HTML or 404", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(":11434")) return json({ data: [{ id: "fake-model" }] });
      if (url.includes(":8080"))
        return new Response("<html></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      return new Response("nope", { status: 404 });
    });
    const servers = await probeLoopbackServers({
      fetch: fetchImpl as unknown as typeof fetch,
      signal: new AbortController().signal,
    });
    expect(servers.map((s) => s.port)).toEqual([11434]);
  });

  it("drops a port that redirects", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes(":1234"))
        return new Response(null, { status: 302, headers: { location: "http://127.0.0.1:9/" } });
      return new Response("nope", { status: 404 });
    });
    const servers = await probeLoopbackServers({
      fetch: fetchImpl as unknown as typeof fetch,
      signal: new AbortController().signal,
    });
    expect(servers).toEqual([]);
  });
});

describe("LocalSetupCheck", () => {
  it("current returns the kept file at construction without probing", async () => {
    const file = path.join(dir, "local-setup.json");
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        checkedAt: 7,
        servers: [{ port: 11434, models: ["fake-model"] }],
      }),
    );
    const probe = vi.fn(async () => []);
    const check = new LocalSetupCheck({ file, probe });
    expect(probe).not.toHaveBeenCalled();
    expect(check.current().findings?.servers[0]?.port).toBe(11434);
    expect(check.current().findings?.servers[0]?.baseUrl).toBe("http://127.0.0.1:11434/v1");
  });

  it("ignores a kept server on a port that is not probed", async () => {
    const file = path.join(dir, "local-setup.json");
    await writeFile(
      file,
      JSON.stringify({ version: 1, checkedAt: 7, servers: [{ port: 9999, models: ["x"] }] }),
    );
    const check = new LocalSetupCheck({ file, probe: async () => [] });
    expect(check.current().findings?.servers).toEqual([]);
  });

  it.each(["{", JSON.stringify({ version: 0 })])(
    "a corrupt or older-format file reads as nothing known",
    async (content) => {
      const file = path.join(dir, "local-setup.json");
      await writeFile(file, content);
      const check = new LocalSetupCheck({ file, probe: async () => [] });
      expect(check.current().findings).toBeNull();
    },
  );

  it("a missing file reads as nothing known", () => {
    const check = new LocalSetupCheck({ file: path.join(dir, "none.json"), probe: async () => [] });
    expect(check.current()).toEqual({ findings: null, checking: false });
  });

  it("concurrent refreshes share one probe", async () => {
    const probe = vi.fn(async () => [server()]);
    const check = new LocalSetupCheck({ file: path.join(dir, "f.json"), probe });
    const [a, b] = await Promise.all([check.refresh(), check.refresh()]);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(check.current().checking).toBe(false);
  });

  it("settles at the deadline when a probe ignores abort", async () => {
    vi.useFakeTimers();
    const probe = vi.fn(() => new Promise<FoundServer[]>(() => undefined));
    const check = new LocalSetupCheck({ file: path.join(dir, "f.json"), probe });
    const refreshed = check.refresh();
    expect(check.current().checking).toBe(true);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(check.current().checking).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    const findings = await refreshed;
    expect(findings.servers).toEqual([]);
    expect(check.current().checking).toBe(false);
  });

  it("aborts the probe's signal at the deadline and drops a late result", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    let finish: (servers: FoundServer[]) => void = () => undefined;
    const probe = (s: AbortSignal) => {
      signal = s;
      return new Promise<FoundServer[]>((resolve) => {
        finish = resolve;
      });
    };
    const check = new LocalSetupCheck({ file: path.join(dir, "f.json"), probe });
    const refreshed = check.refresh();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(signal?.aborted).toBe(true);
    finish([server()]);
    expect((await refreshed).servers).toEqual([]);
    expect(check.current().findings?.servers).toEqual([]);
  });

  it("a probe that throws counts as nothing found", async () => {
    const check = new LocalSetupCheck({
      file: path.join(dir, "f.json"),
      probe: async () => {
        throw new Error("boom");
      },
    });
    expect((await check.refresh()).servers).toEqual([]);
  });

  it("writes atomically with mode 0600", async () => {
    const file = path.join(dir, "local-setup.json");
    const check = new LocalSetupCheck({ file, probe: async () => [server()] });
    await check.refresh();
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await readdir(dir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    const reread = new LocalSetupCheck({ file, probe: async () => [] });
    expect(reread.current().findings?.servers[0]?.models).toEqual(["fake-model"]);
  });

  it("an unwritable cache does not fail the refresh", async () => {
    const readOnly = path.join(dir, "ro");
    await mkdir(readOnly);
    await chmod(readOnly, 0o500);
    const check = new LocalSetupCheck({
      file: path.join(readOnly, "local-setup.json"),
      probe: async () => [server()],
    });
    const findings = await check.refresh();
    expect(findings.servers.map((s) => s.port)).toEqual([11434]);
    expect(check.current().findings?.servers.map((s) => s.port)).toEqual([11434]);
  });
});
