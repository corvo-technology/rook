import type { LocalSpeech } from "@corvo/adapters";
import { chooseLocalVoice, DEFAULT_LOCAL_MODEL } from "@corvo/adapters";

/** What the owner's own computer uses to listen and speak when no voice is connected. */
export const DEFAULT_LOCAL_SECRET = JSON.stringify({
  model: DEFAULT_LOCAL_MODEL,
  language: "auto",
});

/** How long a request waits for a download it started before it asks the client to come back. */
export const LOCAL_MODEL_WAIT_MS = 50_000;

/** The model a request needs is still downloading. The download carries on without the request. */
export class LocalModelPreparing extends Error {
  readonly code = "VOICE_PREPARING";

  constructor(readonly sizeBytes: number) {
    super("The voice on this computer is still being downloaded.");
    this.name = "LocalModelPreparing";
  }
}

/** The ids of the voices that are on this computer. */
export async function readyLocalVoices(local: LocalSpeech): Promise<string[]> {
  return (await local.store.list())
    .filter((model) => model.kind === "speak" && model.state === "ready")
    .map((model) => model.id);
}

/** The voice that reads a reply in `language`, and whether it is on this computer yet. */
export async function chooseVoiceForLanguage(
  local: LocalSpeech,
  input: { language?: string | undefined; selected?: string | undefined },
) {
  const ready = await readyLocalVoices(local);
  const id = chooseLocalVoice({
    language: input.language,
    selected: input.selected,
    ready,
    voices: local.store.specs("speak"),
  });
  const spec = local.store.spec(id);
  return { id, ready: ready.includes(id), sizeBytes: spec?.sizeBytes ?? 0 };
}

/**
 * Starts the download of a model nobody has fetched and waits a while for it. The download is
 * not tied to the request, so a client that gives up does not cancel it for the next try.
 */
export async function ensureLocalModel(
  local: LocalSpeech,
  id: string,
  waitMs: number = LOCAL_MODEL_WAIT_MS,
): Promise<void> {
  const model = (await local.store.list()).find((entry) => entry.id === id);
  if (!model || model.state === "ready") return;
  const download = local.store.ensure(id);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"pending">((resolve) => {
    timer = setTimeout(() => resolve("pending"), waitMs);
    timer.unref();
  });
  try {
    const outcome = await Promise.race([download.then(() => "ready" as const), timeout]);
    if (outcome === "pending") {
      // Nobody awaits the rest of this download; its failure shows in the model list.
      download.catch(() => undefined);
      throw new LocalModelPreparing(model.sizeBytes);
    }
  } finally {
    clearTimeout(timer);
  }
}
