import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import type {
  Client,
  SessionConfigOption,
  SessionConfigSelectOption,
} from "@agentclientprotocol/sdk";
import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
import type { AgentRuntimeEvent } from "@corvo/adapter-kit";
import { agentChildEnv } from "./agent-process.js";

/**
 * A client for agents that speak the Agent Client Protocol (ACP) over stdio, such as
 * `opencode acp`. The agent is a program on this computer; this file only starts it, asks for
 * its models and runs one turn. Tool permissions are refused unless the caller decides.
 */
export interface AcpCommand {
  command: string;
  args: string[];
  cwd: string;
  /** Added to the small environment the agent gets; server secrets are never inherited. */
  env?: Record<string, string>;
  /** Turns what the program printed before it stopped into a plain explanation, when it knows one. */
  explainExit?: (output: string) => string | undefined;
}

export interface AcpModel {
  id: string;
  name: string;
  free: boolean;
}

export type AcpPermissionDecision = "allow" | "reject";

const SHUTDOWN_GRACE_MS = 2_000;
const OUTPUT_TAIL_CHARS = 4_000;
const DEATH_GRACE_MS = 500;
const CANCEL_GRACE_MS = 3_000;

/** OpenCode's own free tier: ids ending in "-free", plus the one free model without that suffix. */
export function isFreeOpenCodeModel(id: string): boolean {
  return id.startsWith("opencode/") && (id.endsWith("-free") || id === "opencode/big-pickle");
}

interface OpenAgent {
  connection: ClientSideConnection;
  close(): Promise<void>;
}

function startError(command: string, cause?: unknown): Error {
  const reason = cause instanceof Error ? ` (${cause.message})` : "";
  return new Error(`The agent program could not start: ${command}${reason}`);
}

async function openAgent(cmd: AcpCommand, client: Client): Promise<OpenAgent> {
  const child: ChildProcess = spawn(cmd.command, cmd.args, {
    cwd: cmd.cwd,
    env: agentChildEnv(cmd.env ?? {}),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    output = (output + chunk.toString("utf8")).slice(-OUTPUT_TAIL_CHARS);
  });
  child.stderr?.on("error", () => undefined);
  const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
  // Why the program is gone, once it is: a start failure, or its own last words.
  let death: Error | undefined;
  child.once("error", (error) => {
    death = startError(cmd.command, error);
  });
  child.once("close", () => {
    death ??= new Error(cmd.explainExit?.(output) ?? "The agent program stopped unexpectedly.");
  });
  const failed = new Promise<never>((_, reject) => {
    child.once("error", () => reject(death));
    child.once("close", () => reject(death));
  });
  failed.catch(() => undefined);

  // Closing the connection cancels the stdout reader with an error, which Node would raise as
  // an uncaught exception on an unwatched stream. The program's pipes are ours to ignore.
  child.stdout?.on("error", () => undefined);
  child.stdin?.on("error", () => undefined);
  const stream = ndJsonStream(
    Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
  );
  const connection = new ClientSideConnection(() => client, stream);
  const close = async () => {
    child.stdin?.end();
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), SHUTDOWN_GRACE_MS);
    await exited;
    clearTimeout(timer);
  };
  // Every call is raced against the program dying, so a missing binary fails fast.
  const guarded = new Proxy(connection, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        try {
          return await Promise.race([value.apply(target, args) as Promise<unknown>, failed]);
        } catch (error) {
          // The connection usually reports its own closing first; the program's last words
          // explain it better, so give them a moment to arrive.
          const grace = new Promise<void>((resolve) => setTimeout(resolve, DEATH_GRACE_MS).unref());
          await Promise.race([exited, grace]);
          throw death ?? error;
        }
      };
    },
  });
  try {
    await guarded.initialize({
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "corvo", version: "0.1.0" },
    });
  } catch (error) {
    await close();
    throw error;
  }
  return { connection: guarded, close };
}

function modelOption(options: SessionConfigOption[] | null | undefined) {
  return options?.find((option) => option.category === "model" && option.type === "select");
}

function flattenOptions(option: NonNullable<ReturnType<typeof modelOption>>) {
  if (option.type !== "select") return [];
  return (
    option.options as Array<SessionConfigSelectOption | { options: SessionConfigSelectOption[] }>
  ).flatMap((entry) => ("options" in entry ? entry.options : [entry]));
}

const noPermissions: Client = {
  sessionUpdate: () => undefined,
  requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
};

/** The models the agent offers on this computer, free ones marked. */
export async function listAcpModels(cmd: AcpCommand): Promise<AcpModel[]> {
  const agent = await openAgent(cmd, noPermissions);
  try {
    const session = await agent.connection.newSession({ cwd: cmd.cwd, mcpServers: [] });
    const option = modelOption(session.configOptions);
    return option
      ? flattenOptions(option).map((entry) => ({
          id: entry.value,
          name: entry.name,
          free: isFreeOpenCodeModel(entry.value),
        }))
      : [];
  } finally {
    await agent.close();
  }
}

/** Ordered events of one turn, ended by `end()` or `fail()`. */
class EventQueue<T> {
  private items: T[] = [];
  private waiting: (() => void) | undefined;
  private finished = false;
  private failure: unknown;

  push(item: T) {
    this.items.push(item);
    this.wake();
  }
  end() {
    this.finished = true;
    this.wake();
  }
  fail(error: unknown) {
    this.failure = error ?? new Error("The agent turn failed.");
    this.finished = true;
    this.wake();
  }
  private wake() {
    this.waiting?.();
    this.waiting = undefined;
  }
  async *drain(): AsyncGenerator<T> {
    for (;;) {
      while (this.items.length > 0) yield this.items.shift()!;
      if (this.finished) break;
      await new Promise<void>((resolve) => {
        this.waiting = resolve;
      });
    }
    if (this.failure !== undefined) throw this.failure;
  }
}

/** Run one prompt on one model and stream the agent's reply as runtime events. */
export async function* runAcpTurn(
  cmd: AcpCommand,
  options: {
    model: string;
    prompt: string;
    signal?: AbortSignal;
    /** Called when the agent asks to use a tool. Without it every request is refused. */
    decidePermission?: (request: { title: string }) => Promise<AcpPermissionDecision>;
  },
): AsyncGenerator<AgentRuntimeEvent> {
  if (options.signal?.aborted) {
    yield { type: "done" };
    return;
  }
  const queue = new EventQueue<AgentRuntimeEvent>();
  const client: Client = {
    sessionUpdate: ({ update }) => {
      if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
        queue.push({ type: "text", text: update.content.text });
      } else if (update.sessionUpdate === "tool_call") {
        queue.push({ type: "progress", text: update.title, activity: true });
      }
    },
    requestPermission: async (request) => {
      const decision = options.decidePermission
        ? await options.decidePermission({ title: request.toolCall.title ?? "Tool" })
        : "reject";
      const kind = decision === "allow" ? "allow_once" : "reject_once";
      const choice = request.options.find((option) => option.kind === kind);
      return choice
        ? { outcome: { outcome: "selected", optionId: choice.optionId } }
        : { outcome: { outcome: "cancelled" } };
    },
  };
  const agent = await openAgent(cmd, client);
  try {
    const session = await agent.connection.newSession({ cwd: cmd.cwd, mcpServers: [] });
    const option = modelOption(session.configOptions);
    if (option && option.type === "select") {
      if (!flattenOptions(option).some((entry) => entry.value === options.model)) {
        throw new Error(`The agent does not offer the model ${options.model}.`);
      }
      if (option.currentValue !== options.model) {
        await agent.connection.setSessionConfigOption({
          sessionId: session.sessionId,
          configId: option.id,
          value: options.model,
        });
      }
    }
    const turn = agent.connection
      .prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: options.prompt }] })
      .then(
        () => queue.end(),
        (error: unknown) => queue.fail(error),
      );
    const cancel = () => {
      void agent.connection.cancel({ sessionId: session.sessionId });
      // An agent that ignores the cancel is stopped when the turn is closed below.
      setTimeout(() => queue.end(), CANCEL_GRACE_MS).unref();
    };
    options.signal?.addEventListener("abort", cancel, { once: true });
    try {
      yield* queue.drain();
      yield { type: "done" };
    } finally {
      options.signal?.removeEventListener("abort", cancel);
      void turn;
    }
  } finally {
    await agent.close();
  }
}
