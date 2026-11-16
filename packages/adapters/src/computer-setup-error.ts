import { SandboxRateLimitError } from "@corvo/adapter-kit";
import { ComputerBusyError } from "./computer-lifecycle.js";

const setupFailures = new WeakSet<object>();

/**
 * Marks an error as a failure to start the agent's computer, so the run reports it as that
 * and not as a model error. A busy computer is retried and a rate limit has its own message,
 * so neither is marked. Returns the same error.
 */
export function markComputerSetupFailure<T>(error: T): T {
  if (
    error !== null &&
    typeof error === "object" &&
    !(error instanceof ComputerBusyError) &&
    !(error instanceof SandboxRateLimitError)
  )
    setupFailures.add(error);
  return error;
}

export function isComputerSetupFailure(error: unknown): boolean {
  return error !== null && typeof error === "object" && setupFailures.has(error);
}
