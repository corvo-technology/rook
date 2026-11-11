import type { ModelFailureData, RunErrorKind } from "@corvo/contracts";
import { MODEL_FAILURE_REASON, ModelFailureDataSchema } from "@corvo/contracts";
import type { RunErrorTranslator } from "./run-error.js";
import { normalizeRunError } from "./run-error.js";
import { maskSecrets } from "./secret-mask.js";
import { isServerUnreachable, userErrorMessage } from "./user-error.js";

/** Presentation kinds only: the persisted `RunErrorKind` list stays as it is. */
export type ModelProblemKind =
  | RunErrorKind
  | "unreachable"
  | "tls"
  | "proxy"
  | "timeout"
  | "overloaded"
  | "offline"
  | "other";

export type ModelProblemAction = "sign-in" | "replace-key" | "connect" | "change-model";

export type ModelProblem = {
  kind: ModelProblemKind;
  line: string;
  action?: ModelProblemAction;
  resetAt?: number;
  details?: string;
  retry: boolean;
};

export type ModelProblemOptions = {
  authKind?: "api_key" | "oauth" | "openai_compatible";
  translate?: RunErrorTranslator;
  locale?: string;
  now?: number;
};

const english: RunErrorTranslator = (message, values) =>
  message.replace(/\{(\w+)\}/g, (match, key: string) => String(values?.[key] ?? match));

const UNREACHABLE_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);
const TIMEOUT_CODES = new Set([
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "ECONNRESET",
]);
const TLS_CODES = /^(?:CERT_|UNABLE_TO_|SELF_SIGNED_CERT|DEPTH_ZERO_SELF_SIGNED_CERT|ERR_TLS_)/;

function transportKind(code: string | undefined): "unreachable" | "tls" | "timeout" | undefined {
  if (!code) return undefined;
  if (UNREACHABLE_CODES.has(code)) return "unreachable";
  if (TLS_CODES.test(code)) return "tls";
  if (TIMEOUT_CODES.has(code)) return "timeout";
  return undefined;
}

/**
 * One plain line for a failed model call, the one action that fixes it, and the masked raw text.
 * Classifies from the transport code, then the HTTP status, then the provider's error envelope.
 */
export function describeModelProblem(
  failure: ModelFailureData,
  options: ModelProblemOptions = {},
): ModelProblem {
  const translate = options.translate ?? english;
  const masked = maskSecrets(failure.details);
  const finish = (
    problem: Omit<ModelProblem, "details" | "retry"> & { retry?: boolean },
  ): ModelProblem => {
    const details = masked.trim() === problem.line.trim() ? undefined : masked;
    return {
      ...problem,
      retry: problem.retry ?? problem.kind !== "context",
      ...(details ? { details } : {}),
    };
  };
  const provider = translate("Your model provider");
  const byCode = transportKind(failure.code);
  if (byCode) {
    const normalized = normalizeRunError(
      `${failure.code}: ${failure.details}`,
      translate,
      options.locale,
      options.now,
    );
    const line =
      normalized.transport === byCode
        ? normalized.summary
        : byCode === "tls"
          ? translate(
              "{provider} couldn't be reached securely. A security program or network filter may be intercepting the connection.",
              { provider },
            )
          : byCode === "unreachable"
            ? translate("{provider} couldn't be reached. Check that it's running.", { provider })
            : translate("{provider} took too long to respond. Try again.", { provider });
    return finish({ kind: byCode, line });
  }
  if (failure.status === 407) {
    return finish({
      kind: "proxy",
      line: translate(
        "{provider} couldn't be reached through the network proxy. Check the proxy settings.",
        { provider },
      ),
    });
  }
  const hasLeadingStatus = /^(?:[^\n():]{1,60} API error \(\d{3}\):|\d{3}(?:\s*:\s*|\s+))/.test(
    failure.details.trim(),
  );
  const input =
    failure.status !== undefined && !hasLeadingStatus
      ? `${failure.status}: ${failure.details}`
      : failure.details;
  const normalized = normalizeRunError(input, translate, options.locale, options.now);
  const kind: ModelProblemKind = normalized.kind ?? normalized.transport ?? "other";
  let line = normalized.summary;
  let action: ModelProblemAction | undefined;
  if (normalized.recovery === "model") action = "change-model";
  else if (normalized.recovery === "connection") {
    action =
      normalized.kind === "auth"
        ? options.authKind === "oauth"
          ? "sign-in"
          : "replace-key"
        : "connect";
  }
  if (kind === "auth" && options.authKind === "oauth") {
    line = translate("{provider} sign-in is no longer valid.", { provider });
  }
  return finish({
    kind,
    line,
    ...(action ? { action } : {}),
    ...(normalized.resetAt ? { resetAt: normalized.resetAt } : {}),
  });
}

/** The structured failure an API error carries, when it carries one. */
export function modelFailureData(error: unknown): ModelFailureData | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const data = (error as { data?: unknown }).data;
  if (data === null || typeof data !== "object") return undefined;
  const { reason, modelFailure } = data as { reason?: unknown; modelFailure?: unknown };
  if (reason !== MODEL_FAILURE_REASON) return undefined;
  const parsed = ModelFailureDataSchema.safeParse(modelFailure);
  return parsed.success ? parsed.data : undefined;
}

export function modelProblemFromError(
  error: unknown,
  fallback: string,
  options: ModelProblemOptions = {},
): ModelProblem {
  const failure = modelFailureData(error);
  if (failure) return describeModelProblem(failure, options);
  const translate = options.translate ?? english;
  if (isServerUnreachable(error)) {
    return { kind: "offline", line: translate("Could not reach the server"), retry: true };
  }
  return {
    kind: "other",
    line: userErrorMessage(error, { fallback, offline: translate("Could not reach the server") }),
    retry: true,
  };
}
