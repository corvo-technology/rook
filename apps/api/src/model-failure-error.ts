import { ModelRequestError } from "@corvo/adapter-kit";
import { MODEL_FAILURE_REASON } from "@corvo/contracts";
import { maskSecrets } from "@corvo/core";
import { ORPCError } from "@orpc/server";

/**
 * A model probe or connect failure as an RPC error. The message stays the human line; the status,
 * transport code and masked raw text ride in `data` so every client can classify the same way.
 */
export function modelFailureError(
  error: unknown,
  fallback: string,
): ORPCError<"BAD_REQUEST", unknown> {
  const message = error instanceof Error ? error.message : fallback;
  if (!(error instanceof ModelRequestError)) return new ORPCError("BAD_REQUEST", { message });
  const { status, code, details } = error.facts;
  return new ORPCError("BAD_REQUEST", {
    message,
    data: {
      reason: MODEL_FAILURE_REASON,
      modelFailure: {
        details: maskSecrets(details ?? message).slice(0, 8000),
        ...(status !== undefined ? { status } : {}),
        ...(code ? { code } : {}),
      },
    },
  });
}
