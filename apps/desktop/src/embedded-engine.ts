import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import type { DesktopLocalStackPhase, DesktopLocalStackState } from "@corvo/contracts";
import { readPrivateFile, writePrivateFile } from "./setup-store.js";

export const ENGINE_DIR_NAME = "engine";
export const ENGINE_WEB_URL_FILE = ".desktop-web-url";
export const ENGINE_HOST_CONFIG_FILE = ".desktop-host-config";
export const ENGINE_TOKEN_FILE = ".desktop-stack-token";
export const ENGINE_SECRETS_FILE = "secrets.json";
/** The keys the person pasted for Telegram and Composio; private to the user, never sent back to the app. */
export const ENGINE_CONNECTIONS_FILE = "connections.json";
const CONNECTION_KEY_MAX_LENGTH = 4096;

export interface EngineConnections {
  composioApiKey?: string;
  telegramBotToken?: string;
}
/** A field set to a string replaces the saved key, null removes it, absent leaves it as it is. */
export type EngineConnectionsPatch = { [K in keyof EngineConnections]?: string | null };

/** The patch a window sent, with anything unknown dropped; throws when it is not a plain object. */
export function parseConnectionsPatch(value: unknown): EngineConnectionsPatch {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("That key is not valid.");
  }
  const input = value as Record<string, unknown>;
  const patch: EngineConnectionsPatch = {};
  for (const key of ["composioApiKey", "telegramBotToken"] as const) {
    const item = input[key];
    if (item === undefined) continue;
    if (item !== null && typeof item !== "string") throw new Error("That key is not valid.");
    patch[key] = item;
  }
  return patch;
}

export const ENGINE_OUTPUT_LINES = 20;
export const ENGINE_HEALTH_TIMEOUT_MS = 120_000;
export const DEFAULT_ENGINE_WEB_URL = "http://127.0.0.1:45173";

const DATABASE_NAME = "corvo";
const DATABASE_OWNER = "corvo";
const DATABASE_APP_ROLE = "corvo_app";
const POSTGRES_READY_TIMEOUT_MS = 60_000;
const MIGRATE_TIMEOUT_MS = 10 * 60_000;
const HEALTH_POLL_INTERVAL_MS = 1_000;
const STOP_GRACE_MS = 15_000;
const MAX_SECRETS_BYTES = 8 * 1024;
const ENGINE_TOKEN = /^[a-f0-9]{64}$/;

/** What a spawned process exposes; real child processes satisfy it. */
export interface EngineProcess {
  readonly pid?: number;
  readonly stdout: {
    on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  } | null;
  readonly stderr: {
    on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  } | null;
  readonly stdin: { end(data?: string): unknown } | null;
  on(event: "exit", listener: (code: number | null, signal: string | null) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export type SpawnEngineProcess = (
  command: string,
  args: string[],
  options: { cwd: string; env: Record<string, string>; stdin: boolean },
) => EngineProcess;

export interface EngineDeps {
  /** The app's engine folder under user data: the database, bot homes, secrets and logs. */
  dataDir: string;
  /** Where the bundled API, worker and migrations live; may be inside the app archive. */
  engineDir: string;
  /** Where the bundled PostgreSQL programs (`initdb`, `postgres`) live. */
  postgresBinDir: string;
  /** The program that runs the engine's JavaScript: the app's own Electron binary in node mode. */
  nodeExecutable: string;
  env: NodeJS.ProcessEnv;
  /** The system the programs are for; the running one unless a test says otherwise. */
  platform?: NodeJS.Platform;
  localWebUrl: string;
  /** Computer-access credentials for "this Mac", passed to the API as its host computer. */
  hostComputer?: { url: string; token: string };
  /** An OpenAI-compatible server on this computer, offered to the API as its local models. */
  localModels?: { url: string; models: readonly string[] };
  /**
   * The one program the API may start as an MCP server: the desktop control launcher. Stdio servers
   * stay off without it, and with it nothing else on this computer can be started that way.
   */
  desktopControlLauncher?: string;
  /**
   * Present when Docker is on this computer: the engine then runs the computer supervisor beside the
   * API, and bots get isolated Docker computers. Absent, bots have no isolated computer.
   */
  docker?: {
    /** The folder holding the computer image's files, which the supervisor builds the image from. */
    computerContext: string;
    /** Docker Desktop on macOS and Windows publishes a loopback port instead of a container address. */
    controlViaLoopback: boolean;
    /** The computer image, which the app builds before the supervisor is asked for a computer. */
    image: string;
  };
  spawn: SpawnEngineProcess;
  /** Resolves true when the engine's own web address answers its health check. */
  probe: (url: string, signal: AbortSignal) => Promise<boolean>;
  allocatePort?: () => Promise<number>;
  /** Resolves true when nothing else is listening on the address. */
  portIsFree?: (port: number) => Promise<boolean>;
  isProcessAlive?: (pid: number) => boolean;
  randomHex: (bytes: number) => string;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  healthTimeoutMs?: number;
  onState?: (state: DesktopLocalStackState) => void;
  /** Every line the engine's programs print, kept for the terminal and a log file. */
  onOutput?: (lines: readonly string[]) => void;
}

interface EngineSecrets {
  postgresPassword: string;
  appPassword: string;
  authSecret: string;
  encryptionKey: string;
  screenProxySecret: string;
}

export function engineDir(userDataDir: string): string {
  return path.join(userDataDir, ENGINE_DIR_NAME);
}

/**
 * The engine's JavaScript lives in the app's own files (`dist/engine`, inside the app archive of an
 * installed build); the database programs are a resource outside it, because they are executables.
 */
export function engineResourcePaths(input: {
  packaged: boolean;
  resourcesPath: string;
  appPath: string;
  platform?: NodeJS.Platform;
  arch?: string;
}): { engineDir: string; postgresBinDir: string; computerContextDir: string } {
  return {
    // The files the supervisor builds the isolated computer's image from.
    computerContextDir: input.packaged
      ? path.join(input.resourcesPath, "computer")
      : path.resolve(input.appPath, "..", "..", "infra", "sandboxes", "computer"),
    engineDir: path.join(input.appPath, "dist", "engine"),
    postgresBinDir: input.packaged
      ? path.join(input.resourcesPath, "postgres", "bin")
      : path.join(
          input.appPath,
          "node_modules",
          "@embedded-postgres",
          postgresPackage(input.platform ?? process.platform, input.arch ?? process.arch),
          "native",
          "bin",
        ),
  };
}

/** The `@embedded-postgres` package that carries the programs for a system. */
export function postgresPackage(platform: NodeJS.Platform, arch: string): string {
  // The macOS programs are universal: one build serves Apple Silicon and Intel.
  if (platform === "darwin") return "darwin-arm64";
  if (platform === "win32" && arch === "x64") return "windows-x64";
  if (platform === "linux" && (arch === "x64" || arch === "arm64")) return `linux-${arch}`;
  throw new Error(`The local engine does not run on ${platform} ${arch}.`);
}

/** A Postgres program's file name on a system: Windows adds `.exe`. */
export function postgresProgram(name: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? `${name}.exe` : name;
}

/**
 * How `initdb` picks collation and character handling. macOS keeps the system locale it always
 * used. Windows has no `en_US.UTF-8` and a minimal Linux may not either, so there the database
 * uses the ICU rules built into the bundled programs: English sorting that does not depend on
 * what the system has installed.
 */
export function initdbLocaleArgs(platform: NodeJS.Platform): string[] {
  return platform === "darwin"
    ? ["--locale=en_US.UTF-8"]
    : ["--locale-provider=icu", "--icu-locale=en-US", "--locale=C"];
}

export async function readEngineToken(dir: string): Promise<string | null> {
  const raw = await readPrivateFile(path.join(dir, ENGINE_TOKEN_FILE), 1024);
  const token = raw?.trim() ?? "";
  return ENGINE_TOKEN.test(token) ? token : null;
}

/** Creates an app-private identity the API uses to recognise this app, kept out of the secrets file. */
async function ensureEngineToken(dir: string, randomHex: (bytes: number) => string) {
  const existing = await readEngineToken(dir);
  if (existing !== null) return existing;
  const token = randomHex(32);
  if (!ENGINE_TOKEN.test(token)) throw new Error("Token generator returned invalid data.");
  await writePrivateFile(path.join(dir, ENGINE_TOKEN_FILE), `${token}\n`);
  return token;
}

export async function readEngineWebUrl(dir: string, fallback: string): Promise<string> {
  const raw = await readPrivateFile(path.join(dir, ENGINE_WEB_URL_FILE), 128);
  const match = raw?.match(/^http:\/\/127\.0\.0\.1:(\d{4,5})$/);
  const port = Number(match?.[1]);
  return match && port >= 1024 && port <= 65535 && raw === `http://127.0.0.1:${port}`
    ? raw
    : fallback;
}

export async function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else if (address && typeof address !== "string") resolve(address.port);
        else reject(new Error("No loopback port allocated."));
      });
    });
  });
}

export async function loopbackPortIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

export function initialEngineState(): DesktopLocalStackState {
  return { phase: "idle", message: null, output: [] };
}

function withPhase(
  state: DesktopLocalStackState,
  phase: DesktopLocalStackPhase,
): DesktopLocalStackState {
  return state.phase === phase && state.message === null
    ? state
    : { ...state, phase, message: null };
}

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/** Environment the engine's programs may inherit; everything else is set explicitly. */
const INHERITED_ENV = [
  "HOME",
  "USER",
  "PATH",
  "TMPDIR",
  // Windows programs (Postgres included) do not start without these.
  "SystemRoot",
  "SYSTEMROOT",
  "windir",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "ComSpec",
  "PATHEXT",
  "LANG",
  "LC_ALL",
  "SHELL",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "NODE_EXTRA_CA_CERTS",
] as const;

/** Calls this computer makes to itself, which no proxy should carry. */
const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "::1", "[::1]"] as const;

/**
 * How the engine's Node programs reach the network. Node trusts only its own bundled certificates,
 * so on a computer where a security program inspects HTTPS every model request fails with
 * "fetch failed"; it is asked to trust the computer's certificates too, which only adds to the set.
 * And Node's fetch ignores HTTP_PROXY and HTTPS_PROXY unless asked to read them, so when a proxy is
 * set the engine is asked to use it, with this computer's own addresses kept off it.
 */
export function engineNetworkEnv(env: Readonly<Record<string, string>>): Record<string, string> {
  const result: Record<string, string> = { NODE_USE_SYSTEM_CA: "1" };
  const proxied = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"].some((key) =>
    Boolean(env[key]?.trim()),
  );
  if (!proxied) return result;
  const bypass = [
    ...new Set([...(env.NO_PROXY ?? env.no_proxy ?? "").split(","), ...LOOPBACK_HOSTS]),
  ]
    .map((host) => host.trim())
    .filter(Boolean)
    .join(",");
  return { ...result, NODE_USE_ENV_PROXY: "1", NO_PROXY: bypass, no_proxy: bypass };
}

const START_INTERRUPTED = "Starting was interrupted. Retry.";

/**
 * Runs Rook on this computer without Docker: a PostgreSQL server, the database migrations, the
 * API and the worker, all as child processes of the app. The setup window polls `state()`.
 */
export class EmbeddedEngineController {
  private current: DesktopLocalStackState = initialEngineState();
  private currentWebUrl: string;
  private running: Promise<DesktopLocalStackState> | null = null;
  private stopping: Promise<DesktopLocalStackState> | null = null;
  private inFlight: AbortController | null = null;
  private ticket = 0;
  /** Starts ticketed at or below this were superseded by a later stop and must not run. */
  private voidBefore = 0;
  private database: EngineProcess | null = null;
  private api: EngineProcess | null = null;
  private worker: EngineProcess | null = null;
  private supervisor: EngineProcess | null = null;
  private serving = false;
  /** Set while the engine's programs are being stopped on purpose. */
  private tearingDown = false;

  constructor(private readonly deps: EngineDeps) {
    this.currentWebUrl = deps.localWebUrl;
  }

  webUrl(): string {
    return this.currentWebUrl;
  }

  state(): DesktopLocalStackState {
    return this.current;
  }

  /** True while the engine this app started is up; only then may the app trust the local address. */
  async matchesDesiredStack(url = this.currentWebUrl): Promise<boolean> {
    if (!this.serving || url !== this.currentWebUrl) return false;
    try {
      return await this.deps.probe(url, AbortSignal.timeout(HEALTH_POLL_INTERVAL_MS));
    } catch {
      return false;
    }
  }

  start(): Promise<DesktopLocalStackState> {
    if (this.running !== null) return this.running;
    const ticket = ++this.ticket;
    const attempt = (this.stopping ?? Promise.resolve())
      .then(() => (ticket <= this.voidBefore ? this.current : this.run()))
      .finally(() => {
        if (this.running === attempt) this.running = null;
      });
    this.running = attempt;
    return attempt;
  }

  /** Interrupts an attempt in progress; what already started is stopped by `stop()`. */
  abort() {
    this.inFlight?.abort();
  }

  stop(): Promise<DesktopLocalStackState> {
    this.voidBefore = this.ticket;
    if (this.stopping !== null && this.running === null) return this.stopping;
    this.abort();
    const settled = [this.stopping, this.running].map((pending) => pending?.catch(() => undefined));
    this.running = null;
    const stopping = Promise.all(settled)
      .then(() => this.runStop())
      .finally(() => {
        if (this.stopping === stopping) this.stopping = null;
      });
    this.stopping = stopping;
    return stopping;
  }

  private async runStop(): Promise<DesktopLocalStackState> {
    this.serving = false;
    this.tearingDown = true;
    // The programs that use the database stop first; the database stops last and fast, so
    // nothing is left waiting on a client and the next start finds a clean shutdown.
    await Promise.all([
      this.terminate(this.api, "SIGTERM"),
      this.terminate(this.worker, "SIGTERM"),
      this.terminate(this.supervisor, "SIGTERM"),
    ]);
    await this.terminate(this.database, "SIGINT");
    this.api = this.worker = this.supervisor = this.database = null;
    this.tearingDown = false;
    this.setState(initialEngineState());
    return this.current;
  }

  private terminate(child: EngineProcess | null, signal: NodeJS.Signals): Promise<void> {
    if (child === null) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(forced);
        resolve();
      };
      const forced = setTimeout(() => {
        child.kill("SIGKILL");
        done();
      }, STOP_GRACE_MS);
      child.on("exit", done);
      if (!child.kill(signal)) done();
    });
  }

  private pushPhase(phase: DesktopLocalStackPhase) {
    this.setState(withPhase(this.current, phase));
  }

  private fail(message: string) {
    this.setState({ ...this.current, phase: "failed", message });
  }

  private pushOutput(chunk: Buffer | string) {
    const lines = String(chunk)
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean);
    if (lines.length === 0) return;
    this.deps.onOutput?.(lines);
    const output = [...this.current.output, ...lines].slice(-ENGINE_OUTPUT_LINES);
    this.setState({ ...this.current, output });
  }

  private setState(next: DesktopLocalStackState) {
    if (next === this.current) return;
    this.current = next;
    this.deps.onState?.(next);
  }

  private async run(): Promise<DesktopLocalStackState> {
    const controller = new AbortController();
    this.inFlight = controller;
    this.setState({ ...initialEngineState() });
    // A session that ended on its own may have left its other programs running.
    await this.cleanup();
    try {
      await this.attempt(controller.signal);
    } catch (error) {
      if (this.current.phase !== "failed") {
        this.fail(controller.signal.aborted ? START_INTERRUPTED : failureMessage(error));
      }
    } finally {
      if (this.inFlight === controller) this.inFlight = null;
    }
    if (this.current.phase !== "ready") await this.cleanup();
    return this.current;
  }

  /** A failed attempt leaves nothing running. */
  private async cleanup() {
    this.serving = false;
    this.tearingDown = true;
    await Promise.all([
      this.terminate(this.api, "SIGTERM"),
      this.terminate(this.worker, "SIGTERM"),
      this.terminate(this.supervisor, "SIGTERM"),
    ]);
    await this.terminate(this.database, "SIGINT");
    this.api = this.worker = this.supervisor = this.database = null;
    this.tearingDown = false;
  }

  private get platform(): NodeJS.Platform {
    return this.deps.platform ?? process.platform;
  }

  private baseEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const key of INHERITED_ENV) {
      const value = this.deps.env[key];
      if (value !== undefined) env[key] = value;
    }
    // Postgres words its readiness line in the user's language otherwise.
    env.LC_MESSAGES = "C";
    return env;
  }

  private async attempt(signal: AbortSignal) {
    const { dataDir, engineDir: bundleDir, postgresBinDir } = this.deps;
    this.pushPhase("preparing");
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    const pgData = path.join(dataDir, "postgres");
    const appData = path.join(dataDir, "data");
    await mkdir(appData, { recursive: true, mode: 0o700 });

    const secrets = await this.ensureSecrets();
    const stackToken = await ensureEngineToken(dataDir, this.deps.randomHex);
    await this.chooseWebUrl();
    if (signal.aborted) throw new Error(START_INTERRUPTED);

    await this.stopOrphanedDatabase(pgData);
    const fresh = (await readPrivateFile(path.join(pgData, "PG_VERSION"), 16)) === null;
    if (fresh) {
      await mkdir(pgData, { recursive: true, mode: 0o700 });
      const pwfile = path.join(dataDir, ".pgpass-init");
      await writePrivateFile(pwfile, `${secrets.postgresPassword}\n`);
      await this.runToCompletion(
        path.join(postgresBinDir, postgresProgram("initdb", this.platform)),
        [
          `--pgdata=${pgData}`,
          `--username=${DATABASE_OWNER}`,
          `--pwfile=${pwfile}`,
          "--auth=scram-sha-256",
          "--encoding=UTF8",
          ...initdbLocaleArgs(this.platform),
        ],
        { cwd: dataDir, env: this.baseEnv(), stdin: false },
        signal,
        INITDB_FAILED,
      );
      // `initdb` leaves only the default databases; creating ours needs no server or client.
      await this.runToCompletion(
        path.join(postgresBinDir, postgresProgram("postgres", this.platform)),
        ["--single", "-D", pgData, "postgres"],
        { cwd: dataDir, env: this.baseEnv(), stdin: true },
        signal,
        INITDB_FAILED,
        `CREATE DATABASE ${DATABASE_NAME};\n`,
      );
    }

    this.pushPhase("starting");
    const pgPort = await (this.deps.allocatePort ?? allocateLoopbackPort)();
    await this.startDatabase(pgData, pgPort, signal);
    if (signal.aborted) throw new Error(START_INTERRUPTED);

    const urls = databaseUrls(pgPort, secrets);
    const web = new URL(this.currentWebUrl);
    // Docker computers need a supervisor that the API and worker can reach with a shared token.
    const supervisorEnv = this.deps.docker
      ? {
          NODE_ENV: "production",
          SUPERVISOR_HOST: "127.0.0.1",
          SUPERVISOR_PORT: String(await (this.deps.allocatePort ?? allocateLoopbackPort)()),
          SANDBOX_SUPERVISOR_TOKEN: this.deps.randomHex(32),
          DATA_DIR: appData,
          CORVO_COMPUTER_CONTEXT: this.deps.docker.computerContext,
          SANDBOX_CONTROL_VIA_LOOPBACK: String(this.deps.docker.controlViaLoopback),
          CORVO_COMPUTER_IMAGE: this.deps.docker.image,
          SANDBOX_COMPUTER_IMAGE_BUILD: "off",
        }
      : null;
    const connections = await this.readConnections();
    const baseEnv = this.baseEnv();
    const engineEnv: Record<string, string> = {
      ...baseEnv,
      ...engineNetworkEnv(baseEnv),
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      DATABASE_URL: urls.app,
      DATA_DIR: appData,
      BETTER_AUTH_SECRET: secrets.authSecret,
      ENCRYPTION_KEY: secrets.encryptionKey,
      SCREEN_PROXY_SECRET: secrets.screenProxySecret,
      // No web server runs in this app, so the API also serves the computer screen.
      SCREEN_PROXY_IN_API: "1",
      // Content stays on this computer, under its own disk encryption; a lost key would
      // otherwise lose every conversation. Existing ciphertext still reads.
      CONTENT_ENCRYPTION: "off",
      // Docker is not part of the app; computers come from "this Mac" through the host credentials.
      // The board is part of the app: agents and people share it from the first run.
      TICKET_BOARD_ENABLED: "true",
      SANDBOX_PROVIDER: supervisorEnv ? "docker" : "none",
      ...(supervisorEnv
        ? {
            SANDBOX_SUPERVISOR_URL: `http://127.0.0.1:${supervisorEnv.SUPERVISOR_PORT}`,
            SANDBOX_SUPERVISOR_TOKEN: supervisorEnv.SANDBOX_SUPERVISOR_TOKEN,
          }
        : {}),
      SANDBOX_HOST_URL: this.deps.hostComputer?.url ?? "",
      SANDBOX_HOST_TOKEN: this.deps.hostComputer?.token ?? "",
      ...(connections.composioApiKey ? { COMPOSIO_API_KEY: connections.composioApiKey } : {}),
      ...(connections.telegramBotToken
        ? {
            TELEGRAM_BOT_TOKEN: connections.telegramBotToken,
            // Telegram updates are polled here, but the adapter only mounts with a signing secret.
            TELEGRAM_WEBHOOK_SECRET_TOKEN: createHash("sha256")
              .update(`telegram-webhook:${secrets.authSecret}`)
              .digest("hex"),
          }
        : {}),
      ...(this.deps.localModels
        ? {
            CORVO_LOCAL_MODELS: this.deps.localModels.models.join(","),
            CORVO_LOCAL_MODELS_URL: this.deps.localModels.url,
          }
        : {}),
      ...(this.deps.desktopControlLauncher
        ? {
            MCP_STDIO_ENABLED: "true",
            MCP_STDIO_ALLOWED_COMMANDS: this.deps.desktopControlLauncher,
          }
        : {}),
      CORVO_DESKTOP_STACK_TOKEN: stackToken,
      WAKEUP_DRIVER: "graphile",
      AGENT_RUNTIME: "pi",
      API_HOST: "127.0.0.1",
      API_PORT: web.port,
      API_URL: this.currentWebUrl,
      // No account and no outside call: the app signs in to this engine itself.
      BETTER_AUTH_URL: this.currentWebUrl,
      WEB_ORIGIN: this.currentWebUrl,
    };

    await this.runToCompletion(
      this.deps.nodeExecutable,
      [path.join(bundleDir, "migrate.mjs")],
      {
        cwd: dataDir,
        env: {
          ...engineEnv,
          MIGRATIONS_DIR: path.join(bundleDir, "migrations"),
          DATABASE_MIGRATION_URL: urls.owner,
        },
        stdin: false,
      },
      signal,
      MIGRATE_FAILED,
      undefined,
      MIGRATE_TIMEOUT_MS,
    );

    if (supervisorEnv) {
      this.supervisor = this.spawnLogged(path.join(bundleDir, "supervisor.mjs"), dataDir, {
        ...this.baseEnv(),
        ELECTRON_RUN_AS_NODE: "1",
        ...supervisorEnv,
      });
      this.watchUnexpectedExit(this.supervisor, "computer supervisor");
    }
    this.api = this.spawnLogged(path.join(bundleDir, "api.mjs"), dataDir, engineEnv);
    this.worker = this.spawnLogged(path.join(bundleDir, "worker.mjs"), dataDir, engineEnv);
    this.watchUnexpectedExit(this.api, "api");
    this.watchUnexpectedExit(this.worker, "worker");

    this.pushPhase("waiting-healthy");
    const sleep = this.deps.sleep ?? defaultSleep;
    const deadline = Date.now() + (this.deps.healthTimeoutMs ?? ENGINE_HEALTH_TIMEOUT_MS);
    while (!signal.aborted && this.current.phase !== "failed") {
      if (await this.deps.probe(this.currentWebUrl, signal).catch(() => false)) {
        const identity = engineConfigIdentity(this.deps);
        await writePrivateFile(path.join(dataDir, ENGINE_HOST_CONFIG_FILE), identity ?? "");
        this.serving = true;
        this.pushPhase("ready");
        return;
      }
      if (Date.now() >= deadline) break;
      await sleep(HEALTH_POLL_INTERVAL_MS, signal);
    }
    if (this.current.phase === "failed") return;
    throw new Error(signal.aborted ? START_INTERRUPTED : HEALTH_FAILED);
  }

  /** Whether each key is saved. The keys themselves never leave this process. */
  async connectionsStatus(): Promise<{ composio: boolean; telegram: boolean }> {
    const saved = await this.readConnections();
    return { composio: Boolean(saved.composioApiKey), telegram: Boolean(saved.telegramBotToken) };
  }

  /** Saves keys for the next start; the caller restarts the engine for them to take effect. */
  async saveConnections(patch: EngineConnectionsPatch): Promise<void> {
    const next: EngineConnections = { ...(await this.readConnections()) };
    for (const key of ["composioApiKey", "telegramBotToken"] as const) {
      const value = patch[key];
      if (value === undefined) continue;
      if (value === null) {
        delete next[key];
        continue;
      }
      const clean = value.trim();
      if (!clean || clean.length > CONNECTION_KEY_MAX_LENGTH || /[\r\n\0]/.test(clean)) {
        throw new Error("That key is not valid.");
      }
      next[key] = clean;
    }
    await mkdir(this.deps.dataDir, { recursive: true, mode: 0o700 });
    await writePrivateFile(
      path.join(this.deps.dataDir, ENGINE_CONNECTIONS_FILE),
      JSON.stringify(next),
    );
  }

  private async readConnections(): Promise<EngineConnections> {
    const raw = await readPrivateFile(
      path.join(this.deps.dataDir, ENGINE_CONNECTIONS_FILE),
      64 * 1024,
    );
    if (raw === null) return {};
    try {
      const saved = JSON.parse(raw) as Record<string, unknown>;
      const out: EngineConnections = {};
      if (typeof saved.composioApiKey === "string" && saved.composioApiKey)
        out.composioApiKey = saved.composioApiKey;
      if (typeof saved.telegramBotToken === "string" && saved.telegramBotToken)
        out.telegramBotToken = saved.telegramBotToken;
      return out;
    } catch {
      return {};
    }
  }

  /** True when the engine's host-computer and local-model settings match what the running engine was given. */
  async hostConfigMatches(): Promise<boolean> {
    const identity = engineConfigIdentity(this.deps);
    const saved = await readPrivateFile(
      path.join(this.deps.dataDir, ENGINE_HOST_CONFIG_FILE),
      4096,
    );
    // No settings now matches an engine that was given none, not one that was given some.
    return (saved ?? "") === (identity ?? "");
  }

  private async ensureSecrets(): Promise<EngineSecrets> {
    const file = path.join(this.deps.dataDir, ENGINE_SECRETS_FILE);
    const raw = await readPrivateFile(file, MAX_SECRETS_BYTES);
    if (raw !== null) {
      try {
        const saved = JSON.parse(raw) as Partial<EngineSecrets>;
        if (
          typeof saved.postgresPassword === "string" &&
          typeof saved.appPassword === "string" &&
          typeof saved.authSecret === "string" &&
          typeof saved.encryptionKey === "string" &&
          typeof saved.screenProxySecret === "string"
        ) {
          return saved as EngineSecrets;
        }
      } catch {
        /* An unreadable file is replaced below only when there is no database to match it. */
      }
      throw new Error(SECRETS_UNREADABLE);
    }
    // A database without its secrets cannot be opened; never silently start over on top of it.
    if (
      (await readPrivateFile(path.join(this.deps.dataDir, "postgres", "PG_VERSION"), 16)) !== null
    ) {
      throw new Error(SECRETS_UNREADABLE);
    }
    const secrets: EngineSecrets = {
      postgresPassword: this.deps.randomHex(24),
      appPassword: this.deps.randomHex(24),
      authSecret: this.deps.randomHex(32),
      encryptionKey: Buffer.from(this.deps.randomHex(32), "hex").toString("base64"),
      screenProxySecret: this.deps.randomHex(32),
    };
    await writePrivateFile(file, `${JSON.stringify(secrets)}\n`);
    return secrets;
  }

  /** Keeps the app's address stable across launches so the saved sign-in stays valid. */
  private async chooseWebUrl() {
    const free = this.deps.portIsFree ?? loopbackPortIsFree;
    const port = Number(new URL(this.currentWebUrl).port);
    if (!(await free(port))) {
      this.currentWebUrl = `http://127.0.0.1:${await (this.deps.allocatePort ?? allocateLoopbackPort)()}`;
    }
    await writePrivateFile(path.join(this.deps.dataDir, ENGINE_WEB_URL_FILE), this.currentWebUrl);
  }

  /** A database left running by an app that crashed would hold the folder's lock. */
  private async stopOrphanedDatabase(pgData: string) {
    const raw = await readFile(path.join(pgData, "postmaster.pid"), "utf8").catch(() => null);
    const pid = Number(raw?.split("\n", 1)[0]);
    if (!Number.isInteger(pid) || pid <= 1) return;
    const alive = this.deps.isProcessAlive ?? isProcessAlive;
    if (!alive(pid)) return;
    try {
      process.kill(pid, "SIGINT");
    } catch {
      return;
    }
    const sleep = this.deps.sleep ?? defaultSleep;
    for (let waited = 0; waited < STOP_GRACE_MS && alive(pid); waited += 250) await sleep(250);
  }

  private async startDatabase(pgData: string, port: number, signal: AbortSignal) {
    const child = this.spawnLogged(
      path.join(this.deps.postgresBinDir, postgresProgram("postgres", this.platform)),
      this.deps.dataDir,
      this.baseEnv(),
      [
        "-D",
        pgData,
        "-p",
        String(port),
        "-c",
        "listen_addresses=127.0.0.1",
        "-c",
        // No Unix socket: its path has a 103-byte limit that a long user folder can pass, and the
        // engine only needs loopback TCP.
        "unix_socket_directories=",
        "-c",
        "max_connections=100",
      ],
      { raw: true },
    );
    this.database = child;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(DATABASE_FAILED)), POSTGRES_READY_TIMEOUT_MS);
      const finish = (error?: Error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      child.stderr?.on("data", (chunk) => {
        if (/ready to accept connections/.test(String(chunk))) finish();
      });
      child.on("exit", () => finish(new Error(DATABASE_FAILED)));
      child.on("error", () => finish(new Error(DATABASE_FAILED)));
      signal.addEventListener("abort", () => finish(new Error(START_INTERRUPTED)), { once: true });
    });
  }

  private spawnLogged(
    script: string,
    cwd: string,
    env: Record<string, string>,
    args?: string[],
    options?: { raw?: boolean },
  ): EngineProcess {
    const command = options?.raw ? script : this.deps.nodeExecutable;
    const child = this.deps.spawn(command, options?.raw ? (args ?? []) : [script], {
      cwd,
      env,
      stdin: false,
    });
    child.stdout?.on("data", (chunk) => this.pushOutput(chunk));
    child.stderr?.on("data", (chunk) => this.pushOutput(chunk));
    return child;
  }

  /** After the engine is up, a program that stops on its own ends the session honestly. */
  private watchUnexpectedExit(child: EngineProcess, name: string) {
    child.on("exit", () => {
      if (this.api !== child && this.worker !== child && this.supervisor !== child) return;
      if (this.stopping !== null || this.tearingDown) return;
      this.serving = false;
      this.fail(`The Rook ${name} stopped unexpectedly. Retry.`);
    });
  }

  private runToCompletion(
    command: string,
    args: string[],
    options: { cwd: string; env: Record<string, string>; stdin: boolean },
    signal: AbortSignal,
    failureText: string,
    input?: string,
    timeoutMs = 120_000,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = this.deps.spawn(command, args, options);
      child.stdout?.on("data", (chunk) => this.pushOutput(chunk));
      child.stderr?.on("data", (chunk) => this.pushOutput(chunk));
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(failureText));
      }, timeoutMs);
      const onAbort = () => {
        child.kill("SIGTERM");
        reject(new Error(START_INTERRUPTED));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      child.on("error", () => {
        clearTimeout(timer);
        reject(new Error(failureText));
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        if (code === 0) resolve();
        else reject(new Error(failureText));
      });
      if (options.stdin) child.stdin?.end(input ?? "");
    });
  }
}

const INITDB_FAILED = "Could not create the local database. Retry, and check the output below.";
const MIGRATE_FAILED = "Could not update the local database. Retry, and check the output below.";
const DATABASE_FAILED = "The local database did not start. Retry, and check the output below.";
const HEALTH_FAILED = "Rook started but did not answer. Retry, and check the output below.";
const SECRETS_UNREADABLE =
  "The saved keys for the local data cannot be read, so the data stays untouched. Restore the Corvo folder in Application Support or contact support.";

function failureMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Could not start Rook on this computer. Retry.";
}

function databaseUrls(port: number, secrets: EngineSecrets) {
  const host = `127.0.0.1:${port}/${DATABASE_NAME}`;
  return {
    owner: `postgres://${DATABASE_OWNER}:${secrets.postgresPassword}@${host}`,
    app: `postgres://${DATABASE_APP_ROLE}:${secrets.appPassword}@${host}`,
  };
}

/**
 * What the running engine was told about this computer. Null when it was told nothing, so an
 * engine started before these settings existed is not restarted for them.
 */
function engineConfigIdentity(
  deps: Pick<EngineDeps, "hostComputer" | "localModels" | "docker">,
): string | null {
  const { hostComputer, localModels } = deps;
  const docker = Boolean(deps.docker);
  if (!hostComputer && !localModels && !docker) return null;
  // Each setting joins the identity only once it exists, so an engine started before it keeps matching.
  if (docker || localModels) {
    return JSON.stringify({
      hostComputer,
      ...(localModels ? { localModels } : {}),
      ...(docker ? { docker } : {}),
    });
  }
  return JSON.stringify(hostComputer);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
