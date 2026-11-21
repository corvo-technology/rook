import type { ApprovalCardCode, MetaCode, NotificationCode } from "@corvo/contracts";
import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { storageUsageParts } from "./run-error-copy";

type Params = Record<string, string>;

/** The active UI language, or the browser default before one is activated. */
const locale = () => i18n.locale || undefined;

/** `text` and `detail` of an approval card, worded in the viewer's language from its code. */
export type ApprovalCardCopy = { title: string; lines: string[] };

function formatWhen(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    const local = new Intl.DateTimeFormat(locale(), {
      timeZone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
    return `${local} ${timeZone}`;
  } catch {
    return iso;
  }
}

/**
 * Wording for the cards the server proposes. The server sends the code and its params; its own
 * English `text` and `detail` are only for clients that do not know a code.
 */
export function approvalCardCopy(
  code: ApprovalCardCode,
  p: Params,
  /** The English `detail`, whose text after its length lines is the new instructions. */
  detail?: string,
): ApprovalCardCopy | undefined {
  const {
    name = "",
    site = "",
    members = "",
    purpose = "",
    group = "",
    rename = "",
    add = "",
    remove = "",
    bot = "",
    from = "",
    to = "",
    thinking = "",
    routine = "",
    lastAgent = "",
    agent = "",
    instruction = "",
    prompt = "",
    cron = "",
    provider = "",
    address = "",
    reason = "",
    read = "",
    write = "",
    task = "",
    instructions = "",
  } = p;
  switch (code) {
    case "create_group":
      return {
        title: t`Create group “${name}”?`,
        lines: [t`Members: ${members}`, ...(purpose ? [t`Purpose: ${purpose}`] : [])],
      };
    case "update_group": {
      const lines: string[] = [];
      if (rename) lines.push(t`Rename to “${rename}”`);
      if (purpose) lines.push(t`Purpose: ${purpose}`);
      if (p.clearPurpose) lines.push(t`Clear the purpose`);
      if (add) lines.push(t`Add: ${add}`);
      if (remove) lines.push(t`Remove: ${remove}`);
      return { title: t`Update group “${group}”?`, lines };
    }
    case "change_model": {
      const defaultModel = t`Default model`;
      const fromModel = from || defaultModel;
      const toModel = to || defaultModel;
      const lines = [t`From: ${fromModel}`, t`To: ${toModel}`];
      if (thinking) lines.push(t`Thinking: ${thinking}`);
      else if (p.thinkingDefault) lines.push(t`Thinking: Default`);
      return { title: t`Change the model of ${bot}?`, lines };
    }
    case "schedule_routine": {
      const when = formatWhen(p.at ?? "", p.timezone ?? "UTC");
      return {
        title: t`Schedule “${name}” for ${bot}?`,
        lines: [
          cron ? t`Repeats ${cron}, next at ${when}` : t`Runs at ${when}`,
          t`Prompt: ${prompt}`,
        ],
      };
    }
    case "add_routine_step":
      return {
        title: t`Add a step to “${routine}”?`,
        lines: [t`After ${lastAgent} finishes, ${agent} runs it`, t`Instruction: ${instruction}`],
      };
    case "replace_instructions": {
      const oldLength = Number(p.oldLength).toLocaleString(locale());
      const newLength = Number(p.newLength).toLocaleString(locale());
      return {
        title: t`Replace the instructions of ${bot}?`,
        lines: [
          t`Old length: ${oldLength} characters`,
          t`New length: ${newLength} characters`,
          "",
          detail?.split("\n").slice(3).join("\n") ?? "",
        ],
      };
    }
    case "update_instructions":
      return { title: t`Update instructions?`, lines: [] };
    case "agent_connection": {
      return {
        title:
          p.accept === "1"
            ? t`Approve connection with “${name}”?`
            : t`Decline connection with “${name}”?`,
        lines: [`${provider}: ${address}`],
      };
    }
    case "create_agent":
      return {
        title: t`Create agent “${name}”?`,
        lines: [
          ...(read ? [t`Can read: ${read}`] : []),
          ...(write ? [t`Can read and write: ${write}`] : []),
          ...(task ? [t`First task: ${task}`] : []),
          ...(instructions ? [t`Instructions: ${instructions}`] : []),
        ],
      };
    case "open_website":
      return { title: t`Open ${site}?`, lines: [] };
    case "create_space": {
      const space = name || t`Untitled`;
      return {
        title: t`Create space “${space}”?`,
        lines: [
          ...(reason ? [reason] : []),
          t`Bots, groups, chats, files, memory, and integrations in this space stay separate from other spaces.`,
        ],
      };
    }
  }
}

/** The line a system notice shows, worded in the viewer's language from its code. */
export function metaCopy(code: MetaCode, p: Params): string | undefined {
  const { name = "", reason = "" } = p;
  switch (code) {
    case "stronger_model":
      return t`Switched to a stronger model`;
    case "rule_approved": {
      const tool = p.tool ?? "";
      return t`Auto-approved by rule: ${tool}`;
    }
    case "budget_alert": {
      const used = Number(p.used).toLocaleString(locale());
      const limit = Number(p.limit).toLocaleString(locale());
      return t`${used} of ${limit} tokens`;
    }
    case "created_by":
      return t`Created by ${name}`;
    case "group_invite":
      return t`You were added to the group chat “${name}”. Reply YES in this conversation to join it with your agent.`;
    case "stuck_queued":
      return t`Stopped. This stayed queued without starting.`;
    case "stuck_waiting_input":
      return t`Stopped. This was still waiting for an answer.`;
    case "stuck_waiting_takeover":
      return t`Stopped. This was still waiting for you on the screen.`;
    case "branch_effects":
      return t`Actions already taken by the earlier reply were not undone.`;
    case "routine_watching":
      return t`${name} routine: watching for changes`;
    case "routine_no_changes":
      return t`${name} routine: no changes`;
    case "sandbox_storage_full":
      return [
        t`This agent's computer is full. Delete files it no longer needs.`,
        ...storageUsageParts(p),
      ].join(" ");
    case "sandbox_storage_low":
      return [
        t`This agent's computer is almost full. Delete files it no longer needs.`,
        ...storageUsageParts(p),
      ].join(" ");
    case "computer_home_lost":
      return t`This computer's saved files couldn't be found; it started fresh.`;
    case "routine_check_paused":
      return t`The ${name} routine is paused because its change check failed: ${reason}`;
  }
}

/** What stopped a customer's assistant, for the partner's administrators. */
function assistantCauseWords(cause: string | undefined): string | undefined {
  switch (cause) {
    case "no_model":
      return t`no model is connected`;
    case "credits_empty":
      return t`model credits are used up`;
    case "model_unpriced":
      return t`the model has no price`;
    case "model_not_allowed":
      return t`the model is not allowed`;
    case "transcription_unavailable":
      return t`transcription is not set up`;
    default:
      return undefined;
  }
}

/** The line an inbox alert shows, worded in the viewer's language from its code. */
export function notificationCopy(code: NotificationCode, p: Params): string {
  const name = p.name ?? "";
  switch (code) {
    case "storage_near_limit": {
      const percent = p.percent ?? "80";
      return t`Storage is ${percent}% full`;
    }
    case "partner_limit_reached":
      return t`${name} reached the monthly limit`;
    case "partner_balance_low":
      return t`Your credit fund is running low`;
    case "partner_autotopup_started":
      return t`Automatic top-up started`;
    case "partner_autotopup_failed":
      return t`Automatic top-up failed`;
    case "partner_invoice_issued":
      return t`New invoice`;
    case "partner_past_due":
      return t`${name} has a payment past due`;
    case "partner_connector_down":
      return t`${name}'s connector is down`;
    case "partner_assistant_unavailable": {
      const why = assistantCauseWords(p.cause);
      return why
        ? t`${name}'s assistant is unavailable: ${why}`
        : t`${name}'s assistant is unavailable`;
    }
  }
}
