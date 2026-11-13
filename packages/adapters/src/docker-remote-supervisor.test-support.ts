import { readWorkspaceArchive } from "./workspace-archive.js";
import { workspaceArchive } from "./workspace-archive.test-support.js";

async function* bytes(body: ReadableStream<Uint8Array>) {
  yield* body as unknown as AsyncIterable<Uint8Array>;
}

/**
 * A supervisor that keeps the homes on its own host, as `fetch`: it answers its health check as
 * a remote one, makes a computer per bot, and serves and accepts each home as a gzipped tar.
 * `disk` is that host's storage by bot id; losing the host is clearing it.
 */
export function fakeRemoteSupervisor() {
  const disk = new Map<string, Map<string, { content: Uint8Array; executable: boolean }>>();
  const provisions: Array<Record<string, unknown>> = [];
  const requests: string[] = [];
  const botOf = (url: string) => /\/computers\/c-([^/]+)\//.exec(url)?.[1] ?? "";
  const fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push(`${method} ${new URL(url).pathname}`);
    if (url.endsWith("/health")) return Response.json({ ok: true, homes: "remote" });
    if (url.endsWith("/computers") && method === "POST") {
      const body = JSON.parse(String(init?.body)) as { botId: string };
      provisions.push(body);
      const resumed = disk.has(body.botId);
      if (!resumed) disk.set(body.botId, new Map());
      return Response.json({ id: `c-${body.botId}`, resumed });
    }
    const home = disk.get(botOf(url));
    if (!home) return Response.json({ error: "computer not found" }, { status: 404 });
    if (url.endsWith("/archive") && method === "GET") {
      return new Response(new Uint8Array(workspaceArchive(home)), {
        headers: { "content-type": "application/gzip" },
      });
    }
    if (url.endsWith("/archive") && method === "PUT") {
      for await (const file of readWorkspaceArchive(bytes(init?.body as ReadableStream))) {
        if ("body" in file) throw new Error("test archives hold only small files");
        home.set(file.path, { content: file.content, executable: file.executable === true });
      }
      return Response.json({ ok: true });
    }
    return Response.json({ error: "unexpected" }, { status: 500 });
  };
  const write = (botId: string, files: Record<string, string>) => {
    const home = disk.get(botId) ?? new Map();
    disk.set(botId, home);
    for (const [name, content] of Object.entries(files)) {
      home.set(name, { content: Buffer.from(content), executable: false });
    }
  };
  const read = (botId: string): Record<string, string> =>
    Object.fromEntries(
      [...(disk.get(botId) ?? [])].map(([name, file]) => [
        name,
        Buffer.from(file.content).toString(),
      ]),
    );
  return { fetch, disk, provisions, requests, write, read };
}
