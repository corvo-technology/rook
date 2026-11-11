import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import type { AgentRuntime } from "@corvo/adapter-kit";
import type {
  CliEngineId,
  CliEngineState,
  CliEngineStatus,
  CliEnginesView,
  ModelCatalogEntry,
} from "@corvo/contracts";
import { CLI_ENGINE_PROVIDER_ID, cliEngineModelId } from "@corvo/contracts";
import { CLI_ENGINE_RUN_ERRORS } from "@corvo/core";
import { findAgentBinary } from "./agent-process.js";
import type { CliEngineDefinition } from "./cli-engine-parser.js";
import type { CliEngineLocator } from "./cli-engine-runtime.js";
import { installedEngineBinary } from "./cli-engines/install.js";

const VIEW_TTL_MS = 60_000;
const PROBE_TIMEOUT_MS = 15_000;
const PROBE_OUTPUT_LIMIT = 64 * 1024;

/** Where Corvo keeps an engine's own sign-in and settings, apart from the person's own setup. */
export function cliEngineConfigDir(dataDir: string, id: CliEngineId): string {
  return path.join(dataDir, "engines", id, "config");
}

type Probe = (
  binary: string,
  args: string[],
  env: Record<string, string>,
) => Promise<{ code: number; stdout: string }>;

/** Runs a status command with a time limit that stops its whole process group. */
const runProbe: Probe = (binary, args, env) =>
  new Promise((resolve) => {
    let stdout = "";
    let done = false;
    const finish = (code: number) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, stdout });
    };
    const child = spawn(binary, args, {
      env,
      stdio: ["ignore", "pipe", "ignore"],
      detached: true,
    });
    const timer = setTimeout(() => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      finish(-1);
    }, PROBE_TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < PROBE_OUTPUT_LIMIT) stdout += chunk.toString("utf8");
    });
    child.once("error", () => finish(-1));
    child.once("close", (code) => finish(code ?? -1));
  });

/** Finds each engine's CLI, reads its status, and offers its models where it is ready. */
export class CliEngineHost implements CliEngineLocator {
  private readonly engines: ReadonlyMap<CliEngineId, CliEngineDefinition>;
  private readonly dataDir: string;
  private readonly probe: Probe;
  private readonly now: () => number;
  private readonly locate: (engine: CliEngineDefinition) => Promise<string | undefined>;
  private binaries = new Map<CliEngineId, string>();
  private last: { view: CliEnginesView; at: number } | undefined;
  private refreshing: Promise<CliEnginesView> | undefined;
  private locating = new Map<CliEngineId, Promise<string | undefined>>();

  constructor(options: {
    dataDir: string;
    engines: readonly CliEngineDefinition[];
    run?: Probe;
    now?: () => number;
    /** How a binary is found; tests inject it, otherwise PATH and the engine's install folders. */
    locate?: (engine: CliEngineDefinition) => Promise<string | undefined>;
  }) {
    this.engines = new Map(options.engines.map((engine) => [engine.id, engine]));
    this.dataDir = options.dataDir;
    this.probe = options.run ?? runProbe;
    this.now = options.now ?? Date.now;
    this.locate =
      options.locate ??
      (async (engine) =>
        (await findAgentBinary(engine.binaryName, engine.installDirs(os.homedir()))) ??
        // A build Corvo installed itself, for a machine that has none of its own.
        installedEngineBinary(options.dataDir, engine.id, engine.binaryName));
  }

  configDir(id: CliEngineId): string {
    return cliEngineConfigDir(this.dataDir, id);
  }

  turnsDir(id: CliEngineId): string {
    return path.join(this.dataDir, "engines", id, "turns");
  }

  async binary(id: CliEngineId): Promise<string | undefined> {
    return this.binaries.get(id) ?? this.redetect(id);
  }

  /** One detection at a time per engine; turns that hit a moved binary together share it. */
  redetect(id: CliEngineId): Promise<string | undefined> {
    const engine = this.engines.get(id);
    if (!engine) return Promise.resolve(undefined);
    const running = this.locating.get(id);
    if (running) return running;
    const next = this.locate(engine)
      .then((binary) => {
        if (binary) this.binaries.set(id, binary);
        else this.binaries.delete(id);
        return binary;
      })
      .finally(() => this.locating.delete(id));
    this.locating.set(id, next);
    return next;
  }

  async ready(id: CliEngineId): Promise<CliEngineState> {
    const view = await this.view();
    return view.engines.find((engine) => engine.id === id)?.state ?? "missing";
  }

  async view(): Promise<CliEnginesView> {
    if (this.last && this.now() - this.last.at < VIEW_TTL_MS) return this.last.view;
    return this.refresh();
  }

  refresh(): Promise<CliEnginesView> {
    this.refreshing ??= this.detect().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  /** From the last detection, so it can answer where a lookup cannot wait. */
  offers(modelId: string): boolean {
    return (
      this.last?.view.engines.some(
        (engine) => engine.state === "ready" && engine.models.includes(modelId),
      ) ?? false
    );
  }

  catalog(): ModelCatalogEntry[] {
    return (this.last?.view.engines ?? []).flatMap((status) => {
      const engine = this.engines.get(status.id);
      if (!engine || status.state !== "ready") return [];
      return engine.models.map((model) => ({
        provider: CLI_ENGINE_PROVIDER_ID,
        providerName: engine.displayName,
        id: cliEngineModelId(engine.id, model),
        label: model.charAt(0).toUpperCase() + model.slice(1),
        billing: `${engine.displayName} plan`,
        managed: true,
      }));
    });
  }

  private async detect(): Promise<CliEnginesView> {
    const engines = await Promise.all(
      [...this.engines.values()].map((engine) => this.status(engine)),
    );
    const view: CliEnginesView = { enabled: true, engines };
    this.last = { view, at: this.now() };
    return view;
  }

  private async status(engine: CliEngineDefinition): Promise<CliEngineStatus> {
    const checkedAt = new Date(this.now()).toISOString();
    const binary = await this.redetect(engine.id);
    if (!binary) return { id: engine.id, state: "missing", version: null, models: [], checkedAt };
    const env = engine.probeEnv({ configDir: this.configDir(engine.id) });
    const [version, auth] = await Promise.all([
      this.probe(binary, engine.statusArgs.version, env),
      this.probe(binary, engine.statusArgs.auth, env),
    ]);
    const { state, version: found } = engine.status({ version, auth });
    return {
      id: engine.id,
      state,
      version: found,
      models:
        state === "ready" ? engine.models.map((model) => cliEngineModelId(engine.id, model)) : [],
      checkedAt,
    };
  }
}

let installed: CliEngineHost | undefined;

/** Composition roots install the host once; without it, no CLI engine is offered. */
export function installCliEngineHost(host: CliEngineHost | undefined): void {
  installed = host;
}

export function cliEngineHost(): CliEngineHost | undefined {
  return installed;
}

/** Sends runs of CLI-engine models to the CLI runtime, and everything else to the base one. */
export function routeAgentRuntime(base: AgentRuntime, cli: AgentRuntime | undefined): AgentRuntime {
  return {
    describe: () => base.describe(),
    run(request, context) {
      if (request.model.provider !== CLI_ENGINE_PROVIDER_ID) return base.run(request, context);
      if (!cli) throw new Error(CLI_ENGINE_RUN_ERRORS.claude.missing);
      return cli.run(request, context);
    },
    async abort(runId) {
      await Promise.all([base.abort(runId), cli?.abort(runId)]);
    },
  };
}
