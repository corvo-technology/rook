/**
 * Where the cached prefix of one turn ends and the next turn's begins: the end of the user
 * message block. Pi marks the system prompt, the last tool and the last block; for payloads in
 * the Anthropic format this adds one more marker at that boundary, so the next turn can read
 * the earlier conversation from the cache instead of only the system prompt and the tools.
 * Providers allow four markers; the payload is left alone when it has none to copy or no room.
 */
const MAX_CACHE_MARKERS = 4;

type Block = { type?: unknown; text?: unknown; cache_control?: unknown };
type PayloadHook = (payload: unknown, model: never) => unknown;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function markers(payload: Record<string, unknown>): unknown[] {
  const found: unknown[] = [];
  const visit = (value: unknown) => {
    if (isRecord(value) && value.cache_control !== undefined) found.push(value.cache_control);
  };
  if (Array.isArray(payload.system)) payload.system.forEach(visit);
  if (Array.isArray(payload.tools)) payload.tools.forEach(visit);
  if (Array.isArray(payload.messages)) {
    for (const message of payload.messages) {
      if (isRecord(message) && Array.isArray(message.content)) message.content.forEach(visit);
      else visit(message);
    }
  }
  return found;
}

/** A new payload with the extra marker, or undefined when nothing changes. */
export function markCacheBoundary(payload: unknown, boundaryText: string): unknown {
  if (!isRecord(payload) || !Array.isArray(payload.messages)) return undefined;
  const existing = markers(payload);
  if (existing.length === 0 || existing.length >= MAX_CACHE_MARKERS) return undefined;
  const messages = payload.messages as unknown[];
  for (let m = messages.length - 1; m >= 0; m--) {
    const message = messages[m];
    if (!isRecord(message) || message.role !== "user" || !Array.isArray(message.content)) continue;
    const content = message.content as Block[];
    for (let b = content.length - 1; b >= 0; b--) {
      const block = content[b];
      if (block?.type !== "text" || block.text !== boundaryText) continue;
      if (block.cache_control !== undefined) return undefined;
      const nextContent = content.map((item, index) =>
        index === b ? { ...item, cache_control: existing[0] } : item,
      );
      const nextMessages = messages.map((item, index) =>
        index === m ? { ...(item as object), content: nextContent } : item,
      );
      return { ...payload, messages: nextMessages };
    }
  }
  return undefined;
}

/** Stream options with the boundary marker added after any onPayload hook already there. */
export function withCacheBoundary<O extends object>(
  options: O | undefined,
  boundaryText: () => string | undefined,
): O {
  const previous = (options as { onPayload?: PayloadHook } | undefined)?.onPayload;
  return {
    ...(options ?? {}),
    onPayload: async (payload: unknown, model: never) => {
      const replaced = previous ? await previous(payload, model) : undefined;
      const text = boundaryText();
      const marked = text ? markCacheBoundary(replaced ?? payload, text) : undefined;
      return marked ?? replaced;
    },
  } as O;
}
