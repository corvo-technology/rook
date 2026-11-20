import * as z from "zod";
import { AgentImportSetupItemSchema } from "./agent-import-setup.js";
import { botSecretDestinationSchema } from "./bot-secrets.js";
import { Id } from "./ids.js";
import { McpTransportSchema } from "./mcp.js";

export const ProductEventType = z.enum([
  "thread.message.created",
  "thread.cleared",
  /** The conversation now shows another version; the payload carries its branch (null: the original) and fork seq. */
  "thread.branch.changed",
  "thread.message.updated",
  "thread.message.reaction",
  /** A message was pinned or unpinned; the payload carries its id and `pinnedAt` (null when unpinned). */
  "thread.message.pinned",
  "thread.progress",
  "thread.artifact",
  "thread.ask",
  "thread.choice",
  "thread.meta",
  "thread.computer",
  "thread.subagent",
  "thread.cloud_agent",
  "thread.call.ended",
  "run.started",
  "run.steering.claimed",
  "run.checkpointed",
  "run.waiting_input",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "computer.status",
  "computer.takeover.requested",
  "computer.takeover.granted",
  "computer.takeover.released",
  "computer.command",
  "memory.revised",
  "routine.created",
  "routine.updated",
  "routine.fired",
  "skill.teaching.started",
  "skill.teaching.stopped",
  "skill.draft.created",
  "skill.saved",
  "effect.recorded",
  "agent.tool.called",
  "agent.tool.completed",
  "effect.reconciled",
  "usage.recorded",
  "bot.spawned",
  "bot.updated",
  "bot.archived",
  "bot.deleted",
  "group.created",
  "group.updated",
  "group.handoff",
  /** Liveness only: never persisted, never applied to a snapshot, always seq 0. */
  "heartbeat",
  /**
   * Too much happened after the client's cursor to replay. Never persisted; its seq is the head the
   * stream continues from, and the client takes a fresh snapshot instead of the missed events.
   */
  "thread.resync",
]);
export type ProductEventType = z.infer<typeof ProductEventType>;

export const MessageRole = z.enum(["user", "bot", "system"]);
export const BotMessageIntent = z.enum(["request", "result", "question", "status", "fyi"]);
export type BotMessageIntent = z.infer<typeof BotMessageIntent>;

export const MAX_CHART_DATA_ROWS = 5_000;

const ChartSpec = z.record(z.string(), z.any());

function embeddedChartRowCount(spec: Record<string, unknown>): number {
  const specData = Array.isArray(spec.data) ? spec.data.length : 0;
  const markData = Array.isArray(spec.marks)
    ? spec.marks.reduce((total, mark) => {
        if (!mark || typeof mark !== "object" || !Array.isArray(mark.data)) return total;
        return total + mark.data.length;
      }, 0)
    : 0;
  return specData + markData;
}

const ChartBlock = z
  .object({
    kind: z.literal("chart"),
    name: z.string(),
    /** Declarative Observable Plot spec, validated by render_plot before publish.
        z.any keeps the inferred type JSON-assignable for persistence. */
    spec: ChartSpec,
    data: z.array(z.any()).max(MAX_CHART_DATA_ROWS),
  })
  .superRefine((block, ctx) => {
    if (block.data.length + embeddedChartRowCount(block.spec) <= MAX_CHART_DATA_ROWS) return;
    ctx.addIssue({
      code: "custom",
      message: `Chart data exceeds the ${MAX_CHART_DATA_ROWS.toLocaleString("en-US")}-row limit`,
    });
  });

export const SecretAskPurpose = z.enum(["otp", "password", "api_key"]);
export type SecretAskPurpose = z.infer<typeof SecretAskPurpose>;

/** The longest reason a handoff can carry. */
export const HANDOFF_REASON_MAX_LENGTH = 300;

/**
 * Text the server composes for a person is sent as a code plus params, and the client words it in
 * the member's language. The English `text` / `detail` stay beside it for clients that do not know
 * a code. Add a code here, its English fallback where it is built, and its Lingui wording in
 * `apps/web/src/lib/server-copy.ts`.
 */
export const ApprovalCardCode = z.enum([
  "create_group",
  "update_group",
  "change_model",
  "schedule_routine",
  "add_routine_step",
  "replace_instructions",
  "update_instructions",
  "agent_connection",
  "create_space",
  "create_agent",
]);
export type ApprovalCardCode = z.infer<typeof ApprovalCardCode>;

export const MetaCode = z.enum([
  "stronger_model",
  "budget_alert",
  "created_by",
  "group_invite",
  "stuck_queued",
  "stuck_waiting_input",
  "stuck_waiting_takeover",
  "routine_watching",
  "routine_no_changes",
  "routine_check_paused",
  "sandbox_storage_full",
  "computer_home_lost",
  "rule_approved",
  "branch_effects",
]);
export type MetaCode = z.infer<typeof MetaCode>;

/** Flat string params a code's wording is filled from. */
export const ServerCopyParams = z.record(z.string(), z.string());

export const MessageBlock = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string() }),
  z.object({
    kind: z.literal("card"),
    lines: z.array(z.object({ k: z.string(), v: z.string() })),
  }),
  /** A task an agent created on the board: its reference, such as "FIN-42", and its title. */
  z.object({ kind: z.literal("ticket"), ref: z.string(), title: z.string() }),
  z.object({
    kind: z.literal("ask"),
    text: z.string(),
    approvalEffectId: Id.optional(),
    /** A proposed change to something that exists; shown as Apply or Dismiss, one card at a time. */
    proposal: z.literal(true).optional(),
    instructionUpdate: z
      .object({
        botId: Id,
        before: z.string(),
        after: z.string(),
        reason: z.string(),
        undoVersionId: Id.optional(),
      })
      .optional(),
    detail: z.string().optional(),
    /** What `text` and `detail` say, as a code the client words in the member's language. */
    card: z.object({ code: ApprovalCardCode, params: ServerCopyParams }).optional(),
    detailFormat: z.enum(["text", "code"]).optional(),
    input: z.enum(["text", "secret"]).optional(),
    /** Why the secret is needed; drives field label on the masked card. */
    purpose: SecretAskPurpose.optional(),
    // Records what the runtime could produce under either deployment mode, so
    // an ask persisted before an owner toggles the private-HTTP flag still
    // validates on replay.
    credential: botSecretDestinationSchema({ allowPrivateHttpOrigin: true }).optional(),
    /** On a fetch approval, the site an "always" answer allows. */
    site: z.string().optional(),
    /** What an "always" answer keeps on any other approval: one tool, on one connection, for one agent. */
    alwaysAllow: z
      .object({ agent: z.string(), connection: z.string(), tool: z.string() })
      .optional(),
    status: z.enum(["pending", "answered"]).optional(),
    answer: z.string().optional(),
    /** A secret request the user dismissed instead of answering. */
    dismissed: z.literal(true).optional(),
    actions: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          outcome: z.enum(["created", "cancelled"]).optional(),
        }),
      )
      .optional(),
  }),
  z.object({
    kind: z.literal("choice"),
    question: z.string(),
    subtitle: z.string().optional(),
    options: z.array(z.object({ id: z.string(), letter: z.string(), label: z.string() })),
    /** Set once the user picks an option; renders the picker as answered. */
    answerId: z.string().optional(),
  }),
  z.object({
    /** Inline app authorization card (Composio-backed): logo, name, one-line
        description, and an Authorize button that flips to connected. */
    kind: z.literal("app_connect"),
    connectorId: z.string().optional(),
    provider: z.string(),
    name: z.string(),
    description: z.string(),
    logo: z.string().nullable(),
    status: z.enum(["pending", "connected"]),
  }),
  z.object({
    /** An action the partner's page can carry out, proposed by the agent. Nothing runs until
        the person confirms it in the card; the page then reports how it went. */
    kind: z.literal("host_action"),
    actionId: z.string().min(1).max(64),
    name: z.string().max(40),
    label: z.string().max(200),
    params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    status: z.enum(["pending", "done", "denied", "failed"]),
  }),
  z.object({
    kind: z.literal("connect"),
    name: z.string(),
    initial: z.string(),
    color: z.string(),
    status: z.enum(["pending", "connected"]),
  }),
  z.object({
    kind: z.literal("computer"),
    state: z.string(),
    text: z.string(),
  }),
  z.object({
    /** Transcript card left in the thread when the bot hangs up a voice call. */
    kind: z.literal("voice_call"),
    /** Absent when the call had no client nonce to derive an id from. */
    callId: z.string().optional(),
    title: z.string(),
    farewell: z.string(),
    /** Connected time the caller's client measured; absent when the bot hung up. */
    durationSeconds: z.number().int().nonnegative().optional(),
  }),
  z.object({
    /** The bot is calling the user; the card tracks the call from ringing to its outcome. */
    kind: z.literal("call_request"),
    callId: z.string(),
    /** Why the bot is calling, shown on the incoming call. */
    reason: z.string(),
    /** The bot's first spoken sentence once the user answers. */
    opening: z.string(),
    status: z.enum(["ringing", "answered", "declined", "missed"]),
    expiresAt: z.string(),
    /** Connected time the user's client measured after answering. */
    durationSeconds: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal("meta"),
    text: z.string(),
    /** A notice a client words itself in the member's language; `text` is the fallback. */
    code: MetaCode.optional(),
    params: ServerCopyParams.optional(),
    /** Detail behind the notice, such as the reason an agent gave. */
    detail: z.string().optional(),
  }),
  z.object({
    kind: z.literal("progress"),
    text: z.string(),
    /** Provider-generated tool status rather than assistant-authored narration. */
    activity: z.literal(true).optional(),
    pendingToolNames: z.array(z.string()).optional(),
  }),
  z.object({
    kind: z.literal("steps"),
    steps: z.array(z.object({ label: z.string(), count: z.number().int().positive() })),
    durationMs: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal("subagent"),
    agentId: z.string(),
    name: z.string(),
    task: z.string(),
    status: z.enum(["running", "completed", "failed"]),
    progress: z.string().optional(),
    result: z.string().optional(),
    /** `progress` and `result` are the start of a longer text; `threads.message` returns it whole. */
    truncated: z.literal(true).optional(),
  }),
  z.object({
    /** A bot's plan for a request with several stages, kept current as they start and finish. */
    kind: z.literal("plan"),
    title: z.string().max(120),
    steps: z
      .array(
        z.object({
          id: z.string().max(20),
          label: z.string().max(200),
          /** Who does it: a teammate or a group. */
          owner: z.string().max(80).optional(),
          status: z.enum(["pending", "running", "done", "failed"]),
          /** One line on how it went or what it is waiting for. */
          note: z.string().max(300).optional(),
        }),
      )
      .max(12),
  }),
  z.object({
    /** What the wiki curator kept or proposed from this conversation; its state is read live. */
    kind: z.literal("wiki_change"),
    changeId: Id,
    pages: z.array(z.object({ title: z.string(), op: z.enum(["create", "append", "replace"]) })),
  }),
  z.object({
    /** A fact about the person an agent kept or proposes to keep; its state is read live. */
    kind: z.literal("memory_fact"),
    memoryId: Id,
    text: z.string(),
  }),
  z.object({
    kind: z.literal("child_bot"),
    botId: z.string(),
    name: z.string(),
    title: z.string().optional(),
    status: z.enum(["created", "archived", "deleted"]),
  }),
  z.object({
    /** Compact card for a remote cloud coding agent (not the bot computer). */
    kind: z.literal("cloud_agent"),
    agentId: z.string(),
    title: z.string(),
    status: z.enum(["running", "finished", "failed", "cancelled", "expired"]),
    url: z.string(),
    branch: z.string().optional(),
    prUrl: z.string().optional(),
    latestRunId: z.string().optional(),
  }),
  z.object({
    kind: z.literal("skill_draft"),
    skillId: Id,
    name: z.string(),
    goal: z.string(),
    playbook: z.object({
      whenToUse: z.string(),
      inputs: z.array(z.string()),
      steps: z.array(z.string()),
      howToCheck: z.string(),
      whatToReturn: z.string(),
      approvalBoundaries: z.string(),
      failureHandling: z.string(),
    }),
    status: z.enum(["draft", "saved"]),
  }),
  ChartBlock,
  z.object({
    /** Approval card for an agent-created MCP server. The user completes the
        OAuth popup (or confirms no authorization is needed) in the UI. The
        status persists so the card renders its decision after a remount. */
    kind: z.literal("mcp_approval"),
    name: z.string(),
    serverId: Id,
    transport: McpTransportSchema,
    endpoint: z.string().nullable(),
    needsOAuth: z.boolean(),
    /** The server takes an API key as a bearer token; the card asks the user for it. */
    needsKey: z
      .object({
        label: z.string().max(80),
        hint: z.string().max(200).optional(),
        docsUrl: z.string().url().max(500).optional(),
      })
      .optional(),
    status: z.enum(["pending", "connected", "dismissed"]).default("pending"),
    /**
     * Set when the card asks for access for a teammate of the bot whose chat shows it, such as a
     * chief asking for an agent it delegated to. Approving gives the teammate the server.
     */
    forBotId: Id.optional(),
    forBotName: z.string().max(200).optional(),
    /** Set when the card asks for read access only. Approving grants exactly this level. */
    level: z.enum(["read", "write"]).optional(),
  }),
  z.object({
    kind: z.literal("import_setup"),
    items: z.array(AgentImportSetupItemSchema),
    /** Set by Undo, which also empties `items`; the checklist is then hidden. */
    undone: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("image"),
    /** Explicit visual input requested by a confirmation-aware client. */
    imageHandling: z.literal("confirm").optional(),
    artifactId: Id,
    mimeType: z.string(),
    name: z.string(),
  }),
  z.object({
    kind: z.literal("file"),
    artifactId: Id,
    mimeType: z.string(),
    name: z.string(),
    size: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("handoff"),
    fromBotId: Id,
    toBotId: Id,
    text: z.string(),
    /** Why the sender chose this recipient, shown beside the handoff. */
    reason: z.string().max(HANDOFF_REASON_MAX_LENGTH).optional(),
    /** Links ownership transfers in one user-started group turn. */
    hop: z.number().int().positive().optional(),
    /** Set when the sender is outside the group: the stage's result comes back to it. */
    returnsToSender: z.literal(true).optional(),
    /** The sender could route to groups it is not in, so the result may let it route on. */
    routedWithAuthority: z.literal(true).optional(),
    /** The step of the sender's plan this stage carries; its status follows the work. */
    planStep: z.string().max(20).optional(),
  }),
  z.object({
    /** A group-chat message delivered into a member bot's own thread. */
    kind: z.literal("channel_message"),
    provider: z.string(),
    /** Per-message network when a provider spans multiple transports. */
    transport: z.string().optional(),
    channelId: Id,
    fromAddress: z.string(),
    fromLabel: z.string(),
    text: z.string(),
    hop: z.number().int().nonnegative().optional(),
  }),
  z.object({
    /**
     * Marks a message from an outside person who wrote to a linked WhatsApp number. The run it
     * starts is a visitor run, which is offered a small allowlist of tools.
     */
    kind: z.literal("visitor_message"),
    installationId: Id,
    conversationId: Id,
  }),
  z.object({
    /**
     * Marks a message the owner wrote in their own "Message yourself" chat of a linked WhatsApp
     * number, so the agent's answer goes back to that chat and not to another app.
     */
    kind: z.literal("linked_chat"),
    installationId: Id,
    /** The provider thread the answer is sent to. */
    threadId: z.string(),
  }),
  z.object({
    /** Shown in the sending bot's own chat, so the user can see what it sent. */
    kind: z.literal("bot_message_sent"),
    toBotId: Id,
    toBotName: z.string(),
    text: z.string(),
    intent: BotMessageIntent.optional(),
  }),
  z.object({
    /** Delivered into the receiving bot's own chat as the prompt that woke it. */
    kind: z.literal("bot_message_received"),
    fromBotId: Id,
    fromBotName: z.string(),
    text: z.string(),
    intent: BotMessageIntent.optional(),
    /** Sender-thread echo this delivery answers, when applicable. */
    returnToMessageId: Id.optional(),
    /** Links in a bot-started chain; absent when a person started it. */
    hop: z.number().int().nonnegative().optional(),
    /** The answer to a routed handoff: the router that sent it may route the next stage. */
    continuesRouting: z.literal(true).optional(),
    /** The step of the sender's plan this request carries; its status follows the work. */
    planStep: z.string().max(20).optional(),
    /**
     * A consultation for someone outside the sender's audience: the answer reaches the asking
     * agent, and `text` is left empty here so the person never reads it.
     */
    consultation: z.literal(true).optional(),
  }),
]);
export type MessageBlock = z.infer<typeof MessageBlock>;

/**
 * Something the bot did on its computer, shown in the terminal's Activity view: a shell
 * command (with a redacted output tail) or a file/app action, whose `command` is the path or
 * app name.
 */
export const COMPUTER_COMMAND_OUTPUT_MAX_CHARS = 16_000;
export const ComputerCommandKind = z.enum([
  "shell",
  "write_file",
  "attach_file",
  "open_path",
  "launch_app",
]);
export type ComputerCommandKind = z.infer<typeof ComputerCommandKind>;
export const ComputerCommandSchema = z.object({
  executionId: z.string(),
  kind: ComputerCommandKind,
  command: z.string(),
  cwd: z.string(),
  status: z.enum(["running", "done"]),
  exitCode: z.number().int().nullable(),
  output: z.string(),
  /** `output` is the start of a longer one; `computer.commandOutput` returns it whole. */
  outputTruncated: z.literal(true).optional(),
  /** Size written by write_file. */
  bytes: z.number().int().nonnegative().optional(),
});
export type ComputerCommand = z.infer<typeof ComputerCommandSchema>;

/**
 * Collapse running/done events into one entry per command, in start order. A finished
 * command stays finished, so history and live events can be merged in either order.
 */
export function foldComputerCommands<T extends ComputerCommand>(events: T[]): T[] {
  const byId = new Map<string, T>();
  for (const event of events) {
    if (byId.get(event.executionId)?.status === "done" && event.status === "running") continue;
    byId.set(event.executionId, event);
  }
  return [...byId.values()];
}

export const ProductEventSchema = z.object({
  id: Id,
  spaceId: Id,
  threadId: Id,
  botId: Id,
  seq: z.number().int().nonnegative(),
  type: ProductEventType,
  runId: Id.optional(),
  createdAt: z.string(),
  payload: z.record(z.string(), z.unknown()),
});
export type ProductEvent = z.infer<typeof ProductEventSchema>;

export const ReplyPreviewSchema = z.object({
  role: MessageRole,
  botId: Id.optional(),
  text: z.string(),
  attachment: z
    .object({
      kind: z.enum(["image", "file"]),
      artifactId: Id,
      mimeType: z.string(),
      name: z.string(),
    })
    .optional(),
});
export type ReplyPreview = z.infer<typeof ReplyPreviewSchema>;

/**
 * Why an agent did or did not answer a channel message. The first five answer; the rest do not.
 * `router_failed` answered by default because the router could not decide.
 */
export const ROUTING_REASONS = [
  "router_picked",
  "mentioned",
  "thread_owner",
  "follow_up",
  "router_failed",
  "not_picked",
  "none_needed",
  "not_in_audience",
  "paused",
  "over_budget",
] as const;
export const RoutingReason = z.enum(ROUTING_REASONS);
export type RoutingReason = z.infer<typeof RoutingReason>;

/** Who was considered for a channel message and why each did or did not answer. No message text. */
export const RoutingReportSchema = z.object({
  /** The router model judged it, or fixed rules (a mention, the thread owner, a follow-up). */
  by: z.enum(["router", "rules"]),
  /** The router model's own short rationale, kept as it said it. */
  note: z.string().max(200).optional(),
  agents: z.array(z.object({ botId: Id, reason: RoutingReason })).max(100),
});
export type RoutingReport = z.infer<typeof RoutingReportSchema>;

export const MessageVariantsSchema = z.object({
  /** Zero-based place of the version on screen. */
  index: z.number().int().nonnegative(),
  count: z.number().int().min(2),
  /** The branch of each version in order; null is the original line. */
  branchIds: z.array(Id.nullable()),
});
export type MessageVariants = z.infer<typeof MessageVariantsSchema>;

export const ThreadMessageSchema = z.object({
  id: Id,
  threadId: Id,
  seq: z.number().int().nonnegative(),
  role: MessageRole,
  blocks: z.array(MessageBlock),
  botId: Id.optional(),
  replyToMessageId: Id.optional(),
  replyQuote: z.string().optional(),
  replyPreview: ReplyPreviewSchema.nullable().optional(),
  /** The channel message this one is a thread reply to; absent in the main column. */
  threadRootId: Id.optional(),
  runId: Id.optional(),
  /** Set when the message was sent from a live voice call; groups one call's transcript. */
  callId: z.string().optional(),
  /** Who wrote a user message in a shared conversation; absent on older messages. */
  authorUserId: Id.optional(),
  /** On the message that opens one of several versions of a point in the chat (regenerated or edited). */
  variants: MessageVariantsSchema.optional(),
  authorName: z.string().optional(),
  authorImage: z.string().nullable().optional(),
  /** The routine whose run wrote this message; absent for anything a person or a chat started. */
  routineName: z.string().optional(),
  /** When the message was pinned to the channel; absent when it is not pinned. */
  pinnedAt: z.string().optional(),
  /** Who a channel message was routed to and why; absent outside channels and on older messages. */
  routingReport: RoutingReportSchema.optional(),
  createdAt: z.string(),
});
export type ThreadMessage = z.infer<typeof ThreadMessageSchema>;

export function canReactToThreadMessage(message: Pick<ThreadMessage, "id" | "blocks">): boolean {
  return (
    !message.id.startsWith("progress:") &&
    !message.id.startsWith("subagent:") &&
    !message.blocks.some((block) => block.kind === "channel_message")
  );
}

/** What a space hint says changed. A hint carries no content: the client reads it through the RPC. */
export const SPACE_HINT_KINDS = [
  "roster",
  "approvals",
  "dm",
  "computer",
  "routines",
  "notifications",
  "presence",
] as const;
export const SpaceHintKind = z.enum(SPACE_HINT_KINDS);
export type SpaceHintKind = z.infer<typeof SpaceHintKind>;

/**
 * One frame of a member's space stream: an invalidation hint, or a `heartbeat` that only proves
 * the stream is alive. Neither carries ids or content.
 */
export const SpaceHintSchema = z.object({
  kind: z.union([SpaceHintKind, z.literal("heartbeat")]),
  createdAt: z.string(),
});
export type SpaceHint = z.infer<typeof SpaceHintSchema>;
