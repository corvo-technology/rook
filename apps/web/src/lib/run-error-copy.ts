import type { RunErrorInfo } from "@corvo/contracts";
import { COMPUTER_SETUP_RUN_ERROR } from "@corvo/contracts";
import type { ModelProblemAction } from "@corvo/core";
import { maskSecrets, normalizeRunError } from "@corvo/core";
import { i18n } from "@lingui/core";
import { webRunProblem } from "./model-problem";
import { translateRunError } from "./run-error";

/** What a person can do from a failed run's card. */
export type RunErrorAction =
  | "retry"
  | "recover"
  | "free-space"
  | "open-usage"
  | "adjust-limit"
  | "resume"
  | "change-model"
  | "connect"
  | "sign-in"
  | "replace-key";

export type RunErrorView = {
  title: string;
  /** One short line of why, or what to do. */
  line: string;
  tone: "destructive" | "warning";
  actions: RunErrorAction[];
  /** The technical code and, where it adds something, the provider's own message. */
  details: string;
};

const locale = () => i18n.locale || undefined;

const MODEL_ACTIONS: Record<ModelProblemAction, RunErrorAction> = {
  "sign-in": "sign-in",
  "replace-key": "replace-key",
  connect: "connect",
  "change-model": "change-model",
  "raise-limit": "adjust-limit",
  resume: "resume",
};

/** Directories the computer names by path, in words a person knows. */
function directoryName(name: string): string {
  const base = name.replace(/^\.\//, "");
  if (/(^|\/)\.browser-profiles(\/|$)/.test(base)) {
    return i18n._({ id: "browser profiles", message: "browser profiles" });
  }
  return base;
}

function size(megabytes: number, unit: "megabyte" | "gigabyte"): string {
  return new Intl.NumberFormat(locale(), {
    style: "unit",
    unit,
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(unit === "gigabyte" ? megabytes / 1024 : megabytes);
}

/** ".codex 475 MB, .nvm 229 MB" as the list a person reads, with sizes in their language. */
function largestDirectories(raw: string): string {
  return raw
    .split(", ")
    .map((piece) => {
      const match = piece.match(/^(.*) (\d+) MB$/);
      return match
        ? `${directoryName(match[1] ?? "")} ${size(Number(match[2]), "megabyte")}`
        : piece;
    })
    .join(", ");
}

function storageFullLine(params: Record<string, string>): string {
  const parts: string[] = [];
  const used = Number(params.usedMb);
  const total = Number(params.totalMb);
  if (params.usedMb && params.totalMb && Number.isFinite(used) && Number.isFinite(total)) {
    const unit = total < 1024 ? "megabyte" : "gigabyte";
    parts.push(
      i18n._({
        id: "Using {used} of {total}.",
        message: "Using {used} of {total}.",
        values: { used: size(used, unit), total: size(total, unit) },
      }),
    );
  }
  if (params.top) {
    parts.push(
      i18n._({
        id: "Largest: {top}.",
        message: "Largest: {top}.",
        values: { top: largestDirectories(params.top) },
      }),
    );
  }
  return parts.length
    ? parts.join(" ")
    : i18n._({
        id: "Free up space or recover the computer.",
        message: "Free up space or recover the computer.",
      });
}

/** The provider's own message, when it says something the title and line do not. */
function supportMessage(info: RunErrorInfo, raw: string): string {
  if (
    info.code !== "model_provider_error" &&
    info.code !== "model_rate_limited" &&
    info.code !== "timeout" &&
    info.code !== "computer_start_failed" &&
    info.code !== "unknown"
  ) {
    return "";
  }
  const lines = raw.trim().split("\n");
  if (lines[0]?.trim() === COMPUTER_SETUP_RUN_ERROR) lines.shift();
  return maskSecrets(lines.join("\n").trim());
}

function view(
  info: RunErrorInfo,
  raw: string,
  fields: Omit<RunErrorView, "details">,
): RunErrorView {
  const message = supportMessage(info, raw);
  return { ...fields, details: message ? `${info.code}\n${message}` : info.code };
}

/**
 * A failed run's card in the viewer's language, from the code the server saved. `raw` is the
 * English text saved beside it: the provider's words for Details, and what the model errors'
 * one-line reason is translated from.
 */
export function describeRunError(
  info: RunErrorInfo,
  raw: string,
  authKind?: Parameters<typeof webRunProblem>[1],
): RunErrorView {
  const p = info.params ?? {};
  const agent = p.agent;
  switch (info.code) {
    case "computer_storage_full":
      return view(info, raw, {
        title: agent
          ? i18n._({
              id: "{agent}'s computer is out of space",
              message: "{agent}'s computer is out of space",
              values: { agent },
            })
          : i18n._({ id: "The computer is out of space", message: "The computer is out of space" }),
        line: storageFullLine(p),
        tone: "destructive",
        actions: ["free-space", "recover"],
      });
    case "computer_start_failed":
      return view(info, raw, {
        title: agent
          ? i18n._({
              id: "Couldn't start {agent}'s computer",
              message: "Couldn't start {agent}'s computer",
              values: { agent },
            })
          : i18n._({ id: "Couldn't start the computer", message: "Couldn't start the computer" }),
        line:
          p.damaged === "1"
            ? i18n._({
                id: "Its system is damaged. Recover it to rebuild it.",
                message: "Its system is damaged. Recover it to rebuild it.",
              })
            : i18n._({
                id: "Try again. If it keeps failing, recover the computer.",
                message: "Try again. If it keeps failing, recover the computer.",
              }),
        tone: "destructive",
        actions: p.damaged === "1" ? ["recover", "retry"] : ["retry", "recover"],
      });
    case "computer_home_lost":
      return view(info, raw, {
        title: i18n._({
          id: "The computer lost its saved files",
          message: "The computer lost its saved files",
        }),
        line: i18n._({
          id: "It started fresh. Recover the computer to rebuild it.",
          message: "It started fresh. Recover the computer to rebuild it.",
        }),
        tone: "warning",
        actions: ["recover", "retry"],
      });
    case "model_provider_error":
    case "model_rate_limited":
    case "timeout": {
      const problem = webRunProblem(raw, authKind);
      const action = problem.action ? MODEL_ACTIONS[problem.action] : undefined;
      const title =
        info.code === "model_rate_limited"
          ? i18n._({ id: "The model is busy", message: "The model is busy" })
          : info.code === "timeout"
            ? i18n._({ id: "The model took too long", message: "The model took too long" })
            : p.model
              ? i18n._({
                  id: "{model} couldn't answer",
                  message: "{model} couldn't answer",
                  values: { model: p.model },
                })
              : i18n._({ id: "The model couldn't answer", message: "The model couldn't answer" });
      return view(info, raw, {
        title,
        line: problem.line,
        tone: "destructive",
        actions: [
          ...(action ? [action] : []),
          ...(problem.retry && action !== "adjust-limit" && action !== "resume"
            ? (["retry"] as const)
            : []),
        ],
      });
    }
    case "monthly_limit":
      return view(info, raw, {
        title: i18n._({ id: "Monthly limit reached", message: "Monthly limit reached" }),
        line:
          p.scope === "member"
            ? i18n._({
                id: "Your monthly use of this space's model is used up.",
                message: "Your monthly use of this space's model is used up.",
              })
            : i18n._({
                id: "Raise this agent's token limit to keep going.",
                message: "Raise this agent's token limit to keep going.",
              }),
        tone: "warning",
        actions: p.scope === "member" ? ["open-usage"] : ["adjust-limit", "open-usage"],
      });
    case "daily_credit_limit":
      return view(info, raw, {
        title:
          p.scope === "credit"
            ? i18n._({ id: "Credit used up", message: "Credit used up" })
            : i18n._({ id: "Daily limit reached", message: "Daily limit reached" }),
        line:
          p.scope === "credit"
            ? i18n._({
                id: "Usage resumes when the period resets.",
                message: "Usage resumes when the period resets.",
              })
            : i18n._({
                id: "This agent used its daily budget. Raise the limit or wait until tomorrow.",
                message:
                  "This agent used its daily budget. Raise the limit or wait until tomorrow.",
              }),
        tone: "warning",
        actions: p.scope === "credit" ? ["open-usage"] : ["adjust-limit", "open-usage"],
      });
    case "paused":
      return view(info, raw, {
        title:
          p.scope === "account"
            ? i18n._({ id: "This account is paused", message: "This account is paused" })
            : i18n._({ id: "Agents are paused", message: "Agents are paused" }),
        line:
          p.scope === "account"
            ? i18n._({
                id: "Usage resumes when the account does.",
                message: "Usage resumes when the account does.",
              })
            : i18n._({
                id: "Resume this space to keep going.",
                message: "Resume this space to keep going.",
              }),
        tone: "warning",
        actions: p.scope === "account" ? [] : ["resume"],
      });
    case "reply_cap":
      return view(info, raw, {
        title: i18n._({
          id: "This reply hit its token limit",
          message: "This reply hit its token limit",
        }),
        line: i18n._({
          id: "Raise the agent's limit, or ask for a shorter reply.",
          message: "Raise the agent's limit, or ask for a shorter reply.",
        }),
        tone: "warning",
        actions: ["adjust-limit", "retry"],
      });
    case "plan_storage_full":
      return view(info, raw, {
        title: i18n._({
          id: "Your plan's storage is full",
          message: "Your plan's storage is full",
        }),
        line: i18n._({
          id: "Free up space or upgrade your plan.",
          message: "Free up space or upgrade your plan.",
        }),
        tone: "warning",
        actions: ["open-usage"],
      });
    case "plan_computer_limit":
      return view(info, raw, {
        title: i18n._({
          id: "Your plan's computer limit is reached",
          message: "Your plan's computer limit is reached",
        }),
        line: i18n._({
          id: "Upgrade your plan to add more computers.",
          message: "Upgrade your plan to add more computers.",
        }),
        tone: "warning",
        actions: ["open-usage"],
      });
    case "no_model_access":
      return view(info, raw, {
        title: i18n._({ id: "No model to run", message: "No model to run" }),
        line: i18n._({
          id: "Connect a model or subscribe to keep running agents.",
          message: "Connect a model or subscribe to keep running agents.",
        }),
        tone: "warning",
        actions: ["connect"],
      });
    case "turn_stopped":
      return view(info, raw, {
        title: i18n._({ id: "The agent stopped", message: "The agent stopped" }),
        line:
          p.kind === "tool_errors"
            ? i18n._({ id: "Its tools kept failing.", message: "Its tools kept failing." })
            : p.kind === "stall"
              ? i18n._({
                  id: "It got stuck and nothing was moving.",
                  message: "It got stuck and nothing was moving.",
                })
              : p.kind === "waiting"
                ? i18n._({
                    id: "It kept waiting for something that didn't arrive.",
                    message: "It kept waiting for something that didn't arrive.",
                  })
                : i18n._({
                    id: "It kept repeating the same step.",
                    message: "It kept repeating the same step.",
                  }),
        tone: "warning",
        actions: ["retry"],
      });
    case "unknown":
      return view(info, raw, {
        title: i18n._({ id: "Something went wrong", message: "Something went wrong" }),
        line: i18n._({ id: "Try again in a moment.", message: "Try again in a moment." }),
        tone: "destructive",
        actions: ["retry"],
      });
  }
}

/**
 * A failed run's lines for a history row: its title and why in the viewer's language when the run
 * saved a code, otherwise the summary of its text, which older runs still have.
 */
export function runFailureLines(
  error: string,
  info: RunErrorInfo | null | undefined,
  locale: string,
): { title: string; line?: string; details: string } {
  if (info) {
    const view = describeRunError(info, error);
    return { title: view.title, line: view.line, details: view.details };
  }
  return { title: normalizeRunError(error, translateRunError, locale).summary, details: error };
}
