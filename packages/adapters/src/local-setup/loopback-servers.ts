import type { CliEngineStatus } from "@corvo/contracts";
import { probeOpenAiCompatibleModels } from "../pi-openai-compatible-provider.js";

/** The only addresses ever probed. No caller supplies a URL. */
export const LOOPBACK_MODEL_SERVERS: readonly { port: number; label: string; baseUrl: string }[] = [
  { port: 11434, label: "Ollama", baseUrl: "http://127.0.0.1:11434/v1" },
  { port: 1234, label: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1" },
  { port: 8080, label: "llama.cpp", baseUrl: "http://127.0.0.1:8080/v1" },
];

export type FoundServer = { port: number; label: string; baseUrl: string; models: string[] };

export type MachineFindings = {
  version: 2;
  checkedAt: number;
  servers: FoundServer[];
  /** What the coding-agent CLI probe reported; empty where there is none. */
  cliEngines: CliEngineStatus[];
};

const DEFAULT_PROBE_TIMEOUT_MS = 1_500;

/**
 * Asks each fixed loopback port for its model list. A port that errors, redirects, answers
 * anything but a models list, or lists nothing is not a model server and is left out.
 */
export async function probeLoopbackServers(options: {
  fetch?: typeof fetch;
  signal: AbortSignal;
  probeTimeoutMs?: number;
}): Promise<FoundServer[]> {
  const timeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const results = await Promise.all(
    LOOPBACK_MODEL_SERVERS.map(async (server): Promise<FoundServer | null> => {
      try {
        const models = await probeOpenAiCompatibleModels(
          { baseUrl: server.baseUrl },
          options.fetch,
          AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]),
          { allowPrivate: true },
        );
        return models.length > 0 ? { ...server, models } : null;
      } catch {
        return null;
      }
    }),
  );
  return results.filter((server): server is FoundServer => server !== null);
}
