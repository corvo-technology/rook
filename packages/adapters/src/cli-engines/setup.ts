import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import type { CliEngineId, CliEngineSetup } from "@corvo/contracts";
import { findAgentBinary } from "../agent-process.js";
import { CLAUDE_ENGINE } from "../cli-engine-claude.js";
import type { CliEngineHost } from "../cli-engine-host.js";
import type { CliEngineDefinition } from "../cli-engine-parser.js";
import { DownloadDigestMismatchError } from "../verified-download.js";
import { BrowserLogin } from "./browser-login.js";
import { installCliEngine, releaseTarget } from "./install.js";
import { LoginTerminal } from "./login-terminal.js";

function isMusl(): boolean {
  try {
    return readdirSync("/lib").some((name) => name.startsWith("ld-musl-"));
  } catch {
    return false;
  }
}

/**
 * Installing a coding-agent CLI and signing it in, for the engine's own computer. Detection and
 * the sign-in check stay in the CLI engine host; this only acts, then asks the host again.
 */
export class CliEngineSetupService {
  readonly #host: CliEngineHost;
  readonly #dataDir: string;
  readonly #ownersComputer: boolean;
  readonly #engines: ReadonlyMap<CliEngineId, CliEngineDefinition>;
  readonly #fetch: typeof fetch | undefined;
  readonly #browser: BrowserLogin;
  readonly #terminal: LoginTerminal;
  #installing: Promise<"installed" | "mismatch" | "failed"> | undefined;
  readonly #script: () => Promise<string | undefined>;
  readonly #modes = new Map<string, "browser" | "terminal">();

  constructor(options: {
    host: CliEngineHost;
    dataDir: string;
    /** True on the engine the desktop app starts: sign-in then opens the system browser. */
    ownersComputer: boolean;
    engines?: readonly CliEngineDefinition[];
    fetch?: typeof fetch;
    script?: () => Promise<string | undefined>;
  }) {
    this.#host = options.host;
    this.#dataDir = options.dataDir;
    this.#ownersComputer = options.ownersComputer;
    this.#engines = new Map((options.engines ?? [CLAUDE_ENGINE]).map((e) => [e.id, e]));
    this.#fetch = options.fetch;
    this.#script = options.script ?? (() => findAgentBinary("script", ["/usr/bin", "/bin"]));
    const common = {
      spawn,
      binary: (id: CliEngineId) => options.host.binary(id),
      env: (id: CliEngineId) =>
        this.#engines.get(id)?.probeEnv({ configDir: options.host.configDir(id) }) ?? {},
      status: options.host,
    };
    this.#browser = new BrowserLogin(common);
    this.#terminal = new LoginTerminal({
      ...common,
      script: this.#script,
    });
  }

  async setup(): Promise<CliEngineSetup[]> {
    const script = this.#ownersComputer ? undefined : await this.#script();
    return [...this.#engines.keys()].map((id) => ({
      id,
      installable: releaseTarget(id, process.platform, process.arch, isMusl()) !== null,
      signIn: this.#ownersComputer ? "browser" : script ? "terminal" : null,
    }));
  }

  /** One install at a time; a second caller waits for the first. */
  install(id: CliEngineId): Promise<"installed" | "mismatch" | "failed"> {
    const engine = this.#engines.get(id);
    if (!engine) return Promise.resolve("failed");
    this.#installing ??= (async () => {
      try {
        await installCliEngine(id, engine.binaryName, {
          dataDir: this.#dataDir,
          fetch: this.#fetch,
          musl: isMusl,
        });
        await this.#host.redetect(id);
        await this.#host.refresh();
        return "installed" as const;
      } catch (error) {
        return error instanceof DownloadDigestMismatchError
          ? ("mismatch" as const)
          : ("failed" as const);
      } finally {
        this.#installing = undefined;
      }
    })();
    return this.#installing;
  }

  /** Starts the engine's own sign-in; undefined when this computer has no way to run it. */
  async signIn(
    id: CliEngineId,
  ): Promise<{ sessionId: string; mode: "browser" | "terminal" } | undefined> {
    if (!this.#engines.has(id)) return undefined;
    await mkdir(this.#host.configDir(id), { recursive: true, mode: 0o700 });
    if (this.#ownersComputer) {
      const started = await this.#browser.start(id).catch(() => undefined);
      if (!started) return undefined;
      this.#remember(started.sessionId, "browser");
      return { ...started, mode: "browser" };
    }
    const started = await this.#terminal.start(id);
    if (!started) return undefined;
    this.#remember(started.sessionId, "terminal");
    return { ...started, mode: "terminal" };
  }

  #remember(sessionId: string, mode: "browser" | "terminal"): void {
    this.#modes.set(sessionId, mode);
    if (this.#modes.size > 16) {
      const oldest = this.#modes.keys().next().value;
      if (oldest) this.#modes.delete(oldest);
    }
  }

  session(sessionId: string):
    | {
        state: "running" | "done" | "failed" | "cancelled";
        lines: string[];
        url?: string;
        error?: string;
      }
    | undefined {
    const mode = this.#modes.get(sessionId);
    if (mode === "browser") {
      const state = this.#browser.state(sessionId);
      return state ? { ...state, lines: [] } : undefined;
    }
    if (mode === "terminal") return this.#terminal.screen(sessionId);
    return undefined;
  }

  input(
    sessionId: string,
    input: { text?: string; key?: "enter" | "up" | "down" | "esc" | "tab" | "backspace" },
  ): boolean {
    if (this.#modes.get(sessionId) !== "terminal") return false;
    this.#terminal.input(sessionId, input);
    return true;
  }

  cancel(sessionId: string): boolean {
    const mode = this.#modes.get(sessionId);
    if (mode === "browser") this.#browser.cancel(sessionId);
    else if (mode === "terminal") this.#terminal.cancel(sessionId);
    return mode !== undefined;
  }
}
