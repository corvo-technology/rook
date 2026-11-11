import type { AgentRuntimeEvent } from "@corvo/adapter-kit";
import type { CliEngineId, CliEngineState } from "@corvo/contracts";

/** What a CLI's output becomes: runtime events, plus the two ways a turn can stop early. */
export type CliEngineEvent =
  | AgentRuntimeEvent
  | { type: "violation"; reason: string }
  | { type: "failed"; message: string };

/** Turns a CLI's streamed output into runtime events; pure, so fixtures can drive it. */
export interface CliStreamParser {
  line(line: string): CliEngineEvent[];
  /** The process ended; `stderrTail` is the end of what it wrote to stderr. */
  end(exitCode: number | null, stderrTail: string): CliEngineEvent[];
}

/** What the CLI must report at start: the one tool gateway, and only this turn's tools. */
export interface CliStreamExpectations {
  gatewayName: string;
  toolNames: ReadonlySet<string>;
}

/** Everything that is specific to one coding-agent CLI; the runtime, gateway and host are not. */
export interface CliEngineDefinition {
  id: CliEngineId;
  binaryName: string;
  /** The name the CLI gives the tool gateway in its start report. */
  gatewayName: string;
  installDirs(home: string): string[];
  statusArgs: { version: string[]; auth: string[] };
  status(probe: {
    version: { code: number; stdout: string };
    auth: { code: number; stdout: string };
  }): { state: CliEngineState; version: string | null };
  /** Model names as the CLI knows them; ids are `<engine>/<model>`. */
  models: readonly string[];
  args(turn: { model: string; systemPromptFile: string }): string[];
  env(input: { configDir: string; mcpUrl: string }): Record<string, string>;
  parser(expect: CliStreamExpectations, model: string): CliStreamParser;
}
