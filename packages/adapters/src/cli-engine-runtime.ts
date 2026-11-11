import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import type {
  AdapterContext,
  AgentRunRequest,
  AgentRuntime,
  AgentRuntimeEvent,
  AgentToolCompletion,
  AgentToolResultContent,
  ConnectorTool,
} from "@corvo/adapter-kit";
import type { CliEngineId, CliEngineState } from "@corvo/contracts";
import { CLI_ENGINE_PROVIDER_ID, parseCliEngineModelId } from "@corvo/contracts";
import { CLI_ENGINE_RUN_ERRORS } from "@corvo/core";
import { transcript } from "./acp-openai-bridge.js";
import { isToolPauseResult } from "./approval-effect.js";
import { FIND_TOOL, findTools, partitionTools, USE_TOOL } from "./builtin-tool-bridge.js";
import type { CliEngineDefinition } from "./cli-engine-parser.js";
import type { CliToolGateway } from "./cli-tool-gateway.js";
import { sanitizeSensitiveText } from "./pi-runtime-errors.js";
import { clipToolResultContent } from "./pi-runtime-limits.js";
import { namedAgentTools, serializeToolResult } from "./pi-runtime-tools.js";

export type { CliEngineDefinition } from "./cli-engine-parser.js";

/** Where the host keeps what the runtime needs: the binary, the sign-in state and the folders. */
export interface CliEngineLocator {
  binary(id: CliEngineId): Promise<string | undefined>;
  /** Detects again after the binary moved; turns that hit it together share one detection. */
  redetect(id: CliEngineId): Promise<string | undefined>;
  configDir(id: CliEngineId): string;
  turnsDir(id: CliEngineId): string;
  ready(id: CliEngineId): Promise<CliEngineState>;
}

const MAX_CONCURRENT = 4;
const KILL_GRACE_MS = 5_000;
const PAUSE_KILL_DELAY_MS = 50;
const STDERR_TAIL_CHARS = 4_000;
// Sub-agents and takeover are not offered to a CLI turn.
const NOT_OFFERED = new Set(["run_subagent", "request_takeover"]);

function channel() {
  const items: AgentRuntimeEvent[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  let failure: Error | undefined;
  return {
    push(event: AgentRuntimeEvent) {
      if (closed) return;
      items.push(event);
      wake?.();
    },
    fail(error: Error) {
      if (closed) return;
      failure = error;
      closed = true;
      wake?.();
    },
    close() {
      closed = true;
      wake?.();
    },
    async *iterate(): AsyncGenerator<AgentRuntimeEvent> {
      while (true) {
        const next = items.shift();
        if (next) {
          yield next;
          continue;
        }
        if (failure) throw failure;
        if (closed) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}

/** A counting lock for turns; a waiter leaves the line when its signal aborts. */
class Slots {
  private waiting: Array<() => void> = [];
  private free: number;
  constructor(size: number) {
    this.free = size;
  }
  async acquire(signal: AbortSignal): Promise<(() => void) | undefined> {
    if (signal.aborted) return undefined;
    if (this.free > 0) {
      this.free -= 1;
      return () => this.release();
    }
    return new Promise((resolve) => {
      const grant = () => {
        signal.removeEventListener("abort", leave);
        resolve(() => this.release());
      };
      const leave = () => {
        this.waiting = this.waiting.filter((waiter) => waiter !== grant);
        resolve(undefined);
      };
      this.waiting.push(grant);
      signal.addEventListener("abort", leave, { once: true });
    });
  }
  private release() {
    const next = this.waiting.shift();
    if (next) next();
    else this.free += 1;
  }
}

function toolResultContent(
  result: unknown,
  request: AgentRunRequest,
  name: string,
  args: Record<string, unknown>,
) {
  if (
    result &&
    typeof result === "object" &&
    (result as { kind?: unknown }).kind === "agent_tool_result" &&
    Array.isArray((result as { content?: unknown }).content)
  ) {
    return clipToolResultContent((result as { content: AgentToolResultContent[] }).content);
  }
  return [
    {
      type: "text" as const,
      text: serializeToolResult(result, request.contextStrategy, name, args),
    },
  ];
}

/** SIGTERM, then SIGKILL when it has not gone after the grace period. */
function killProcess(proc: ChildProcess | undefined) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  proc.kill("SIGTERM");
  const timer = setTimeout(() => proc.kill("SIGKILL"), KILL_GRACE_MS);
  proc.once("exit", () => clearTimeout(timer));
}

function isMissingBinary(error: unknown): boolean {
  return (error as { code?: unknown } | undefined)?.code === "ENOENT";
}

export class CliEngineRuntime implements AgentRuntime {
  private readonly engines: ReadonlyMap<CliEngineId, CliEngineDefinition>;
  private readonly locator: CliEngineLocator;
  private readonly gateway: CliToolGateway;
  private readonly slots: Slots;
  private readonly running = new Map<string, AbortController>();

  constructor(options: {
    engines: readonly CliEngineDefinition[];
    locator: CliEngineLocator;
    gateway: CliToolGateway;
    maxConcurrent?: number;
  }) {
    this.engines = new Map(options.engines.map((engine) => [engine.id, engine]));
    this.locator = options.locator;
    this.gateway = options.gateway;
    this.slots = new Slots(options.maxConcurrent ?? MAX_CONCURRENT);
  }

  describe() {
    return {
      id: CLI_ENGINE_PROVIDER_ID,
      contractVersion: "1",
      adapterVersion: "1",
      capabilities: { streaming: true, compaction: false, tools: true, scripted: false },
    };
  }

  async abort(runId: string): Promise<void> {
    this.running.get(runId)?.abort();
  }

  async *run(
    request: AgentRunRequest,
    context?: Partial<AdapterContext>,
  ): AsyncGenerator<AgentRuntimeEvent, void> {
    const parsed =
      request.model.provider === CLI_ENGINE_PROVIDER_ID
        ? parseCliEngineModelId(request.model.id)
        : undefined;
    const engine = parsed ? this.engines.get(parsed.engine) : undefined;
    if (!parsed || !engine) throw new Error("This run is not for a CLI engine.");
    if (request.model.callObserver) {
      throw new Error("A CLI engine cannot run a model that is billed as hosted credits.");
    }
    const errors = CLI_ENGINE_RUN_ERRORS[engine.id];

    const controller = new AbortController();
    this.running.set(request.runId, controller);
    const signal = context?.signal
      ? AbortSignal.any([controller.signal, context.signal])
      : controller.signal;
    const release = await this.slots.acquire(signal);
    if (!release) {
      this.running.delete(request.runId);
      return;
    }

    const turnId = randomUUID();
    const turnDir = path.join(this.locator.turnsDir(engine.id), turnId);
    let closeSession: (() => void) | undefined;
    let child: ChildProcess | undefined;
    let exited: Promise<void> = Promise.resolve();
    try {
      const state = await this.locator.ready(engine.id);
      if (state === "missing" || state === "unsupported") throw new Error(errors.missing);
      if (state === "signed_out" || state === "api_key") throw new Error(errors.signedOut);

      const configDir = this.locator.configDir(engine.id);
      await mkdir(configDir, { recursive: true, mode: 0o700 });
      await chmod(configDir, 0o700);
      await mkdir(turnDir, { recursive: true, mode: 0o700 });
      const systemPromptFile = path.join(turnDir, "system.md");
      await writeFile(systemPromptFile, request.instructions, { mode: 0o600 });

      const queue = channel();
      let paused = false;
      let settled = false;
      let seq = 0;
      let unsafe = false;
      let lines = Promise.resolve();

      const listed = partitionTools(request.tools);
      const offered = listed.listed.filter((tool) => !NOT_OFFERED.has(tool.name));
      const named = namedAgentTools(offered);
      const byGatewayName = new Map(named.map(({ tool, name }) => [name, tool]));
      const runnable = new Map<string, ConnectorTool>(
        [...offered, ...listed.deferred]
          .filter((tool) => tool.name !== FIND_TOOL && tool.name !== USE_TOOL)
          .map((tool) => [tool.name, tool]),
      );

      const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
      // The executor's audit hook; best effort, and never able to change what a tool answers.
      const report = (completion: AgentToolCompletion) => {
        try {
          void Promise.resolve(request.onToolCompleted?.(completion)).catch(() => undefined);
        } catch {
          // Audit hooks are best effort.
        }
      };
      const execute = async (
        tool: ConnectorTool,
        args: Record<string, unknown>,
        executionId: string,
        viaUseTool?: boolean,
      ) => {
        queue.push({
          type: "tool",
          name: tool.name,
          args,
          executionId,
          ...(viaUseTool ? { viaUseTool } : {}),
        });
        if (!request.executeTool) return text(`${tool.name} is unavailable without an executor.`);
        const startedAt = Date.now();
        let result: unknown;
        let failure: unknown;
        try {
          result = await request.executeTool(tool.name, args, executionId, tool.route);
          if (isToolPauseResult(result)) pause();
          return { content: toolResultContent(result, request, tool.name, args) };
        } catch (error) {
          failure = error;
          throw error;
        } finally {
          report({
            name: tool.name,
            executionId,
            durationMs: Math.max(0, Date.now() - startedAt),
            ...(result === undefined ? {} : { result }),
            ...(failure === undefined ? {} : { error: failure }),
            ...(paused ? { paused: true } : {}),
          });
        }
      };

      const call = async (gatewayName: string, args: Record<string, unknown>) => {
        // Lines already read must be judged first: a start that broke the rules runs nothing.
        await lines;
        const tool = byGatewayName.get(gatewayName);
        if (!tool || unsafe || settled) return { ...text("Tool not allowed."), isError: true };
        if (paused) return text("Skipped: waiting for the person to respond.");
        const executionId = JSON.stringify(["cli-tool", turnId, ++seq]);
        try {
          if (tool.name === FIND_TOOL) {
            queue.push({ type: "tool", name: tool.name, args, executionId });
            return text(JSON.stringify(findTools(listed.deferred, args)));
          }
          if (tool.name === USE_TOOL) {
            const inner = runnable.get(String(args.name));
            if (!inner) {
              queue.push({ type: "tool", name: tool.name, args, executionId });
              throw new Error(`${String(args.name)} is not available. Use a name find_tool lists.`);
            }
            const innerArgs =
              args.arguments && typeof args.arguments === "object"
                ? (args.arguments as Record<string, unknown>)
                : {};
            return await execute(inner, innerArgs, executionId, true);
          }
          if (tool.name === "ask_user") {
            const options = Array.isArray(args.options)
              ? args.options.map((option) => String(option).trim())
              : [];
            if (
              options.length < 2 ||
              options.length > 4 ||
              options.some((option) => option.length === 0 || option.length > 80) ||
              new Set(options).size !== options.length
            ) {
              throw new Error("ask_user requires two to four unique, non-empty options");
            }
            queue.push({ type: "tool", name: tool.name, args, executionId });
            queue.push({
              type: "ask",
              text: String(args.question ?? "What should I use?"),
              actions: options.map((label, index) => ({ id: `choice-${index + 1}`, label })),
            });
            pause();
            return text("Waiting for the user's choice.");
          }
          return await execute(tool, args, executionId);
        } catch (error) {
          const message = error instanceof Error ? error.message : "The tool failed.";
          return { ...text(sanitizeSensitiveText(message)), isError: true };
        }
      };

      const session = await this.gateway.open({
        tools: named.map(({ tool, name }) => ({
          name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
        call,
      });
      closeSession = session.close;

      const parser = engine.parser(
        { gatewayName: engine.gatewayName, toolNames: new Set(byGatewayName.keys()) },
        request.model.id,
      );
      // A paused turn is over: the CLI has had the answer, so it is stopped and the run waits.
      function pause() {
        if (paused) return;
        paused = true;
        setTimeout(() => killProcess(child), PAUSE_KILL_DELAY_MS);
      }
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        killProcess(child);
        if (error) queue.fail(error);
        else queue.close();
      };
      let stderrTail = "";

      const args = engine.args({ model: parsed.model, systemPromptFile });
      const env = engine.env({ configDir, mcpUrl: session.url });
      const prompt = transcript([...request.history, { role: "user", content: request.prompt }]);

      child = await this.start(engine, args, env, turnDir);
      const proc = child;
      exited = new Promise<void>((resolve) => {
        if (proc.exitCode !== null || proc.signalCode !== null) resolve();
        else proc.once("exit", () => resolve());
      });
      proc.stdin?.on("error", () => undefined);
      proc.stdin?.end(prompt);
      proc.stderr?.on("data", (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString("utf8")).slice(-STDERR_TAIL_CHARS);
      });
      proc.stderr?.on("error", () => undefined);

      const handle = async (events: ReturnType<typeof parser.line>) => {
        for (const event of events) {
          if (settled) return;
          if (event.type === "violation") {
            unsafe = true;
            finish(new Error(errors.unsafe));
            return;
          }
          if (paused) return;
          if (event.type === "failed") {
            finish(new Error(event.message));
            return;
          }
          if (event.type === "usage") {
            const accounted = { ...event, accounted: true as const };
            await request.onUsage?.(accounted);
            queue.push(accounted);
          } else if (event.type === "done") {
            queue.push(event);
            finish();
          } else {
            queue.push(event);
          }
        }
      };

      const reader = createInterface({ input: proc.stdout as NodeJS.ReadableStream });
      reader.on("line", (line) => {
        lines = lines.then(() => handle(parser.line(line))).catch((error) => finish(error));
      });
      proc.once("close", (code) => {
        void lines.then(async () => {
          if (settled) return;
          if (paused) {
            queue.push({ type: "done" });
            finish();
            return;
          }
          await handle(parser.end(code, stderrTail));
          finish();
        });
      });
      proc.once("error", (error) => finish(error));

      // Whatever stops the turn from outside ends it without a reply.
      const stop = () => finish();
      if (signal.aborted) stop();
      else signal.addEventListener("abort", stop, { once: true });

      try {
        yield* queue.iterate();
      } finally {
        signal.removeEventListener("abort", stop);
      }
    } finally {
      closeSession?.();
      this.running.delete(request.runId);
      killProcess(child);
      await exited;
      await rm(turnDir, { recursive: true, force: true });
      release();
    }
  }

  /** Starts the CLI; when its binary moved, detects once more and tries the new path once. */
  private async start(
    engine: CliEngineDefinition,
    args: string[],
    env: Record<string, string>,
    cwd: string,
  ): Promise<ChildProcess> {
    const errors = CLI_ENGINE_RUN_ERRORS[engine.id];
    let binary = await this.locator.binary(engine.id);
    let moved = false;
    if (binary) {
      try {
        await access(binary);
      } catch {
        binary = undefined;
      }
    }
    if (!binary) {
      moved = true;
      binary = await this.locator.redetect(engine.id);
      if (!binary) throw new Error(errors.missing);
    }
    try {
      return await this.spawnChild(binary, args, env, cwd);
    } catch (error) {
      if (!isMissingBinary(error) || moved)
        throw isMissingBinary(error) ? new Error(errors.missing) : error;
      const fresh = await this.locator.redetect(engine.id);
      if (!fresh) throw new Error(errors.missing);
      try {
        return await this.spawnChild(fresh, args, env, cwd);
      } catch (retry) {
        throw isMissingBinary(retry) ? new Error(errors.missing) : retry;
      }
    }
  }

  private spawnChild(
    binary: string,
    args: string[],
    env: Record<string, string>,
    cwd: string,
  ): Promise<ChildProcess> {
    return new Promise((resolve, reject) => {
      const proc = spawn(binary, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
      proc.once("error", reject);
      proc.once("spawn", () => {
        proc.off("error", reject);
        resolve(proc);
      });
    });
  }
}
