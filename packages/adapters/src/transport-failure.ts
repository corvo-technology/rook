const MAX_CAUSE_DEPTH = 5;

/**
 * undici reports refused ports, unreachable hosts, DNS misses and TLS errors alike as
 * `TypeError: fetch failed` and keeps the actionable reason in `cause` (or in the per-address
 * errors of a happy-eyeballs AggregateError).
 */
export function transportFailureDetail(error: unknown, depth = 0): string | undefined {
  if (depth >= MAX_CAUSE_DEPTH || !(error instanceof Error)) return undefined;
  if (error instanceof AggregateError) {
    for (const inner of error.errors) {
      const detail = transportFailureDetail(inner, depth + 1);
      if (detail) return detail;
    }
  }
  return (
    transportFailureDetail(error.cause, depth + 1) ??
    (error.message === "fetch failed" ? undefined : error.message)
  );
}

/** The error code (`ETIMEDOUT`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`...) of the failure the network reported. */
export function transportFailureCode(error: unknown, depth = 0): string | undefined {
  if (depth >= MAX_CAUSE_DEPTH || !(error instanceof Error)) return undefined;
  if (error instanceof AggregateError) {
    for (const inner of error.errors) {
      const code = transportFailureCode(inner, depth + 1);
      if (code) return code;
    }
  }
  const own = (error as { code?: unknown }).code;
  return (
    transportFailureCode(error.cause, depth + 1) ?? (typeof own === "string" ? own : undefined)
  );
}

function hostOf(input: unknown): string | undefined {
  try {
    const url =
      typeof input === "string" || input instanceof URL
        ? String(input)
        : input && typeof input === "object" && "url" in input
          ? String((input as { url: unknown }).url)
          : undefined;
    return url ? new URL(url).host : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A `fetch failed` that says why. The request's host is named (never its path or query, which can
 * carry a key) and so is the reason the network gave, so a certificate problem is not mistaken for
 * a slow provider. Anything else, a cancelled request included, is left as it was.
 */
export function explainFetchFailure(error: unknown, input: unknown): unknown {
  if (!(error instanceof TypeError) || error.message !== "fetch failed") return error;
  const detail = transportFailureDetail(error);
  const code = transportFailureCode(error);
  const host = hostOf(input);
  const reason = detail ? `: ${detail}${code && !detail.includes(code) ? ` (${code})` : ""}` : "";
  // The same error, so its type and its cause chain stay as callers expect; only the message says more.
  error.message = `fetch failed${host ? ` (${host})` : ""}${reason}`;
  return error;
}
