import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import http from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { screenPorts } from "./computer-spec.js";

/** A computer's screen reached through this supervisor, so nothing outside its host needs the container's address. */
const GATEWAY_PREFIX = "/gateway/";
const CONTAINER_ID = /^[a-f0-9]{12,64}$/;
/** Every connection to a screen is closed after this long without a response from the computer. */
const UPSTREAM_TIMEOUT_MS = 30_000;

/** Headers that describe a hop, or this supervisor's own authority; none reaches the computer. */
const STRIPPED_REQUEST_HEADERS = new Set([
  "authorization",
  "cookie",
  "host",
  "connection",
  "keep-alive",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
]);
const STRIPPED_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "set-cookie",
  "transfer-encoding",
]);

export function gatewayEnabled(value = process.env.SANDBOX_SCREEN_GATEWAY) {
  const setting = value?.trim() || "false";
  if (setting === "true") return true;
  if (setting === "false") return false;
  throw new Error('SANDBOX_SCREEN_GATEWAY must be "true" or "false"');
}

/** The path, on this supervisor, of a computer's screen page. The caller adds its own origin. */
export function gatewayScreenPath(containerId: string) {
  return `${GATEWAY_PREFIX}${containerId}/embed.html`;
}

/** The screen page's address with a token in the place noVNC reads its socket path from. */
export function gatewayScreenPathWithToken(path: string, token: string) {
  const url = new URL(path, "http://gateway.invalid");
  url.searchParams.set("path", `websockify?token=${encodeURIComponent(token)}`);
  return `${url.pathname}${url.search}`;
}

/** The one port a computer serves its screen and terminal on. Nothing else is ever reachable. */
export function gatewayUpstreamPort() {
  return Number(screenPorts(0).viewPort);
}

/** Splits `/gateway/<container id>/<rest>?<query>`; anything else, including traversal, is null. */
export function parseGatewayUrl(url: string | undefined) {
  if (!url?.startsWith(GATEWAY_PREFIX)) return null;
  const parsed = new URL(url, "http://gateway.invalid");
  const rest = parsed.pathname.slice(GATEWAY_PREFIX.length);
  const slash = rest.indexOf("/");
  const containerId = slash < 0 ? rest : rest.slice(0, slash);
  const upstreamPath = slash < 0 ? "/" : rest.slice(slash);
  if (!CONTAINER_ID.test(containerId)) return null;
  // The browser never needs to climb out of a screen's folder, and the computer's server
  // sees the path as given, so refuse anything that could mean something else to it.
  const decoded = decodeURIComponent(upstreamPath);
  if (decoded.split("/").includes("..") || /[\\\0]/.test(decoded)) return null;
  return {
    containerId,
    upstreamPath: `${upstreamPath}${parsed.search}`,
    search: parsed.searchParams,
    pathname: upstreamPath,
  };
}

/** A websocket carries input and frames, so it must name the token the computer will check. */
export function gatewaySocketHasToken(search: URLSearchParams, pathname: string) {
  if (!pathname.endsWith("/websockify")) return true;
  return /^[A-Za-z0-9_-]{1,128}$/.test(search.get("token") ?? "");
}

export interface GatewayUpstream {
  host: string;
  port: number;
}

export type GatewayResolution =
  | { ok: true; upstream: GatewayUpstream }
  | { ok: false; status: 400 | 401 | 403 | 404 | 409 | 502; error: string };

/** Decides who may reach which computer; the caller owns the supervisor's token and Docker. */
export type GatewayResolver = (
  headers: IncomingHttpHeaders | Headers,
  target: NonNullable<ReturnType<typeof parseGatewayUrl>>,
) => Promise<GatewayResolution>;

function headerEntries(headers: IncomingHttpHeaders | Headers) {
  const entries: Array<[string, string]> = [];
  if (headers instanceof Headers) {
    for (const [key, value] of headers) entries.push([key, value]);
    return entries;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) entries.push([key, Array.isArray(value) ? value.join(", ") : value]);
  }
  return entries;
}

function forwardedHeaders(headers: IncomingHttpHeaders | Headers, upstream: GatewayUpstream) {
  const forwarded: Record<string, string> = {};
  for (const [key, value] of headerEntries(headers)) {
    const name = key.toLowerCase();
    if (STRIPPED_REQUEST_HEADERS.has(name) || name.startsWith("x-corvo-")) continue;
    forwarded[name] = value;
  }
  forwarded.host = `${upstream.host}:${upstream.port}`;
  return forwarded;
}

/** Proxies one HTTP request to the computer's screen server and streams its answer back. */
export async function proxyGatewayHttp(
  request: Request,
  target: NonNullable<ReturnType<typeof parseGatewayUrl>>,
  upstream: GatewayUpstream,
): Promise<Response> {
  return new Promise<Response>((resolve) => {
    const outgoing = http.request(
      {
        host: upstream.host,
        port: upstream.port,
        method: request.method,
        path: target.upstreamPath,
        headers: forwardedHeaders(request.headers, upstream),
        timeout: UPSTREAM_TIMEOUT_MS,
      },
      (incoming) => {
        const headers = new Headers();
        for (const [key, value] of headerEntries(incoming.headers)) {
          if (!STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) headers.append(key, value);
        }
        const status = incoming.statusCode ?? 502;
        const noBody = status === 204 || status === 304 || request.method === "HEAD";
        resolve(
          new Response(noBody ? null : (Readable.toWeb(incoming) as ReadableStream), {
            status,
            headers,
          }),
        );
        if (noBody) incoming.resume();
      },
    );
    const fail = () => {
      outgoing.destroy();
      resolve(Response.json({ error: "computer screen unavailable" }, { status: 502 }));
    };
    outgoing.once("timeout", fail);
    outgoing.once("error", fail);
    request.signal.addEventListener("abort", () => outgoing.destroy(), { once: true });
    if (request.body && request.method !== "GET" && request.method !== "HEAD") {
      Readable.fromWeb(request.body as WebReadableStream).pipe(outgoing);
    } else {
      outgoing.end();
    }
  });
}

/** Carries a websocket upgrade to the computer's screen server and then the bytes both ways. */
export function proxyGatewayUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  target: NonNullable<ReturnType<typeof parseGatewayUrl>>,
  upstream: GatewayUpstream,
) {
  const connection = net.connect(upstream.port, upstream.host);
  const close = () => {
    socket.destroy();
    connection.destroy();
  };
  connection.setTimeout(UPSTREAM_TIMEOUT_MS, close);
  connection.once("error", close);
  socket.once("error", close);
  socket.once("close", close);
  connection.once("close", close);
  connection.once("connect", () => {
    connection.setTimeout(0);
    const lines = [`${req.method ?? "GET"} ${target.upstreamPath} HTTP/1.1`];
    for (const [key, value] of Object.entries(forwardedHeaders(req.headers, upstream))) {
      lines.push(`${key}: ${value}`);
    }
    // The upgrade itself is a hop-by-hop request, so it is asked for again here.
    lines.push("connection: Upgrade");
    connection.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head.length) connection.write(head);
    socket.pipe(connection);
    connection.pipe(socket);
  });
}

/** Answers an upgrade this gateway refuses, in the form the browser's socket expects. */
export function refuseGatewayUpgrade(socket: Duplex, status: number, error: string) {
  socket.end(
    `HTTP/1.1 ${status} ${error}\r\nconnection: close\r\ncontent-length: 0\r\n\r\n`.replace(
      /[^\x20-\x7e\r\n]/g,
      "",
    ),
  );
}
