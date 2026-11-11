import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EngineDeps, EngineProcess } from "./embedded-engine.js";
import {
  EmbeddedEngineController,
  engineResourcePaths,
  initdbLocaleArgs,
  parseConnectionsPatch,
  postgresPackage,
  postgresProgram,
  readEngineToken,
  readEngineWebUrl,
} from "./embedded-engine.js";

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdinWritten: string | null = null;
  stdin = {
    end: (data?: string) => {
      this.stdinWritten = data ?? "";
    },
  };
  signals: string[] = [];
  exited = false;
  constructor(
    readonly command: string,
    readonly args: string[],
    readonly env: Record<string, string>,
  ) {
    super();
  }
  kill(signal: NodeJS.Signals = "SIGTERM") {
    this.signals.push(signal);
    killLog.push(`${path.basename(this.args[0] ?? this.command)}:${signal}`);
    queueMicrotask(() => this.exit(0));
    return true;
  }
  exit(code: number) {
    if (this.exited) return;
    this.exited = true;
    this.emit("exit", code, null);
  }
}

let dir: string;
let children: FakeChild[];
let failScript: string | null;
let killLog: string[];

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "corvo-engine-"));
  children = [];
  killLog = [];
  failScript = null;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** The supervisor takes the first port the engine allocates after the database's. */
const supervisorPort = () => 54_002;

const base = (child: FakeChild) => path.basename(child.args[0] ?? child.command);

function deps(overrides: Partial<EngineDeps> = {}): EngineDeps {
  let counter = 0;
  return {
    dataDir: path.join(dir, "engine"),
    engineDir: "/app/engine",
    postgresBinDir: "/app/postgres/bin",
    nodeExecutable: "/app/Rook",
    env: { HOME: "/Users/test", PATH: "/usr/bin", SECRET_TOKEN: "must-not-leak" },
    localWebUrl: "http://127.0.0.1:45173",
    spawn: (command, args, options) => {
      const child = new FakeChild(command, args, options.env);
      children.push(child);
      const name =
        path.basename(command) === "Rook"
          ? base(child)
          : path.basename(command).replace(/\.exe$/, "");
      queueMicrotask(() => {
        if (name === "postgres" && !args.includes("--single")) {
          child.stderr.emit("data", "LOG:  database system is ready to accept connections\n");
        } else if (name === "api.mjs" || name === "worker.mjs" || name === "supervisor.mjs") {
          child.stdout.emit("data", `${name} started\n`);
        } else {
          child.exit(failScript === name ? 1 : 0);
        }
      });
      return child as unknown as EngineProcess;
    },
    probe: async () => true,
    allocatePort: async () => 54_000 + ++counter,
    portIsFree: async () => true,
    isProcessAlive: () => false,
    randomHex: (bytes) => "ab".repeat(bytes),
    sleep: async () => undefined,
    ...overrides,
  };
}

describe("EmbeddedEngineController", () => {
  it("starts the database, migrates it, then runs the API and worker", async () => {
    const phases: string[] = [];
    const engine = new EmbeddedEngineController(
      deps({
        onState: (s) => {
          if (phases.at(-1) !== s.phase) phases.push(s.phase);
        },
      }),
    );
    const state = await engine.start();

    expect(state.phase).toBe("ready");
    expect(phases).toEqual(["idle", "preparing", "starting", "waiting-healthy", "ready"]);
    expect(
      children.map((child) => `${path.basename(child.command)} ${child.args[0] ?? ""}`),
    ).toEqual([
      expect.stringContaining("initdb"),
      expect.stringContaining("postgres --single"),
      expect.stringContaining("postgres -D"),
      "Rook /app/engine/migrate.mjs",
      "Rook /app/engine/api.mjs",
      "Rook /app/engine/worker.mjs",
    ]);
    expect(children[1]?.stdinWritten).toBe("CREATE DATABASE corvo;\n");
    expect(children[2]?.args).toContain("unix_socket_directories=");
    expect(await engine.matchesDesiredStack()).toBe(true);
  });

  it("hands every line the programs print to the log, not only the last few", async () => {
    const printed: string[] = [];
    const engine = new EmbeddedEngineController(
      deps({ onOutput: (lines) => printed.push(...lines) }),
    );
    await engine.start();
    children.find((child) => base(child) === "api.mjs")?.stdout.emit("data", "one\ntwo\r\n\n");
    expect(printed).toEqual(expect.arrayContaining(["api.mjs started", "one", "two"]));
  });

  it("offers the local model server to the API and notices when its address changes", async () => {
    const localModels = {
      url: "http://127.0.0.1:45900/secret/v1",
      models: ["opencode/big-pickle", "opencode/glm-free"],
    };
    const engine = new EmbeddedEngineController(deps({ localModels }));
    await engine.start();
    const api = children.find((child) => base(child) === "api.mjs");
    expect(api?.env).toMatchObject({
      CORVO_LOCAL_MODELS: "opencode/big-pickle,opencode/glm-free",
      CORVO_LOCAL_MODELS_URL: "http://127.0.0.1:45900/secret/v1",
    });
    expect(await engine.hostConfigMatches()).toBe(true);
    const moved = new EmbeddedEngineController(
      deps({ localModels: { ...localModels, url: "http://127.0.0.1:45901/secret/v1" } }),
    );
    expect(await moved.hostConfigMatches()).toBe(false);
  });

  it("gives the API the saved Telegram and Composio keys, and reports only whether each is set", async () => {
    const engine = new EmbeddedEngineController(deps());
    expect(await engine.connectionsStatus()).toEqual({ composio: false, telegram: false });
    await engine.saveConnections({ composioApiKey: " ck_test ", telegramBotToken: "123:abc" });
    expect(await engine.connectionsStatus()).toEqual({ composio: true, telegram: true });
    await engine.start();
    const api = children.find((child) => base(child) === "api.mjs");
    expect(api?.env).toMatchObject({ COMPOSIO_API_KEY: "ck_test", TELEGRAM_BOT_TOKEN: "123:abc" });
    // Telegram refuses unsigned updates, so the engine signs them with a secret of its own.
    expect(api?.env.TELEGRAM_WEBHOOK_SECRET_TOKEN).toMatch(/^[0-9a-f]{32,}$/);
    const worker = children.find((child) => base(child) === "worker.mjs");
    expect(worker?.env.TELEGRAM_BOT_TOKEN).toBe("123:abc");
  });

  it("leaves the keys out when none is saved, and removes one when asked", async () => {
    const engine = new EmbeddedEngineController(deps());
    await engine.saveConnections({ telegramBotToken: "123:abc" });
    await engine.saveConnections({ telegramBotToken: null });
    expect(await engine.connectionsStatus()).toEqual({ composio: false, telegram: false });
    await engine.start();
    const api = children.find((child) => base(child) === "api.mjs");
    expect(api?.env).not.toHaveProperty("TELEGRAM_BOT_TOKEN");
    expect(api?.env).not.toHaveProperty("COMPOSIO_API_KEY");
  });

  it("refuses a key that is empty, too long or has line breaks", async () => {
    const engine = new EmbeddedEngineController(deps());
    for (const bad of ["   ", "a".repeat(5000), "abc\ndef"]) {
      await expect(engine.saveConnections({ composioApiKey: bad })).rejects.toThrow();
    }
  });

  it("reads a patch from a window and drops anything it does not know", () => {
    expect(parseConnectionsPatch({ telegramBotToken: "1:a", extra: "x" })).toEqual({
      telegramBotToken: "1:a",
    });
    expect(parseConnectionsPatch({ composioApiKey: null })).toEqual({ composioApiKey: null });
    expect(() => parseConnectionsPatch({ composioApiKey: 5 })).toThrow();
    expect(() => parseConnectionsPatch("key")).toThrow();
    expect(() => parseConnectionsPatch(null)).toThrow();
  });

  it("lets the API start the desktop control launcher and nothing else as an MCP server", async () => {
    const launcher = "/data/tools/desktop-control/launch.sh";
    const engine = new EmbeddedEngineController(deps({ desktopControlLauncher: launcher }));
    await engine.start();
    const api = children.find((child) => base(child) === "api.mjs");
    expect(api?.env).toMatchObject({
      MCP_STDIO_ENABLED: "true",
      MCP_STDIO_ALLOWED_COMMANDS: launcher,
    });
  });

  it("runs isolated Docker computers when Docker is there, and gives the API the supervisor's address", async () => {
    const docker = {
      computerContext: "/app/computer",
      controlViaLoopback: true,
      image: "corvo/computer:app-abc123",
    };
    const engine = new EmbeddedEngineController(deps({ docker }));
    await engine.start();
    const supervisor = children.find((child) => base(child) === "supervisor.mjs");
    expect(supervisor?.env).toMatchObject({
      NODE_ENV: "production",
      SUPERVISOR_HOST: "127.0.0.1",
      SUPERVISOR_PORT: String(supervisorPort()),
      SANDBOX_SUPERVISOR_TOKEN: "ab".repeat(32),
      CORVO_COMPUTER_CONTEXT: "/app/computer",
      SANDBOX_CONTROL_VIA_LOOPBACK: "true",
      // The app builds the image itself; the supervisor must not try, and say so when it is not ready.
      CORVO_COMPUTER_IMAGE: "corvo/computer:app-abc123",
      SANDBOX_COMPUTER_IMAGE_BUILD: "off",
    });
    expect(supervisor?.env.DATA_DIR).toBe(path.join(dir, "engine", "data"));
    expect(supervisor?.env.SECRET_TOKEN).toBeUndefined();
    for (const name of ["api.mjs", "worker.mjs"]) {
      const child = children.find((c) => base(c) === name);
      expect(child?.env).toMatchObject({
        SANDBOX_PROVIDER: "docker",
        SANDBOX_SUPERVISOR_URL: `http://127.0.0.1:${supervisorPort()}`,
        SANDBOX_SUPERVISOR_TOKEN: "ab".repeat(32),
      });
    }
    // The supervisor is up before the programs that call it.
    expect(children.findIndex((c) => base(c) === "supervisor.mjs")).toBeLessThan(
      children.findIndex((c) => base(c) === "api.mjs"),
    );
  });

  it("keeps no computer, rather than a half set up one, when Docker is not there", async () => {
    const engine = new EmbeddedEngineController(deps());
    await engine.start();
    expect(children.some((child) => base(child) === "supervisor.mjs")).toBe(false);
    const api = children.find((child) => base(child) === "api.mjs");
    expect(api?.env.SANDBOX_PROVIDER).toBe("none");
    expect(api?.env.SANDBOX_SUPERVISOR_URL).toBeUndefined();
  });

  it("turns the ticket board on for the API and the worker", async () => {
    const engine = new EmbeddedEngineController(deps());
    await engine.start();
    for (const program of ["api.mjs", "worker.mjs"]) {
      expect(children.find((child) => base(child) === program)?.env.TICKET_BOARD_ENABLED).toBe(
        "true",
      );
    }
  });

  it("stops the supervisor with the rest and starts again when Docker appears or goes away", async () => {
    const withDocker = deps({
      docker: {
        computerContext: "/app/computer",
        controlViaLoopback: false,
        image: "corvo/computer:app-abc123",
      },
    });
    const engine = new EmbeddedEngineController(withDocker);
    await engine.start();
    await engine.stop();
    expect(killLog.some((entry) => entry.startsWith("supervisor.mjs:"))).toBe(true);
    // The settings the running engine was given no longer match once Docker is gone.
    const without = new EmbeddedEngineController(deps());
    expect(await without.hostConfigMatches()).toBe(false);
  });

  it("lets the engine offer a coding-agent CLI on this computer", async () => {
    const engine = new EmbeddedEngineController(deps());
    await engine.start();
    for (const file of ["api.mjs", "worker.mjs"]) {
      expect(children.find((child) => base(child) === file)?.env.CLI_ENGINES_ENABLED).toBe("true");
    }
  });

  it("keeps stdio MCP servers off when there is no launcher", async () => {
    const engine = new EmbeddedEngineController(deps());
    await engine.start();
    const api = children.find((child) => base(child) === "api.mjs");
    expect(api?.env.MCP_STDIO_ENABLED).toBeUndefined();
    expect(api?.env.MCP_STDIO_ALLOWED_COMMANDS).toBeUndefined();
  });

  it("gives the API its own address, secrets and no Docker, and leaks nothing from the app's environment", async () => {
    const engine = new EmbeddedEngineController(
      deps({ hostComputer: { url: "http://127.0.0.1:9000", token: "t".repeat(64) } }),
    );
    await engine.start();
    const api = children.find((child) => base(child) === "api.mjs");
    expect(api?.env).toMatchObject({
      ELECTRON_RUN_AS_NODE: "1",
      API_HOST: "127.0.0.1",
      API_PORT: "45173",
      WEB_ORIGIN: "http://127.0.0.1:45173",
      BETTER_AUTH_URL: "http://127.0.0.1:45173",
      SANDBOX_PROVIDER: "none",
      SANDBOX_HOST_URL: "http://127.0.0.1:9000",
      CONTENT_ENCRYPTION: "off",
    });
    expect(api?.env.DATABASE_URL).toMatch(
      /^postgres:\/\/corvo_app:[a-f0-9]+@127\.0\.0\.1:54\d+\/corvo$/,
    );
    // Nothing here asks the hosted account service; the app signs in to this engine itself.
    expect(api?.env.CORVO_CENTRAL_AUTH_URL).toBeUndefined();
    expect(api?.env.SECRET_TOKEN).toBeUndefined();
    expect(api?.env.DATABASE_MIGRATION_URL).toBeUndefined();
    const migrate = children.find((child) => base(child) === "migrate.mjs");
    expect(migrate?.env.DATABASE_MIGRATION_URL).toMatch(/^postgres:\/\/corvo:/);
    expect(migrate?.env.MIGRATIONS_DIR).toBe("/app/engine/migrations");
  });

  it("keeps secrets, token and address between starts, so data and sign-in survive", async () => {
    const first = new EmbeddedEngineController(deps());
    await first.start();
    await first.stop();
    const secrets = await readFile(path.join(dir, "engine", "secrets.json"), "utf8");
    const token = await readEngineToken(path.join(dir, "engine"));
    expect(token).toMatch(/^[a-f0-9]{64}$/);

    children.length = 0;
    const second = new EmbeddedEngineController(deps({ randomHex: () => "cd".repeat(32) }));
    await second.start();
    expect(await readFile(path.join(dir, "engine", "secrets.json"), "utf8")).toBe(secrets);
    expect(await readEngineToken(path.join(dir, "engine"))).toBe(token);
  });

  it("does not recreate a database that already exists", async () => {
    await new EmbeddedEngineController(deps()).start();
    children.length = 0;
    // PG_VERSION is what initdb leaves behind.
    const { writePrivateFile } = await import("./setup-store.js");
    await writePrivateFile(path.join(dir, "engine", "postgres", "PG_VERSION"), "18\n");
    await new EmbeddedEngineController(deps()).start();
    expect(children.some((child) => path.basename(child.command) === "initdb")).toBe(false);
  });

  it("moves to a free port when the saved one is taken, and remembers it", async () => {
    const engine = new EmbeddedEngineController(deps({ portIsFree: async () => false }));
    await engine.start();
    expect(engine.webUrl()).toMatch(/^http:\/\/127\.0\.0\.1:54\d+$/);
    expect(await readEngineWebUrl(path.join(dir, "engine"), "fallback")).toBe(engine.webUrl());
  });

  it("fails with an actionable message when the migration fails, and leaves nothing running", async () => {
    failScript = "migrate.mjs";
    const engine = new EmbeddedEngineController(deps());
    const state = await engine.start();
    expect(state.phase).toBe("failed");
    expect(state.message).toContain("update the local database");
    const database = children.find(
      (child) => child.args.includes("-D") && !child.args.includes("--single"),
    );
    expect(database?.signals).toContain("SIGINT");
    expect(await engine.matchesDesiredStack()).toBe(false);
  });

  it("fails when the database never starts", async () => {
    failScript = "postgres";
    const engine = new EmbeddedEngineController(
      deps({
        spawn: (command, args, options) => {
          const child = new FakeChild(command, args, options.env);
          children.push(child);
          queueMicrotask(() =>
            child.exit(path.basename(command) === "initdb" || args.includes("--single") ? 0 : 1),
          );
          return child as unknown as EngineProcess;
        },
      }),
    );
    const state = await engine.start();
    expect(state.phase).toBe("failed");
    expect(state.message).toContain("database did not start");
  });

  it("fails when the app never answers its health check", async () => {
    const engine = new EmbeddedEngineController(
      deps({ probe: async () => false, healthTimeoutMs: 0 }),
    );
    const state = await engine.start();
    expect(state.phase).toBe("failed");
    expect(state.message).toContain("did not answer");
  });

  it("stops the API and worker first and the database last", async () => {
    const engine = new EmbeddedEngineController(deps());
    await engine.start();
    await engine.stop();
    expect(killLog.at(-1)).toBe("-D:SIGINT");
    expect(killLog).toContain("api.mjs:SIGTERM");
    expect(killLog).toContain("worker.mjs:SIGTERM");
    expect(engine.state().phase).toBe("idle");
    expect(await engine.matchesDesiredStack()).toBe(false);
  });

  it("reports a program that stops by itself after the engine was ready", async () => {
    const engine = new EmbeddedEngineController(deps());
    await engine.start();
    children.find((child) => base(child) === "api.mjs")?.exit(1);
    expect(engine.state().phase).toBe("failed");
    expect(engine.state().message).toContain("api stopped unexpectedly");
    expect(await engine.matchesDesiredStack()).toBe(false);
  });

  it("refuses to start over a database whose secrets are missing", async () => {
    const { writePrivateFile } = await import("./setup-store.js");
    await mkdir(path.join(dir, "engine", "postgres"), { recursive: true });
    await writePrivateFile(path.join(dir, "engine", "postgres", "PG_VERSION"), "18\n");
    const state = await new EmbeddedEngineController(deps()).start();
    expect(state.phase).toBe("failed");
    expect(state.message).toContain("saved keys");
  });
});

describe("engineResourcePaths", () => {
  it("keeps the engine in the app files and the database programs in resources when installed", () => {
    expect(
      engineResourcePaths({ packaged: true, resourcesPath: "/R", appPath: "/R/app.asar" }),
    ).toEqual({
      engineDir: "/R/app.asar/dist/engine",
      postgresBinDir: "/R/postgres/bin",
      computerContextDir: "/R/computer",
    });
  });

  it("uses the build output and the installed package when running from source", () => {
    expect(
      engineResourcePaths({
        packaged: false,
        resourcesPath: "/R",
        appPath: "/A",
        platform: "darwin",
        arch: "arm64",
      }),
    ).toEqual({
      engineDir: "/A/dist/engine",
      postgresBinDir: "/A/node_modules/@embedded-postgres/darwin-arm64/native/bin",
      computerContextDir: "/infra/sandboxes/computer",
    });
  });
});

describe("the database programs on each system", () => {
  it.each([
    ["darwin", "arm64", "darwin-arm64"],
    ["darwin", "x64", "darwin-arm64"],
    ["win32", "x64", "windows-x64"],
    ["linux", "x64", "linux-x64"],
    ["linux", "arm64", "linux-arm64"],
  ] as const)("picks the package for %s %s", (platform, arch, expected) => {
    expect(postgresPackage(platform, arch)).toBe(expected);
  });

  it("refuses a system it has no programs for instead of picking another one's", () => {
    expect(() => postgresPackage("win32", "arm64")).toThrow("does not run on win32 arm64");
    expect(() => postgresPackage("freebsd", "x64")).toThrow("does not run on");
  });

  it("finds the installed package of the running system when started from source", () => {
    expect(
      engineResourcePaths({
        packaged: false,
        resourcesPath: "/R",
        appPath: "/A",
        platform: "linux",
        arch: "arm64",
      }).postgresBinDir,
    ).toBe("/A/node_modules/@embedded-postgres/linux-arm64/native/bin");
  });

  it("adds .exe to program names only on Windows", () => {
    expect(postgresProgram("initdb", "win32")).toBe("initdb.exe");
    expect(postgresProgram("initdb", "linux")).toBe("initdb");
    expect(postgresProgram("postgres", "darwin")).toBe("postgres");
  });

  it("keeps the macOS locale and gives the other systems one that does not depend on them", () => {
    expect(initdbLocaleArgs("darwin")).toEqual(["--locale=en_US.UTF-8"]);
    for (const platform of ["win32", "linux"] as const) {
      expect(initdbLocaleArgs(platform)).toEqual([
        "--locale-provider=icu",
        "--icu-locale=en-US",
        "--locale=C",
      ]);
    }
  });

  it("starts the Windows programs by their .exe names and gives them the environment Windows needs", async () => {
    const engine = new EmbeddedEngineController({
      ...deps(),
      platform: "win32",
      env: { SystemRoot: "C:\\Windows", PATH: "C:\\x", SECRET_TOKEN: "no" },
    });
    await engine.start();
    const initdb = children.find((child) => path.basename(child.command).startsWith("initdb"));
    expect(path.basename(initdb?.command ?? "")).toBe("initdb.exe");
    expect(initdb?.args).toContain("--locale-provider=icu");
    expect(initdb?.env.SystemRoot).toBe("C:\\Windows");
    expect(initdb?.env.SECRET_TOKEN).toBeUndefined();
  });
});

describe("the network the engine's programs use", () => {
  const programs = ["api.mjs", "worker.mjs"] as const;
  const start = async (env: Record<string, string>, platform: NodeJS.Platform = "win32") => {
    const engine = new EmbeddedEngineController({ ...deps(), platform, env });
    await engine.start();
    return (name: (typeof programs)[number]) => children.find((child) => base(child) === name)!.env;
  };

  it("trusts the certificates of the computer, so a security program that inspects HTTPS does not break every model request", async () => {
    const envOf = await start({ SystemRoot: "C:\\Windows", PATH: "C:\\x" });
    for (const name of programs) expect(envOf(name).NODE_USE_SYSTEM_CA).toBe("1");
  });

  it("changes nothing about proxies while none is set", async () => {
    const envOf = await start({ SystemRoot: "C:\\Windows", PATH: "C:\\x" });
    for (const name of programs) {
      expect(envOf(name).NODE_USE_ENV_PROXY).toBeUndefined();
      expect(envOf(name).NO_PROXY).toBeUndefined();
    }
  });

  it("sends requests through the proxy the person has set, and keeps this computer's own calls off it", async () => {
    const envOf = await start({
      SystemRoot: "C:\\Windows",
      PATH: "C:\\x",
      HTTPS_PROXY: "http://proxy.corp:8080",
      NO_PROXY: "intranet.corp",
    });
    for (const name of programs) {
      const env = envOf(name);
      expect(env.NODE_USE_ENV_PROXY).toBe("1");
      expect(env.HTTPS_PROXY).toBe("http://proxy.corp:8080");
      const bypass = (env.NO_PROXY ?? "").split(",");
      expect(bypass).toEqual(
        expect.arrayContaining(["intranet.corp", "127.0.0.1", "localhost", "::1", "[::1]"]),
      );
      expect(env.no_proxy).toBe(env.NO_PROXY);
    }
  });

  it("reads a lower-case proxy variable too, as Windows tools and shells often set it", async () => {
    const envOf = await start({ SystemRoot: "C:\\Windows", https_proxy: "http://proxy.corp:8080" });
    expect(envOf("worker.mjs").NODE_USE_ENV_PROXY).toBe("1");
    expect(envOf("worker.mjs").NO_PROXY).toContain("127.0.0.1");
  });

  it("does not hand these settings to the database", async () => {
    await start({ SystemRoot: "C:\\Windows", HTTPS_PROXY: "http://proxy.corp:8080" });
    const postgres = children.find((child) => path.basename(child.command).startsWith("postgres"));
    expect(postgres?.env.NODE_USE_SYSTEM_CA).toBeUndefined();
    expect(postgres?.env.NODE_USE_ENV_PROXY).toBeUndefined();
  });
});
