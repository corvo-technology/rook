import { readFileSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CliEngineStatus } from "@corvo/contracts";
import { CliEngineStatusSchema } from "@corvo/contracts";
import * as z from "zod";
import {
  type FoundServer,
  LOOPBACK_MODEL_SERVERS,
  type MachineFindings,
} from "./loopback-servers.js";

const DEFAULT_DEADLINE_MS = 5_000;

const FindingsFileSchema = z.object({
  // Version 1 files were written before the CLI probe existed and read with no engines.
  version: z.union([z.literal(1), z.literal(2)]),
  checkedAt: z.number(),
  cliEngines: z.array(CliEngineStatusSchema).max(20).optional(),
  servers: z.array(
    z.object({
      port: z.number().int(),
      models: z.array(z.string().max(300)).max(500),
    }),
  ),
});

/** A kept file is only trusted for ports Corvo probes itself; label and URL come from constants. */
function readKept(file: string): MachineFindings | null {
  try {
    const parsed = FindingsFileSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    if (!parsed.success) return null;
    const servers: FoundServer[] = [];
    for (const kept of parsed.data.servers) {
      const known = LOOPBACK_MODEL_SERVERS.find((server) => server.port === kept.port);
      if (known && kept.models.length > 0) servers.push({ ...known, models: kept.models });
    }
    return {
      version: 2,
      checkedAt: parsed.data.checkedAt,
      servers,
      cliEngines: parsed.data.cliEngines ?? [],
    };
  } catch {
    return null;
  }
}

/**
 * One detection pass per process. The last result is kept on disk and returned at once; a
 * fresh check runs behind it, concurrent callers share it, and it always settles by the
 * deadline even when a probe ignores its abort signal.
 */
export class LocalSetupCheck {
  #findings: MachineFindings | null;
  #running: Promise<MachineFindings> | null = null;
  readonly #file: string;
  readonly #probe: (signal: AbortSignal) => Promise<FoundServer[]>;
  readonly #cliProbe: ((signal: AbortSignal) => Promise<CliEngineStatus[]>) | undefined;
  readonly #deadlineMs: number;
  readonly #now: () => number;

  constructor(options: {
    file: string;
    probe: (signal: AbortSignal) => Promise<FoundServer[]>;
    /** Reads the coding-agent CLIs; it shares the deadline but never holds the servers up. */
    cliProbe?: (signal: AbortSignal) => Promise<CliEngineStatus[]>;
    deadlineMs?: number;
    now?: () => number;
  }) {
    this.#file = options.file;
    this.#probe = options.probe;
    this.#cliProbe = options.cliProbe;
    this.#deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
    this.#now = options.now ?? Date.now;
    this.#findings = readKept(this.#file);
  }

  current(): { findings: MachineFindings | null; checking: boolean } {
    return { findings: this.#findings, checking: this.#running !== null };
  }

  refresh(): Promise<MachineFindings> {
    this.#running ??= this.#run().finally(() => {
      this.#running = null;
    });
    return this.#running;
  }

  async #run(): Promise<MachineFindings> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<"deadline">((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve("deadline");
      }, this.#deadlineMs);
    });
    // Each source settles by the deadline on its own, so a hung one contributes nothing.
    const within = async <T>(probe: Promise<T>, empty: T): Promise<T> => {
      const result = await Promise.race([probe.catch(() => empty), deadline]);
      return result === "deadline" ? empty : result;
    };
    const [servers, cliEngines] = await Promise.all([
      within(this.#probe(controller.signal), [] as FoundServer[]),
      this.#cliProbe
        ? within(this.#cliProbe(controller.signal), [] as CliEngineStatus[])
        : Promise.resolve([] as CliEngineStatus[]),
    ]);
    clearTimeout(timer);
    const findings: MachineFindings = { version: 2, checkedAt: this.#now(), servers, cliEngines };
    this.#findings = findings;
    await this.#persist(findings);
    return findings;
  }

  async #persist(findings: MachineFindings): Promise<void> {
    const tmp = `${this.#file}.tmp`;
    try {
      await mkdir(path.dirname(this.#file), { recursive: true });
      await writeFile(tmp, JSON.stringify(findings), { mode: 0o600 });
      await rename(tmp, this.#file);
    } catch {
      // The report still comes from memory when the disk cannot be written.
      await rm(tmp, { force: true }).catch(() => undefined);
    }
  }
}
