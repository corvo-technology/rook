import { readFileSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import * as z from "zod";
import {
  type FoundServer,
  LOOPBACK_MODEL_SERVERS,
  type MachineFindings,
} from "./loopback-servers.js";

const DEFAULT_DEADLINE_MS = 5_000;

const FindingsFileSchema = z.object({
  version: z.literal(1),
  checkedAt: z.number(),
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
    return { version: 1, checkedAt: parsed.data.checkedAt, servers };
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
  readonly #deadlineMs: number;
  readonly #now: () => number;

  constructor(options: {
    file: string;
    probe: (signal: AbortSignal) => Promise<FoundServer[]>;
    deadlineMs?: number;
    now?: () => number;
  }) {
    this.#file = options.file;
    this.#probe = options.probe;
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
    const deadline = new Promise<FoundServer[]>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve([]);
      }, this.#deadlineMs);
    });
    const servers = await Promise.race([
      this.#probe(controller.signal).catch((): FoundServer[] => []),
      deadline,
    ]);
    clearTimeout(timer);
    const findings: MachineFindings = { version: 1, checkedAt: this.#now(), servers };
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
