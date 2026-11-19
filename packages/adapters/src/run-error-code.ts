import { SandboxStorageFullError } from "@corvo/adapter-kit";
import { PLAN_ERROR_CODES, type RunErrorInfo, type RunStopReason } from "@corvo/contracts";
import {
  ACCOUNT_PAUSED_RUN_ERROR,
  BOT_DAILY_LIMIT_RUN_ERROR,
  BOT_MONTHLY_LIMIT_RUN_ERROR,
  BOT_REPLY_CAP_RUN_ERROR,
  HOSTED_MODEL_CREDITS_REQUIRED_ERROR,
  MEMBER_MONTHLY_LIMIT_RUN_ERROR,
  MISSING_MODEL_RUN_ERROR,
  MODEL_ACCESS_REQUIRED_RUN_ERROR,
  maskSecrets,
  normalizeRunError,
  PARTNER_CREDIT_USED_UP_RUN_ERROR,
  PARTNER_MODEL_NOT_ALLOWED_RUN_ERROR,
  SPACE_PAUSED_RUN_ERROR,
  WORKSPACE_PERSONAL_MODEL_RUN_ERROR,
} from "@corvo/core";
import { isComputerSetupFailure } from "./computer-setup-error.js";
import { isSandboxStorageFullError } from "./sandbox-errors.js";

const REASON_MAX = 160;

/** What the run knows that its error does not say. */
export type RunErrorContext = {
  botName?: string;
  provider?: string | null;
  model?: string | null;
  stopReason?: RunStopReason;
};

const BY_MESSAGE: Record<string, RunErrorInfo> = {
  [BOT_MONTHLY_LIMIT_RUN_ERROR]: { code: "monthly_limit", params: { scope: "bot" } },
  [MEMBER_MONTHLY_LIMIT_RUN_ERROR]: { code: "monthly_limit", params: { scope: "member" } },
  [BOT_DAILY_LIMIT_RUN_ERROR]: { code: "daily_credit_limit", params: { scope: "bot" } },
  [PARTNER_CREDIT_USED_UP_RUN_ERROR]: { code: "daily_credit_limit", params: { scope: "credit" } },
  [PARTNER_MODEL_NOT_ALLOWED_RUN_ERROR]: { code: "model_not_allowed" },
  [ACCOUNT_PAUSED_RUN_ERROR]: { code: "paused", params: { scope: "account" } },
  [SPACE_PAUSED_RUN_ERROR]: { code: "paused", params: { scope: "space" } },
  [BOT_REPLY_CAP_RUN_ERROR]: { code: "reply_cap" },
  [MODEL_ACCESS_REQUIRED_RUN_ERROR]: { code: "no_model_access" },
  [MISSING_MODEL_RUN_ERROR]: { code: "no_model_access" },
  [HOSTED_MODEL_CREDITS_REQUIRED_ERROR]: { code: "no_model_access" },
  [WORKSPACE_PERSONAL_MODEL_RUN_ERROR]: { code: "no_model_access" },
};

const BY_STOP_REASON: Partial<Record<RunStopReason, RunErrorInfo["code"]>> = {
  reply_cap: "reply_cap",
  monthly_limit: "monthly_limit",
  paused: "paused",
};

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

function megabytes(bytes: number): string {
  return String(Math.round(bytes / 1024 / 1024));
}

/** One short line of what the provider said, with secrets masked and no stack. */
function shortReason(message: string): string {
  const line = maskSecrets(message).split("\n")[0]?.trim() ?? "";
  return line.length > REASON_MAX ? `${line.slice(0, REASON_MAX)}…` : line;
}

function causes(error: unknown): unknown[] {
  const chain: unknown[] = [];
  for (let current = error; current instanceof Error && chain.length < 6; current = current.cause)
    chain.push(current);
  return chain;
}

/**
 * The code and params a failed run saves beside its English text. `message` is that text, which
 * the app's fixed run errors are matched by exactly; an error class or a stop reason decides first.
 */
export function classifyRunError(
  error: unknown,
  message: string,
  context: RunErrorContext = {},
): RunErrorInfo {
  const stopped = context.stopReason ? BY_STOP_REASON[context.stopReason] : undefined;
  const trimmed = message.trim();
  const exact = BY_MESSAGE[trimmed];
  if (exact) return exact;
  if (stopped) return { code: stopped };
  if (context.stopReason) return { code: "turn_stopped", params: { kind: context.stopReason } };
  const storage = causes(error).find((item) => item instanceof SandboxStorageFullError);
  if (storage instanceof SandboxStorageFullError || isSandboxStorageFullError(error)) {
    const params: Record<string, string> = {};
    if (context.botName) params.agent = context.botName;
    if (storage instanceof SandboxStorageFullError) {
      if (storage.usage) params.top = storage.usage;
      if (storage.disk) {
        params.usedMb = megabytes(storage.disk.usedBytes);
        params.totalMb = megabytes(storage.disk.totalBytes);
      }
    }
    return { code: "computer_storage_full", params };
  }
  const planCode = causes(error)
    .map(errorCode)
    .find((code) => code?.startsWith("PLAN_"));
  if (planCode === PLAN_ERROR_CODES.storageFull) return { code: "plan_storage_full" };
  if (planCode === PLAN_ERROR_CODES.computerLimit) return { code: "plan_computer_limit" };
  if (isComputerSetupFailure(error)) {
    return {
      code: "computer_start_failed",
      params: { ...(context.botName ? { agent: context.botName } : {}) },
    };
  }
  if (errorCode(error) === "SANDBOX_RATE_LIMITED" || errorCode(error) === "SANDBOX_UNAVAILABLE") {
    return {
      code: "computer_start_failed",
      params: { ...(context.botName ? { agent: context.botName } : {}) },
    };
  }
  if (errorCode(error) === "SANDBOX_DAMAGED") {
    return {
      code: "computer_start_failed",
      params: { ...(context.botName ? { agent: context.botName } : {}), damaged: "1" },
    };
  }
  const name = error instanceof Error ? error.name : "";
  if (
    name === "TransientModelError" ||
    name === "ModelAccountError" ||
    name === "ModelOutputError" ||
    (name !== "Error" && name !== "" && /Model/.test(name))
  ) {
    return modelError(message, context);
  }
  const normalized = normalizeRunError(message);
  if (normalized.kind || normalized.transport) return modelError(message, context);
  return { code: "unknown" };
}

function modelError(message: string, context: RunErrorContext): RunErrorInfo {
  const normalized = normalizeRunError(message);
  if (normalized.kind === "rate")
    return { code: "model_rate_limited", params: providerParams(context) };
  if (normalized.transport === "timeout")
    return { code: "timeout", params: providerParams(context) };
  return {
    code: "model_provider_error",
    params: {
      ...providerParams(context),
      ...(normalized.kind ? { kind: normalized.kind } : {}),
      ...(normalized.transport ? { kind: normalized.transport } : {}),
      reason: shortReason(message),
    },
  };
}

function providerParams(context: RunErrorContext): Record<string, string> {
  return {
    ...(context.provider ? { provider: context.provider } : {}),
    ...(context.model ? { model: context.model } : {}),
  };
}
