import type { AgentRuntimeEvent } from "@corvo/adapter-kit";

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
